import { createFilterPass, defineEffect, filterGroup, fragmentEffect } from '@mk7s/hologpu-core';
import type { TextureTap } from '@mk7s/hologpu-core';
import { f } from '../_filters/common.ts';

const shader = /* wgsl */ `
fn effect(uv:vec2f)->vec4f {
  var progress=params.progress;
  if(progress<0.0) {progress=clamp(frame.time/params.duration,0.0,1.0);}
  if(frame.reducedMotion>0.5) {progress=1.0;}
  if(progress<=0.0 || progress>=1.0) {return vec4f(0);}
  let direction=vec2f(cos(params.angle),sin(params.angle));
  let span=dot(abs(direction),vec2f(0.5))+params.width*4.0;
  let distance=dot(uv-0.5,direction)-mix(-span,span,progress);
  let band=exp(-0.5*distance*distance/(params.width*params.width));
  let envelope=smoothstep(0.0,0.08,progress)*(1.0-smoothstep(0.92,1.0,progress));
  let alpha=clamp(band*envelope*sample_image(uv).a*params.intensity*params.tint.a,0.0,1.0);
  return vec4f(params.tint.rgb*alpha,alpha);
}`;

const definition = fragmentEffect({
  id: 'product-sheen',
  budget: { expectedMs: 0.5, referenceSize: [640, 400] },
  title: 'Alpha-masked product sheen',
  tags: ['product', 'image', 'sheen', 'css', 'progress', 'launch-page'],
  inputs: ['image', 'css', 'time'],
  params: {
    progress: {
      ...f(
        0.5,
        -1,
        1,
        'Static or authored 0…1 sweep progress; -1 enables a once-on-load sweep.',
        'Motion',
      ),
      css: true,
    },
    duration: {
      ...f(1.2, 0.1, 10, 'Automatic sweep duration when progress is -1.', 'Motion'),
      unit: 's',
    },
    width: f(0.08, 0.01, 0.25, 'Gaussian sheen width in normalized image coordinates.', 'Light'),
    angle: { ...f(-0.35, -3.14, 3.14, 'Band angle in radians.', 'Light'), unit: 'rad' },
    intensity: { ...f(0.2, 0, 1, 'Peak sheen opacity before source alpha.', 'Light'), css: true },
    tint: {
      type: 'color',
      default: '#ffffff',
      css: true,
      group: 'Palette',
      description: 'Sheen tint, parsed to linear RGB.',
    },
  },
  presets: {
    pearl: { progress: 0.5, tint: '#e7edff', width: 0.1, intensity: 0.2 },
    warm: { progress: 0.5, tint: '#ffe3bc', width: 0.065, intensity: 0.22 },
    automatic: { progress: -1, duration: 1.2 },
  },
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 1.2 },
  fallback: 'transparent',
  imageFallback: true,
  poster: new URL('./poster.png', import.meta.url).href,
  wgsl: shader,
});

export default defineEffect({
  ...definition,
  async create(ctx) {
    const texture = ctx.device.createTexture({
      label: 'product-sheen-empty-alpha',
      size: [1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    ctx.device.queue.writeTexture({ texture }, new Uint8Array(4), { bytesPerRow: 4 }, [1, 1]);
    const fallback: TextureTap = {
      texture,
      width: 1,
      height: 1,
      format: 'rgba8unorm',
      kind: 'float',
    };
    try {
      const pass = await createFilterPass(ctx, shader, 'hgpu-product-sheen');
      let input = fallback,
        group = filterGroup(ctx, pass, input),
        disposed = false;
      let lastProgress: number | undefined;
      const progressAt = (time: number, reduced = false) =>
        reduced
          ? 1
          : Math.max(
              0,
              Math.min(
                1,
                ctx.params.values.progress < 0
                  ? time / ctx.params.values.duration
                  : ctx.params.values.progress,
              ),
            );
      return {
        resize() {},
        update() {},
        reset() {
          lastProgress = undefined;
        },
        shouldRender(frame) {
          return (
            lastProgress === undefined ||
            progressAt(frame.time, frame.reducedMotion) !== lastProgress
          );
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
          lastProgress = progressAt(frame.time, frame.reducedMotion);
        },
        sources: { fragment: pass.source },
        diagnostics: pass.diagnostics,
        memory() {
          return { textureBytes: disposed ? 0 : 4, bufferBytes: 0 };
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          pass.dispose();
          texture.destroy();
        },
      };
    } catch (error) {
      texture.destroy();
      throw error;
    }
  },
});
