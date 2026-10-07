import {
  feedbackEffect,
  createComputePass,
  createSimulationDisplay,
  simulationSource,
  simulationUniformLayout,
  hash,
  type FeedbackProgram,
  type BufferTap,
} from '@mk7s/hologpu-core';
import { createPrefixSum, createSort, createSpatialHash } from '@mk7s/hologpu-core';
export const primitiveSchema = {
  count: {
    type: 'u32',
    default: 4096,
    min: 16,
    max: 1048576,
    step: 16,
    uniform: false,
    group: 'Workload',
    description: 'Number of unsigned elements or grid points; changing the workload reseeds it.',
  },
  threshold: {
    type: 'f32',
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.01,
    group: 'Workload',
    description:
      'Nonzero selection probability for scan/compaction, or extent of generated sort keys.',
  },
  algorithm: {
    type: 'enum',
    default: 'radix',
    options: ['radix', 'bitonic'],
    group: 'Workload',
    description: 'Stable unsigned radix sort or padded bitonic sorting network.',
  },
  grid: {
    type: 'u32',
    default: 32,
    min: 4,
    max: 64,
    step: 4,
    uniform: false,
    group: 'Workload',
    description: 'Uniform grid dimensions along both normalized position axes.',
  },
  view: {
    type: 'enum',
    default: 'result',
    options: ['result', 'input', 'indices'],
    group: 'Inspection',
    description: 'Show algorithm output, original input, or associated sorted/compacted row IDs.',
  },
  tint: {
    type: 'color',
    default: '#c2e8a6',
    group: 'Palette',
    description: 'Algorithm result accent color.',
  },
  background: {
    type: 'color',
    default: '#12202b',
    group: 'Palette',
    description: 'Opaque comparison panel background.',
  },
} as const;
const declaration = `@group(1) @binding(3) var<uniform> config:vec4u;@group(1) @binding(0) var<storage,read_write> input:array<u32>;@group(1) @binding(1) var<storage,read_write> values:array<u32>;@group(1) @binding(2) var<storage,read_write> positions:array<vec4f>;`;
export function primitiveDemo(id: 'prefix-sum' | 'sort' | 'spatial-hash', title: string) {
  return feedbackEffect({
    id,
    title,
    family: 'primitives',
    core: true,
    tags: ['compute', 'storage', 'parallel'],
    inputs: [],
    features: [],
    params: {
      count: primitiveSchema.count,
      threshold: primitiveSchema.threshold,
      view: primitiveSchema.view,
      tint: primitiveSchema.tint,
      background: primitiveSchema.background,
      ...(id === 'sort' ? { algorithm: primitiveSchema.algorithm } : {}),
      ...(id === 'spatial-hash' ? { grid: primitiveSchema.grid } : {}),
    },
    presets: {
      sparse: { threshold: 0.15, count: 1024, tint: '#efbc89' },
      dense: {
        threshold: 0.85,
        count: 16384,
        tint: '#a8bdf7',
        ...(id === 'sort' ? { algorithm: 'bitonic' } : id === 'spatial-hash' ? { grid: 16 } : {}),
      },
    },
    quality: { resolutionScale: [0.25, 1] },
    reducedMotion: { time: 0 },
    fallback: 'linear-gradient(135deg,#12202b,#466755)',
    async setup(ctx): Promise<FeedbackProgram> {
      const device = ctx.device,
        uniform = simulationUniformLayout(device),
        capacity = 1048576;
      const buffers: GPUBuffer[] = [],
        leases: { dispose(): void }[] = [];
      let scan: Awaited<ReturnType<typeof createPrefixSum>> | null = null,
        radix: Awaited<ReturnType<typeof createSort>> | null = null,
        bitonic: Awaited<ReturnType<typeof createSort>> | null = null,
        grid: Awaited<ReturnType<typeof createSpatialHash>> | null = null;
      const allocate = (bytes: number, label: string) => {
        const buffer = device.createBuffer({
          label: `${id}-${label}`,
          size: bytes,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });
        buffers.push(buffer);
        return buffer;
      };
      try {
        const input = allocate(capacity * 4, 'input'),
          values = allocate(capacity * 4, 'values'),
          positions = allocate(id === 'spatial-hash' ? capacity * 16 : 16, 'positions'),
          counter = allocate(4, 'counter');
        if (id === 'prefix-sum') scan = await createPrefixSum(ctx.session, capacity);
        else if (id === 'sort') {
          radix = await createSort(ctx.session, capacity);
          bitonic = await createSort(ctx.session, capacity, 'bitonic');
        } else
          grid = await createSpatialHash(ctx.session, capacity, {
            dimensions: [32, 32, 1],
            maxDimensions: [64, 64, 1],
          });
        const initLayout = device.createBindGroupLayout({
          entries: [0, 1, 2, 3].map((binding) => ({
            binding,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: binding === 3 ? ('uniform' as const) : ('storage' as const) },
          })),
        });
        const initSource = simulationSource(
          ctx.params.schema,
          `${declaration}
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) gid:vec3u){let i=gid.x;if(i>=config.x){return;}let r=random(hash_u32(i^frame.seed));let s=random(hash_u32(i+frame.seed*17041u));input[i]=${id === 'prefix-sum' ? 'select(0u,1u,r<params.threshold)' : 'u32(r*max(2.0,params.threshold*4096.0))'};values[i]=i;${id === 'spatial-hash' ? 'positions[i]=vec4f(r,s,0,1);' : ''}}`,
          [hash],
        );
        const initialize = await createComputePass(ctx.session, initSource, `${id}-initialize`, [
          uniform,
          initLayout,
        ]);
        leases.push(initialize);
        const displayLayout = device.createBindGroupLayout({
          entries: [0, 1, 2, 3, 4].map((binding) => ({
            binding,
            visibility: GPUShaderStage.FRAGMENT,
            buffer: { type: binding === 4 ? ('uniform' as const) : ('read-only-storage' as const) },
          })),
        });
        const displaySource = simulationSource(
          ctx.params.schema,
          `@group(1) @binding(4) var<uniform> config:vec4u;@group(1) @binding(0) var<storage,read> output:array<u32>;@group(1) @binding(1) var<storage,read> original:array<u32>;@group(1) @binding(2) var<storage,read> indices:array<u32>;@group(1) @binding(3) var<storage,read> count:array<u32>;
@fragment fn fragment(in:VertexOut)->@location(0)vec4f{let columns=64u;let rows=64u;let p=vec2u(clamp(in.uv,vec2f(0),vec2f(.99999))*vec2f(f32(columns),f32(rows)));let cell=p.x+columns*p.y;let index=min(config.x-1u,cell*config.x/(columns*rows));var a=0.0;
${id === 'spatial-hash' ? 'a=f32(output[cell%(config.y*config.y)])/max(1.0,f32(config.x)/f32(config.y*config.y)*2.0);' : id === 'sort' ? 'a=f32(output[index])/max(2.0,params.threshold*4096.0);' : 'a=f32(output[index])/max(1.0,f32(config.x));'}
if(params.view==1u){a=f32(original[index])/${id === 'prefix-sum' ? '1.0' : 'max(2.0,params.threshold*4096.0)'};}
if(params.view==2u){${id === 'prefix-sum' ? 'if(count[0]>0u){let packed=min(count[0]-1u,cell*count[0]/(columns*rows));a=f32(indices[packed])/f32(config.x);}' : 'a=f32(indices[index])/f32(config.x);'}}
let local=fract(in.uv*vec2f(f32(columns),f32(rows)));let edge=smoothstep(0.0,.1,min(min(local.x,local.y),min(1.0-local.x,1.0-local.y)));let color=mix(params.background.rgb,params.tint.rgb,clamp(a,0.0,1.0)*.9+.06)*mix(.6,1.0,edge);return vec4f(color,1);}`,
        );
        const display = await createSimulationDisplay(
          ctx.session,
          displaySource,
          ctx.format,
          `${id}-display`,
          [uniform, displayLayout],
        );
        leases.push(display);
        let output = input,
          ids = values,
          total = counter,
          selected = Number(ctx.params.values.count),
          gridDimension = Number(ctx.params.values.grid ?? 32);
        const configs = new Map<string, GPUBuffer>();
        const argumentsBuffer = () => {
          const key = `${selected}:${gridDimension}`;
          let buffer = configs.get(key);
          if (!buffer) {
            buffer = device.createBuffer({
              size: 16,
              usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            device.queue.writeBuffer(buffer, 0, new Uint32Array([selected, gridDimension, 0, 0]));
            configs.set(key, buffer);
            buffers.push(buffer);
          }
          return buffer;
        };
        const compute = (encoder: GPUCommandEncoder, uniforms: GPUBindGroup) => {
          const initGroup = device.createBindGroup({
            layout: initLayout,
            entries: [input, values, positions, argumentsBuffer()].map((buffer, binding) => ({
              binding,
              resource: { buffer },
            })),
          });
          initialize.dispatch(encoder, [uniforms, initGroup], [Math.ceil(selected / 256)]);
          if (scan) {
            output = scan.encode(encoder, input, selected);
            const compact = scan.compact(encoder, input, selected);
            ids = compact.indices;
            total = compact.count;
          } else if (radix && bitonic) {
            const result = (ctx.params.values.algorithm === 'radix' ? radix : bitonic).encode(
              encoder,
              input,
              values,
              selected,
            );
            output = result.keys;
            ids = result.values;
          } else if (grid) {
            grid.encode(encoder, positions, selected);
            output = grid.cellCounts;
            ids = grid.sortedIndices;
          }
        };
        return {
          resize() {
            const nextCount = Number(ctx.params.values.count),
              nextGrid = Number(ctx.params.values.grid ?? 32);
            const changed = selected !== nextCount || gridDimension !== nextGrid;
            selected = nextCount;
            gridDimension = nextGrid;
            grid?.resize([nextGrid, nextGrid, 1]);
            return changed;
          },
          initialize(encoder, _frame, uniforms) {
            compute(encoder, uniforms);
          },
          step(encoder, _frame, uniforms) {
            compute(encoder, uniforms);
          },
          display(encoder, target, _frame, uniforms) {
            const group = device.createBindGroup({
              layout: displayLayout,
              entries: [output, input, ids, total, argumentsBuffer()].map((buffer, binding) => ({
                binding,
                resource: { buffer },
              })),
            });
            display.draw(encoder, target, [uniforms, group]);
          },
          get sources() {
            return {
              initialize: initialize.source,
              display: display.source,
              ...scan?.sources,
              ...radix?.sources,
              ...bitonic?.sources,
              ...grid?.sources,
            };
          },
          get diagnostics() {
            return [
              ...leases.flatMap((pass) => ('diagnostics' in pass ? (pass.diagnostics as []) : [])),
              ...(scan?.diagnostics ?? []),
              ...(radix?.diagnostics ?? []),
              ...(bitonic?.diagnostics ?? []),
              ...(grid?.diagnostics ?? []),
            ];
          },
          bufferTaps() {
            const taps: Record<string, BufferTap> = {
              input: { buffer: input, count: selected, stride: 4 },
              output: {
                buffer: output,
                count: id === 'spatial-hash' ? gridDimension * gridDimension : selected,
                stride: 4,
              },
              indices: { buffer: ids, count: selected, stride: 4 },
            };
            if (scan) taps.compactedCount = { buffer: total, count: 1, stride: 4 };
            if (grid) {
              taps.cellOffsets = { buffer: grid.cellOffsets, count: grid.cellCount + 1, stride: 4 };
              taps.sortedKeys = { buffer: grid.sortedKeys, count: selected, stride: 4 };
            }
            return taps;
          },
          memory() {
            return {
              bufferBytes:
                buffers.reduce((n, b) => n + b.size, 0) +
                (scan?.memory.bufferBytes ?? 0) +
                (radix?.memory.bufferBytes ?? 0) +
                (bitonic?.memory.bufferBytes ?? 0) +
                (grid?.memory.bufferBytes ?? 0),
              textureBytes: 0,
            };
          },
          dispose() {
            buffers.forEach((b) => b.destroy());
            leases.forEach((l) => l.dispose());
            scan?.dispose();
            radix?.dispose();
            bitonic?.dispose();
            grid?.dispose();
          },
        };
      } catch (error) {
        buffers.forEach((b) => b.destroy());
        leases.forEach((l) => l.dispose());
        scan?.dispose();
        radix?.dispose();
        bitonic?.dispose();
        grid?.dispose();
        throw error;
      }
    },
  });
}
