import { fragmentEffect, noise } from '@mk7s/hologpu-core';

export default fragmentEffect({
  id: 'topographic-lines',
  budget: { expectedMs: 0.8, referenceSize: [640, 400] },
  title: 'Quiet topographic contours',
  core: true,
  tags: ['background', 'contours', 'noise', 'derivatives'],
  params: {
    base: {
      type: 'color',
      default: '#111b21',
      css: true,
      group: 'Palette',
      description: 'Flat background colour between contours.',
    },
    tint: {
      type: 'color',
      default: '#a8c4bd',
      css: true,
      group: 'Palette',
      description: 'Contour line colour.',
    },
    intensity: {
      type: 'f32',
      default: 0.15,
      min: 0,
      max: 1,
      step: 0.01,
      css: true,
      group: 'Field',
      description: 'Contour contrast against the base colour.',
    },
    spacing: {
      type: 'f32',
      default: 24,
      min: 12,
      max: 96,
      step: 1,
      unit: 'px',
      group: 'Field',
      description:
        'Height interval in CSS pixels; terrain slopes keep adjacent lines at least this far apart.',
    },
    weight: {
      type: 'f32',
      default: 1,
      min: 0.5,
      max: 3,
      step: 0.1,
      unit: 'px',
      css: true,
      group: 'Field',
      description: 'Contour stroke width in CSS pixels.',
    },
    scale: {
      type: 'f32',
      default: 360,
      min: 160,
      max: 720,
      step: 10,
      unit: 'px',
      group: 'Field',
      description: 'Base terrain wavelength in CSS pixels.',
    },
    speed: {
      type: 'f32',
      default: 0.012,
      min: 0,
      max: 0.1,
      step: 0.002,
      group: 'Motion',
      description: 'Slow terrain translation in noise units per second.',
    },
  },
  presets: {
    atlas: { base: '#111b21', tint: '#a8c4bd', intensity: 0.15, spacing: 24, weight: 1 },
    paper: { base: '#f5f3ef', tint: '#74786d', intensity: 0.18, spacing: 24, weight: 1 },
    sparse: { intensity: 0.12, spacing: 40, weight: 0.8, scale: 480 },
  },
  fallback: 'linear-gradient(#111b21, #111b21)',
  reducedMotion: { time: 0 },
  quality: { resolutionScale: [0.5, 1] },
  poster: new URL('./poster.png', import.meta.url).href,
  inputs: ['time'],
  chunks: [noise],
  wgsl: /* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
  let cssSize=frame.resolution/max(frame.dpr,0.001);
  let p=uv*cssSize/params.scale+vec2f(3.1,7.7)+frame.time*params.speed*vec2f(0.6,1.0);
  // Value-noise fBm has a bounded slope; 0.2 keeps the CSS-height slope below one.
  let height=fbm(p,frame.seed,0u,2u)*params.scale*0.2;
  let level=height/max(params.spacing,12.0);
  let gradient=length(vec2f(dpdx(level),dpdy(level)));
  let distance=abs(fract(level+0.5)-0.5);
  let cssGradient=max(gradient*frame.dpr,0.000001);
  let halfWidth=0.5*params.weight*cssGradient;
  let aa=max(0.5*fwidth(level),0.000001);
  // Integrate both stroke edges over the pixel footprint, including subpixel strokes.
  let line=clamp((halfWidth+aa-distance)/(2.0*aa),0.0,1.0)
    -clamp((-halfWidth+aa-distance)/(2.0*aa),0.0,1.0);
  return mix(params.base,params.tint,line*params.intensity);
}`,
});
