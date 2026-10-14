import { defineEffect, fragmentEffect } from '@mk7s/hologpu-core';
import { f, color, roundedRect } from '../_dom/common.ts';
import { cardGeometryParams, cardDistance } from '../_dom/card-geometry.ts';
const borderEnergy = fragmentEffect({
  id: 'border-energy',
  budget: { expectedMs: 0.5, referenceSize: [640, 400] },
  title: 'Rounded rectangle border energy',
  family: 'dom',
  core: true,
  tags: ['dom', 'sdf', 'border', 'glow'],
  inputs: ['time', 'element-rect'],
  params: {
    ...cardGeometryParams,
    trace: {
      type: 'bool',
      default: false,
      description:
        'Hover trace whose entire stroke and glow fade with intensity; legacy rendering remains the default.',
      group: 'Light',
    },
    width: f(2, 0.5, 24, 'Border stroke width in CSS pixels.', 'Geometry'),
    glow: f(14, 1, 100, 'Exponential glow falloff distance in CSS pixels.', 'Light'),
    speed: f(0.4, 0, 4, 'Energy pulse revolutions per second.', 'Motion'),
    intensity: {
      ...f(
        1.5,
        0,
        5,
        'Legacy emission; in trace mode, opacity of the complete stroke and glow.',
        'Light',
      ),
      css: true,
    },
    tint: { ...color('#92dfe7', 'Linear border emission colour.'), css: true },
  },
  presets: {
    ember: { tint: '#ffad6b', glow: 28, speed: 0.25, width: 3 },
    orbit: { tint: '#b69ff0', radius: 70, speed: 1.1, width: 1 },
    'border-trace': {
      trace: true,
      intensity: 0,
      tint: '#d9e5f2',
      width: 1.5,
      glow: 8,
      speed: 0.25,
    },
  },
  presetPosters: { 'border-trace': new URL('./poster-border-trace.png', import.meta.url).href },
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback: 'linear-gradient(135deg,#92dfe7,#263448)',
  wgsl:
    roundedRect +
    cardDistance +
    `
fn border_energy_legacy(uv:vec2f)->vec4f {let origin=params.rect.xy*frame.resolution;let size=max(params.rect.zw*frame.resolution,vec2f(1));let p=uv*frame.resolution-origin-size*.5;let radius=min(params.radius*frame.dpr,min(size.x,size.y)*.5);let d=rounded_rect(p,size*.5,radius);let aa=max(fwidth(d),.5);let stroke=1.0-smoothstep(params.width*frame.dpr*.5-aa,params.width*frame.dpr*.5+aa,abs(d));let glow=exp(-abs(d)/max(params.glow*frame.dpr,.1));var theta=0.0;if(dot(p,p)>.000001){theta=atan2(p.y,p.x);}let pulse=pow(.5+.5*cos(theta-frame.time*params.speed*6.2831853),10.0);let emission=(stroke+glow*.25)*(.25+pulse*params.intensity);let alpha=clamp(stroke+glow*.3,0.0,1.0);return vec4f(params.tint.rgb*emission,alpha*params.tint.a);}
fn effect(uv:vec2f)->vec4f {
  let legacyRadii=any(params.radiiX<vec4f(0))||any(params.radiiY<vec4f(0));
  if(params.trace==0u&&legacyRadii){return border_energy_legacy(uv);}
  if(params.trace!=0u&&params.intensity<=0.0){return vec4f(0);}
  let cssSize=frame.resolution/max(frame.dpr,0.0001);
  let size=max(params.rect.zw*cssSize,vec2f(0.0001));
  let p=uv*cssSize-params.rect.xy*cssSize-size*.5;
  let d=card_distance(p,size*.5,params.radius,params.radiiX,params.radiiY);
  let aa=max(fwidth(d),.5/max(frame.dpr,0.0001));
  let stroke=1.0-smoothstep(params.width*.5-aa,params.width*.5+aa,abs(d));
  let halo=exp(-abs(d)/max(params.glow,.1));
  var theta=0.0;if(dot(p,p)>.000001){theta=atan2(p.y,p.x);}
  var time=frame.time;if(params.trace!=0u&&frame.reducedMotion>.5){time=0.0;}
  let pulse=pow(.5+.5*cos(theta-time*params.speed*6.2831853),10.0);
  if(params.trace==0u){
    let emission=(stroke+halo*.25)*(.25+pulse*params.intensity);
    return vec4f(params.tint.rgb*emission,clamp(stroke+halo*.3,0.0,1.0)*params.tint.a);
  }
  let alpha=clamp((stroke+halo*.22)*(.18+.82*pulse)*params.intensity*params.tint.a,0.0,1.0);
  return vec4f(params.tint.rgb,alpha);
}`,
});

export default defineEffect({
  ...borderEnergy,
  async create(ctx) {
    const instance = await borderEnergy.create(ctx);
    return {
      ...instance,
      shouldRender: () =>
        !ctx.params.values.trace ||
        (Number(ctx.params.values.intensity) > 0 && Number(ctx.params.values.speed) > 0),
    };
  },
});
