import { fragmentEffect, sdf, colour } from '@mk7s/hologpu-core';
export default fragmentEffect({
  id: 'raymarch',
  title: 'Sphere-traced sculpture',
  core: true,
  tags: ['raymarch', 'sdf-3d', 'shadows', 'ao'],
  params: {
    steps: {
      type: 'u32',
      default: 80,
      min: 16,
      max: 160,
      step: 1,
      group: 'Quality',
      description: 'Maximum sphere-tracing iterations per pixel.',
    },
    speed: {
      type: 'f32',
      default: 0.2,
      min: 0,
      max: 1,
      step: 0.01,
      group: 'Motion',
      description: 'Camera orbit speed.',
    },
    softness: {
      type: 'f32',
      default: 12,
      min: 2,
      max: 32,
      step: 0.5,
      group: 'Light',
      description: 'Soft-shadow sharpness coefficient.',
    },
    ao: {
      type: 'bool',
      default: true,
      group: 'Light',
      description: 'Five-sample ambient occlusion.',
    },
    tint: {
      type: 'color',
      default: '#e9b99a',
      group: 'Palette',
      description: 'Linear material color.',
    },
  },
  presets: {
    clay: { tint: '#e9b99a', softness: 12, ao: true, steps: 80 },
    chrome: { tint: '#79bfdb', softness: 28, ao: false, steps: 120 },
  },
  inputs: ['time'],
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback: 'radial-gradient(ellipse, #e9b99a, #171e2c)',
  chunks: [sdf, colour],
  wgsl: /* wgsl */ `
fn scene(p: vec3f) -> f32 {
  let sculpture=sd_smooth_union(sd_sphere(p-vec3f(-0.35,0,0),0.65),sd_torus(p-vec3f(0.35,0.05,0),vec2f(0.52,0.19)),0.23);
  return min(sculpture,p.y+0.8);
}
fn normal(p: vec3f) -> vec3f { let e=0.001;return normalize(vec3f(scene(p+vec3f(e,0,0))-scene(p-vec3f(e,0,0)),scene(p+vec3f(0,e,0))-scene(p-vec3f(0,e,0)),scene(p+vec3f(0,0,e))-scene(p-vec3f(0,0,e)))); }
fn shadow(p: vec3f,light: vec3f) -> f32 {
  var result=1.0;var t=0.02;
  for(var i=0;i<32;i++){let h=scene(p+light*t);result=min(result,params.softness*h/max(t,0.01));t+=clamp(h,0.025,0.2);if(h<0.001||t>5.0){break;}}
  return clamp(result,0.08,1.0);
}
fn occlusion(p: vec3f,n: vec3f) -> f32 { var result=0.0;var weight=1.0;for(var i=1;i<=5;i++){let h=f32(i)*0.07;result+=weight*(h-scene(p+n*h));weight*=0.6;}return clamp(1.0-2.0*result,0.0,1.0); }
fn effect(uv: vec2f) -> vec4f {
  let angle=0.6+frame.time*params.speed;let origin=vec3f(sin(angle)*3.0,1.1,cos(angle)*3.0);
  let forward=normalize(vec3f(0,-0.15,0)-origin);let right=normalize(cross(forward,vec3f(0,1,0)));let up=cross(right,forward);
  let p=aspect_uv(uv,frame.resolution);let ray=normalize(forward*1.4+right*p.x-up*p.y);
  var t=0.0;var hit=false;
  for(var i=0u;i<params.steps;i++){let d=scene(origin+ray*t);if(d<0.001){hit=true;break;}t+=d;if(t>12.0){break;}}
  var color=vec3f(0.018,0.028,0.05)+0.025*(1.0-uv.y);
  if(hit){let position=origin+ray*t;let n=normal(position);let light=normalize(vec3f(-0.6,1.0,0.7));let diffuse=max(dot(n,light),0.0)*shadow(position+n*0.003,light);var ambient=1.0;if(params.ao!=0u){ambient=occlusion(position,n);}let material=select(params.tint.rgb,vec3f(0.11),position.y< -0.795);let spec=pow(max(dot(reflect(-light,n),-ray),0.0),40.0)*0.3;color=material*(0.15*ambient+diffuse)+spec;color=mix(color,vec3f(0.028,0.04,0.065),1.0-exp(-t*0.025));}
  return vec4f(tone_map(color*1.5),1.0);
}`,
});
