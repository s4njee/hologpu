import { fragmentEffect } from '@mk7s/hologpu-core';
import { f, color, roundedRect } from '../_dom/common.ts';
export default fragmentEffect({
  id: 'border-energy',
  title: 'Rounded rectangle border energy',
  family: 'dom',
  core: true,
  tags: ['dom', 'sdf', 'border', 'glow'],
  inputs: ['time', 'element-rect'],
  params: {
    rect: {
      type: 'vec4',
      default: [0.12, 0.18, 0.76, 0.64],
      min: 0,
      max: 1,
      step: 0.01,
      description: 'Local normalized rectangle: left, top, width, height.',
      group: 'Geometry',
    },
    radius: f(24, 0, 200, 'Rounded corner radius in CSS pixels.', 'Geometry'),
    width: f(2, 0.5, 24, 'Border stroke width in CSS pixels.', 'Geometry'),
    glow: f(14, 1, 100, 'Exponential glow falloff distance in CSS pixels.', 'Light'),
    speed: f(0.4, 0, 4, 'Energy pulse revolutions per second.', 'Motion'),
    intensity: f(1.5, 0, 5, 'Linear border emission multiplier.', 'Light'),
    tint: color('#92dfe7', 'Linear border emission colour.'),
  },
  presets: {
    ember: { tint: '#ffad6b', glow: 28, speed: 0.25, width: 3 },
    orbit: { tint: '#b69ff0', radius: 70, speed: 1.1, width: 1 },
  },
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback: 'linear-gradient(135deg,#92dfe7,#263448)',
  wgsl:
    roundedRect +
    `
fn effect(uv:vec2f)->vec4f {let origin=params.rect.xy*frame.resolution;let size=max(params.rect.zw*frame.resolution,vec2f(1));let p=uv*frame.resolution-origin-size*.5;let radius=min(params.radius*frame.dpr,min(size.x,size.y)*.5);let d=rounded_rect(p,size*.5,radius);let aa=max(fwidth(d),.5);let stroke=1.0-smoothstep(params.width*frame.dpr*.5-aa,params.width*frame.dpr*.5+aa,abs(d));let glow=exp(-abs(d)/max(params.glow*frame.dpr,.1));var theta=0.0;if(dot(p,p)>.000001){theta=atan2(p.y,p.x);}let pulse=pow(.5+.5*cos(theta-frame.time*params.speed*6.2831853),10.0);let emission=(stroke+glow*.25)*(.25+pulse*params.intensity);let alpha=clamp(stroke+glow*.3,0.0,1.0);return vec4f(params.tint.rgb*emission,alpha*params.tint.a);}`,
});
