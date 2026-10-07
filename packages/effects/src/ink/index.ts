import { feedbackEffect } from '@mk7s/hologpu-core';
import { createFluidProgram } from '../_fluid/index.ts';
import { solverParams, inkParams } from '../_fluid/params.ts';
const params = {
  ...solverParams,
  viscosity: { ...solverParams.viscosity, default: 0.25 },
  drag: { ...solverParams.drag, default: 0.6 },
  vorticity: { ...solverParams.vorticity, default: 0.2 },
  source: { ...solverParams.source, default: 0.25 },
  dissipation: { ...solverParams.dissipation, default: 0 },
  dyeA: { ...solverParams.dyeA, default: '#24445a' },
  dyeB: { ...solverParams.dyeB, default: '#6c3a42' },
  background: { ...solverParams.background, default: '#f1eadb' },
  ...inkParams,
} as const;
export default feedbackEffect({
  id: 'ink',
  title: 'Pigment deposition on paper',
  family: 'fluids',
  core: true,
  tags: ['compute', 'stable-fluids', 'pigment', 'paper', 'absorption'],
  params,
  presets: {
    sumi: {
      dyeA: '#182025',
      dyeB: '#324247',
      absorption: 1.6,
      grain: 0.75,
      source: 0.18,
      viscosity: 0.4,
      opticalDensity: 2.4,
    },
    watercolor: {
      dyeA: '#226ead',
      dyeB: '#bb4653',
      absorption: 0.35,
      evaporation: 0.15,
      grain: 0.4,
      source: 0.45,
      drag: 0.25,
      opticalDensity: 1.5,
    },
  },
  inputs: ['time', 'seed', 'resolution', 'pointer', 'velocity', 'buttons', 'pressure'],
  features: [],
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback:
    'radial-gradient(ellipse at 35% 50%,#536777,transparent 45%),radial-gradient(ellipse at 60% 55%,#957c7c,#f1eadb 65%)',
  setup: (ctx) => createFluidProgram(ctx, 'ink', params),
});
