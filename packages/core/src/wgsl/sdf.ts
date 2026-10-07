import { chunk } from './composer.ts';
export const sdf = chunk(
  'sdf',
  /* wgsl */ `
fn sd_circle(p: vec2f,r: f32) -> f32 { return length(p)-r; }
fn sd_box(p: vec2f,b: vec2f) -> f32 { let q=abs(p)-b;return length(max(q,vec2f(0)))+min(max(q.x,q.y),0.0); }
fn sd_round_box(p: vec2f,b: vec2f,r: f32) -> f32 { return sd_box(p,b-vec2f(r))-r; }
fn sd_union(a: f32,b: f32) -> f32 { return min(a,b); }
fn sd_intersection(a: f32,b: f32) -> f32 { return max(a,b); }
fn sd_subtract(a: f32,b: f32) -> f32 { return max(a,-b); }
fn sd_smooth_union(a: f32,b: f32,k: f32) -> f32 { let h=clamp(0.5+0.5*(b-a)/max(k,0.0001),0.0,1.0);return mix(b,a,h)-k*h*(1.0-h); }
fn sd_sphere(p: vec3f,r: f32) -> f32 { return length(p)-r; }
fn sd_box3(p: vec3f,b: vec3f) -> f32 { let q=abs(p)-b;return length(max(q,vec3f(0)))+min(max(q.x,max(q.y,q.z)),0.0); }
fn sd_torus(p: vec3f,r: vec2f) -> f32 { return length(vec2f(length(p.xz)-r.x,p.y))-r.y; }
`,
);
