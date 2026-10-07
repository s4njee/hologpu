import { fragmentEffect, colour, hash } from '@mk7s/hologpu-core';
export default fragmentEffect({
  id: 'gradient-oklch',
  title: 'OKLCH mesh gradient',
  core: true,
  tags: ['colour', 'mesh', 'dither'],
  params: {
    first: {
      type: 'color',
      default: '#f071b4',
      group: 'Palette',
      description: 'First mesh stop, parsed to linear RGB.',
    },
    second: {
      type: 'color',
      default: '#476aff',
      group: 'Palette',
      description: 'Second mesh stop.',
    },
    third: { type: 'color', default: '#ffbe66', group: 'Palette', description: 'Third mesh stop.' },
    spread: {
      type: 'f32',
      default: 2.5,
      min: 0.5,
      max: 8,
      step: 0.05,
      group: 'Field',
      description: 'Gaussian stop concentration.',
    },
    speed: {
      type: 'f32',
      default: 0.2,
      min: 0,
      max: 2,
      step: 0.01,
      unit: 'rad/s',
      group: 'Motion',
      description: 'Orbital speed of the three mesh stops.',
    },
    dither: {
      type: 'bool',
      default: true,
      group: 'Field',
      description: 'One display-code-value dither to reduce banding.',
    },
  },
  presets: {
    dusk: { first: '#f071b4', second: '#476aff', third: '#ffbe66', spread: 2.5 },
    lagoon: { first: '#36cfad', second: '#075c96', third: '#f4eb91', spread: 4.5 },
  },
  fallback: 'linear-gradient(135deg, #f071b4, #476aff, #ffbe66)',
  reducedMotion: { time: 0 },
  quality: { resolutionScale: [0.25, 1] },
  inputs: ['time'],
  chunks: [colour, hash],
  wgsl: /* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
  let t=frame.time*params.speed;
  let a=vec2f(0.5)+0.36*vec2f(cos(t),sin(t));
  let b=vec2f(0.5)+0.36*vec2f(cos(t+2.094),sin(t+2.094));
  let c=vec2f(0.5)+0.36*vec2f(cos(t+4.189),sin(t+4.189));
  var w=exp(-params.spread*vec3f(dot(uv-a,uv-a),dot(uv-b,uv-b),dot(uv-c,uv-c)));w/=w.x+w.y+w.z;
  let ca=oklab_to_oklch(linear_to_oklab(params.first.rgb));
  let cb=oklab_to_oklch(linear_to_oklab(params.second.rgb));
  let cc=oklab_to_oklch(linear_to_oklab(params.third.rgb));
  let hue=atan2(dot(w,vec3f(sin(ca.z),sin(cb.z),sin(cc.z))),dot(w,vec3f(cos(ca.z),cos(cb.z),cos(cc.z))));
  let lch=vec3f(dot(w,vec3f(ca.x,cb.x,cc.x)),dot(w,vec3f(ca.y,cb.y,cc.y)),hue);
  var rgb=clamp(oklab_to_linear(oklch_to_oklab(lch)),vec3f(0),vec3f(1));
  if(params.dither!=0u) { let n=(hash_2d(floor(uv*frame.resolution),frame.seed)-0.5)/255.0;rgb=srgb_to_linear(clamp(linear_to_srgb(rgb)+n,vec3f(0),vec3f(1))); }
  return vec4f(rgb,dot(w,vec3f(params.first.a,params.second.a,params.third.a)));
}`,
});
