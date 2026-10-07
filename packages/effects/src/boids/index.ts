import { particleEffect } from '@mk7s/hologpu-core';
import { boidsParams as params } from '../_neighbors/params.ts';
import { neighborProgram } from '../_neighbors/program.ts';
export default particleEffect({
  id: 'boids',
  title: 'Boids with sorted spatial neighbors',
  family: 'particles',
  core: true,
  tags: ['flocking', 'spatial-hash', 'prefix-sum', 'radix-sort'],
  params,
  inputs: ['pointer'],
  presets: {
    murmuration: {
      radius: 0.08,
      separation: 0.09,
      alignment: 4,
      cohesion: 2,
      maxSpeed: 0.3,
      tint: '#ecb8a0',
    },
    shoal: {
      radius: 0.045,
      separation: 0.28,
      alignment: 2.5,
      cohesion: 4,
      maxSpeed: 0.2,
      tint: '#96bfea',
    },
  },
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback: 'radial-gradient(ellipse,#89dccb,#07101c)',
  setup: (ctx) => neighborProgram(ctx, 'boids'),
});
