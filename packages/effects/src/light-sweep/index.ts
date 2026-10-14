import { defineEffect, fragmentEffect, createFilterPass, filterGroup } from '@mk7s/hologpu-core';
import type { TextureTap } from '@mk7s/hologpu-core';
import { f } from '../_filters/common.ts';
const shader = /* wgsl */ `
fn effect(uv:vec2f)->vec4f {
  var progress=params.progress;
  if(progress<0.0) {progress=clamp(frame.time/params.duration,0.0,1.0);}
  if(frame.reducedMotion>0.5) {progress=1.0;}
  // A settled sheen is invisible: a Gaussian's tails must not linger at the edges.
  if(progress<=0.0 || progress>=1.0) {return vec4f(0);}
  let direction=vec2f(cos(params.angle),sin(params.angle));
  let span=dot(abs(direction),vec2f(0.5))+params.width*4.0;
  let distance=dot(uv-0.5,direction)-mix(-span,span,progress);
  let band=exp(-0.5*distance*distance/(params.width*params.width));
  let envelope=smoothstep(0.0,0.08,progress)*(1.0-smoothstep(0.92,1.0,progress));
  let alpha=clamp(band*envelope*params.intensity*params.tint.a*sample_image(uv).a,0.0,1.0);
  return vec4f(params.tint.rgb*alpha,alpha);
}`;
const definition = fragmentEffect({
  id: 'light-sweep',
  budget: { expectedMs: 0.3, referenceSize: [640, 400] },
  title: 'Soft specular light sweep',
  family: 'procedural',
  tags: ['background', 'sheen', 'progress', 'css', 'image'],
  inputs: ['time', 'css', 'image'],
  params: {
    progress: {
      ...f(
        -1,
        -1,
        1,
        'Use -1 for the once-on-load sweep; explicit 0…1 progress overrides the clock.',
        'Motion',
      ),
      css: true,
    },
    duration: {
      ...f(
        1.2,
        0.1,
        10,
        'Duration of the automatic sweep; use 1 for a normalized timeline.',
        'Motion',
      ),
      unit: 's',
    },
    width: f(
      0.08,
      0.01,
      0.25,
      'Gaussian band standard deviation in normalized host coordinates.',
      'Light',
    ),
    angle: { ...f(-0.35, -3.14, 3.14, 'Band travel angle in radians.', 'Light'), unit: 'rad' },
    intensity: { ...f(0.22, 0, 1, 'Peak sheen opacity.', 'Light'), css: true },
    tint: {
      type: 'color',
      default: '#ffffff',
      css: true,
      group: 'Palette',
      description: 'Sheen colour, parsed to linear RGB.',
    },
  },
  presets: {
    pearl: { tint: '#e7edff', width: 0.1, intensity: 0.2 },
    warm: { tint: '#ffe3bc', width: 0.065, intensity: 0.25 },
    timeline: { progress: -1, duration: 1 },
  },
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 1.2 },
  fallback: 'transparent',
  poster: new URL('./poster.png', import.meta.url).href,
  // The custom T1 pass below adds one optional alpha texture to the fragment scaffold.
  wgsl: shader,
});
export default defineEffect({
  ...definition,
  async create(ctx) {
    const texture = ctx.device.createTexture({
      label: 'light-sweep-opaque-mask',
      size: [1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    ctx.device.queue.writeTexture(
      { texture },
      new Uint8Array([255, 255, 255, 255]),
      { bytesPerRow: 4 },
      [1, 1],
    );
    const fallback: TextureTap = {
      texture,
      width: 1,
      height: 1,
      format: 'rgba8unorm' as const,
      kind: 'float' as const,
    };
    try {
      const pass = await createFilterPass(ctx, shader, 'hgpu-light-sweep');
      let input: TextureTap = fallback,
        group = filterGroup(ctx, pass, input),
        disposed = false,
        lastProgress: number | undefined;
      const currentProgress = (time: number) => {
        const value = ctx.params.values.progress;
        return Math.max(0, Math.min(1, value < 0 ? time / ctx.params.values.duration : value));
      };
      return {
        resize() {},
        update() {},
        reset() {
          lastProgress = undefined;
        },
        shouldRender(frame) {
          return lastProgress === undefined || currentProgress(frame.time) !== lastProgress;
        },
        render(frame, encoder, target) {
          const current = ctx.inputs?.get('image') ?? fallback;
          if (
            current.texture !== input.texture ||
            current.mipLevel !== input.mipLevel ||
            current.arrayLayer !== input.arrayLayer
          ) {
            input = current;
            group = filterGroup(ctx, pass, input);
          }
          pass.draw(encoder, target, [group]);
          lastProgress = currentProgress(frame.time);
        },
        dispose() {
          if (!disposed) {
            disposed = true;
            pass.dispose();
            texture.destroy();
          }
        },
        sources: { fragment: pass.source },
        diagnostics: pass.diagnostics,
        memory() {
          return { textureBytes: disposed ? 0 : 4, bufferBytes: 0 };
        },
      };
    } catch (error) {
      texture.destroy();
      throw error;
    }
  },
});
