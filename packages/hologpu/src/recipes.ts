import { chain, defineEffect, filterEffect, hash, type ParamSpec } from '@mk7s/hologpu-core';
import colorGrade from '@mk7s/hologpu-effects/color-grade';
import grainOverlay from '@mk7s/hologpu-effects/grain-overlay';

// The catalogue grain is a transparent T1 overlay. This T4 adapter keeps the
// graded image beneath it, so the two-stage recipe emits the complete picture.
const videoGrain = filterEffect({
  id: 'hero-video-grain',
  title: 'Graded video with quiet grain',
  params: {
    ...grainOverlay.params,
    rate: {
      ...grainOverlay.params.rate,
      description: 'Grain pattern changes per second; video decoding keeps its own cadence.',
    },
  },
  inputs: ['image', 'time'],
  chunks: [hash],
  presets: grainOverlay.presets,
  quality: { resolutionScale: [0.5, 1] },
  reducedMotion: { time: 0 },
  fallback: 'transparent',
  imageFallback: true,
  wgsl: /* wgsl */ `
fn effect(uv:vec2f)->vec4f {
  let image=sample_image(uv);
  let time=select(frame.time,0.0,frame.reducedMotion>.5);
  let tick=u32(floor(time*params.rate+0.000001));
  let n=hash_2d(floor(uv*frame.resolution),frame.seed+tick*1013u);
  let luma=clamp(dot(image.rgb/max(image.a,0.00001),vec3f(.2126,.7152,.0722)),0.0,1.0);
  let response=mix(1.0,.35+.65*luma,params.luminanceWeight);
  let grain=mix(params.shadow,params.tint,n);
  let mean=mix(params.shadow.rgb,params.tint.rgb,.5);
  let modulation=(grain.rgb-mean)*2.0*params.intensity*response*grain.a;
  return vec4f(max(image.rgb*(1.0+modulation),vec3f(0)),image.a);
}`,
});
const graded = chain(colorGrade, videoGrain);
const quiet = {
  s0_toneMap: 'linear',
  s0_look: 'identity',
  s0_lutAmount: 0,
  s0_exposure: -0.05,
  s1_intensity: 0.035,
  s1_rate: 18,
} as const;
/** Use muted, looping, authored video at no more than 1280×720, with a native fallback. */
export const heroVideoGrade = defineEffect({
  ...graded,
  params: Object.fromEntries(
    Object.entries(graded.params).map(([name, spec]) => [
      name,
      { ...spec, default: quiet[name as keyof typeof quiet] ?? spec.default } as ParamSpec,
    ]),
  ),
  presets: {
    neutral: quiet,
    warm: { ...quiet, s0_look: 'warm', s0_lutAmount: 0.2, s0_gain: [1.02, 1, 0.98] },
  },
  imageFallback: true,
  fallback: 'transparent',
});
