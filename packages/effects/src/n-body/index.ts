import { particleEffect } from '@mk7s/hologpu-core';
import { nbodyParams as params } from '../_neighbors/params.ts';
import { neighborProgram } from '../_neighbors/program.ts';
export default particleEffect({
  id: 'n-body',
  title: 'Tiled and grid-accelerated gravity',
  family: 'particles',
  core: true,
  tags: ['gravity', 'workgroup-tiling', 'spatial-hash'],
  params,
  inputs: [],
  presets: {
    galaxy: {
      count: 4096,
      method: 'grid',
      gravity: 0.04,
      speed: 0.13,
      softening: 0.035,
      tint: '#edbea2',
    },
    clusters: {
      count: 1024,
      method: 'tiled',
      gravity: 0.07,
      speed: 0.03,
      softening: 0.015,
      tint: '#a6bcec',
    },
  },
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback: 'radial-gradient(ellipse,#89dccb,#07101c)',
  setup: (ctx) => neighborProgram(ctx, 'n-body'),
});
