import type { ParamSchema } from '@mk7s/hologpu-core';
import { f } from './common.ts';

/** CSS border-box geometry, expressed relative to an optionally padded effect canvas. */
export const cardGeometryParams = {
  rect: {
    type: 'vec4',
    default: [0.12, 0.18, 0.76, 0.64],
    min: 0,
    max: 1,
    step: 0.01,
    description: 'Local normalized border box: left, top, width, height.',
    group: 'Geometry',
  },
  radius: f(24, 0, 200, 'Legacy rounded corner radius in CSS pixels.', 'Geometry'),
  radiiX: {
    type: 'vec4',
    default: [-1, -1, -1, -1],
    min: -1,
    max: 4096,
    step: 0.1,
    description:
      'Horizontal CSS corner radii: top-left, top-right, bottom-right, bottom-left; -1 retains radius.',
    group: 'Geometry',
  },
  radiiY: {
    type: 'vec4',
    default: [-1, -1, -1, -1],
    min: -1,
    max: 4096,
    step: 0.1,
    description:
      'Vertical CSS corner radii: top-left, top-right, bottom-right, bottom-left; -1 retains radius.',
    group: 'Geometry',
  },
} as const satisfies ParamSchema;

/** Baseline WGSL, all arguments in CSS pixels. Ellipse distance is accurate near the rim. */
export const cardDistance = `
fn card_ellipse_distance(q:vec2f,r:vec2f)->f32 {
  let n=q/r;let k=length(n);
  let gradient=length(n/r)/max(k,0.00001);
  return (k-1.0)/max(gradient,0.00001);
}
fn card_distance(p:vec2f,halfSize:vec2f,legacyRadius:f32,radiiX:vec4f,radiiY:vec4f)->f32 {
  let h=max(halfSize,vec2f(0.0001));
  if(any(radiiX<vec4f(0))||any(radiiY<vec4f(0))){
    let r=clamp(legacyRadius,0.0,min(h.x,h.y));let q=abs(p)-h+vec2f(r);
    return length(max(q,vec2f(0)))+min(max(q.x,q.y),0.0)-r;
  }
  var rx=max(radiiX,vec4f(0));var ry=max(radiiY,vec4f(0));
  let factor=min(1.0,min(min(2.0*h.x/max(rx.x+rx.y,0.0001),2.0*h.x/max(rx.w+rx.z,0.0001)),min(2.0*h.y/max(ry.x+ry.w,0.0001),2.0*h.y/max(ry.y+ry.z,0.0001))));
  rx*=factor;ry*=factor;
  let box=abs(p)-h;
  var d=length(max(box,vec2f(0)))+min(max(box.x,box.y),0.0);
  // Separate corner regions also cover legal CSS radii larger than half an edge.
  if(rx.x>0.0&&ry.x>0.0&&p.x< -h.x+rx.x&&p.y< -h.y+ry.x){d=max(d,card_ellipse_distance(p-vec2f(-h.x+rx.x,-h.y+ry.x),vec2f(rx.x,ry.x)));}
  if(rx.y>0.0&&ry.y>0.0&&p.x> h.x-rx.y&&p.y< -h.y+ry.y){d=max(d,card_ellipse_distance(p-vec2f(h.x-rx.y,-h.y+ry.y),vec2f(rx.y,ry.y)));}
  if(rx.z>0.0&&ry.z>0.0&&p.x> h.x-rx.z&&p.y> h.y-ry.z){d=max(d,card_ellipse_distance(p-vec2f(h.x-rx.z,h.y-ry.z),vec2f(rx.z,ry.z)));}
  if(rx.w>0.0&&ry.w>0.0&&p.x< -h.x+rx.w&&p.y> h.y-ry.w){d=max(d,card_ellipse_distance(p-vec2f(-h.x+rx.w,h.y-ry.w),vec2f(rx.w,ry.w)));}
  return d;
}`;
