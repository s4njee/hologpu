import { defineEffect, fragmentEffect, colour, hash } from '@mk7s/hologpu-core';
import { f } from '../_filters/common.ts';
import { createTextPass } from '../_typography/common.ts';
const code = /* wgsl */ `
fn shimmer_lch(a:vec3f,b:vec3f,t:f32)->vec3f {
  var first=oklab_to_oklch(linear_to_oklab(a));
  var second=oklab_to_oklch(linear_to_oklab(b));
  if(first.y<0.0001) {first.z=second.z;}
  if(second.y<0.0001) {second.z=first.z;}
  let hue=atan2(sin(second.z-first.z),cos(second.z-first.z));
  return clamp(oklab_to_linear(oklch_to_oklab(vec3f(mix(first.xy,second.xy,t),first.z+hue*t))),vec3f(0),vec3f(1));
}
fn effect(uv:vec2f)->vec4f {
  var progress=params.progress;
  if(progress<0.0) {progress=clamp(frame.time/params.duration,0.0,1.0);}
  let frozen=frame.reducedMotion>0.5;
  if(!frozen && (progress<=0.0 || progress>=1.0)) {return vec4f(0);}
  let coverage=sample_image(uv).a;
  if(coverage<=0.0) {return vec4f(0);}
  let center=mix(-params.width*3.0,1.0+params.width*3.0,progress);
  var coordinate=clamp(0.5+(uv.x-center)/(params.width*2.0),0.0,1.0);
  let distance=(uv.x-center)/params.width;
  var envelope=exp(-0.5*distance*distance)*smoothstep(0.0,0.08,progress)*(1.0-smoothstep(0.92,1.0,progress));
  if(frozen) {coordinate=uv.x;envelope=1.0;}
  var rgb=shimmer_lch(params.first.rgb,params.second.rgb,clamp(coordinate*2.0,0.0,1.0));
  var opacity=mix(params.first.a,params.second.a,clamp(coordinate*2.0,0.0,1.0));
  if(coordinate>0.5) {rgb=shimmer_lch(params.second.rgb,params.third.rgb,coordinate*2.0-1.0);opacity=mix(params.second.a,params.third.a,coordinate*2.0-1.0);}
  let pixel=vec2u(uv*frame.resolution);
  rgb=srgb_to_linear(clamp(linear_to_srgb(rgb)+vec3f((random(pixel.x+pixel.y*65537u+frame.seed)-0.5)/255.0),vec3f(0),vec3f(1)));
  let alpha=coverage*envelope*params.intensity*opacity;
  return vec4f(rgb*alpha,alpha);
}`;
const definition = fragmentEffect({
  id: 'text-shimmer',
  budget: { expectedMs: 0.3, referenceSize: [640, 400] },
  title: 'Masked OKLCH headline shimmer',
  family: 'dom',
  tags: ['text', 'mask', 'gradient', 'oklch', 'css', 'typography'],
  inputs: ['text', 'css', 'time'],
  features: [],
  params: {
    progress: {
      ...f(
        -1,
        -1,
        1,
        'Use -1 for one automatic sweep; explicit CSS progress 0…1 owns the position.',
        'Motion',
      ),
      css: true,
    },
    duration: {
      ...f(
        1.2,
        0.1,
        10,
        'Automatic sweep duration; use 1 for normalized timeline progress.',
        'Motion',
      ),
      unit: 's',
    },
    width: f(
      0.16,
      0.025,
      0.5,
      'Gaussian highlight width in normalized heading coordinates.',
      'Light',
    ),
    intensity: {
      ...f(
        0.25,
        0,
        1,
        'Peak highlight opacity; reduced motion uses the same static gradient opacity.',
        'Light',
      ),
      css: true,
    },
    first: {
      type: 'color',
      default: '#d5c1f0',
      css: true,
      group: 'Palette',
      description: 'First OKLCH gradient stop.',
    },
    second: {
      type: 'color',
      default: '#fff0dc',
      css: true,
      group: 'Palette',
      description: 'Middle OKLCH gradient stop.',
    },
    third: {
      type: 'color',
      default: '#a9dbe9',
      css: true,
      group: 'Palette',
      description: 'Final OKLCH gradient stop.',
    },
  },
  presets: {
    pearl: { first: '#d5c1f0', second: '#fff0dc', third: '#a9dbe9' },
    ember: { first: '#bfa5d6', second: '#ffdfa8', third: '#efb1a3' },
    timeline: { progress: -1, duration: 1 },
  },
  quality: { resolutionScale: [1, 1] },
  reducedMotion: { time: 1.2 },
  fallback: 'transparent',
  poster: new URL('./poster.png', import.meta.url).href,
  textFallback: { kind: 'gradient', colors: ['first', 'second', 'third'] },
  chunks: [colour, hash],
  wgsl: code,
});
export default defineEffect({
  ...definition,
  async create(ctx) {
    const text = await createTextPass(ctx, code, 'hgpu-text-shimmer', [colour, hash]);
    let lastProgress: number | undefined;
    const progressAt = (time: number) =>
      Math.max(
        0,
        Math.min(
          1,
          ctx.params.values.progress < 0
            ? time / ctx.params.values.duration
            : ctx.params.values.progress,
        ),
      );
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
