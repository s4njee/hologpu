import {
  createParticleBuffers,
  createComputePass,
  simulationSource,
  simulationUniformLayout,
  createSpatialHash,
  hash,
  type EffectContext,
  type ParamSchema,
  type ParticleProgram,
  type BufferTap,
} from '@mk7s/hologpu-core';
import { particlePresentation } from '../_particles/render.ts';
import * as shader from './shaders.ts';
export async function neighborProgram<S extends ParamSchema>(
  ctx: EffectContext<S>,
  id: 'boids' | 'n-body',
): Promise<ParticleProgram> {
  const device = ctx.device,
    uniforms = simulationUniformLayout(device);
  const layout = device.createBindGroupLayout({
    label: `${id}-state`,
    entries: [0, 1, 2, 3, 4, 5].map((binding) => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: {
        type: ([0, 2, 3].includes(binding)
          ? 'read-only-storage'
          : 'storage') as GPUBufferBindingType,
      },
    })),
  });
  const drawLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });
  const source = (code: string) =>
    simulationSource(ctx.params.schema, shader.declarations + code, [hash]);
  const sources = {
    initialize: source(shader.initialize),
    ...(id === 'boids'
      ? { flock: source(shader.boids) }
      : {
          aggregate: source(shader.aggregate),
          tiled: source(shader.gravityFunctions + shader.tiled),
          grid: source(shader.gravityFunctions + shader.gridGravity),
        }),
  };
  const leases: { dispose(): void }[] = [];
  let state: ReturnType<typeof createParticleBuffers> | undefined,
    grid: Awaited<ReturnType<typeof createSpatialHash>> | undefined,
    statistics: GPUBuffer | undefined,
    aggregates: GPUBuffer | undefined;
  try {
    const passes: Record<string, Awaited<ReturnType<typeof createComputePass>>> = {};
    for (const [key, composed] of Object.entries(sources)) {
      const pass = await createComputePass(ctx.session, composed, `${id}-${key}`, [
        uniforms,
        layout,
      ]);
      leases.push(pass);
      passes[key] = pass;
    }
    grid = await createSpatialHash(ctx.session, id === 'boids' ? 65536 : 16384, {
      dimensions: [Number(ctx.params.values.grid), Number(ctx.params.values.grid), 1],
      axes: 'xy',
      maxDimensions: [64, 64, 1],
    });
    leases.push(grid);
    const quad = simulationSource(ctx.params.schema, shader.drawing);
    const point = simulationSource(
      ctx.params.schema,
      shader.drawing
        .replace('@builtin(instance_index) instance:u32', '@builtin(instance_index) ignored:u32')
        .replace(
          'let a=particles[instance];let local=corners[vertex];',
          'let a=particles[vertex];let local=vec2f(0);',
        ),
    );
    const presentation = await particlePresentation(ctx, id, point, quad, drawLayout);
    leases.push(presentation);
    let count = 0,
      dimension = 0,
      side = 0,
      groups: GPUBindGroup[] = [],
      drawGroups: GPUBindGroup[] = [];
    const methodOffset = ctx.params.layout.fields.find((f) => f.name === 'method')?.offset;
    function bind() {
      groups = [0, 1].map(() => {
        const g = device.createBindGroup({
          layout,
          entries: [
            { binding: 0, resource: { buffer: state!.read } },
            { binding: 1, resource: { buffer: state!.write } },
            { binding: 2, resource: { buffer: grid!.sortedIndices } },
            { binding: 3, resource: { buffer: grid!.cellOffsets } },
            { binding: 4, resource: { buffer: statistics! } },
            { binding: 5, resource: { buffer: aggregates! } },
          ],
        });
        state!.swap();
        return g;
      });
      drawGroups = [0, 1].map(() => {
        const g = device.createBindGroup({
          layout: drawLayout,
          entries: [{ binding: 0, resource: { buffer: state!.read } }],
        });
        state!.swap();
        return g;
      });
    }
    return {
      resize(size) {
        presentation.resize(size);
        const c = Number(ctx.params.values.count),
          n = Number(ctx.params.values.grid);
        if (c === count && n === dimension) return false;
        count = c;
        dimension = n;
        state?.dispose();
        statistics?.destroy();
        aggregates?.destroy();
        state = createParticleBuffers(ctx.session, { count, stride: 16, label: `${id}-particles` });
        statistics = device.createBuffer({
          label: `${id}-statistics`,
          size: count * 16,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });
        aggregates = device.createBuffer({
          label: `${id}-aggregates`,
          size: dimension * dimension * 16,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });
        grid!.resize([dimension, dimension, 1]);
        side = 0;
        bind();
        return true;
      },
      initialize(encoder, _frame, uniform) {
        if (side % 2) state!.swap();
        side = 0;
        encoder.clearBuffer(statistics!);
        encoder.clearBuffer(aggregates!);
        passes.initialize!.dispatch(encoder, [uniform, groups[0]!], [Math.ceil(count / 64), 1, 1]);
        passes.initialize!.dispatch(encoder, [uniform, groups[1]!], [Math.ceil(count / 64), 1, 1]);
        grid!.encode(encoder, state!.read, count);
        presentation.reset();
      },
      step(encoder, _frame, uniform, snapshot) {
        const group = groups[side % 2]!;
        if (id === 'boids') {
          grid!.encode(encoder, state!.read, count);
          passes.flock!.dispatch(encoder, [uniform, group], [Math.ceil(count / 64), 1, 1]);
        } else {
          const method = new DataView(snapshot).getUint32(methodOffset!, true);
          if (method === 0)
            passes.tiled!.dispatch(encoder, [uniform, group], [Math.ceil(count / 64), 1, 1]);
          else {
            grid!.encode(encoder, state!.read, count);
            passes.aggregate!.dispatch(
              encoder,
              [uniform, group],
              [Math.ceil((dimension * dimension) / 64), 1, 1],
            );
            passes.grid!.dispatch(encoder, [uniform, group], [Math.ceil(count / 64), 1, 1]);
          }
        }
        state!.swap();
        side++;
      },
      display(encoder, target, frame, uniform) {
        presentation.draw(
          encoder,
          target,
          uniform,
          drawGroups[side % 2]!,
          count,
          'quad',
          frame.index,
        );
      },
      textureTaps: () => presentation.textureTaps(),
      bufferTaps(): Readonly<Record<string, BufferTap>> {
        return {
          particles: {
            buffer: state!.read,
            count,
            stride: 16,
            label: 'Particle position xy and velocity xy (f32)',
          },
          statistics: {
            buffer: statistics!,
            count,
            stride: 16,
            label:
              id === 'boids'
                ? 'Exact neighbor count, candidate count, acceleration xy'
                : 'Acceleration xy, speed, unit body marker',
          },
          sortedIndices: {
            buffer: grid!.sortedIndices,
            count,
            stride: 4,
            label: 'Last indexed particle IDs sorted by spatial cell',
          },
          sortedKeys: {
            buffer: grid!.sortedKeys,
            count,
            stride: 4,
            label: 'Last indexed row-major spatial cell keys',
          },
          cellOffsets: {
            buffer: grid!.cellOffsets,
            count: dimension * dimension + 1,
            stride: 4,
            label: 'Exclusive prefix-sum cell boundaries',
          },
          cellCounts: {
            buffer: grid!.cellCounts,
            count: dimension * dimension,
            stride: 4,
            label: 'Per-cell particle population',
          },
          ...(id === 'n-body'
            ? {
                aggregates: {
                  buffer: aggregates!,
                  count: dimension * dimension,
                  stride: 16,
                  label: 'Per-cell center xy, mass, body count',
                },
              }
            : {}),
        };
      },
      memory() {
        return {
          textureBytes: presentation.bytes,
          bufferBytes:
            (state?.bytes ?? 0) +
            (statistics?.size ?? 0) +
            (aggregates?.size ?? 0) +
            grid!.memory.bufferBytes,
        };
      },
      dispose() {
        state?.dispose();
        statistics?.destroy();
        aggregates?.destroy();
        leases.reverse().forEach((p) => p.dispose());
      },
      sources: { ...sources, ...grid.sources, ...presentation.sources },
      diagnostics: [
        ...Object.values(passes).flatMap((p) => p.diagnostics),
        ...grid.diagnostics,
        ...presentation.diagnostics,
      ],
    };
  } catch (error) {
    state?.dispose();
    statistics?.destroy();
    aggregates?.destroy();
    leases.reverse().forEach((p) => p.dispose());
    throw error;
  }
}
