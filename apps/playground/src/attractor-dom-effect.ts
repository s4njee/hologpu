import {
  basicParticleEffect,
  randomInit,
  renderParams,
} from '../../../packages/effects/src/_particles/basic.ts';
import type { ParamSchema } from '@mk7s/hologpu';

export const rectLimit = 16;
const rectangles: ParamSchema = Object.fromEntries(
  ['pull', 'push'].flatMap((kind) =>
    Array.from({ length: rectLimit }, (_, i) => [
      `${kind}${i}`,
      { type: 'vec4', default: [0, 0, 0, 0] },
    ]),
  ),
);

// Demo-local dynamics, sharing the catalogue's fixed-step storage and HDR renderer.
export default basicParticleEffect(
  {
    id: 'dom-attractors',
    title: 'DOM particle attractors',
    family: 'particles',
    params: {
      ...renderParams,
      ...rectangles,
      count: { ...renderParams.count, default: 24576 },
      size: { ...renderParams.size, default: 1.3 },
      trail: { ...renderParams.trail, default: 0.96 },
      tint: { ...renderParams.tint, default: '#1677ff' },
      background: { ...renderParams.background, default: '#080f14' },
      strength: { type: 'f32', default: 1, min: 0, max: 2 },
      polarity: { type: 'f32', default: 1, min: -1, max: 1 },
      pullCount: { type: 'u32', default: 0 },
      pushCount: { type: 'u32', default: 0 },
    },
    inputs: [],
    features: [],
    presets: {},
    reducedMotion: { time: 0 },
    fallback: 'radial-gradient(ellipse at 70% 40%, #164f50, #080f14)',
  },
  {
    initialize: `${randomInit}p.velocity.w=p.position.w*18.0;`,
    extra: `
// Signed distance and outward normal of a rectangle in height-normalized page space.
fn boundary(q:vec2f, box:vec4f, aspect:f32)->vec3f {
  let center=(box.xy+box.zw)*.5*vec2f(aspect,1);
  let halfSize=(box.zw-box.xy)*.5*vec2f(aspect,1);
  let local=q-center;
  let d=abs(local)-halfSize;
  let outside=max(d,vec2f(0));
  let distance=length(outside)+min(max(d.x,d.y),0.0);
  var normal=vec2f(select(-1.0,1.0,local.x>=0),0);
  if(d.y>d.x){normal=vec2f(0,select(-1.0,1.0,local.y>=0));}
  if(length(outside)>.00001){normal=normalize(outside*sign(local));}
  return vec3f(normal,distance);
}
fn influence(q:vec2f, box:vec4f, aspect:f32, polarity:f32)->vec2f {
  let edge=boundary(q,box,aspect);
  let n=edge.xy;
  if(polarity<0){return n*1.8*exp(-max(edge.z,0.0)*13.0);}
  // Attraction settles just outside the element; a tangent keeps particles circulating.
  let weight=exp(-max(edge.z,0.0)*5.0);
  return (-n*clamp((edge.z-.028)*5.0,-1.5,1.0)+vec2f(-n.y,n.x)*.48)*weight;
}`,
    step: `
let aspect=frame.resolution.x/frame.resolution.y;
var q=(p.position.xy*vec2f(.5,-.5)+.5)*vec2f(aspect,1);
let t=frame.time*.13;
var force=vec2f(sin(q.y*9+t)+cos(q.x*5-q.y*3-t),cos(q.x*8-t)-sin(q.y*6+q.x*2+t))*.09;
let pulls=array<vec4f,${rectLimit}>(${Array.from({ length: rectLimit }, (_, i) => `params.pull${i}`).join(',')});
let pushes=array<vec4f,${rectLimit}>(${Array.from({ length: rectLimit }, (_, i) => `params.push${i}`).join(',')});
for(var i=0u;i<min(params.pullCount,${rectLimit}u);i++){force+=params.strength*influence(q,pulls[i],aspect,params.polarity);}
for(var i=0u;i<min(params.pushCount,${rectLimit}u);i++){force+=params.strength*influence(q,pushes[i],aspect,-params.polarity);}
var velocity=(p.velocity.xy+force*frame.delta)*exp(-1.6*frame.delta);
velocity*=min(1.0,.5/max(length(velocity),.0001));
q+=velocity*frame.delta;
q=fract(q/vec2f(aspect,1)+1)*vec2f(aspect,1);
p.position=vec4f(q/vec2f(aspect,1)*vec2f(2,-2)+vec2f(-1,1),0,p.position.w);
p.velocity=vec4f(velocity,0,p.velocity.w+frame.delta);
// A slow reseeding cycle keeps the whole background populated instead of draining it.
if(p.velocity.w>18){let h=hash_u32(id.x+frame.seed*65537u+u32(frame.time)*7919u);p.position=vec4f(random(h)*2-1,random(hash_u32(h+1u))*2-1,0,p.position.w);p.velocity=vec4f(0);}
`,
  },
);
