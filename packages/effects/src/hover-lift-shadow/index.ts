import { defineEffect, fragmentEffect } from '@mk7s/hologpu-core';
import { cardDistance, cardGeometryParams } from '../_dom/card-geometry.ts';
import { f } from '../_filters/common.ts';

const definition = fragmentEffect({
  id: 'hover-lift-shadow',
  budget: { expectedMs: 0.4, referenceSize: [640, 400] },
  title: 'Soft coloured card contact shadow',
  tags: ['card', 'shadow', 'css', 'launch-page'],
  inputs: ['css'],
  params: {
    ...cardGeometryParams,
    elevation: {
      ...f(0.15, 0, 1, 'Card lift; controls shadow spread and downward offset.', 'Appearance'),
      css: true,
    },
    intensity: {
      ...f(0.2, 0, 1, 'Maximum exterior contact-shadow opacity.', 'Appearance'),
      css: true,
    },
    tint: {
      type: 'color',
      default: '#283b66',
      css: true,
      group: 'Palette',
      description: 'Subtle shadow tint; alpha also scales opacity.',
    },
  },
  presets: {
    cool: { tint: '#283b66', intensity: 0.2, elevation: 0.15 },
    warm: { tint: '#664c3b', intensity: 0.18, elevation: 0.15 },
    lifted: { tint: '#253760', intensity: 0.25, elevation: 0.65 },
  },
  quality: { resolutionScale: [0.5, 1] },
  reducedMotion: { time: 0 },
  fallback: 'transparent',
  poster: new URL('./poster.png', import.meta.url).href,
  cardFallback: { kind: 'shadow' },
  wgsl: /* wgsl */ `
${cardDistance}
fn effect(uv:vec2f)->vec4f {
  let dpr=max(frame.dpr,0.0001);
  let size=frame.resolution/dpr;
  let centre=(params.rect.xy+params.rect.zw*0.5)*size;
  let halfSize=params.rect.zw*size*0.5;
  let local=uv*size-centre;
  let elevation=clamp(params.elevation,0.0,1.0);
  let offset=vec2f(0.0,mix(3.0,15.0,elevation));
  let sigma=mix(4.0,11.0,elevation);
  let card=card_distance(local,halfSize,params.radius,params.radiiX,params.radiiY);
  let shadow=card_distance(local-offset,halfSize,params.radius,params.radiiX,params.radiiY);
  let aa=0.5/dpr;
  let exterior=smoothstep(-aa,aa,card);
  let distance=max(shadow,0.0);
  let halo=exp(-0.5*distance*distance/(sigma*sigma));
  let alpha=clamp(halo*exterior*params.intensity*mix(0.65,1.0,elevation)*params.tint.a,0.0,1.0);
  return vec4f(params.tint.rgb,alpha);
}`,
});

export default defineEffect({
  ...definition,
  async create(ctx) {
    const instance = await definition.create(ctx);
    return { ...instance, shouldRender: () => false };
  },
});
