import { defineEffect, fragmentEffect } from '@mk7s/hologpu-core';
import { f, color } from '../_dom/common.ts';
const spotlight = fragmentEffect({
  id: 'spotlight',
  budget: { expectedMs: 0.4, referenceSize: [640, 400] },
  title: 'Shared page spotlight reveal',
  family: 'dom',
  core: true,
  tags: ['dom', 'pointer', 'multiple-surfaces', 'light'],
  inputs: ['page-pointer', 'element-rect'],
  params: {
    pageRect: {
      type: 'vec4',
      default: [0, 0, 512, 512],
      min: -100000,
      max: 100000,
      step: 1,
      description: 'Viewport rectangle in CSS pixels: left, top, width, height.',
      group: 'Geometry',
    },
    pagePointer: {
      type: 'vec2',
      default: [256, 256],
      min: -100000,
      max: 100000,
      step: 1,
      description: 'Shared viewport pointer in CSS pixels; identical for every surface.',
      group: 'DOM',
    },
    radius: f(180, 1, 1000, 'Spotlight radius in viewport CSS pixels.', 'Light'),
    softness: f(0.55, 0.01, 1, 'Fraction of radius occupied by the feathered outer edge.', 'Light'),
    intensity: { ...f(1.2, 0, 5, 'Linear reveal intensity.', 'Light'), css: true },
    card: {
      type: 'bool',
      default: false,
      description: 'Transparent quiet overlay for a whole card grid.',
      group: 'Light',
    },
    ambient: f(0.04, 0, 1, 'Linear intensity outside the spotlight.', 'Light'),
    tint: { ...color('#c4c1ff', 'Spotlight colour.'), css: true },
    background: color('#102133', 'Unlit surface colour.'),
  },
  presets: {
    warm: { tint: '#ffb67a', radius: 240, softness: 0.75 },
    sharp: { tint: '#b5f5ed', radius: 95, softness: 0.12 },
    'card-spotlight': {
      card: true,
      radius: 320,
      intensity: 0.15,
      tint: '#ffffff',
      ambient: 0,
      softness: 0.8,
    },
  },
  presetPosters: { 'card-spotlight': new URL('./poster-card-spotlight.png', import.meta.url).href },
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback: 'radial-gradient(circle,#c4c1ff,#102133)',
  wgsl: `fn effect(uv:vec2f)->vec4f {let page=params.pageRect.xy+uv*params.pageRect.zw;let d=distance(page,params.pagePointer);let light=1.0-smoothstep(params.radius*(1.0-params.softness),params.radius,d);if(params.card!=0u){return vec4f(params.tint.rgb,clamp((params.ambient+light*params.intensity)*params.tint.a,0.0,1.0));}let weave=.7+.3*cos(page.x*.065)*cos(page.y*.065);return vec4f(params.background.rgb+params.tint.rgb*(params.ambient+light*params.intensity)*weave,params.background.a);}`,
});

export default defineEffect({
  ...spotlight,
  async create(ctx) {
    const instance = await spotlight.create(ctx);
    return { ...instance, shouldRender: () => !ctx.params.values.card };
  },
});
