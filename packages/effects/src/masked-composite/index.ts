import { filterEffect, createFilterPass, filterGroup } from '@mk7s/hologpu-core';
import type { TextureTap } from '@mk7s/hologpu-core';
import { e, f } from '../_filters/common.ts';

const code = /* wgsl */ `
fn effect(uv:vec2f)->vec4f {
  let original=sample_image(uv);
  let filtered=sample_filteredSource(uv);
  let mask=sample_maskSource(uv);
  var coverage=mask.r;
  if(params.maskChannel==1u) {coverage=mask.a;}
  if(params.maskChannel==2u) {coverage=dot(mask.rgb,vec3f(0.2126,0.7152,0.0722));}
  let weight=clamp(coverage,0.0,1.0)*params.blend;
  // Both inputs already contain linear, premultiplied RGBA. Interpolate alpha too.
  return mix(original,filtered,weight);
}`;

export default filterEffect({
  id: 'masked-composite',
  budget: { expectedMs: 0.5, referenceSize: [640, 400] },
  title: 'Masked original / filtered composite',
  core: true,
  tags: ['filter', 'mask', 'composite', 'product', 'lcd'],
  inputs: ['image', 'filtered', 'mask', 'css'],
  fieldInputSampling: 'base',
  features: [],
  params: {
    sceneSource: {
      type: 'texture',
      textureType: 'image',
      default: 'original',
      description:
        'Optional original binding for chain use; otherwise the primary image is original.',
      group: 'Inputs',
    },
    filteredSource: {
      type: 'texture',
      textureType: 'image',
      default: 'filtered',
      description: 'Filtered output binding; otherwise uses the incoming primary image of a chain.',
      group: 'Inputs',
    },
    maskSource: {
      type: 'texture',
      textureType: 'image',
      default: 'mask',
      description:
        'Coverage mask binding; canonical mask descriptors store linear coverage in red.',
      group: 'Inputs',
    },
    maskChannel: e('red', ['red', 'alpha', 'luminance'], 'Coverage channel; red for a mask input.'),
    blend: { ...f(1, 0, 1, 'Filtered contribution through the mask.', 'Composite'), css: true },
  },
  presets: {
    masked: { blend: 1, maskChannel: 'red' },
    original: { blend: 0 },
    half: { blend: 0.5 },
  },
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback: 'transparent',
  imageFallback: true,
  poster: new URL('./poster.png', import.meta.url).href,
  async setup({ ctx, input }) {
    const texture = ctx.device.createTexture({
      label: 'composite-full-coverage',
      size: [1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    });
    ctx.device.queue.writeTexture(
      { texture },
      new Uint8Array([255, 255, 255, 255]),
      { bytesPerRow: 4 },
      [1, 1],
    );
    const white: TextureTap = { texture, width: 1, height: 1, format: 'rgba8unorm', kind: 'float' };
    let original = input(),
      filtered = input(),
      mask = white;
    const local = {
      ...ctx,
      inputs: {
        get(name: string) {
          if (name === 'sceneSource') return original;
          if (name === 'filteredSource') return filtered;
          if (name === 'maskSource') return mask;
          return ctx.inputs?.get(name);
        },
      },
    };
    try {
      const pass = await createFilterPass(local, code, 'hgpu-masked-composite');
      let group = filterGroup(local, pass, original);
      const same = (a: TextureTap, b: TextureTap) =>
        a.texture === b.texture && a.mipLevel === b.mipLevel && a.arrayLayer === b.arrayLayer;
      return {
        resize() {},
        update() {},
        reset() {},
        render(_frame, encoder, target) {
          const nextOriginal = ctx.inputs?.get('sceneSource') ?? input();
          const nextFiltered = ctx.inputs?.get('filteredSource') ?? input();
          const nextMask = ctx.inputs?.get('maskSource') ?? white;
          const changed =
            !same(original, nextOriginal) || !same(filtered, nextFiltered) || !same(mask, nextMask);
          original = nextOriginal;
          filtered = nextFiltered;
          mask = nextMask;
          if (changed) group = filterGroup(local, pass, original);
          pass.draw(encoder, target, [group]);
        },
        textureTaps(): Readonly<Record<string, TextureTap>> {
          return { original, filtered, mask };
        },
        memory() {
          return { textureBytes: 4, bufferBytes: 0 };
        },
        sources: { composite: pass.source },
        diagnostics: pass.diagnostics,
        dispose() {
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
