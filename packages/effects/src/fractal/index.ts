import { fragmentEffect, colour } from '@mk7s/hologpu-core';
export default fragmentEffect({
  id: 'fractal',
  title: 'Julia / Mandelbrot explorer',
  core: true,
  tags: ['fractal', 'precision', 'double-single'],
  params: {
    fractalSet: {
      type: 'enum',
      default: 'mandelbrot',
      options: ['mandelbrot', 'julia'],
      group: 'Algorithm',
      description: 'Escape-time complex map.',
    },
    arithmetic: {
      type: 'enum',
      default: 'f32',
      options: ['f32', 'double-single'],
      group: 'Algorithm',
      description: 'Double-single uses paired f32 arithmetic, not native f64.',
    },
    center: {
      type: 'vec2',
      default: [-0.5, 0],
      min: -2,
      max: 2,
      step: 0.0001,
      group: 'View',
      description: 'Complex-plane center. The low residual is supplied separately for deep zoom.',
    },
    residual: {
      type: 'vec2',
      default: [0, 0],
      min: -0.0001,
      max: 0.0001,
      step: 0.000000001,
      group: 'View',
      description: 'Low component of the center in double-single mode.',
    },
    zoom: {
      type: 'f32',
      default: 1,
      min: 0.5,
      max: 1000000,
      step: 0.1,
      group: 'View',
      description: 'Magnification; f32 eventually loses neighboring-pixel distinctions.',
    },
    iterations: {
      type: 'u32',
      default: 100,
      min: 16,
      max: 300,
      step: 1,
      group: 'Quality',
      description: 'Maximum escape-time iterations.',
    },
    julia: {
      type: 'vec2',
      default: [-0.8, 0.156],
      min: -1.5,
      max: 1.5,
      step: 0.001,
      group: 'Algorithm',
      description: 'Complex constant for the Julia set.',
    },
    hue: {
      type: 'f32',
      default: 0.4,
      min: 0,
      max: 6.28,
      step: 0.01,
      group: 'Palette',
      description: 'OKLCH smooth-coloring hue offset.',
    },
  },
  presets: {
    coast: {
      fractalSet: 'mandelbrot',
      center: [-0.5, 0],
      zoom: 1,
      arithmetic: 'f32',
      iterations: 100,
    },
    julia: {
      fractalSet: 'julia',
      julia: [-0.8, 0.156],
      center: [0, 0],
      zoom: 1.2,
      arithmetic: 'double-single',
      hue: 3.5,
    },
  },
  inputs: [],
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback: 'radial-gradient(ellipse, #d290e1, #101829)',
  chunks: [colour],
  wgsl: /* wgsl */ `
// Reconstruct finite f32 values through integer fields. This makes rounding
// observable before compensation, preventing fast-math reassociation/fusion.
// The bounded fractal path never needs infinities, NaNs, or subnormal precision.
fn round_pair(v: f32) -> f32 {
  let bits=bitcast<u32>(v);let exponent=(bits>>23u)&255u;
  let significand=f32((bits&0x7fffffu)|select(0u,0x800000u,exponent!=0u));
  return ldexp(significand,select(-149,i32(exponent)-150,exponent!=0u))*select(1.0,-1.0,(bits&0x80000000u)!=0u);
}
fn two_sum(a: f32,b: f32) -> vec2f {
  let s=round_pair(a+b);let v=round_pair(s-a);
  let e=round_pair(round_pair(a-round_pair(s-v))+round_pair(b-v));
  return vec2f(s,e);
}
fn ds_add(a: vec2f,b: vec2f) -> vec2f {
  let s=two_sum(a.x,b.x);let t=two_sum(a.y,b.y);
  let r=two_sum(s.x,round_pair(s.y+t.x));
  return two_sum(r.x,round_pair(r.y+t.y));
}
fn ds_mul(first: vec2f,second: vec2f) -> vec2f {
  let a=two_sum(first.x,first.y);let b=two_sum(second.x,second.y);
  let product=round_pair(a.x*b.x);
  let ah=bitcast<f32>(bitcast<u32>(a.x)&0xfffff000u);let al=round_pair(a.x-ah);
  let bh=bitcast<f32>(bitcast<u32>(b.x)&0xfffff000u);let bl=round_pair(b.x-bh);
  let e0=round_pair(round_pair(ah*bh)-product);
  let e1=round_pair(e0+round_pair(ah*bl));
  let e2=round_pair(e1+round_pair(al*bh));
  let e3=round_pair(e2+round_pair(al*bl));
  let e4=round_pair(e3+round_pair(a.x*b.y));
  let e5=round_pair(e4+round_pair(a.y*b.x));
  let error=round_pair(e5+round_pair(a.y*b.y));
  let hi=round_pair(product+error);return vec2f(hi,round_pair(error-round_pair(hi-product)));
}
fn effect(uv: vec2f) -> vec4f {
  let offset=aspect_uv(uv,frame.resolution)*3.2/params.zoom;
  let point=params.center+params.residual+offset;var z=vec2f(0);var c=point;
  if(params.fractalSet==1u){z=point;c=params.julia;}
  var zx=vec2f(z.x,0);var zy=vec2f(z.y,0);
  var cx=vec2f(c.x,0);var cy=vec2f(c.y,0);
  if(params.arithmetic==1u){let px=ds_add(vec2f(params.center.x,params.residual.x),vec2f(offset.x,0));let py=ds_add(vec2f(params.center.y,params.residual.y),vec2f(offset.y,0));if(params.fractalSet==1u){zx=px;zy=py;}else{cx=px;cy=py;}}
  var count=0u;var magnitude=0.0;
  for(var i=0u;i<params.iterations;i++) {
    if(params.arithmetic==1u){let nextX=ds_add(ds_add(ds_mul(zx,zx),-ds_mul(zy,zy)),cx);let nextY=ds_add(ds_mul(vec2f(2,0),ds_mul(zx,zy)),cy);zx=nextX;zy=nextY;z=vec2f(zx.x+zx.y,zy.x+zy.y);}
    else {z=vec2f(z.x*z.x-z.y*z.y,2.0*z.x*z.y)+c;}
    count=i;magnitude=dot(z,z);if(magnitude>256.0){break;}
  }
  if(magnitude<=256.0){return vec4f(0.003,0.005,0.009,1);}
  let smoothCount=f32(count)+1.0-log2(max(log2(sqrt(magnitude)),0.001));let h=params.hue+smoothCount*0.12;
  let rgb=clamp(oklab_to_linear(oklch_to_oklab(vec3f(0.65+0.15*sin(smoothCount*0.06),0.13,h))),vec3f(0),vec3f(1));
  return vec4f(rgb,1.0);
}`,
});
