import { feedbackEffect } from '@mk7s/hologpu-core';
import { createFluidProgram } from '../_fluid/index.ts';
import { solverParams, smokeParams } from '../_fluid/params.ts';
const params = {
  ...solverParams,
  source: { ...solverParams.source, default: 1.2 },
  vorticity: { ...solverParams.vorticity, default: 1.4 },
  dissipation: { ...solverParams.dissipation, default: 0.22 },
  initialAmount: { ...solverParams.initialAmount, default: 2 },
  dyeA: { ...solverParams.dyeA, default: '#c4d4df' },
  dyeB: { ...solverParams.dyeB, default: '#edb49c' },
  background: { ...solverParams.background, default: '#111b29' },
  ...smokeParams,
} as const;
export default feedbackEffect({
  id: 'smoke',
  title: 'Buoyant smoke and self-shadow',
  family: 'fluids',
  core: true,
  tags: ['compute', 'stable-fluids', 'buoyancy', 'temperature', 'self-shadow'],
  params,
  presets: {
    plume: { buoyancy: 1.2, heat: 1.8, cooling: 0.25, vorticity: 2, source: 1.3, extinction: 4 },
    mist: {
      buoyancy: 0.25,
      heat: 0.4,
      cooling: 0.5,
      vorticity: 0.35,
      source: 0.6,
      extinction: 1.6,
      dyeA: '#afc6cf',
      dyeB: '#c7d9d9',
    },
  },
  inputs: ['time', 'seed', 'resolution', 'pointer', 'velocity', 'buttons', 'pressure'],
  features: [],
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback: 'radial-gradient(ellipse at 50% 75%,#afc6cf,#4b5d6a 30%,#111b29 70%)',
  setup: (ctx) => createFluidProgram(ctx, 'smoke', params),
});
