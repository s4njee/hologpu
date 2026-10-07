import { fragmentEffect, sdf } from '@mk7s/hologpu-core';
export default fragmentEffect({
  id: 'sdf-2d',
  title: 'Metaballs and Boolean shapes',
  core: true,
  tags: ['sdf', 'boolean', 'metaballs', 'derivatives'],
  params: {
    operation: {
      type: 'enum',
      default: 'smooth-union',
      options: ['smooth-union', 'union', 'intersection', 'subtract'],
      group: 'Geometry',
      description: 'Combine a moving circle and rounded box.',
    },
    radius: {
      type: 'f32',
      default: 0.22,
      min: 0.05,
      max: 0.45,
      step: 0.01,
      group: 'Geometry',
      description: 'Circle radius in normalized stage units.',
    },
    smoothing: {
      type: 'f32',
      default: 0.2,
      min: 0.005,
      max: 0.4,
      step: 0.005,
      group: 'Geometry',
      description: 'Smooth-union blend distance.',
    },
    speed: {
      type: 'f32',
      default: 0.6,
      min: 0,
      max: 2,
      step: 0.01,
      group: 'Motion',
      description: 'Orbit speed; the pointer shifts the circle.',
    },
    contours: {
      type: 'bool',
      default: true,
      group: 'Field',
      description: 'Show distance isolines outside the surface.',
    },
    tint: { type: 'color', default: '#8be5cf', group: 'Palette', description: 'Shape fill color.' },
  },
  presets: {
    merge: { operation: 'smooth-union', radius: 0.22, smoothing: 0.2 },
    cutout: { operation: 'subtract', radius: 0.25, tint: '#f7a4ca', contours: false },
  },
  inputs: ['time', 'pointer'],
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback: 'radial-gradient(circle, #8be5cf, #1a2434)',
  chunks: [sdf],
  wgsl: /* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
  let p=aspect_uv(uv,frame.resolution);
  let offset=0.13*vec2f(cos(frame.time*params.speed),sin(frame.time*params.speed))+select(vec2f(0),(frame.pointer-0.5)*0.1,frame.buttons!=0u);
  let a=sd_round_box(p+vec2f(0.06,0),vec2f(0.22,0.18),0.06);let b=sd_circle(p-offset,params.radius);
  var d=sd_smooth_union(a,b,params.smoothing);if(params.operation==1u){d=sd_union(a,b);}else if(params.operation==2u){d=sd_intersection(a,b);}else if(params.operation==3u){d=sd_subtract(a,b);}
  let aa=max(fwidth(d),1.0/frame.resolution.y);let coverage=1.0-smoothstep(-aa,aa,d);
  var background=vec3f(0.013,0.019,0.035);if(params.contours!=0u){let line=1.0-smoothstep(0.0,0.035,abs(sin(d*80.0)));background+=vec3f(0.025)*line;}
  return vec4f(mix(background,params.tint.rgb,coverage),1.0);
}`,
});
