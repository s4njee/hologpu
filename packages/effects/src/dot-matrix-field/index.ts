import { fragmentEffect, noise, sdf } from '@mk7s/hologpu-core';

export default fragmentEffect({
  id: 'dot-matrix-field',
  budget: { expectedMs: 0.5, referenceSize: [640, 400] },
  title: 'Quiet CSS-pixel dot matrix',
  tags: ['background', 'launch-page', 'dots', 'pointer'],
  inputs: ['time', 'pointer'],
  params: {
    pitch: {
      type: 'f32',
      default: 24,
      min: 12,
      max: 96,
      step: 1,
      unit: 'px',
      group: 'Geometry',
      description: 'Distance between dot centres in CSS pixels.',
    },
    radius: {
      type: 'f32',
      default: 1.15,
      min: 0.5,
      max: 6,
      step: 0.05,
      unit: 'px',
      group: 'Geometry',
      description: 'Resting dot radius in CSS pixels.',
    },
    tint: {
      type: 'color',
      default: '#8092ad',
      css: true,
      group: 'Palette',
      description: 'Dot colour; alpha also scales dot opacity.',
    },
    intensity: {
      type: 'f32',
      default: 0.2,
      min: 0,
      max: 1,
      step: 0.01,
      css: true,
      group: 'Appearance',
      description: 'Dot opacity before gentle breathing and pointer response.',
    },
    pointerRadius: {
      type: 'f32',
      default: 160,
      min: 24,
      max: 600,
      step: 1,
      unit: 'px',
      group: 'Interaction',
      description: 'Pointer influence radius in CSS pixels.',
    },
    pointerStrength: {
      type: 'f32',
      default: 0.3,
      min: 0,
      max: 0.5,
      step: 0.01,
      group: 'Interaction',
      description: 'Maximum fractional radius and opacity boost; halved with reduced motion.',
    },
    breathing: {
      type: 'f32',
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
      group: 'Motion',
      description: 'Slow noise modulation, bounded to ±15%; disabled with reduced motion.',
    },
    speed: {
      type: 'f32',
      default: 0.06,
      min: 0,
      max: 0.2,
      step: 0.01,
      group: 'Motion',
      description: 'Slow travel through the seeded noise field.',
    },
  },
  presets: {
    technical: { tint: '#8092ad', intensity: 0.2, pitch: 24, radius: 1.15 },
    paper: { tint: '#5b6474', intensity: 0.16, pitch: 28, radius: 0.85 },
    ember: { tint: '#df946b', intensity: 0.22, pitch: 26, radius: 1.1 },
  },
  quality: { resolutionScale: [0.5, 1] },
  reducedMotion: { time: 0 },
  poster: new URL('./poster.png', import.meta.url).href,
  fallback:
    'radial-gradient(circle at 12px 12px, rgb(128 146 173 / 20%) 0 1.15px, transparent 1.65px) 0 0 / 24px 24px repeat',
  chunks: [noise, sdf],
  wgsl: /* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
  let dpr=max(frame.dpr,0.0001);
  let cssSize=frame.resolution/dpr;
  let p=uv*cssSize;
  let cell=floor(p/params.pitch);
  let centre=(cell+0.5)*params.pitch;
  let local=(fract(p/params.pitch)-0.5)*params.pitch;
  let proximity=1.0-smoothstep(0.0,params.pointerRadius,distance(centre,frame.pointer*cssSize));
  let pointerBoost=proximity*params.pointerStrength*mix(1.0,0.5,frame.reducedMotion);
  let n=value_noise(cell*0.19+frame.time*params.speed*vec2f(0.6,1.0),frame.seed);
  let breathe=1.0+(n*2.0-1.0)*0.15*params.breathing*(1.0-frame.reducedMotion);
  let radius=min(params.radius*breathe*(1.0+pointerBoost),params.pitch*0.45);
  let aa=0.5/dpr;
  let coverage=1.0-smoothstep(-aa,aa,sd_circle(local,radius));
  let alpha=clamp(coverage*params.intensity*breathe*(1.0+pointerBoost)*params.tint.a,0.0,1.0);
  return vec4f(params.tint.rgb,alpha);
}`,
});
