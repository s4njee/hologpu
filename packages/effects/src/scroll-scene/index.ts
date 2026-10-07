import { fragmentEffect } from '@mk7s/hologpu-core';
import { f, color, progress, roundedRect } from '../_dom/common.ts';
export default fragmentEffect({
  id: 'scroll-scene',
  title: 'CSS scroll timeline scene',
  family: 'dom',
  core: true,
  tags: ['dom', 'scroll', 'css', 'timeline'],
  inputs: ['css', 'scroll'],
  params: {
    progress: { ...progress, default: 0 },
    depth: f(1, 0.1, 4, 'Parallax depth multiplier.', 'Scene'),
    turns: f(1, 0, 4, 'Rotation turns across the scroll range.', 'Scene'),
    radius: f(0.13, 0.02, 0.4, 'Rounded panel corner radius in normalized height.', 'Scene'),
    first: color('#e5aa8c', 'Foreground panel colour.'),
    second: color('#8aadeb', 'Background panel colour.'),
    background: color('#0e1d30', 'Scene background colour.'),
  },
  presets: {
    orbit: { turns: 2, depth: 1.4, first: '#a6dbc1', second: '#c6aaef' },
    stack: { turns: 0, depth: 2.2, radius: 0.04 },
  },
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback: 'linear-gradient(135deg,#0e1d30,#8aadeb)',
  wgsl:
    roundedRect +
    `fn effect(uv:vec2f)->vec4f {let t=clamp(params.progress,0.0,1.0);let aspect=frame.resolution.x/frame.resolution.y;let p=(uv-.5)*vec2f(aspect,1);var rgb=params.background.rgb;for(var i=0;i<5;i++){let z=f32(4-i)/4.0;let angle=t*params.turns*6.2831853*(.25+z*.35);let shift=vec2f(sin(t*6.2831853+z*2.0),cos(t*6.2831853+z*2.0))*.2*params.depth*z;let q=p-shift;let rotated=vec2f(cos(angle)*q.x-sin(angle)*q.y,sin(angle)*q.x+cos(angle)*q.y);let halfsize=vec2f(.2,.14)*(1.0+z*.55);let d=rounded_rect(rotated,halfsize,min(params.radius,min(halfsize.x,halfsize.y)));let aa=max(fwidth(d),.001);let coverage=1.0-smoothstep(-aa,aa,d);let c=mix(params.first.rgb,params.second.rgb,z)*(.5+.5*(1.0-z));rgb=mix(rgb,c,coverage);}return vec4f(rgb,1);}`,
});
