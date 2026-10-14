import { defineEffect, fragmentEffect } from '@mk7s/hologpu-core';
import { e, f } from '../_filters/common.ts';

const definition = fragmentEffect({
  id: 'pointer-map',
  budget: { expectedMs: 0.5, referenceSize: [640, 400] },
  title: 'Gaussian pointer normal / flow map',
  core: true,
  family: 'procedural',
  tags: ['map', 'normal', 'flow', 'pointer', 'product', 'lcd'],
  inputs: ['pointer', 'css'],
  features: [],
  params: {
    center: {
      type: 'vec2',
      default: [-1, -1],
      min: -1,
      max: 1,
      description: 'Manual normalized lens centre; either negative component follows the pointer.',
      group: 'Lens',
    },
    encoding: e(
      'normal',
      ['normal', 'flow'],
      'Normal RG is encoded 0…1; flow RG is signed.',
      'Output',
    ),
    radius: f(
      0.09,
      0.01,
      0.5,
      'Gaussian standard deviation, normalized to the host height.',
      'Lens',
    ),
    intensity: {
      ...f(0.25, 0, 1, 'Vector and height strength; zero is exactly neutral.', 'Lens'),
      css: true,
    },
  },
  presets: {
    lens: { encoding: 'normal', radius: 0.09, intensity: 0.25 },
    flow: { encoding: 'flow', radius: 0.09, intensity: 0.25 },
    neutral: { intensity: 0 },
  },
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback: 'none',
  poster: new URL('./poster.png', import.meta.url).href,
  wgsl: /* wgsl */ `
fn effect(uv:vec2f)->vec4f {
  var center=params.center;
  if(any(center<vec2f(0))) {center=frame.pointer;}
  let aspect=frame.resolution.x/max(frame.resolution.y,1.0);
  let q=(uv-center)*vec2f(aspect,1.0);
  let radius=max(params.radius,0.00001);
  let lens=exp(-0.5*dot(q,q)/(radius*radius));
  let strength=select(params.intensity,0.0,frame.reducedMotion>0.5);
  let slope=q/radius*lens*strength;
  let height=0.5+0.5*lens*strength;
  let vector=select(vec2f(0.5)+slope*0.5,slope,params.encoding==1u);
  return vec4f(vector,height,1.0);
}`,
});

export default defineEffect({
  ...definition,
  async create(ctx) {
    const instance = await definition.create(ctx);
    return {
      ...instance,
      shouldRender() {
        return false;
      },
    };
  },
});
