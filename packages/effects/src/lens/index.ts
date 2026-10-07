import { filterEffect, hash } from '@mk7s/hologpu-core';
import { f, straight } from '../_filters/common.ts';
export default filterEffect({
  id: 'lens',
  title: 'Lens and film stack',
  core: true,
  tags: ['filter', 'lens', 'grain'],
  inputs: ['image', 'time'],
  params: {
    barrel: f(0.12, -0.5, 0.5, 'Radial k1 barrel / pincushion distortion.', 'Optics'),
    aberration: f(0.002, 0, 0.025, 'Radial red/blue channel separation.', 'Optics'),
    vignette: f(0.3, 0, 1, 'Smooth radial attenuation.', 'Film'),
    grain: f(0.025, 0, 0.2, 'Seeded zero-mean linear film grain amplitude.', 'Film'),
  },
  presets: {
    clean: { barrel: 0, aberration: 0, vignette: 0, grain: 0 },
    vintage: { barrel: 0.15, aberration: 0.004, vignette: 0.55, grain: 0.05 },
  },
  chunks: [hash],
  wgsl:
    straight +
    `
fn effect(uv:vec2f)->vec4f {let q=uv-.5;let warped=.5+q*(1.0+params.barrel*dot(q,q)*4.0);let centre=sample_image(warped);let red=straight(sample_image(warped+q*params.aberration));let blue=straight(sample_image(warped-q*params.aberration));var c=vec3f(red.r,straight(centre).g,blue.b);c*=1.0-params.vignette*smoothstep(.1,.7,length(q));let n=hash_2d(floor(uv*frame.resolution),frame.seed+frame.index)-.5;c=max(c+n*params.grain,vec3f(0));return premul(c,centre.a);}`,
});
