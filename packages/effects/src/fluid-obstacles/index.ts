import { feedbackEffect } from '@mk7s/hologpu-core';
import { createFluidProgram } from '../_fluid/index.ts';
import { solverParams } from '../_fluid/params.ts';
const params = {
  ...solverParams,
  iterations: { ...solverParams.iterations, default: 32 },
  initialVelocity: { ...solverParams.initialVelocity, default: [0.18, 0] as const },
  source: { ...solverParams.source, default: 0.8 },
} as const;
export default feedbackEffect({
  id: 'fluid-obstacles',
  title: 'Fluid around DOM rectangles',
  family: 'fluids',
  core: true,
  tags: ['compute', 'stable-fluids', 'dom', 'pressure', 'obstacles', 'staggered-grid'],
  params,
  presets: {
    headings: {
      initial: 'uniform',
      initialVelocity: [0.25, 0],
      iterations: 48,
      dyeA: '#b39ce9',
      dyeB: '#e9b99a',
      source: 1,
    },
    eddies: {
      initial: 'vortices',
      vorticity: 1.8,
      iterations: 32,
      force: 0.6,
      dyeA: '#35bacf',
      dyeB: '#ef795e',
    },
  },
  inputs: ['time', 'seed', 'resolution', 'pointer', 'velocity', 'buttons', 'pressure', 'dom-rects'],
  features: [],
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback:
    'radial-gradient(ellipse at 30% 50%,#35bacf,transparent 50%),linear-gradient(120deg,#101623,#53416d)',
  setup: (ctx) => createFluidProgram(ctx, 'fluid', params, true),
});
