import { defineEffect } from '@mk7s/hologpu-core';
import { lightingParams } from '../_lighting/params.ts';
import { createLighting } from '../_lighting/program.ts';
export default defineEffect({
  id: 'radiance-cascades',
  title: '2D radiance cascades',
  family: 'lighting',
  tier: 'T4',
  core: true,
  tags: ['radiance', 'global-illumination', 'hierarchy', 'distance'],
  features: [],
  inputs: ['image', 'text-mask', 'rects'],
  params: {
    ...lightingParams,
    scene: { ...lightingParams.scene, default: 'blocks' },
    view: {
      type: 'enum',
      default: 'light',
      options: ['light', 'radiance', 'distance'],
      group: 'Display',
      description: 'Tone-mapped diffuse light, integrated radiance, or signed-distance diagnostic.',
    },
    levels: {
      type: 'u32',
      default: 4,
      min: 1,
      max: 4,
      step: 1,
      group: 'Cascades',
      description:
        'Hierarchy depth; each level halves spatial probes and quadruples angular rays and interval length.',
    },
    interval: {
      type: 'f32',
      default: 4,
      min: 1,
      max: 8,
      step: 0.5,
      unit: 'px',
      group: 'Cascades',
      description: 'First distance interval length; farther disjoint intervals grow by four.',
    },
    bounces: {
      type: 'u32',
      default: 2,
      min: 1,
      max: 3,
      step: 1,
      group: 'Cascades',
      description:
        'Deterministic radiance sweeps; later sweeps add diffuse wall response from the preceding irradiance field.',
    },
    albedo: {
      type: 'f32',
      default: 0.65,
      min: 0,
      max: 0.9,
      step: 0.01,
      group: 'Material',
      description: 'Diffuse wall reflectance applied once per additional sweep.',
    },
    environment: {
      type: 'color',
      default: '#080c16',
      group: 'Light',
      description: 'Linear boundary/environment radiance.',
    },
    exposure: {
      type: 'f32',
      default: 1.5,
      min: 0.1,
      max: 6,
      step: 0.1,
      group: 'Display',
      description: 'Exposure before bounded Reinhard presentation.',
    },
  },
  presets: {
    low: { levels: 3, bounces: 1, grid: 128, exposure: 2 },
    bounce: { levels: 4, bounces: 3, albedo: 0.85, grid: 256 },
  },
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback:
    'radial-gradient(at 20% 25%,#efb77b,transparent),radial-gradient(at 80% 30%,#668bde,#101829)',
  create: (ctx) => createLighting(ctx, 'cascades'),
});
