import { chunk } from './composer.ts';
import { hash } from './hash.ts';
export const noise = chunk(
  'noise',
  /* wgsl */ `
fn fade(p: vec2f) -> vec2f { return p*p*p*(p*(p*6.0-15.0)+10.0); }
fn value_noise(p: vec2f, seed: u32) -> f32 {
  let cell=floor(p); let t=fade(fract(p));
  return mix(mix(hash_2d(cell,seed),hash_2d(cell+vec2f(1,0),seed),t.x),mix(hash_2d(cell+vec2f(0,1),seed),hash_2d(cell+1.0,seed),t.x),t.y);
}
fn gradient_at(cell: vec2f, seed: u32) -> vec2f { let a=hash_2d(cell,seed)*6.2831853; return vec2f(cos(a),sin(a)); }
fn gradient_noise(p: vec2f, seed: u32) -> f32 {
  let i=floor(p); let f=fract(p); let t=fade(f);
  let a=dot(gradient_at(i,seed),f); let b=dot(gradient_at(i+vec2f(1,0),seed),f-vec2f(1,0));
  let c=dot(gradient_at(i+vec2f(0,1),seed),f-vec2f(0,1)); let d=dot(gradient_at(i+1.0,seed),f-1.0);
  return 0.5+0.7071068*mix(mix(a,b,t.x),mix(c,d,t.x),t.y);
}
fn simplex_noise(p: vec2f, seed: u32) -> f32 {
  let i=floor(p+dot(p,vec2f(0.3660254))); let a=p-i+dot(i,vec2f(0.211324865));
  let corner=select(vec2f(0,1),vec2f(1,0),a.x>a.y);
  let b=a-corner+0.211324865; let c=a-1.0+0.42264973;
  let t=max(vec3f(0.5-dot(a,a),0.5-dot(b,b),0.5-dot(c,c)),vec3f(0));
  let w=t*t*t*t;
  return clamp(0.5+35.0*dot(w,vec3f(dot(gradient_at(i,seed),a),dot(gradient_at(i+corner,seed),b),dot(gradient_at(i+1.0,seed),c))),0.0,1.0);
}
fn worley(p: vec2f, seed: u32) -> vec2f {
  let cell=floor(p); let local=fract(p); var nearest=vec2f(10);
  for(var y=-1; y<=1; y++) { for(var x=-1; x<=1; x++) {
    let offset=vec2f(f32(x),f32(y)); let d=length(offset+hash_pair(cell+offset,seed)-local);
    if(d<nearest.x) {nearest.y=nearest.x; nearest.x=d;} else if(d<nearest.y) {nearest.y=d;}
  }} return nearest;
}
fn curl_noise(p: vec2f, seed: u32) -> vec2f {
  let e=0.01;
  return vec2f(simplex_noise(p+vec2f(0,e),seed)-simplex_noise(p-vec2f(0,e),seed),simplex_noise(p-vec2f(e,0),seed)-simplex_noise(p+vec2f(e,0),seed))/(2.0*e);
}
fn noise_kind(p: vec2f, seed: u32, kind: u32) -> f32 {
  if(kind==0u) {return value_noise(p,seed);} if(kind==1u) {return gradient_noise(p,seed);}
  if(kind==2u) {return simplex_noise(p,seed);} if(kind==3u) {return min(worley(p,seed).x,1.0);}
  return clamp(length(curl_noise(p,seed))*0.3,0.0,1.0);
}
fn fbm(p: vec2f, seed: u32, kind: u32, octaves: u32) -> f32 {
  var q=p; var a=0.5; var total=0.0; var weight=0.0;
  for(var i=0u;i<min(octaves,8u);i++) { total+=a*noise_kind(q,seed+i*97u,kind);weight+=a;q=q*2.03+vec2f(3.1,7.7);a*=0.5; }
  return total/max(weight,0.001);
}
`,
  [hash],
);
