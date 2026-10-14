import {
  particleEffect,
  createParticleBuffers,
  createComputePass,
  simulationSource,
  simulationUniformLayout,
  hash,
  noise,
  type ParamSchema,
  type ParticleOptions,
  type EffectContext,
  type ParticleProgram,
  type EffectInstance,
} from '@mk7s/hologpu-core';
import { particlePresentation } from './render.ts';
export const renderParams = {
  count: {
    type: 'u32',
    default: 65536,
    min: 64,
    max: 1048576,
    step: 64,
    uniform: false,
    group: 'Particles',
    description: 'Storage particle count; changing it restarts the seeded field.',
  },
  draw: {
    type: 'enum',
    default: 'quad',
    options: ['point', 'quad'],
    group: 'Rendering',
    description: 'One raster point or six-vertex instanced quad per particle.',
  },
  size: {
    type: 'f32',
    default: 1.6,
    min: 0.5,
    max: 8,
    step: 0.1,
    group: 'Rendering',
    description: 'Quad diameter in display pixels; points remain one pixel.',
  },
  trail: {
    type: 'f32',
    default: 0.94,
    min: 0,
    max: 0.995,
    step: 0.005,
    group: 'Rendering',
    description:
      'Retained HDR energy per newly displayed simulation index; repeated paused renders preserve history.',
  },
  exposure: {
    type: 'f32',
    default: 0.8,
    min: 0.01,
    max: 4,
    step: 0.01,
    group: 'Rendering',
    description: 'Exposure before Reinhard HDR tone mapping.',
  },
  tint: {
    type: 'color',
    default: '#72dcd3',
    group: 'Palette',
    description: 'Additive particle colour.',
  },
  background: {
    type: 'color',
    default: '#07111e',
    group: 'Palette',
    description: 'Tone mapped empty-field background.',
  },
} as const;
export const particleStruct = `struct Particle { position:vec4f, velocity:vec4f };`;
export const randomInit = `let h=hash_u32(id.x+frame.seed*65537u);var p=Particle(vec4f(random(h)*2-1,random(hash_u32(h+1u))*2-1,random(hash_u32(h+2u))*2-1,random(hash_u32(h+3u))),vec4f(0));`;
export function particleShader<S extends ParamSchema>(
  schema: S,
  mode: 'point' | 'quad',
  position = 'p.position.xy',
  extra = '',
) {
  const indices = mode === 'point' ? 'vertex' : 'instance';
  return simulationSource(
    schema,
    `${particleStruct}@group(1) @binding(0) var<storage,read> particles:array<Particle>;${extra}
 struct ParticleOut{@builtin(position) position:vec4f,@location(0) local:vec2f,@location(1) color:vec3f};
 @vertex fn particleVertex(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->ParticleOut{let p=particles[${indices}];var out:ParticleOut;let center=${position};var local=vec2f(0);${mode === 'quad' ? `let corners=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));local=corners[vertex];` : ''}out.position=vec4f(center+local*params.size/frame.resolution,0,1);out.local=local;out.color=params.tint.rgb*mix(.06,.12,p.position.w)*min(1.0,10000.0/(.12*f32(arrayLength(&particles))));return out;}
 @fragment fn particleFragment(in:ParticleOut)->@location(0)vec4f{${mode === 'quad' ? 'if(dot(in.local,in.local)>1){discard;}' : ''}return vec4f(in.color,1);}`,
  );
}
interface ParticleCode<S extends ParamSchema> {
  initialize: string;
  step: string;
  position?: string;
  extra?: string;
  setupTargets?: (ctx: EffectContext<S>, count: number) => Float32Array;
  setInput?: (name: string, data: unknown) => void;
  /** Optional stateless presentation; legacy simulation and HDR presentation stay unchanged. */
  analytic?: {
    active(ctx: EffectContext<S>): boolean;
    create(ctx: EffectContext<S>, targets: () => GPUBuffer | undefined): Promise<EffectInstance>;
  };
}
export function basicParticleEffect<const S extends ParamSchema>(
  options: Omit<ParticleOptions<S>, 'setup'>,
  code: ParticleCode<S> | (() => ParticleCode<S>),
) {
  return particleEffect({
    ...options,
    async setup(ctx) {
      return basicProgram(ctx, options.id, typeof code === 'function' ? code() : code);
    },
  });
}
async function basicProgram<S extends ParamSchema>(
  ctx: EffectContext<S>,
  id: string,
  code: ParticleCode<S>,
): Promise<ParticleProgram> {
  const device = ctx.device,
    uniform = simulationUniformLayout(device);
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ...(code.setupTargets
        ? [
            {
              binding: 2,
              visibility: GPUShaderStage.COMPUTE,
              buffer: { type: 'read-only-storage' as const },
            },
          ]
        : []),
    ],
  });
  const drawLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });
  const declaration = `${particleStruct}@group(1) @binding(0) var<storage,read> previous:array<Particle>;@group(1) @binding(1) var<storage,read_write> next:array<Particle>;${code.setupTargets ? '@group(1) @binding(2) var<storage,read> targets:array<vec4f>;' : ''}${code.extra ?? ''}`;
  const initSource = simulationSource(
    ctx.params.schema,
    `${declaration}@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u){if(id.x>=arrayLength(&next)){return;}${code.initialize}next[id.x]=p;}`,
    [hash, noise],
  );
  const stepSource = simulationSource(
    ctx.params.schema,
    `${declaration}@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u){if(id.x>=arrayLength(&next)){return;}var p=previous[id.x];${code.step}next[id.x]=p;}`,
    [hash, noise],
  );
  const leases: { dispose(): void }[] = [];
  let buffers: ReturnType<typeof createParticleBuffers> | undefined, targets: GPUBuffer | undefined;
  try {
    const init = await createComputePass(ctx.session, initSource, `${id}-initialize`, [
      uniform,
      layout,
    ]);
    leases.push(init);
    const step = await createComputePass(ctx.session, stepSource, `${id}-simulate`, [
      uniform,
      layout,
    ]);
    leases.push(step);
    const presentation = await particlePresentation(
      ctx,
      id,
      particleShader(ctx.params.schema, 'point', code.position),
      particleShader(ctx.params.schema, 'quad', code.position),
      drawLayout,
    );
    leases.push(presentation);
    const analytic = await code.analytic?.create(ctx, () => targets);
    if (analytic) leases.push(analytic);
    let count = 0,
      side = 0,
      groups: GPUBindGroup[] = [],
      drawGroups: GPUBindGroup[] = [];
    let targetSelection = '';
    const selection = () =>
      JSON.stringify(
        Object.entries(ctx.params.schema)
          .filter(([, spec]) => spec.uniform === false)
          .map(([name]) => ctx.params.values[name]),
      );
    function uploadTargets() {
      targetSelection = selection();
      if (targets && code.setupTargets)
        device.queue.writeBuffer(targets, 0, code.setupTargets(ctx, count));
    }
    return {
      resize(size) {
        presentation.resize(code.analytic?.active(ctx) ? [1, 1] : size);
        analytic?.resize(size);
        const n = Number(ctx.params.values.count);
        if (n === count) {
          if (code.setupTargets && targetSelection !== selection()) uploadTargets();
          return false;
        }
        count = n;
        buffers?.dispose();
        targets?.destroy();
        buffers = createParticleBuffers(ctx.session, { count, stride: 32, label: id });
        if (code.setupTargets) {
          targets = device.createBuffer({
            label: `${id}-targets`,
            size: count * 16,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
          });
          uploadTargets();
        }
        side = 0;
        groups = [0, 1].map(() => {
          const g = device.createBindGroup({
            layout,
            entries: [
              { binding: 0, resource: { buffer: buffers!.read } },
              { binding: 1, resource: { buffer: buffers!.write } },
              ...(targets ? [{ binding: 2, resource: { buffer: targets } }] : []),
            ],
          });
          buffers!.swap();
          return g;
        });
        drawGroups = [0, 1].map(() => {
          const g = device.createBindGroup({
            layout: drawLayout,
            entries: [{ binding: 0, resource: { buffer: buffers!.read } }],
          });
          buffers!.swap();
          return g;
        });
        return true;
      },
      initialize(encoder, _frame, u) {
        presentation.reset();
        uploadTargets();
        if (side) buffers!.swap();
        side = 0;
        for (const g of groups) init.dispatch(encoder, [u, g], [Math.ceil(count / 128)]);
      },
      step(encoder, _frame, u) {
        if (code.analytic?.active(ctx)) return;
        step.dispatch(encoder, [u, groups[side]!], [Math.ceil(count / 128)]);
        buffers!.swap();
        side = 1 - side;
      },
      display(encoder, target, frame, u) {
        if (code.analytic?.active(ctx) && analytic) {
          analytic.render(frame, encoder, target);
          return;
        }
        presentation.draw(
          encoder,
          target,
          u,
          drawGroups[side]!,
          count,
          ctx.params.values.draw === 'point' ? 'point' : 'quad',
          frame.index,
        );
      },
      setInput(name, data) {
        if (!code.setInput) throw new Error('Effect has no local particle inputs');
        code.setInput(name, data);
        uploadTargets();
        presentation.reset();
      },
      textureTaps: () =>
        code.analytic?.active(ctx) ? (analytic?.textureTaps?.() ?? {}) : presentation.textureTaps(),
      bufferTaps: () => ({
        particles: {
          buffer: buffers!.read,
          stride: 32,
          count,
          label: 'position xyz + colour weight / velocity xyz + auxiliary',
        },
        ...(targets
          ? {
              targets: {
                buffer: targets,
                stride: 16,
                count,
                label: 'Morph target xy / luminance / sample weight',
              },
            }
          : {}),
      }),
      memory: () => ({
        textureBytes: presentation.bytes + (analytic?.memory?.().textureBytes ?? 0),
        bufferBytes:
          (buffers?.bytes ?? 0) + (targets?.size ?? 0) + (analytic?.memory?.().bufferBytes ?? 0),
      }),
      sources: {
        initialize: initSource,
        simulate: stepSource,
        ...presentation.sources,
        ...analytic?.sources,
      },
      diagnostics: [
        ...init.diagnostics,
        ...step.diagnostics,
        ...presentation.diagnostics,
        ...(analytic?.diagnostics ?? []),
      ],
      dispose() {
        buffers?.dispose();
        targets?.destroy();
        leases.reverse().forEach((l) => l.dispose());
      },
    };
  } catch (error) {
    buffers?.dispose();
    targets?.destroy();
    leases.reverse().forEach((l) => l.dispose());
    throw error;
  }
}
