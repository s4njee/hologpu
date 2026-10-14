import { filterEffect, createFilterPass, filterGroup } from '@mk7s/hologpu-core';
import type { TextureTap } from '@mk7s/hologpu-core';
import { f } from '../_filters/common.ts';
import { cardGeometryParams, cardDistance } from '../_dom/card-geometry.ts';

const code = /* wgsl */ `
fn panel_distance(p:vec2f, halfSize:vec2f)->f32 {
  return card_distance(p,halfSize,params.radius,params.radiiX,params.radiiY);
}
fn effect(uv:vec2f)->vec4f {
  let hostSize=frame.resolution/max(frame.dpr,0.001);
  let cardSize=max(params.rect.zw*hostSize,vec2f(0.001));
  let local=(uv-params.rect.xy)/max(params.rect.zw,vec2f(0.00001));
  let p=(local-0.5)*cardSize;
  let halfSize=cardSize*0.5;
  let distance=panel_distance(p,halfSize);
  let aa=max(fwidth(distance),0.5/max(frame.dpr,0.001));
  let mask=1.0-smoothstep(-aa,aa,distance);
  if(mask<=0.0) {return vec4f(0);}
  // A finite-difference SDF normal bends the hero near the card's rim.
  let epsilon=0.5;
  let gradient=vec2f(
    panel_distance(p+vec2f(epsilon,0),halfSize)-panel_distance(p-vec2f(epsilon,0),halfSize),
    panel_distance(p+vec2f(0,epsilon),halfSize)-panel_distance(p-vec2f(0,epsilon),halfSize));
  let normal=gradient/max(length(gradient),0.00001);
  let rim=exp(-abs(distance)/max(params.rim,0.001));
  let sourceScale=params.sourceRect.zw/cardSize;
  let sourceUV=params.sourceRect.xy+local*params.sourceRect.zw
    +normal*params.refraction*rim*sourceScale;
  var sampled=sample_image(sourceUV);
  if(params.blur>0.0) {
    let d=params.blur*sourceScale;
    sampled=(sampled*4.0+sample_image(sourceUV+vec2f(d.x,0))
      +sample_image(sourceUV-vec2f(d.x,0))+sample_image(sourceUV+vec2f(0,d.y))
      +sample_image(sourceUV-vec2f(0,d.y)))/8.0;
  }
  let tint=params.intensity*params.brand.a;
  let colour=mix(sampled.rgb,params.brand.rgb*sampled.a,tint*0.12);
  let specular=exp(-abs(distance)/max(params.edge,0.001))*tint*sampled.a;
  return vec4f((colour+params.brand.rgb*specular)*mask,sampled.a*mask);
}`;

export default filterEffect({
  id: 'panel-refraction',
  budget: { expectedMs: 0.8, referenceSize: [640, 400] },
  title: 'Frosted hero refraction panel',
  family: 'dom',
  core: true,
  tags: ['card', 'glass', 'refraction', 'blur', 'hero', 'css'],
  inputs: ['image', 'css', 'element-rect'],
  fieldInputSampling: 'base',
  features: [],
  params: {
    ...cardGeometryParams,
    sourceRect: {
      type: 'vec4',
      default: [0, 0, 1, 1],
      description:
        'Normalized hero xywh sampled by the card; bindBackdrop updates this from layout.',
      group: 'Source',
    },
    refraction: {
      ...f(2, 0, 8, 'Maximum rim displacement in CSS pixels.', 'Glass'),
      unit: 'px',
    },
    blur: { ...f(2, 0, 8, 'Five-tap cross blur radius in CSS pixels.', 'Glass'), unit: 'px' },
    rim: { ...f(18, 1, 64, 'Depth of the refracted rim in CSS pixels.', 'Glass'), unit: 'px' },
    edge: { ...f(0.8, 0.25, 3, 'Thin specular edge width in CSS pixels.', 'Glass'), unit: 'px' },
    intensity: { ...f(0.22, 0, 1, 'Brand tint and specular edge strength.', 'Glass'), css: true },
    brand: {
      type: 'color',
      default: '#e4edff',
      css: true,
      description: 'Quiet brand tint and edge colour, parsed to linear RGB.',
      group: 'Palette',
    },
  },
  presets: {
    clear: { refraction: 1.5, blur: 0.5, intensity: 0.15 },
    frost: { refraction: 2, blur: 4, intensity: 0.25 },
  },
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback: 'transparent',
  poster: new URL('./poster.png', import.meta.url).href,
  cardFallback: { kind: 'glass' },
  async setup({ ctx, input }) {
    const pass = await createFilterPass(ctx, cardDistance + code, 'hgpu-panel-refraction');
    let tap: TextureTap = input();
    let group = filterGroup(ctx, pass, tap);
    return {
      resize() {},
      update() {},
      shouldRender: () => false,
      reset() {},
      render(_frame, encoder, target) {
        const next = input();
        if (
          next.texture !== tap.texture ||
          next.mipLevel !== tap.mipLevel ||
          next.arrayLayer !== tap.arrayLayer
        )
          group = filterGroup(ctx, pass, next);
        tap = next;
        pass.draw(encoder, target, [group]);
      },
      textureTaps(): Readonly<Record<string, TextureTap>> {
        return { hero: tap };
      },
      memory() {
        // The filter scaffold owns the fixture; the real hero texture is borrowed.
        return { textureBytes: 0, bufferBytes: 0 };
      },
      sources: { refraction: pass.source },
      diagnostics: pass.diagnostics,
      dispose() {
        pass.dispose();
      },
    };
  },
});
