import { basicParticleEffect, renderParams, randomInit } from '../_particles/basic.ts';
const params = {
  ...renderParams,
  count: { ...renderParams.count, default: 1048576 },
  draw: { ...renderParams.draw, default: 'point' },
  speed: {
    type: 'f32',
    default: 0.14,
    min: 0,
    max: 0.8,
    step: 0.01,
    group: 'Flow',
    description: 'Curl velocity in normalized units per second.',
  },
  frequency: {
    type: 'f32',
    default: 2,
    min: 0.2,
    max: 8,
    step: 0.1,
    group: 'Flow',
    description: 'Spatial frequency of the simplex curl field.',
  },
  evolution: {
    type: 'f32',
    default: 0.08,
    min: 0,
    max: 0.5,
    step: 0.01,
    group: 'Flow',
    description: 'Translation of the noise field per second.',
  },
} as const;
export default basicParticleEffect(
  {
    id: 'flow-particles',
    title: 'Million curl-noise particles',
    family: 'particles',
    core: true,
    tags: ['compute', 'curl-noise', 'million-particles', 'trails'],
    params,
    inputs: [],
    features: [],
    presets: {
      silk: { frequency: 1.1, speed: 0.1, trail: 0.985, tint: '#cf91f0' },
      turbulence: { frequency: 5, speed: 0.3, trail: 0.88, tint: '#f3bd72' },
    },
    quality: { resolutionScale: [0.25, 1] },
    reducedMotion: { time: 0 },
    fallback: 'radial-gradient(ellipse,#72dcd3,#07111e)',
  },
  {
    initialize: randomInit,
    step: `let v=curl_noise(p.position.xy*params.frequency+vec2f(frame.time*params.evolution),frame.seed);p.velocity=vec4f(v,0,0);p.position=vec4f(fract((p.position.xy+v*params.speed*frame.delta+1)*.5)*2-1,p.position.zw);`,
  },
);
