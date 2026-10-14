import {
  chunk,
  compose,
  createFullscreenPass,
  defineEffect,
  frame,
  fullscreen,
  paramLayout,
} from '@mk7s/hologpu-core';
import { f } from '../_filters/common.ts';

const duration = 0.6;
const params = {
  intensity: {
    ...f(0.2, 0, 1, 'Maximum wavefront opacity; overlapping waves do not add brightness.', 'Light'),
    css: true,
  },
  width: {
    ...f(2, 0.5, 12, 'Soft wavefront standard deviation in CSS pixels.', 'Geometry'),
    unit: 'px',
  },
  tint: {
    type: 'color' as const,
    default: '#d9e5ff',
    css: true,
    group: 'Palette',
    description: 'Ripple colour; alpha also scales opacity.',
  },
};
const source = compose(
  frame,
  fullscreen,
  chunk(
    'press-ripple:uniforms',
    `${paramLayout(params).wgsl}
@group(0) @binding(1) var<uniform> params:Params;
struct Ripples { events:array<vec4f,4> };
@group(0) @binding(2) var<uniform> ripples:Ripples;
@group(0) @binding(3) var<uniform> clock:vec4f;`,
  ),
  chunk(
    'press-ripple:fragment',
    /* wgsl */ `
@fragment fn fragment(in:VertexOut)->@location(0) vec4f {
  let dpr=max(frame.dpr,0.0001);
  let size=frame.resolution/dpr;
  var opacity=0.0;
  for(var i=0u;i<4u;i++) {
    let event=ripples.events[i];
    let age=clock.x-event.z;
    if(event.w<0.5 || age<0.0 || age>=0.6) {continue;}
    let progress=clamp(age/0.6,0.0,1.0);
    if(frame.reducedMotion>0.5) {
      // Only the latest press fades. The host stays still and no ring expands.
      if(i==3u) {opacity=progress*(1.0-progress)*4.0;}
    } else {
      let centre=event.xy*size;
      let reach=length(max(centre,size-centre))+params.width*3.0;
      let radius=reach*(1.0-(1.0-progress)*(1.0-progress));
      let distance=length(in.uv*size-centre)-radius;
      let sigma=max(params.width,0.5/dpr);
      let ring=exp(-0.5*distance*distance/(sigma*sigma));
      let fade=smoothstep(0.0,0.04,progress)*pow(1.0-progress,1.5);
      opacity=max(opacity,ring*fade);
    }
  }
  let alpha=clamp(opacity*params.intensity*params.tint.a,0.0,1.0);
  return vec4f(params.tint.rgb*alpha,alpha);
}`,
  ),
);

export default defineEffect({
  id: 'press-ripple',
  budget: { expectedMs: 0.4, referenceSize: [640, 400] },
  family: 'procedural',
  title: 'Soft press wavefront',
  tier: 'T1',
  core: false,
  tags: ['button', 'card', 'press', 'interaction', 'launch-page'],
  features: [],
  inputs: ['pointer-down'],
  params,
  presets: {
    pearl: { tint: '#d9e5ff', intensity: 0.2, width: 2 },
    ember: { tint: '#ffc89a', intensity: 0.22, width: 2.5 },
    ink: { tint: '#314c79', intensity: 0.16, width: 1.5 },
  },
  quality: { resolutionScale: [0.5, 1] },
  reducedMotion: { time: 0 },
  fallback: 'transparent',
  poster: new URL('./poster.png', import.meta.url).href,
  cardFallback: { kind: 'none' },
  async create(ctx) {
    const events = new Float32Array(16);
    const buffer = ctx.device.createBuffer({
      label: 'press-ripple-events',
      size: events.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const clockBuffer = ctx.device.createBuffer({
      label: 'press-ripple-clock',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    ctx.device.queue.writeBuffer(buffer, 0, events);
    try {
      const pass = await createFullscreenPass(
        ctx.session,
        source,
        ctx.format,
        'hgpu-press-ripple',
        [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
          { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        ],
      );
      const group = ctx.device.createBindGroup({
        layout: pass.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: ctx.frameBuffer } },
          { binding: 1, resource: { buffer: ctx.paramsBuffer } },
          { binding: 2, resource: { buffer } },
          { binding: 3, resource: { buffer: clockBuffer } },
        ],
      });
      let needsClear = false,
        disposed = false;
      const activeAt = (time: number) =>
        events.some(
          (value, i) =>
            i % 4 === 3 && value > 0 && time >= events[i - 1]! && time - events[i - 1]! < duration,
        );
      return {
        resize() {},
        update() {},
        onPointerDown(position, frame) {
          // Oldest-first storage keeps the latest press in slot three, including equal timestamps.
          if (frame.reducedMotion) events.fill(0);
          events.copyWithin(0, 4);
          events.set([position[0], position[1], frame.interactionTime ?? frame.time, 1], 12);
          return duration;
        },
        shouldRender(frame) {
          return activeAt(frame.interactionTime ?? frame.time) || needsClear;
        },
        render(frame, encoder, target) {
          const time = frame.interactionTime ?? frame.time;
          for (let slot = 0; slot < 4; slot++) {
            const start = events[slot * 4 + 2]!;
            if (time - start >= duration) events[slot * 4 + 3] = 0;
          }
          ctx.device.queue.writeBuffer(buffer, 0, events);
          ctx.device.queue.writeBuffer(clockBuffer, 0, new Float32Array([time, 0, 0, 0]));
          pass.draw(encoder, target, [group]);
          needsClear = activeAt(time);
        },
        reset() {
          events.fill(0);
          needsClear = false;
        },
        sources: { fragment: source },
        diagnostics: pass.diagnostics,
        bufferTaps() {
          return { ripples: { buffer, stride: 16, count: 4, label: 'Oldest-first press events' } };
        },
        memory() {
          return { textureBytes: 0, bufferBytes: disposed ? 0 : events.byteLength + 16 };
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          pass.dispose();
          buffer.destroy();
          clockBuffer.destroy();
        },
      };
    } catch (error) {
      buffer.destroy();
      clockBuffer.destroy();
      throw error;
    }
  },
});
