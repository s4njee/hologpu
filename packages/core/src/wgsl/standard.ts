import { chunk } from './composer.ts';
export const frame = chunk(
  'frame',
  /* wgsl */ `
struct Frame {
  resolution: vec2f, dpr: f32, time: f32,
  pointer: vec2f, velocity: vec2f,
  delta: f32, index: u32, buttons: u32, seed: u32,
  scroll: f32, visibility: f32, pressure: f32, reducedMotion: f32,
};
@group(0) @binding(0) var<uniform> frame: Frame;
`,
);
export const fullscreen = chunk(
  'fullscreen',
  /* wgsl */ `
struct VertexOut { @builtin(position) position: vec4f, @location(0) uv: vec2f, };
@vertex fn vertex(@builtin(vertex_index) i: u32) -> VertexOut {
  let uv=vec2f(f32((i<<1u)&2u),f32(i&2u));
  var out: VertexOut; out.position=vec4f(uv*2.0-1.0,0,1);out.uv=vec2f(uv.x,1.0-uv.y);return out;
}
`,
);
export const sampling = chunk(
  'sampling',
  /* wgsl */ `
fn aspect_uv(uv: vec2f,resolution: vec2f) -> vec2f { return (uv-0.5)*vec2f(resolution.x/resolution.y,1); }
fn sample_bilinear(image: texture_2d<f32>,uv: vec2f) -> vec4f {
  let size=vec2i(textureDimensions(image));let p=uv*vec2f(size)-0.5;let b=vec2i(floor(p));let t=fract(p);
  let a=textureLoad(image,clamp(b,vec2i(0),size-1),0);let c=textureLoad(image,clamp(b+vec2i(1,0),vec2i(0),size-1),0);
  let d=textureLoad(image,clamp(b+vec2i(0,1),vec2i(0),size-1),0);let e=textureLoad(image,clamp(b+vec2i(1,1),vec2i(0),size-1),0);
  return mix(mix(a,c,t.x),mix(d,e,t.x),t.y);
}
`,
);
