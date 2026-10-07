import { feedbackEffect } from '@mk7s/hologpu-core';
import { createFluidProgram } from '../_fluid/index.ts';
import { solverParams } from '../_fluid/params.ts';
export default feedbackEffect({
  id: 'fluid',
  title: 'Projected fluid and dye',
  family: 'fluids',
  core: true,
  tags: ['compute', 'stable-fluids', 'pressure', 'vorticity', 'staggered-grid'],
  params: solverParams,
  presets: {
    vortex: {
      viscosity: 0,
      drag: 0.06,
      vorticity: 1.5,
      source: 0.7,
      iterations: 24,
      dyeA: '#29b7ff',
      dyeB: '#ef438c',
    },
    laminar: {
      viscosity: 0.5,
      drag: 0.4,
      vorticity: 0,
      force: 0.15,
      source: 0.8,
      iterations: 32,
      dyeA: '#d5b06c',
      dyeB: '#508781',
    },
  },
  inputs: ['time', 'seed', 'resolution', 'pointer', 'velocity', 'buttons', 'pressure'],
  features: [],
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback:
    'radial-gradient(ellipse at 30% 45%,#35bacf,transparent 50%),radial-gradient(ellipse at 65% 60%,#ef795e,#101623 65%)',
  setup: (ctx) => createFluidProgram(ctx, 'fluid', solverParams),
});
