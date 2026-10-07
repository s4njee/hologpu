import { filterEffect } from '@mk7s/hologpu-core';
import { f, e, straight } from '../_filters/common.ts';
const code =
  straight +
  `

fn map_vector(uv:vec2f)->vec2f {let m=sample_mapSource(uv);if(params.encoding==0u){return m.rg/max(m.a,.00001)*2.0-1.0;}return m.rg;}
fn effect(uv:vec2f)->vec4f {var direction=map_vector(uv);let q=uv-frame.pointer;let distance=length(q);if(params.mode==1u){direction+=vec2f(sin(uv.y*params.frequency+frame.time*params.speed),cos(uv.x*params.frequency-frame.time*params.speed))*.35;}if(params.mode==2u){direction+=q/max(distance,.0001)*sin(distance*params.frequency-frame.time*params.speed)*exp(-distance*params.decay);}if(params.mode==3u){let texel=1.0/vec2f(textureDimensions(param_mapSource));let dx=sample_bilinear(param_mapSource,uv+vec2f(texel.x,0)).b-sample_bilinear(param_mapSource,uv-vec2f(texel.x,0)).b;let dy=sample_bilinear(param_mapSource,uv+vec2f(0,texel.y)).b-sample_bilinear(param_mapSource,uv-vec2f(0,texel.y)).b;direction+=vec2f(dx,dy)*params.glass;}return sample_image(uv+direction*params.amount);}`;
export default filterEffect({
  id: 'displace',
  title: 'Normal / flow refraction and ripple',
  core: true,
  tags: ['filter', 'displace', 'flow-map', 'refraction'],
  inputs: ['image', 'map', 'time', 'pointer'],
  params: {
    mapSource: {
      type: 'texture',
      default: 'map',
      description: 'Input binding name for the normal or flow map.',
      group: 'Map',
    },
    mode: e(
      'ripple',
      ['refraction', 'liquid', 'ripple', 'glass'],
      'Map refraction plus optional liquid, radial ripple or height-gradient glass.',
    ),
    encoding: e(
      'normal',
      ['normal', 'flow'],
      'Normal RG is decoded from 0–1; flow RG is signed physical velocity.',
    ),
    amount: f(0.035, 0, 0.2, 'Displacement amplitude in normalized image coordinates.'),
    frequency: f(25, 1, 80, 'Liquid/ripple angular spatial frequency.', 'Motion'),
    speed: f(2, 0, 10, 'Liquid/ripple angular speed in radians/s.', 'Motion'),
    decay: f(5, 0, 20, 'Radial ripple exponential falloff.', 'Motion'),
    glass: f(3, 0, 10, 'Height-channel gradient multiplier.', 'Glass'),
  },
  presets: {
    water: { mode: 'liquid', amount: 0.025, frequency: 20, speed: 1.2 },
    refracted: { mode: 'glass', amount: 0.06, glass: 5 },
  },
  wgsl: code,
});
