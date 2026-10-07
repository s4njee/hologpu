import { fragmentEffect } from '@mk7s/hologpu-core';
export default fragmentEffect({
  id: 'bands',
  title: 'Sine bands',
  params: {
    frequency: {
      type: 'f32',
      default: 8,
      min: 1,
      max: 30,
      description: 'Number of waves across the canvas.',
    },
  },
  wgsl: /* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
  let wave=0.5+0.5*sin(uv.x*params.frequency*6.28318+frame.time);
  return vec4f(wave,0.15,1.0-wave,1.0);
}`,
});
