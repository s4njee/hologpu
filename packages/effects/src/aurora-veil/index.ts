import { fragmentEffect, colour, noise } from '@mk7s/hologpu-core';

export default fragmentEffect({
  id: 'aurora-veil',
  budget: { expectedMs: 0.8, referenceSize: [640, 400] },
  title: 'Soft aurora veil',
  core: true,
  tags: ['background', 'brand', 'oklch', 'domain-warp'],
  params: {
    base: {
      type: 'color',
      default: '#11121b',
      css: true,
      group: 'Palette',
      description: 'Flat background colour.',
    },
    first: {
      type: 'color',
      default: '#747499',
      css: true,
      group: 'Palette',
      description: 'First low-saturation aurora stop.',
    },
    second: {
      type: 'color',
      default: '#598f92',
      css: true,
      group: 'Palette',
      description: 'Second aurora stop.',
    },
    third: {
      type: 'color',
      default: '#9d738b',
      css: true,
      group: 'Palette',
      description: 'Third aurora stop.',
    },
    intensity: {
      type: 'f32',
      default: 0.22,
      min: 0,
      max: 1,
      step: 0.01,
      css: true,
      group: 'Field',
      description: 'Band contrast against the base colour.',
    },
    scale: {
      type: 'f32',
      default: 1.8,
      min: 0.5,
      max: 4,
      step: 0.05,
      group: 'Field',
      description: 'Frequency of the soft domain-warped field.',
    },
    speed: {
      type: 'f32',
      default: 0.035,
      min: 0,
      max: 0.2,
      step: 0.005,
      group: 'Motion',
      description: 'Slow field drift in noise units per second.',
    },
    pointerBias: {
      type: 'f32',
      default: 0,
      min: 0,
      max: 0.02,
      step: 0.001,
      group: 'Motion',
      description: 'Optional pointer offset, at most two percent of the field.',
    },
    dither: {
      type: 'bool',
      default: true,
      group: 'Field',
      description: 'Static one-code-value SDR dither.',
    },
  },
  presets: {
    ember: {
      base: '#17120f',
      first: '#ba8662',
      second: '#866c56',
      third: '#8f5f51',
      intensity: 0.22,
    },
    dusk: {
      base: '#11121b',
      first: '#747499',
      second: '#598f92',
      third: '#9d738b',
      intensity: 0.22,
    },
    lagoon: {
      base: '#0d1a1b',
      first: '#6b9193',
      second: '#709982',
      third: '#979c7b',
      intensity: 0.22,
    },
    paper: {
      base: '#f5f3ef',
      first: '#b5bed0',
      second: '#bed1c8',
      third: '#d9bac5',
      intensity: 0.25,
    },
  },
  fallback:
    'linear-gradient(155deg, color-mix(in srgb-linear, #11121b 78%, #747499), color-mix(in srgb-linear, #11121b 78%, #598f92), color-mix(in srgb-linear, #11121b 78%, #9d738b))',
  reducedMotion: { time: 0 },
  quality: { resolutionScale: [0.25, 1] },
  defaultResolutionScale: 0.25,
  poster: new URL('./poster.png', import.meta.url).href,
  presetPosters: {
    ember: new URL('./poster-ember.png', import.meta.url).href,
    dusk: new URL('./poster.png', import.meta.url).href,
    paper: new URL('./poster-paper.png', import.meta.url).href,
  },
  inputs: ['time', 'pointer'],
  chunks: [noise, colour],
  wgsl: /* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
  let bias=(frame.pointer-0.5)*2.0*params.pointerBias;
  let t=frame.time*params.speed;
  let p=aspect_uv(uv+bias,frame.resolution)*params.scale+vec2f(t*0.3,t);
  let warp=vec2f(value_noise(p+vec2f(7,3),frame.seed),value_noise(p+vec2f(1,9),frame.seed+73u))-0.5;
  let n=fbm(p+warp*0.85,frame.seed,0u,2u);
  let band=uv.y+0.24*(n-0.5)+0.07*sin(uv.x*3.2+t);
  let centres=vec3f(band)-vec3f(0.22,0.52,0.82);
  var w=exp(-18.0*centres*centres);
  let veil=clamp(w.x+w.y+w.z,0.0,1.0); w/=max(w.x+w.y+w.z,0.001);
  let a=oklab_to_oklch(linear_to_oklab(params.first.rgb));
  let b=oklab_to_oklch(linear_to_oklab(params.second.rgb));
  let c=oklab_to_oklch(linear_to_oklab(params.third.rgb));
  let hueWeights=w*vec3f(a.y,b.y,c.y);
  let hue=atan2(dot(hueWeights,vec3f(sin(a.z),sin(b.z),sin(c.z))),dot(hueWeights,vec3f(cos(a.z),cos(b.z),cos(c.z))));
  let lch=vec3f(dot(w,vec3f(a.x,b.x,c.x)),dot(w,vec3f(a.y,b.y,c.y)),hue);
  let amount=params.intensity*veil;
  var rgb=mix(params.base.rgb,clamp(oklab_to_linear(oklch_to_oklab(lch)),vec3f(0),vec3f(1)),amount);
  if(params.dither!=0u) {
    let grain=(hash_2d(floor(uv*frame.resolution),frame.seed)-0.5)/255.0;
    rgb=srgb_to_linear(clamp(linear_to_srgb(rgb)+grain,vec3f(0),vec3f(1)));
  }
  return vec4f(rgb,mix(params.base.a,dot(w,vec3f(params.first.a,params.second.a,params.third.a)),amount));
}`,
});
