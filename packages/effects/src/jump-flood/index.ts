import { defineEffect } from '@mk7s/hologpu-core';
import { lightingParams } from '../_lighting/params.ts';
import { createLighting } from '../_lighting/program.ts';
export default defineEffect({
  id: 'jump-flood',
  title: 'Jump-flood distance fields',
  family: 'lighting',
  tier: 'T2',
  core: true,
  tags: ['distance', 'mask', 'outline', 'voronoi'],
  features: [],
  inputs: ['image', 'text-mask'],
  params: {
    ...lightingParams,
    view: {
      type: 'enum',
      default: 'outline',
      options: ['outline', 'distance', 'voronoi'],
      group: 'Display',
      description:
        'Boundary outline/glow, signed pixel distance, or nearest-boundary Voronoi colouring.',
    },
    width: {
      type: 'f32',
      default: 1,
      min: 0,
      max: 16,
      step: 0.25,
      unit: 'px',
      group: 'Display',
      description: 'Outline half-width in mask-grid pixels.',
    },
    glow: {
      type: 'f32',
      default: 4,
      min: 0.1,
      max: 32,
      step: 0.1,
      unit: 'px',
      group: 'Display',
      description: 'Exponential glow falloff distance.',
    },
  },
  presets: {
    outline: { width: 0.75, glow: 2, tint: '#80dcd5' },
    voronoi: { view: 'voronoi', scene: 'blocks', grid: 256 },
  },
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback: 'radial-gradient(#efb77b,#101829)',
  create: (ctx) => createLighting(ctx, 'jump'),
});
