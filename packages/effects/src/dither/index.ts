import { filterEffect, createFilterPass, filterGroup } from '@mk7s/hologpu-core';
import { f, u, e, straight } from '../_filters/common.ts';
import { blueNoiseRanks } from '../_filters/blue-noise.ts';
const code =
  straight +
  `
@group(0) @binding(3) var noiseTexture:texture_2d<f32>;
const bayer=array<f32,16>(0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);
fn effect(uv:vec2f)->vec4f {let source=sample_image(uv);let p=vec2u(floor(uv*frame.resolution));var noise=(bayer[(p.y%4u)*4u+p.x%4u]+.5)/16.0-.5;if(params.mode==1u||params.mode==2u){noise=textureLoad(noiseTexture,vec2i(p%32u),0).r-.5;}let levels=f32(params.levels-1u);var c=clamp(straight(source)+noise*params.amount/levels,vec3f(0),vec3f(1));if(params.mode==2u){let palette=array<vec3f,4>(straight(sample_paletteGradient(vec2f(0,.5))),straight(sample_paletteGradient(vec2f(1.0/3.0,.5))),straight(sample_paletteGradient(vec2f(2.0/3.0,.5))),straight(sample_paletteGradient(vec2f(1,.5))));var best=palette[0];var distance=1e10;for(var i=0u;i<4u;i++){let d=dot(c-palette[i],c-palette[i]);if(d<distance){distance=d;best=palette[i];}}c=best;}else{c=floor(c*levels+.5)/levels;}if(params.mode==3u){let scan=1.0-params.scanline*(.5+.5*cos(uv.y*frame.resolution.y*3.14159265));let channel=p.x%3u;c*=scan*select(vec3f(.65),vec3f(1),vec3u(0,1,2)==vec3u(channel));}return premul(c,source.a);}`;
export default filterEffect({
  id: 'dither',
  title: 'Ordered / blue-noise / palette / CRT',
  core: true,
  tags: ['filter', 'quantisation', 'blue-noise', 'crt'],
  params: {
    mode: e(
      'blue-noise',
      ['bayer', 'blue-noise', 'palette', 'crt'],
      'Ordered 4×4 Bayer, void/cluster tile, nearest palette or scanline/mask CRT.',
    ),
    levels: u(6, 2, 32, 'Per-channel quantization levels.', 'Quantisation'),
    amount: f(1, 0, 2, 'Threshold dither amplitude.', 'Quantisation'),
    scanline: f(0.3, 0, 1, 'CRT horizontal scanline attenuation.', 'CRT'),
    paletteGradient: {
      type: 'gradient',
      default: [
        { offset: 0, color: '#16233a' },
        { offset: 1 / 3, color: '#7d647d' },
        { offset: 2 / 3, color: '#efcea1' },
        { offset: 1, color: '#619bb2' },
      ],
      description: 'Baked linear palette sampled at four evenly spaced positions.',
      group: 'Palette',
    },
  },
  presets: {
    print: { mode: 'palette', amount: 0.8 },
    display: { mode: 'crt', levels: 12, scanline: 0.4 },
  },
  async setup({ ctx, input }) {
    const texture = ctx.device.createTexture({
      label: 'void-cluster-blue-noise',
      size: [32, 32],
      format: 'r8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    });
    ctx.device.queue.writeTexture(
      { texture },
      blueNoiseRanks(),
      { bytesPerRow: 32 },
      { width: 32, height: 32 },
    );
    try {
      const pass = await createFilterPass(ctx, code, 'dither', [
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float' },
        },
      ]);
      return {
        resize() {},
        update() {},
        reset() {},
        render(_f, encoder, target) {
          pass.draw(encoder, target, [
            filterGroup(ctx, pass, input(), [{ binding: 3, resource: texture.createView() }]),
          ]);
        },
        dispose() {
          pass.dispose();
          texture.destroy();
        },
        sources: { fragment: pass.source },
        diagnostics: pass.diagnostics,
        textureTaps() {
          return {
            blueNoise: {
              texture,
              width: 32,
              height: 32,
              format: 'r8unorm',
              kind: 'float' as const,
            },
          };
        },
        memory() {
          return { textureBytes: 1024, bufferBytes: 0 };
        },
      };
    } catch (error) {
      texture.destroy();
      throw error;
    }
  },
});
