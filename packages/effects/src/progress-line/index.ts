import { defineEffect, fragmentEffect } from '@mk7s/hologpu-core';
import { f, u } from '../_filters/common.ts';

const points = [
  [0.05, 0.8],
  [0.35, 0.8],
  [0.35, 0.2],
  [0.65, 0.2],
  [0.65, 0.8],
  [0.95, 0.8],
  [0.95, 0.5],
  [0.95, 0.2],
] as const;
const pointParam = (index: number) => ({
  type: 'vec2' as const,
  default: points[index]!,
  min: 0,
  max: 1,
  description: `Normalized path point ${index}.`,
  group: 'Path',
});

/** Native SVG geometry in CSS pixels; use pathLength="1" and round stroke caps. */
export function progressLinePath(
  width: number,
  height: number,
  params: Readonly<Record<string, unknown>> = {},
): string {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '';
  const authoredCount = Number(params.pointCount ?? 6);
  const count = Math.max(
    2,
    Math.min(8, Number.isFinite(authoredCount) ? Math.floor(authoredCount) : 6),
  );
  const path = points.slice(0, count).map((fallback, index) => {
    const point = params[`p${index}`];
    const value = Array.isArray(point) ? point : fallback;
    const coordinate = (axis: number) => {
      const number = Number(value[axis]);
      return Math.max(0, Math.min(1, Number.isFinite(number) ? number : fallback[axis]!));
    };
    return [coordinate(0) * width, coordinate(1) * height];
  });
  if (path.every((point) => point[0] === path[0]![0] && point[1] === path[0]![1])) return '';
  return path.map(([x, y], index) => `${index ? 'L' : 'M'}${x} ${y}`).join(' ');
}

const definition = fragmentEffect({
  id: 'progress-line',
  budget: { expectedMs: 0.3, referenceSize: [640, 400] },
  title: 'Polyline progress rule',
  core: true,
  family: 'dom',
  tags: ['progress', 'polyline', 'divider', 'css', 'scroll'],
  inputs: ['css'],
  features: [],
  params: {
    pointCount: u(6, 2, 8, 'Number of authored points, connected in order.', 'Path'),
    p0: pointParam(0),
    p1: pointParam(1),
    p2: pointParam(2),
    p3: pointParam(3),
    p4: pointParam(4),
    p5: pointParam(5),
    p6: pointParam(6),
    p7: pointParam(7),
    progress: {
      ...f(1, 0, 1, 'Fraction of actual CSS-pixel path length revealed.', 'Progress'),
      css: true,
    },
    tint: {
      type: 'color',
      default: '#91b6ee',
      css: true,
      description: 'Stroke and head tint.',
      group: 'Palette',
    },
    intensity: { ...f(0.25, 0, 1, 'Stroke and bounded head opacity.', 'Style'), css: true },
    width: {
      ...f(1.5, 0.25, 8, 'Stroke thickness in CSS pixels.', 'Style'),
      unit: 'px',
      css: true,
    },
    headGlow: {
      ...f(6, 0, 24, 'Bounded head glow radius in CSS pixels; zero disables it.', 'Style'),
      unit: 'px',
      css: true,
    },
  },
  presets: {
    steps: { progress: 1 },
    rule: { pointCount: 2, p0: [0.05, 0.5], p1: [0.95, 0.5], headGlow: 4 },
    drawing: { progress: 0.5 },
  },
  quality: { resolutionScale: [1, 1] },
  reducedMotion: { time: 0 },
  fallback: 'transparent',
  poster: new URL('./poster.png', import.meta.url).href,
  wgsl: /* wgsl */ `
fn effect(uv:vec2f)->vec4f {
  let progress=clamp(params.progress,0.0,1.0);
  if(progress<=0.0) {return vec4f(0);}
  let size=frame.resolution/max(frame.dpr,0.001);
  // These vertices come directly from the parameter uniform buffer.
  var points=array<vec2f,8>(params.p0,params.p1,params.p2,params.p3,params.p4,params.p5,params.p6,params.p7);
  let count=clamp(params.pointCount,2u,8u);
  var total=0.0;
  for(var i=1u;i<count;i++) {total+=length((points[i]-points[i-1u])*size);}
  if(total<=0.00001) {return vec4f(0);}
  let revealed=total*progress;
  let pixel=uv*size;
  var traveled=0.0;
  var squared=1e20;
  var head=points[0]*size;
  for(var i=1u;i<count;i++) {
    let a=points[i-1u]*size;
    let vector=(points[i]-points[i-1u])*size;
    let segment=length(vector);
    if(segment>0.00001 && traveled<revealed) {
      let fraction=clamp((revealed-traveled)/segment,0.0,1.0);
      let b=a+vector*fraction;
      let visible=b-a;
      let projection=clamp(dot(pixel-a,visible)/max(dot(visible,visible),0.0000001),0.0,1.0);
      let offset=pixel-(a+visible*projection);
      squared=min(squared,dot(offset,offset));
      head=b;
    }
    traveled+=segment;
  }
  let aa=0.5/max(frame.dpr,0.001);
  let stroke=1.0-smoothstep(max(0.0,params.width*0.5-aa),params.width*0.5+aa,sqrt(squared));
  var glow=0.0;
  if(progress<1.0 && params.headGlow>0.0) {
    let distance=length(pixel-head);
    let radius=params.headGlow;
    glow=0.2*exp(-2.0*distance*distance/(radius*radius))*(1.0-smoothstep(radius*0.8,radius,distance));
    glow*=4.0*progress*(1.0-progress);
  }
  let alpha=clamp(stroke+glow,0.0,1.0)*params.intensity*params.tint.a;
  return vec4f(params.tint.rgb,alpha);
}`,
});

export default defineEffect({
  ...definition,
  async create(ctx) {
    const instance = await definition.create(ctx);
    return { ...instance, shouldRender: () => false };
  },
});
