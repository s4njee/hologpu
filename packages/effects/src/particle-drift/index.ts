import {
  createComputePass,
  createParticleBuffers,
  createParticleDraw,
  defineEffect,
  hash,
  simulationSource,
  simulationUniformLayout,
  type BufferTap,
} from '@mk7s/hologpu-core';
import { f } from '../_filters/common.ts';

const params = {
  count: {
    type: 'u32' as const,
    default: 512,
    min: 256,
    max: 2048,
    step: 256,
    uniform: false,
    group: 'Particles',
    description: 'Bounded dust record count; one particle field per launch page.',
  },
  size: {
    ...f(4, 0.5, 12, 'Gaussian quad diameter in CSS pixels.', 'Geometry'),
    unit: 'px',
  },
  intensity: {
    ...f(0.18, 0, 1, 'Low additive opacity, normalized above 512 records.', 'Light'),
    css: true,
  },
  tint: {
    type: 'color' as const,
    default: '#ffd8ae',
    css: true,
    group: 'Palette',
    description: 'Brand dust colour; alpha scales the opacity.',
  },
  speed: {
    ...f(
      0.035,
      0,
      0.15,
      'Slow orbital phase in radians per second; drift stays within six CSS pixels.',
      'Motion',
    ),
    step: 0.005,
  },
  radius: {
    ...f(120, 24, 240, 'Pointer falloff radius in CSS pixels.', 'Interaction'),
    unit: 'px',
  },
  repulsion: {
    ...f(12, 0, 32, 'Maximum gentle pointer displacement in CSS pixels.', 'Interaction'),
    unit: 'px',
  },
};
const computeSource = simulationSource(
  params,
  /* wgsl */ `
@group(1) @binding(0) var<storage,read_write> particles:array<vec4f>;
@group(1) @binding(1) var<uniform> clock:vec4f;
@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u) {
  if(id.x>=arrayLength(&particles)){return;}
  let h=hash_u32(id.x+frame.seed*65537u);
  let anchor=vec2f(random(h),random(hash_u32(h+1u)))*0.94+0.03;
  let weight=mix(0.25,0.75,random(hash_u32(h+2u)));
  let scale=mix(0.65,1.35,random(hash_u32(h+3u)));
  let cssSize=max(frame.resolution/max(frame.dpr,0.0001),vec2f(1));
  var centre=anchor;
  if(frame.reducedMotion<0.5) {
    let phase=random(hash_u32(h+4u))*6.28318530718;
    let rate=select(1.0,2.0,random(hash_u32(h+5u))>0.5);
    // Bounded orbits retain the seeded scatter at time zero and never accumulate drift.
    let angle=phase+clock.x*rate;
    let drift=(vec2f(sin(angle),cos(angle))-vec2f(sin(phase),cos(phase)))*3.0;
    centre+=drift/cssSize;
    if(all(frame.pointer>=vec2f(0)) && all(frame.pointer<=vec2f(1))) {
      let offset=(centre-frame.pointer)*cssSize;
      let distance=length(offset);
      let falloff=pow(max(0.0,1.0-distance/max(params.radius,1.0)),2.0);
      let direction=offset/max(distance,0.001);
      centre+=direction*min(params.repulsion,32.0)*falloff/cssSize;
    }
  }
  particles[id.x]=vec4f(clamp(centre,vec2f(0),vec2f(1)),weight,scale);
}`,
  [hash],
);
const drawSource = simulationSource(
  params,
  /* wgsl */ `
@group(1) @binding(0) var<storage,read> particles:array<vec4f>;
struct DustOut {
  @builtin(position) position:vec4f,
  @location(0) local:vec2f,
  @location(1) weight:f32,
};
@vertex fn particleVertex(@builtin(vertex_index) vertex:u32,@builtin(instance_index) id:u32)->DustOut {
  let p=particles[id];
  let corners=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
  let local=corners[vertex];
  var out:DustOut;
  let centre=p.xy*vec2f(2,-2)+vec2f(-1,1);
  out.position=vec4f(centre+local*params.size*p.w*frame.dpr/frame.resolution,0,1);
  out.local=local;
  out.weight=p.z*min(1.0,512.0/f32(arrayLength(&particles)));
  return out;
}
@fragment fn particleFragment(in:DustOut)->@location(0) vec4f {
  let radius=dot(in.local,in.local);
  let gaussian=max(0.0,(exp(-4.0*radius)-exp(-4.0))/(1.0-exp(-4.0)));
  let alpha=gaussian*in.weight*clamp(params.intensity,0.0,1.0)*params.tint.a;
  return vec4f(params.tint.rgb*alpha,alpha);
}`,
);

export default defineEffect({
  id: 'particle-drift',
  budget: { expectedMs: 0.7, referenceSize: [640, 400] },
  family: 'particles',
  title: 'Quiet bokeh dust drift',
  tier: 'T3',
  core: false,
  tags: ['dust', 'bokeh', 'pointer', 'ambient', 'launch-page'],
  features: [],
  inputs: ['pointer'],
  params,
  presets: {
    ember: { tint: '#ffd8ae', intensity: 0.18, size: 4 },
    pearl: { tint: '#c8ddf7', intensity: 0.16, size: 3.5 },
    rose: { tint: '#edc2d5', intensity: 0.16, size: 4.5 },
  },
  quality: { resolutionScale: [0.5, 1] },
  defaultResolutionScale: 0.5,
  reducedMotion: { time: 0 },
  fallback: 'transparent',
  poster: new URL('./poster.png', import.meta.url).href,
  async create(ctx) {
    const device = ctx.device;
    const uniforms = simulationUniformLayout(device);
    const computeLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    const drawLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });
    const clock = device.createBuffer({
      label: 'particle-drift-bounded-clock',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    let compute: Awaited<ReturnType<typeof createComputePass>> | undefined;
    let draw: Awaited<ReturnType<typeof createParticleDraw>> | undefined;
    let records: ReturnType<typeof createParticleBuffers> | undefined;
    try {
      compute = await createComputePass(ctx.session, computeSource, 'particle-drift-pose', [
        uniforms,
        computeLayout,
      ]);
      draw = await createParticleDraw(ctx.session, drawSource, {
        label: 'particle-drift-gaussian',
        format: ctx.format,
        layouts: [uniforms, drawLayout],
        mode: 'quad',
        additive: true,
        additiveAlpha: 'over',
      });
      const group = device.createBindGroup({
        layout: uniforms,
        entries: [
          { binding: 0, resource: { buffer: ctx.frameBuffer } },
          { binding: 1, resource: { buffer: ctx.paramsBuffer } },
        ],
      });
      let computeGroup: GPUBindGroup, drawGroup: GPUBindGroup;
      let count = 0,
        signature = '',
        disposed = false;
      return {
        resize() {
          const next = Math.min(2048, Math.max(256, Number(ctx.params.values.count)));
          if (count === next) return;
          const allocation = createParticleBuffers(ctx.session, {
            count: next,
            stride: 16,
            label: 'particle-drift-records',
            pingPong: false,
          });
          const nextCompute = device.createBindGroup({
            layout: computeLayout,
            entries: [
              { binding: 0, resource: { buffer: allocation.read } },
              { binding: 1, resource: { buffer: clock } },
            ],
          });
          const nextDraw = device.createBindGroup({
            layout: drawLayout,
            entries: [{ binding: 0, resource: { buffer: allocation.read } }],
          });
          records?.dispose();
          records = allocation;
          count = next;
          computeGroup = nextCompute;
          drawGroup = nextDraw;
          signature = '';
        },
        update() {},
        reset() {
          signature = '';
        },
        shouldRender(frame) {
          return (
            !frame.reducedMotion &&
            Number(ctx.params.values.speed) > 0 &&
            Number(ctx.params.values.intensity) > 0
          );
        },
        render(frame, encoder, target) {
          if (disposed || !records) return;
          // Reduce the double-precision clock before its f32 upload: all-day tabs stay bounded.
          const phase = frame.reducedMotion
            ? 0
            : (frame.time * Number(ctx.params.values.speed)) % (Math.PI * 2);
          const next = JSON.stringify([
            frame.seed,
            phase,
            frame.reducedMotion,
            ...frame.resolution,
            frame.dpr,
            ...(frame.reducedMotion
              ? []
              : [...frame.pointer, ctx.params.values.radius, ctx.params.values.repulsion]),
          ]);
          if (next !== signature) {
            device.queue.writeBuffer(clock, 0, new Float32Array([phase, 0, 0, 0]));
            compute!.dispatch(encoder, [group, computeGroup], [Math.ceil(count / 128)]);
            signature = next;
          }
          draw!.draw(encoder, target, [group, drawGroup], count);
        },
        bufferTaps(): Record<string, BufferTap> {
          return records
            ? {
                particles: {
                  buffer: records.read,
                  stride: 16,
                  count,
                  label: 'Dust UV centre / opacity weight / diameter scale',
                },
              }
            : {};
        },
        memory() {
          return { textureBytes: 0, bufferBytes: disposed ? 0 : (records?.bytes ?? 0) + 16 };
        },
        sources: { pose: compute.source, quads: draw.source },
        diagnostics: [...compute.diagnostics, ...draw.diagnostics],
        dispose() {
          if (disposed) return;
          disposed = true;
          records?.dispose();
          clock.destroy();
          compute!.dispose();
          draw!.dispose();
        },
      };
    } catch (error) {
      records?.dispose();
      clock.destroy();
      compute?.dispose();
      draw?.dispose();
      throw error;
    }
  },
});
