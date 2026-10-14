import { basicParticleEffect, renderParams, randomInit } from '../_particles/basic.ts';
import { rasterTargets, type MorphInputs } from './targets.ts';
import {
  defineEffect,
  createParticleDraw,
  simulationSource,
  simulationUniformLayout,
  hash,
  type EffectContext,
  type EffectInstance,
} from '@mk7s/hologpu-core';
const params = {
  ...renderParams,
  tint: { ...renderParams.tint, css: true },
  count: { ...renderParams.count, default: 32768 },
  assembly: {
    type: 'bool',
    default: false,
    uniform: false,
    group: 'Motion',
    description:
      'Stateless assemble-and-hold mode; normal spring simulation is retained when disabled.',
  },
  progress: {
    type: 'f32',
    default: 0,
    min: 0,
    max: 1,
    step: 0.01,
    css: true,
    group: 'Motion',
    description:
      'Assembly progress: zero is seeded scatter, one is the raster target; reversible without simulation history.',
  },
  intensity: {
    type: 'f32',
    default: 1,
    min: 0,
    max: 1,
    step: 0.01,
    css: true,
    group: 'Rendering',
    description:
      'Opacity in assembly mode; the quiet preset uses 0.22. Spring presentation remains unchanged.',
  },
  mask: {
    type: 'enum',
    default: 'text',
    options: ['text', 'image'],
    uniform: false,
    group: 'Target',
    description:
      'Local raster text mask or image luminance targets; custom input accepted through field.setInput.',
  },
  word: {
    type: 'enum',
    default: 'GPU',
    options: ['GPU', 'HELLO', 'FLOW'],
    uniform: false,
    group: 'Target',
    description: 'Built-in text mask. setInput("text", string) replaces it with custom text.',
  },
  spring: {
    type: 'f32',
    default: 18,
    min: 1,
    max: 80,
    step: 1,
    group: 'Motion',
    description: 'Spring acceleration toward the target point.',
  },
  damping: {
    type: 'f32',
    default: 5,
    min: 0,
    max: 12,
    step: 0.1,
    group: 'Motion',
    description: 'Exponential velocity damping per second.',
  },
  scatter: {
    type: 'f32',
    default: 2,
    min: 0,
    max: 8,
    step: 0.1,
    group: 'Motion',
    description: 'Pointer repulsion strength while pressed.',
  },
  radius: {
    type: 'f32',
    default: 0.35,
    min: 0.05,
    max: 1,
    step: 0.01,
    group: 'Motion',
    description: 'Pointer scatter radius in normalized coordinates.',
  },
} as const;
// Each instance receives independent local inputs; no cross-mount mutable registry.
const definition = basicParticleEffect(
  {
    id: 'morph-particles',
    title: 'Text and image particle morph',
    family: 'particles',
    core: true,
    tags: ['text', 'image', 'spring', 'pointer'],
    params,
    inputs: ['pointer', 'text', 'image'],
    features: [],
    presets: {
      image: { mask: 'image', spring: 12, damping: 3, trail: 0.85, tint: '#edb68c' },
      soft: { word: 'HELLO', spring: 5, damping: 2, scatter: 5, trail: 0.97, tint: '#b8a6ef' },
      'assemble-and-hold': {
        assembly: true,
        progress: 0,
        count: 8192,
        trail: 0,
        size: 1.6,
        intensity: 0.22,
      },
    },
    quality: { resolutionScale: [0.25, 1] },
    reducedMotion: { time: 0 },
    fallback: 'radial-gradient(ellipse,#b8a6ef,#07111e)',
    presetPosters: {
      'assemble-and-hold': new URL('./poster-assemble-and-hold.png', import.meta.url).href,
    },
  },
  () => {
    const input: MorphInputs = {};
    return {
      initialize: randomInit,
      analytic: {
        active: (ctx) => Boolean(ctx.params.values.assembly),
        create: createAssembly,
      },
      step: `let goal= targets[id.x];let dt=frame.delta;var acceleration=(goal.xy-p.position.xy)*params.spring;if(frame.buttons!=0u){let mouse=frame.pointer*vec2f(2,-2)+vec2f(-1,1);let delta=p.position.xy-mouse;let distance=length(delta);acceleration+=delta/max(distance,.01)*params.scatter*max(0.0,1-distance/params.radius);}p.velocity=vec4f((p.velocity.xy+acceleration*dt)*exp(-params.damping*dt),0,0);p.position=vec4f(clamp(p.position.xy+p.velocity.xy*dt,vec2f(-2),vec2f(2)),0,goal.z);`,
      setupTargets: (context, count) =>
        rasterTargets(
          count,
          String(context.params.values.mask),
          String(context.params.values.word),
          input,
        ),
      setInput(name, data) {
        if (name === 'text' && typeof data === 'string') {
          input.text = data;
          return;
        }
        if (name === 'image' && data && typeof data === 'object') {
          const copy = document.createElement('canvas');
          copy.width = 512;
          copy.height = 256;
          const raster = copy.getContext('2d')!;
          raster.imageSmoothingEnabled = false;
          raster.drawImage(data as CanvasImageSource, 0, 0, 512, 256);
          input.image = copy;
          return;
        }
        throw new TypeError(
          'Morph accepts setInput("text", string) or setInput("image", CanvasImageSource)',
        );
      },
    };
  },
);

/** The assembly preset renders its own analytic pose directly, without viewport HDR history. */
async function createAssembly(
  ctx: EffectContext<typeof params>,
  targets: () => GPUBuffer | undefined,
): Promise<EffectInstance> {
  const source = simulationSource(
    params,
    /* wgsl */ `
@group(1) @binding(0) var<storage,read> targets:array<vec4f>;
struct AssemblyOut {@builtin(position) position:vec4f,@location(0) local:vec2f,@location(1) weight:f32};
@vertex fn particleVertex(@builtin(vertex_index) vertex:u32,@builtin(instance_index) id:u32)->AssemblyOut {
  let goal=targets[id];
  let h=hash_u32(id+frame.seed*65537u);
  let scatter=vec2f(random(h)*2.0-1.0,random(hash_u32(h+1u))*2.0-1.0);
  var t=clamp(params.progress,0.0,1.0);
  if(frame.reducedMotion>0.5){t=1.0;}
  let eased=t*t*(3.0-2.0*t);
  let centre=mix(scatter,goal.xy,eased);
  let corners=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
  let local=corners[vertex];
  var out:AssemblyOut;
  out.position=vec4f(centre+local*params.size*frame.dpr/frame.resolution,0,1);
  out.local=local;out.weight=clamp(goal.z,0.0,1.0);return out;
}
@fragment fn particleFragment(in:AssemblyOut)->@location(0) vec4f {
  let shape=1.0-smoothstep(0.55,1.0,length(in.local));
  let alpha=shape*in.weight*params.intensity*params.tint.a;
  return vec4f(params.tint.rgb*alpha,alpha);
}`,
    [hash],
  );
  const uniforms = simulationUniformLayout(ctx.device);
  const layout = ctx.device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });
  const pass = await createParticleDraw(ctx.session, source, {
    label: 'morph-particles-assembly',
    format: ctx.format,
    layouts: [uniforms, layout],
    mode: 'quad',
    alphaOver: true,
  });
  const uniform = ctx.device.createBindGroup({
    layout: uniforms,
    entries: [
      { binding: 0, resource: { buffer: ctx.frameBuffer } },
      { binding: 1, resource: { buffer: ctx.paramsBuffer } },
    ],
  });
  let previous: GPUBuffer | undefined,
    group: GPUBindGroup | undefined,
    disposed = false;
  return {
    resize() {},
    update() {},
    reset() {},
    render(_frame, encoder, target) {
      const buffer = targets();
      if (!buffer) throw new Error('Morph assembly targets have not been initialized');
      if (buffer !== previous) {
        previous = buffer;
        group = ctx.device.createBindGroup({
          layout,
          entries: [{ binding: 0, resource: { buffer } }],
        });
      }
      pass.draw(
        encoder,
        target,
        [uniform, group!],
        Math.min(Number(ctx.params.values.count), 8192),
      );
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      pass.dispose();
    },
    sources: { assembly: pass.source },
    diagnostics: pass.diagnostics,
    memory: () => ({ textureBytes: 0, bufferBytes: 0 }),
  };
}

export default defineEffect({
  ...definition,
  async create(ctx) {
    const instance = await definition.create(ctx);
    return {
      ...instance,
      // Assembly is a reversible shader pose. A settled field sleeps until a
      // parameter, input, CSS transition or size invalidates it.
      shouldRender: () => !ctx.params.values.assembly,
      update(frame) {
        if (!ctx.params.values.assembly) instance.update(frame);
      },
    };
  },
});
