import { fragmentEffect, hash } from '@mk7s/hologpu-core';

export default fragmentEffect({
  id: 'caustics',
  title: 'Derivative water caustics',
  core: false,
  tags: ['water', 'derivatives', 'refraction', 'jacobian'],
  params: {
    view: {
      type: 'enum',
      default: 'light',
      options: ['light', 'jacobian', 'normals'],
      group: 'Diagnostics',
      description: 'Bounded light concentration, signed ray-map area ratio, or wave normals.',
    },
    scale: {
      type: 'f32',
      default: 7,
      min: 1,
      max: 20,
      step: 0.1,
      group: 'Water',
      description: 'Aspect-correct wave-domain span across the stage height.',
    },
    amplitude: {
      type: 'f32',
      default: 1.3,
      min: 0,
      max: 1.5,
      step: 0.01,
      group: 'Water',
      description: 'Slope amplitude of the eight seeded directional waves.',
    },
    depth: {
      type: 'f32',
      default: 5,
      min: 0,
      max: 5,
      step: 0.05,
      group: 'Optics',
      description: 'Receiver-plane distance in wave-domain units; controls focusing strength.',
    },
    softness: {
      type: 'f32',
      default: 0.06,
      min: 0.02,
      max: 0.5,
      step: 0.01,
      group: 'Optics',
      description: 'Minimum absolute Jacobian determinant before inverse-area amplification.',
    },
    exposure: {
      type: 'f32',
      default: 0.25,
      min: 0.05,
      max: 2,
      step: 0.01,
      group: 'Optics',
      description: 'Exposure of the bounded exponential light response.',
    },
    speed: {
      type: 'f32',
      default: 0.6,
      min: 0,
      max: 2,
      step: 0.01,
      unit: 'rad/s',
      group: 'Motion',
      description: 'Wave phase speed; zero freezes all waves.',
    },
    tint: {
      type: 'color',
      default: '#99e8ec',
      group: 'Palette',
      description: 'Linear-RGB focused light colour and output alpha.',
    },
    background: {
      type: 'color',
      default: '#062d4b',
      group: 'Palette',
      description: 'Linear-RGB receiver colour underneath the focused light.',
    },
  },
  presets: {
    lagoon: { scale: 7, amplitude: 1.1, depth: 4.2, softness: 0.08, exposure: 0.3 },
    pool: {
      scale: 10,
      amplitude: 1.3,
      depth: 5,
      softness: 0.06,
      exposure: 0.25,
      tint: '#e4f9ff',
      background: '#126bb1',
    },
  },
  features: [],
  inputs: ['time', 'seed', 'resolution'],
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback: 'radial-gradient(ellipse at 35% 40%, #99e8ec, #126bb1 40%, #062d4b)',
  chunks: [hash],
  wgsl: /* wgsl */ `
fn water_slope(p: vec2f, time: f32) -> vec2f {
  var slope=vec2f(0.0);
  for(var i=0u; i<8u; i++) {
    let fi=f32(i);
    let angle=fi*2.3999632+random(frame.seed+113u)*6.2831853;
    let direction=vec2f(cos(angle),sin(angle));
    let frequency=1.2+fi*0.57;
    let phase=random(frame.seed+i*137u+61u)*6.2831853;
    let travel=time*sqrt(frequency)*(0.8+random(frame.seed+i*53u));
    slope+=direction*cos(dot(p,direction)*frequency+phase+travel)/(1.0+fi*0.2);
  }
  return slope*(params.amplitude*0.22);
}
fn area_ratio(a: vec2f, b: vec2f) -> f32 { return a.x*b.y-a.y*b.x; }
fn effect(uv: vec2f) -> vec4f {
  let p=aspect_uv(uv,frame.resolution)*params.scale;
  let slope=water_slope(p,frame.time*params.speed);
  let normal=normalize(vec3f(-slope,1.0));
  let ray=refract(vec3f(0.0,0.0,-1.0),normal,1.0/1.333);
  let projected=p+params.depth*ray.xy/max(-ray.z,0.15);
  // All derivative calls execute before diagnostic branches, in uniform control flow.
  let base_area=area_ratio(dpdx(p),dpdy(p));
  let projected_area=area_ratio(dpdx(projected),dpdy(projected));
  let slope_footprint=length(fwidth(slope));
  // Both maps share the stage orientation. Preserve its sign when normalizing.
  let safe_base=select(-max(abs(base_area),1e-12),max(abs(base_area),1e-12),base_area>=0.0);
  let jacobian=projected_area/safe_base;
  let floor_area=max(params.softness,min(slope_footprint*0.35,0.5));
  let concentration=min(12.0,1.0/max(abs(jacobian),floor_area));
  let light=1.0-exp(-concentration*params.exposure);
  var rgb=mix(params.background.rgb,params.tint.rgb,light);
  if(params.view==1u) {
    let compressed=clamp(1.0-abs(jacobian),0.0,1.0);
    let fold=select(vec3f(0.1,0.3,0.8),vec3f(0.9,0.12,0.06),jacobian<0.0);
    rgb=mix(fold,vec3f(1.0),compressed);
  }
  if(params.view==2u) { rgb=normal*0.5+0.5; }
  return vec4f(rgb,params.tint.a);
}`,
});
