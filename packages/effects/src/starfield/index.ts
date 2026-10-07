import { fragmentEffect, hash, noise, colour } from '@mk7s/hologpu-core';

export default fragmentEffect({
  id: 'starfield',
  title: 'Parallax stars and nebula',
  core: false,
  tags: ['parallax', 'hash', 'noise', 'temporal-stability'],
  params: {
    layers: {
      type: 'u32',
      default: 3,
      min: 1,
      max: 5,
      step: 1,
      group: 'Stars',
      description: 'Independent star layers, with increasing size and parallax speed.',
    },
    density: {
      type: 'f32',
      default: 26,
      min: 8,
      max: 50,
      step: 1,
      group: 'Stars',
      description: 'Far-layer lattice cells along the stage height; one candidate star per cell.',
    },
    size: {
      type: 'f32',
      default: 1.15,
      min: 0.3,
      max: 3,
      step: 0.05,
      unit: 'px',
      group: 'Stars',
      description:
        'Nominal far-layer radius in physical target pixels, before seeded size variation.',
    },
    hashMode: {
      type: 'enum',
      default: 'folded',
      options: ['folded', 'xor'],
      group: 'Algorithm',
      description:
        'Role-separated integer coordinate folding, or the shared XOR hash for visual comparison.',
    },
    speed: {
      type: 'f32',
      default: 0.045,
      min: 0,
      max: 0.25,
      step: 0.005,
      unit: 'height/s',
      group: 'Motion',
      description:
        'Continuous diagonal travel; world-space cell identities never include frame or time.',
    },
    twinkle: {
      type: 'f32',
      default: 0.25,
      min: 0,
      max: 1,
      step: 0.05,
      group: 'Motion',
      description: 'Smooth brightness modulation with a fixed per-star phase and frequency.',
    },
    nebula: {
      type: 'f32',
      default: 0.7,
      min: 0,
      max: 1.5,
      step: 0.05,
      group: 'Nebula',
      description: 'Domain-warped, seeded gradient-noise cloud intensity.',
    },
    cloudScale: {
      type: 'f32',
      default: 2.8,
      min: 0.5,
      max: 8,
      step: 0.1,
      group: 'Nebula',
      description: 'Nebula frequency in aspect-correct stage coordinates.',
    },
    cool: {
      type: 'color',
      default: '#438ddb',
      group: 'Palette',
      description: 'Cool nebula and star tint, parsed to linear RGB.',
    },
    warm: {
      type: 'color',
      default: '#da62ad',
      group: 'Palette',
      description: 'Warm nebula and star tint, parsed to linear RGB.',
    },
  },
  presets: {
    deepSpace: {
      layers: 3,
      density: 26,
      size: 1.15,
      nebula: 0.7,
      speed: 0.045,
      hashMode: 'folded',
    },
    drift: {
      layers: 5,
      density: 18,
      size: 1.7,
      nebula: 1,
      speed: 0.08,
      cool: '#38aeb3',
      warm: '#ec9864',
      hashMode: 'folded',
    },
  },
  inputs: ['time'],
  features: [],
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback: 'radial-gradient(ellipse at 35% 40%, #28475a, #261933 55%, #060912)',
  chunks: [hash, noise, colour],
  wgsl: /* wgsl */ `
fn star_key(cell: vec2f, seed: u32) -> u32 {
  let p=vec2u(vec2i(cell));
  if(params.hashMode==1u) { return hash_u32(p.x)^hash_u32(p.y+seed); }
  return hash_u32((p.x*0x9e3779b9u) ^ hash_u32(p.y*0x85ebca6bu+0xc2b2ae35u) ^ seed);
}
fn star_layer(world: vec2f, layer: u32) -> vec3f {
  let depth=0.45+0.28*f32(layer);
  let scale=params.density/(1.0+0.35*f32(layer));
  let p=(world+vec2f(0.7,0.22)*frame.time*params.speed*depth)*scale;
  let cell=floor(p);
  let seed=frame.seed+layer*1297u;
  let pixel=scale/max(frame.resolution.y,1.0);
  var light=vec3f(0);
  for(var y=-1;y<=1;y++) { for(var x=-1;x<=1;x++) {
    let site=cell+vec2f(f32(x),f32(y));
    let key=star_key(site,seed);
    let position=site+vec2f(random(key+101u),random(key+307u));
    let radius=min(params.size*(0.55+random(key+521u))*depth*pixel,0.08);
    let aa=clamp(pixel*0.65,0.00001,0.2);
    let footprint=max(radius,aa);
    let energy=min(1.0,(radius*radius)/(aa*aa));
    let d=length(p-position);
    let core=1.0-smoothstep(max(0.0,radius-aa),radius+aa,d);
    let support=min(0.45,footprint*5.0);
    let halo=0.12*exp(-d*d/(4.0*footprint*footprint))*(1.0-smoothstep(support*0.8,support,d));
    let phase=random(key+733u)*6.2831853;
    let pulse=1.0-params.twinkle*(0.5+0.5*sin(frame.time*(0.8+random(key+947u))+phase));
    let tint=mix(vec3f(1),mix(params.cool.rgb,params.warm.rgb,random(key+1171u)),0.25);
    light+=tint*(core+halo)*energy*pulse*(0.45+0.55*random(key+1429u));
  }}
  return light;
}
fn effect(uv: vec2f) -> vec4f {
  let world=aspect_uv(uv,frame.resolution);
  let q=(world+vec2f(0.7,0.22)*frame.time*params.speed*0.12)*params.cloudScale;
  let warp=vec2f(fbm(q+vec2f(7.3,1.9),frame.seed+3571u,1u,3u),fbm(q+vec2f(2.7,9.1),frame.seed+7907u,1u,3u))-0.5;
  let cloud=fbm(q+warp*1.5,frame.seed+104729u,1u,5u);
  let density=pow(smoothstep(0.25,0.8,cloud),2.0)*params.nebula;
  let tint=mix(params.cool.rgb,params.warm.rgb,smoothstep(0.25,0.75,cloud+warp.x*0.3));
  var rgb=vec3f(0.002,0.004,0.009)+tint*density*0.55;
  for(var layer=0u;layer<params.layers;layer++) { rgb+=star_layer(world,layer); }
  return vec4f(tone_map(rgb),1);
}`,
});
