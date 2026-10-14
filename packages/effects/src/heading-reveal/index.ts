import { defineEffect, fragmentEffect, hash } from '@mk7s/hologpu-core';
import { f } from '../_filters/common.ts';
import { createTextPass } from '../_typography/common.ts';
const code = /* wgsl */ `
fn effect(uv:vec2f)->vec4f {
  var progress=clamp(params.progress,0.0,1.0);
  if(params.progress<0.0) {progress=clamp(frame.time,0.0,1.0);}
  if(frame.reducedMotion>0.5) {progress=1.0;}
  if(progress>=1.0) {return vec4f(0);}
  let coverage=select(0.0,1.0,sample_image(uv).a>0.00001);
  if(coverage<=0.0) {return vec4f(0);}
  // Stable CSS-pixel noise erodes an opaque page-colour cover; real text remains below.
  let cell=vec2u(floor(uv*frame.resolution/max(frame.dpr,0.001)/params.scale));
  let grain=random(cell.x+cell.y*65537u+frame.seed);
  let threshold=clamp(uv.x+(grain-0.5)*params.intensity,0.0,1.0);
  var hidden=smoothstep(progress-params.feather,progress+params.feather,threshold);
  if(progress<=0.0) {hidden=1.0;}
  let alpha=coverage*hidden;
  return vec4f(params.page.rgb*alpha,alpha);
}`;
const definition = fragmentEffect({
  id: 'heading-reveal',
  budget: { expectedMs: 0.5, referenceSize: [640, 400] },
  title: 'Noise-eroded heading reveal',
  family: 'dom',
  tags: ['text', 'mask', 'noise', 'reveal', 'css', 'typography'],
  inputs: ['text', 'css', 'time'],
  features: [],
  params: {
    progress: {
      ...f(
        1,
        -1,
        1,
        'Reveal progress; 1 shows the real heading, -1 selects the normalized timeline clock.',
        'Motion',
      ),
      css: true,
    },
    page: {
      type: 'color',
      default: '#11121b',
      css: true,
      group: 'Palette',
      description:
        'Opaque flat page colour used to cover unrevealed glyphs; must match the DOM background.',
    },
    intensity: {
      ...f(0.25, 0, 1, 'Noise perturbation of the reveal boundary, not cover opacity.', 'Reveal'),
      css: true,
    },
    scale: { ...f(3, 1, 16, 'Noise cell pitch in CSS pixels.', 'Reveal'), unit: 'px' },
    feather: f(
      0.04,
      0.005,
      0.2,
      'Soft transition width in normalized heading coordinates.',
      'Reveal',
    ),
  },
  presets: {
    dark: { page: '#11121b', intensity: 0.25 },
    light: { page: '#f7f5f0', intensity: 0.15 },
    timeline: { progress: -1 },
  },
  quality: { resolutionScale: [1, 1] },
  reducedMotion: { time: 1 },
  fallback: 'transparent',
  poster: new URL('./poster.png', import.meta.url).href,
  textFallback: { kind: 'none' },
  chunks: [hash],
  wgsl: code,
});
export default defineEffect({
  ...definition,
  async create(ctx) {
    const text = await createTextPass(ctx, code, 'hgpu-heading-reveal', [hash]);
    let lastProgress: number | undefined;
    const progressAt = (time: number) =>
      Math.max(0, Math.min(1, ctx.params.values.progress < 0 ? time : ctx.params.values.progress));
    return {
      resize() {},
      update() {},
      reset() {
        lastProgress = undefined;
      },
      shouldRender(frame) {
        return lastProgress === undefined || lastProgress !== progressAt(frame.time);
      },
      render(frame, encoder, target) {
        text.draw(encoder, target);
        lastProgress = progressAt(frame.time);
      },
      dispose: text.dispose,
      sources: { fragment: text.pass.source },
      diagnostics: text.pass.diagnostics,
      memory: text.memory,
      textureTaps: text.textureTaps,
    };
  },
});
