import { createFilterPass, filterEffect, filterGroup } from '@mk7s/hologpu-core';
import type { TextureTap } from '@mk7s/hologpu-core';
import { f, straight } from '../_filters/common.ts';

const shader =
  straight +
  /* wgsl */ `
fn effect(uv:vec2f)->vec4f {
  let source=sample_image(uv);
  let brightness=luminance(max(straight(source),vec3f(0)));
  var selected=select(0.0,1.0,brightness>=params.threshold);
  if(params.softness>0.0) {
    selected=smoothstep(max(0.0,params.threshold-params.softness),params.threshold+params.softness,brightness);
  }
  let coverage=clamp(sample_mask(uv).r,0.0,1.0);
  let strength=selected*coverage*params.intensity*params.tint.a;
  return vec4f(source.rgb*params.tint.rgb,source.a)*strength;
}`;

export default filterEffect({
  id: 'bright-pass',
  budget: { expectedMs: 0.4, referenceSize: [640, 400] },
  title: 'Luminance-selected screenshot highlights',
  tags: ['filter', 'product', 'image', 'luminance', 'mask', 'launch-page'],
  inputs: ['image', 'mask', 'css'],
  params: {
    threshold: {
      ...f(
        0.65,
        0,
        8,
        'Threshold in unpremultiplied linear Rec.709 luminance; HDR values may exceed one.',
        'Extraction',
      ),
      css: true,
    },
    softness: f(
      0.1,
      0,
      1,
      'Half-width of the smooth threshold transition in linear luminance.',
      'Extraction',
    ),
    intensity: {
      ...f(0.25, 0, 1, 'Highlight gain after luminance and author-mask selection.', 'Appearance'),
      css: true,
    },
    tint: {
      type: 'color',
      default: '#ffffff',
      css: true,
      group: 'Palette',
      description: 'Linear RGB highlight tint; white preserves source colour.',
    },
    mask: {
      type: 'texture',
      default: 'mask',
      group: 'Mask',
      description:
        'Optional author mask input named mask; canonical single-channel linear coverage in red. Missing masks are white.',
    },
  },
  presets: {
    screenshot: { threshold: 0.65, softness: 0.1, intensity: 0.25, tint: '#ffffff' },
    highlights: { threshold: 1, softness: 0.15, intensity: 0.2, tint: '#ffffff' },
    warm: { threshold: 0.65, softness: 0.1, intensity: 0.22, tint: '#ffe5c6' },
  },
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback: 'transparent',
  imageFallback: true,
  poster: new URL('./poster.png', import.meta.url).href,
  async setup({ ctx, input }) {
    const texture = ctx.device.createTexture({
      label: 'bright-pass-white-mask',
      size: [1, 1],
      format: 'r8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    ctx.device.queue.writeTexture({ texture }, new Uint8Array([255]), { bytesPerRow: 1 }, [1, 1]);
    const white: TextureTap = { texture, width: 1, height: 1, format: 'r8unorm', kind: 'float' };
    const maskedCtx = {
      ...ctx,
      inputs: {
        get(name: string) {
          return ctx.inputs?.get(name) ?? (name === 'mask' ? white : undefined);
        },
      },
    };
    try {
      const pass = await createFilterPass(maskedCtx, shader, 'hgpu-bright-pass');
      let disposed = false;
      return {
        resize() {},
        update() {},
        reset() {},
        render(_frame, encoder, target) {
          pass.draw(encoder, target, [filterGroup(maskedCtx, pass, input())]);
        },
        sources: { fragment: pass.source },
        diagnostics: pass.diagnostics,
        memory() {
          return { textureBytes: disposed ? 0 : 1, bufferBytes: 0 };
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
