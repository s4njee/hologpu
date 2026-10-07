import { chunk } from './composer.ts';
export const hash = chunk(
  'hash',
  /* wgsl */ `
fn hash_u32(x: u32) -> u32 {
  var h=x; h=h^(h>>16u); h=h*0x7feb352du; h=h^(h>>15u); h=h*0x846ca68bu; return h^(h>>16u);
}
fn random(seed: u32) -> f32 { return f32(hash_u32(seed)>>8u)/16777216.0; }
fn hash_2d(p: vec2f, seed: u32) -> f32 {
  let i=vec2u(vec2i(floor(p))); return random(hash_u32(i.x)^hash_u32(i.y+seed));
}
fn hash_pair(p: vec2f, seed: u32) -> vec2f { return vec2f(hash_2d(p,seed),hash_2d(p,seed+901u)); }
`,
);
