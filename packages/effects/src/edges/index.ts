import { filterEffect } from '@mk7s/hologpu-core';
import { f, u, e, straight } from '../_filters/common.ts';
export default filterEffect({
  id: 'edges',
  title: 'Sobel / toon / Kuwahara',
  core: true,
  tags: ['filter', 'edges', 'neighbourhood', 'painterly'],
  params: {
    mode: e(
      'toon',
      ['sobel', 'toon', 'kuwahara', 'anisotropic-kuwahara'],
      'Sobel magnitude, quantized toon, minimum-variance quadrants or edge-oriented elongated quadrants.',
    ),
    strength: f(2, 0, 8, 'Sobel magnitude gain.', 'Edges'),
    levels: u(5, 2, 16, 'Toon per-channel quantization levels.', 'Toon'),
    radius: u(3, 1, 4, 'Kuwahara quadrant radius in texels.', 'Painterly'),
  },
  presets: {
    comic: { mode: 'toon', strength: 2.5, levels: 4 },
    paint: { mode: 'anisotropic-kuwahara', radius: 4 },
  },
  wgsl:
    straight +
    `
fn effect(uv:vec2f)->vec4f {let texel=1.0/vec2f(textureDimensions(image));let source=sample_image(uv);var gx=0.0;var gy=0.0;for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){let l=luminance(straight(sample_image(uv+vec2f(f32(x),f32(y))*texel)));let wx=f32(x)*select(1.0,2.0,y==0);let wy=f32(y)*select(1.0,2.0,x==0);gx+=l*wx;gy+=l*wy;}}let edge=clamp(length(vec2f(gx,gy))*params.strength,0.0,1.0);if(params.mode==0u){return premul(vec3f(edge),source.a);}if(params.mode==1u){let levels=f32(params.levels-1u);let c=floor(clamp(straight(source),vec3f(0),vec3f(1))*levels+.5)/levels;return premul(c*(1.0-edge),source.a);}var best=straight(source);var minVariance=1e10;let radius=i32(params.radius);var angle=1.5707963;if(gx*gx+gy*gy>1e-12){angle=atan2(gy,gx)+1.5707963;}let tangent=vec2f(cos(angle),sin(angle));let normal=vec2f(-tangent.y,tangent.x);for(var quadrant=0;quadrant<4;quadrant++){var mean=vec3f(0);var square=vec3f(0);var count=0.0;let signX=select(-1.0,1.0,(quadrant&1)!=0);let signY=select(-1.0,1.0,(quadrant&2)!=0);for(var y=0;y<=4;y++){for(var x=0;x<=4;x++){if(x<=radius&&y<=radius){var q=vec2f(f32(x)*signX,f32(y)*signY);if(params.mode==3u){q=tangent*q.x*1.5+normal*q.y*.65;}let c=straight(sample_image(uv+q*texel));mean+=c;square+=c*c;count+=1.0;}}}mean/=count;let variance=dot(max(square/count-mean*mean,vec3f(0)),vec3f(1));if(variance<minVariance){minVariance=variance;best=mean;}}return premul(best,source.a);}`,
});
