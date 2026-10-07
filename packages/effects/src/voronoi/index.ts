import { fragmentEffect, hash, colour } from '@mk7s/hologpu-core';
export default fragmentEffect({
  id: 'voronoi',
  title: 'Moving Voronoi cells',
  core: true,
  tags: ['cellular', 'distance', 'fragment-loops'],
  params: {
    metric: {
      type: 'enum',
      default: 'euclidean',
      options: ['euclidean', 'manhattan', 'chebyshev'],
      group: 'Algorithm',
      description: 'Distance metric used to select the nearest site.',
    },
    scale: {
      type: 'f32',
      default: 8,
      min: 2,
      max: 24,
      step: 0.1,
      group: 'Field',
      description: 'Cell density along the short stage dimension.',
    },
    speed: {
      type: 'f32',
      default: 0.5,
      min: 0,
      max: 2,
      step: 0.01,
      group: 'Motion',
      description: 'Site oscillation speed.',
    },
    border: {
      type: 'f32',
      default: 0.07,
      min: 0,
      max: 0.3,
      step: 0.005,
      group: 'Field',
      description: 'Second-nearest distance-gap threshold; a decorative approximate border.',
    },
    chroma: {
      type: 'f32',
      default: 0.12,
      min: 0,
      max: 0.25,
      step: 0.01,
      group: 'Palette',
      description: 'Cell OKLCH chroma.',
    },
  },
  presets: {
    mosaic: { metric: 'euclidean', scale: 8, border: 0.07 },
    city: { metric: 'manhattan', scale: 14, border: 0.03, chroma: 0.06 },
  },
  inputs: ['time'],
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback: 'linear-gradient(120deg, #8e77ba, #54898c)',
  chunks: [hash, colour],
  wgsl: /* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
  let p=aspect_uv(uv,frame.resolution)*params.scale;let cell=floor(p);var first=10.0;var second=10.0;var identity=0.0;
  for(var y=-2;y<=2;y++) { for(var x=-2;x<=2;x++) {
    let offset=vec2f(f32(x),f32(y));let site=cell+offset;
    let rnd=hash_pair(site,frame.seed);let position=site+0.5+0.4*sin(vec2f(frame.time*params.speed)+rnd*6.2831853);
    let d=abs(p-position);var distance=length(d);if(params.metric==1u){distance=d.x+d.y;}else if(params.metric==2u){distance=max(d.x,d.y);}
    if(distance<first){second=first;first=distance;identity=rnd.x;}else if(distance<second){second=distance;}
  }}
  let hue=identity*6.2831853;let rgb=clamp(oklab_to_linear(oklch_to_oklab(vec3f(0.72,params.chroma,hue))),vec3f(0),vec3f(1));
  let edge=smoothstep(params.border,params.border+0.03,second-first);
  return vec4f(rgb*(0.2+0.8*edge),1);
}`,
});
