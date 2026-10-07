import { fragmentEffect, noise } from '@mk7s/hologpu-core';
export default fragmentEffect({
  id: 'noise-lab',
  title: 'Noise laboratory',
  core: true,
  tags: ['noise', 'fbm', 'domain-warp', 'curl'],
  params: {
    kind: {
      type: 'enum',
      default: 'simplex',
      options: ['value', 'gradient', 'simplex', 'worley', 'curl'],
      group: 'Algorithm',
      description: 'Underlying field; curl displays vector magnitude.',
    },
    scale: {
      type: 'f32',
      default: 5,
      min: 1,
      max: 32,
      step: 0.1,
      group: 'Field',
      description: 'Base spatial frequency.',
    },
    octaves: {
      type: 'u32',
      default: 4,
      min: 1,
      max: 8,
      step: 1,
      group: 'Algorithm',
      description: 'Normalized fractal noise octave count.',
    },
    warp: {
      type: 'f32',
      default: 1.5,
      min: 0,
      max: 5,
      step: 0.05,
      group: 'Field',
      description: 'Domain displacement from two seeded noise fields.',
    },
    speed: {
      type: 'f32',
      default: 0.15,
      min: 0,
      max: 1,
      step: 0.01,
      group: 'Motion',
      description: 'Time-driven translation through the field.',
    },
    low: {
      type: 'color',
      default: '#17183c',
      group: 'Palette',
      description: 'Low-value linear color.',
    },
    high: {
      type: 'color',
      default: '#e6b88d',
      group: 'Palette',
      description: 'High-value linear color.',
    },
  },
  presets: {
    smoke: { kind: 'simplex', scale: 5, octaves: 4, warp: 1.5 },
    cells: { kind: 'worley', scale: 12, octaves: 2, warp: 0.25, low: '#082d39', high: '#87ead6' },
  },
  inputs: ['time'],
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback: 'linear-gradient(145deg, #17183c, #e6b88d)',
  chunks: [noise],
  wgsl: /* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
  var p=aspect_uv(uv,frame.resolution)*params.scale+frame.time*params.speed;
  let displacement=vec2f(simplex_noise(p+vec2f(7,3),frame.seed),simplex_noise(p+vec2f(1,9),frame.seed+73u))-0.5;
  p+=displacement*params.warp;
  let value=fbm(p,frame.seed,params.kind,params.octaves);
  return mix(params.low,params.high,clamp(value,0.0,1.0));
}`,
});
