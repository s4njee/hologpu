/** M0-only shaders. Deliberately no effect contract until M1. */
export const computeShader = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> colors: array<vec4f, 6>;
@group(0) @binding(1) var<uniform> clock: vec4u;
@compute @workgroup_size(8) fn compute(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= 6u) { return; }
  let h = (clock.x + clock.y + id.x + 1u) * 1664525u + 1013904223u;
  colors[id.x] = vec4f(f32(h & 255u), f32((h >> 8u) & 255u), f32((h >> 16u) & 255u), 255.0) / 255.0;
}
`;
export const fullscreenVertex = /* wgsl */ `
@vertex fn vertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let x = f32((i << 1u) & 2u);
  let y = f32(i & 2u);
  return vec4f(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
}
`;
export const renderShader =
  fullscreenVertex +
  /* wgsl */ `
@group(0) @binding(0) var<storage, read> colors: array<vec4f, 6>;
@group(0) @binding(1) var<uniform> surface: vec4u;
@fragment fn fragment(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let alpha = select(0.5, 1.0, p.x >= f32(surface.y) * 0.5);
  return vec4f(colors[surface.x].rgb * alpha, alpha);
}
`;
export const resolveShader =
  fullscreenVertex +
  /* wgsl */ `
@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fragment(@builtin(position) p: vec4f) -> @location(0) vec4f {
  return textureLoad(image, vec2i(p.xy), 0);
}
`;
