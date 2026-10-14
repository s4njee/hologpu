import { filterEffect, createFilterPass, filterGroup, noise } from '@mk7s/hologpu-core';
import type { TextureTap } from '@mk7s/hologpu-core';
import { e, f, progress } from '../_dom/common.ts';

const code = /* wgsl */ `
fn effect(uv:vec2f)->vec4f {
  let a=sample_image(uv);
  let t=clamp(params.progress,0.0,1.0);
  if(t<=0.0){return a;}
  let b=sample_next(uv);
  if(t>=1.0){return b;}
  if(frame.reducedMotion>.5){return select(a,b,t>=.5);}
  var rank=uv.x;
  if(params.direction==1u){rank=uv.y;}
  if(params.direction==2u){rank=1.0-uv.x;}
  if(params.direction==3u){rank=1.0-uv.y;}
  if(params.mode==1u){
    let aspect=frame.resolution.x/max(frame.resolution.y,1.0);
    rank=value_noise(uv*vec2f(aspect,1)*params.noiseScale,frame.seed);
  }
  if(params.mode==2u){
    // Bright straight-linear destination content appears before darker content.
    let luminance=dot(b.rgb/max(b.a,.00001),vec3f(.2126,.7152,.0722));
    rank=1.0-clamp(luminance,0.0,1.0);
  }
  let feather=max(max(params.feather,.000001),fwidth(rank));
  let edge=mix(-feather,1.0+feather,t);
  let weight=1.0-smoothstep(edge-feather,edge+feather,rank);
  if(all(a==b)){return a;}
  return mix(a,b,weight);
}`;

export default filterEffect({
  id: 'section-wipe',
  budget: { expectedMs: 0.4, referenceSize: [640, 400] },
  title: 'Authored image section wipe',
  family: 'dom',
  core: true,
  tags: ['image', 'transition', 'scroll', 'css', 'launch-page'],
  inputs: ['image', 'next', 'css'],
  features: [],
  params: {
    next: {
      type: 'texture',
      default: 'next',
      group: 'Images',
      description: 'Destination image binding; an absent destination preserves the source.',
    },
    progress: {
      ...progress,
      description: 'Image transition progress: zero is source, one is destination.',
    },
    mode: e(
      'directional',
      ['directional', 'noise', 'luminance'],
      'Directional soft wipe, deterministic noise threshold, or bright-first destination reveal.',
      'Transition',
    ),
    direction: e(
      'right',
      ['right', 'down', 'left', 'up'],
      'Direction of the advancing front in directional mode.',
      'Transition',
    ),
    feather: f(
      0.06,
      0,
      0.25,
      'Reveal feather half-width in normalized threshold units.',
      'Transition',
    ),
    noiseScale: f(
      8,
      1,
      24,
      'Noise cells across host height; noise stays still as progress changes.',
      'Noise',
    ),
  },
  presets: {
    editorial: { mode: 'directional', direction: 'right', feather: 0.06 },
    dissolve: { mode: 'noise', noiseScale: 8, feather: 0.08 },
    highlights: { mode: 'luminance', feather: 0.06 },
  },
  quality: { resolutionScale: [0.5, 1] },
  reducedMotion: { time: 0 },
  fallback: 'transparent',
  imageFallback: true,
  poster: new URL('./poster.png', import.meta.url).href,
  async setup({ ctx, input }) {
    const pass = await createFilterPass(ctx, code, 'hgpu-section-wipe', [], [noise]);
    type ImageIdentity = Pick<TextureTap, 'texture' | 'mipLevel' | 'arrayLayer'>;
    let group: GPUBindGroup | undefined,
      primary: ImageIdentity | undefined,
      next: ImageIdentity | undefined;
    const identity = (tap: TextureTap): ImageIdentity => ({
      texture: tap.texture,
      mipLevel: tap.mipLevel ?? 0,
      arrayLayer: tap.arrayLayer ?? 0,
    });
    const changed = (before: ImageIdentity | undefined, tap: TextureTap) =>
      !before ||
      before.texture !== tap.texture ||
      before.mipLevel !== (tap.mipLevel ?? 0) ||
      before.arrayLayer !== (tap.arrayLayer ?? 0);
    return {
      resize() {
        group = undefined;
      },
      update() {},
      reset() {},
      shouldRender: () => false,
      render(_frame, encoder, target) {
        const image = input(),
          destination = ctx.inputs?.get('next') ?? image;
        if (!group || changed(primary, image) || changed(next, destination)) {
          // The standard schema binding aliases missing next to the source itself.
          group = filterGroup(ctx, pass, image);
          primary = identity(image);
          next = identity(destination);
        }
        pass.draw(encoder, target, [group]);
      },
      dispose() {
        group = primary = next = undefined;
        pass.dispose();
      },
      sources: { fragment: pass.source },
      diagnostics: pass.diagnostics,
      memory: () => ({ textureBytes: 0, bufferBytes: 0 }),
    };
  },
});
