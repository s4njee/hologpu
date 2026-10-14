import { defineEffect, fragmentEffect, hash } from '@mk7s/hologpu-core';
import { f } from '../_filters/common.ts';

const definition = fragmentEffect({
  id: 'constellation',
  budget: { expectedMs: 0.8, referenceSize: [640, 400] },
  title: 'Quiet linked constellation',
  family: 'procedural',
  core: true,
  tags: ['ambient', 'particles', 'background', 'launch-page', 'network'],
  inputs: ['time', 'css'],
  features: [],
  params: {
    pitch: {
      ...f(88, 32, 200, 'Spacing of the seeded point lattice in CSS pixels.', 'Geometry'),
      unit: 'px',
      step: 1,
    },
    radius: {
      ...f(1.5, 0.5, 5, 'Point radius in CSS pixels.', 'Geometry'),
      unit: 'px',
    },
    width: {
      ...f(0.7, 0.25, 3, 'Connection stroke width in CSS pixels.', 'Geometry'),
      unit: 'px',
    },
    jitter: f(
      0.6,
      0,
      1,
      'Seeded point displacement, up to a quarter of the lattice pitch.',
      'Geometry',
    ),
    linkDistance: f(
      1.5,
      0.5,
      2.5,
      'Maximum neighbour distance, measured in lattice pitches.',
      'Geometry',
    ),
    tint: {
      type: 'color',
      default: '#a4b4d2',
      css: true,
      group: 'Palette',
      description: 'Point and connection colour; alpha scales the whole field.',
    },
    intensity: {
      ...f(0.22, 0, 1, 'Maximum point opacity; connections stay fainter.', 'Appearance'),
      css: true,
    },
    lineOpacity: f(0.28, 0, 1, 'Connection opacity relative to the points.', 'Appearance'),
    drift: f(0.08, 0, 0.1, 'Slow bounded point drift, measured in lattice pitches.', 'Motion'),
    twinkle: f(0.15, 0, 0.5, 'Gentle point dimming; zero keeps point brightness steady.', 'Motion'),
    speed: f(
      0.04,
      0,
      0.2,
      'Slow drift and twinkle angular speed; zero settles the field.',
      'Motion',
    ),
  },
  presets: {
    quiet: { tint: '#a4b4d2', intensity: 0.22, pitch: 88, lineOpacity: 0.28 },
    ember: { tint: '#e5a076', intensity: 0.24, pitch: 96, lineOpacity: 0.25 },
    paper: { tint: '#56657a', intensity: 0.18, pitch: 104, radius: 1.25, lineOpacity: 0.22 },
  },
  quality: { resolutionScale: [0.5, 1] },
  reducedMotion: { time: 0 },
  poster: new URL('./poster.png', import.meta.url).href,
  fallback: 'transparent',
  chunks: [hash],
  wgsl: /* wgsl */ `
fn constellation_point(cell:vec2f,time:f32)->vec3f {
  let random=hash_pair(cell,frame.seed);
  let phase=random.x*6.2831853;
  let drift=vec2f(sin(time+phase),cos(time*0.73+random.y*6.2831853))*params.drift;
  let point=(cell+0.5+(random-0.5)*params.jitter*0.5+drift)*params.pitch;
  let brightness=1.0-params.twinkle*(0.5+0.5*sin(time*0.6+phase));
  return vec3f(point,brightness);
}
fn constellation_link(pixel:vec2f,a:vec3f,b:vec3f,aa:f32)->f32 {
  let vector=b.xy-a.xy;
  let squared=dot(vector,vector);
  let separation=sqrt(squared)/params.pitch;
  let fade=1.0-smoothstep(params.linkDistance*0.8,params.linkDistance,separation);
  let projection=clamp(dot(pixel-a.xy,vector)/max(squared,0.00001),0.0,1.0);
  let distance=length(pixel-a.xy-vector*projection);
  let coverage=1.0-smoothstep(max(0.0,params.width*0.5-aa),params.width*0.5+aa,distance);
  return coverage*fade*min(a.z,b.z);
}
fn effect(uv:vec2f)->vec4f {
  if(params.intensity<=0.0 || params.tint.a<=0.0) {return vec4f(0);}
  let pixel=uv*frame.resolution/max(frame.dpr,0.001);
  let cell=floor(pixel/params.pitch);
  let aa=0.5/max(frame.dpr,0.001);
  let time=select(frame.time*params.speed,0.0,frame.reducedMotion>0.5);
  var points:array<vec3f,9>;
  var dots=0.0;
  for(var y=0u;y<3u;y++) {
    for(var x=0u;x<3u;x++) {
      let index=y*3u+x;
      let point=constellation_point(cell+vec2f(f32(x)-1.0,f32(y)-1.0),time);
      points[index]=point;
      let distance=length(pixel-point.xy);
      let coverage=1.0-smoothstep(max(0.0,params.radius-aa),params.radius+aa,distance);
      dots=max(dots,coverage*point.z);
    }
  }
  var lines=0.0;
  // The centre's eight neighbours, plus the four diagonal links that can cross
  // this cell without having an endpoint inside it. No neighbour is omitted at
  // a cell boundary, and every global point still connects to at most eight.
  for(var i=0u;i<9u;i++) {
    if(i!=4u) {lines=max(lines,constellation_link(pixel,points[4],points[i],aa));}
  }
  lines=max(lines,constellation_link(pixel,points[1],points[3],aa));
  lines=max(lines,constellation_link(pixel,points[1],points[5],aa));
  lines=max(lines,constellation_link(pixel,points[3],points[7],aa));
  lines=max(lines,constellation_link(pixel,points[5],points[7],aa));
  let alpha=max(dots,lines*params.lineOpacity)*params.intensity*params.tint.a;
  return vec4f(params.tint.rgb,alpha);
}`,
});

export default defineEffect({
  ...definition,
  defaultResolutionScale: 0.5,
  async create(ctx) {
    const instance = await definition.create(ctx);
    return {
      ...instance,
      shouldRender: (frame) =>
        !frame.reducedMotion &&
        ctx.params.values.intensity > 0 &&
        ctx.params.values.speed > 0 &&
        (ctx.params.values.drift > 0 || ctx.params.values.twinkle > 0),
    };
  },
});
