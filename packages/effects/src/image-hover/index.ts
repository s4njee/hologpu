import {
  filterEffect,
  createFilterPass,
  filterGroup,
  defaultFilterInput,
} from '@mk7s/hologpu-core';
import { f, e, progress } from '../_dom/common.ts';
const code = `@group(0) @binding(3) var imageB:texture_2d<f32>;
fn effect(uv:vec2f)->vec4f {let t=clamp(params.progress,0.0,1.0);let envelope=sin(t*3.14159265);let q=uv-.5;var distortion=vec2f(sin(uv.y*params.frequency),cos(uv.x*params.frequency))*params.amount*envelope;if(params.mode==1u){let r=length(q);distortion=q/max(r,.0001)*sin(r*params.frequency)*params.amount*envelope;}let a=sample_image(uv+distortion);let b=sample_bilinear(imageB,uv-distortion);var blend=t;if(params.mode==2u){blend=1.0-smoothstep(t*(1.0+params.feather)-params.feather,t*(1.0+params.feather),uv.x);}return mix(a,b,blend);}`;
export default filterEffect({
  id: 'image-hover',
  title: 'Image hover and scroll transition',
  family: 'dom',
  core: true,
  tags: ['dom', 'image', 'hover', 'css', 'transition'],
  inputs: ['image', 'imageB', 'css'],
  params: {
    progress: { ...progress, default: 0 },
    amount: f(
      0.055,
      0,
      0.3,
      'UV distortion amplitude, strongest halfway through the transition.',
      'Distortion',
    ),
    frequency: f(22, 1, 100, 'Distortion spatial angular frequency.', 'Distortion'),
    feather: f(
      0.12,
      0.001,
      0.5,
      'Wipe feather width in normalized image coordinates.',
      'Transition',
    ),
    mode: e(
      'wave',
      ['wave', 'ripple', 'wipe'],
      'Wave, radial ripple or feathered wipe transition.',
      'Transition',
    ),
  },
  presets: {
    ripple: { mode: 'ripple', progress: 0.5, amount: 0.085, frequency: 35 },
    wipe: { mode: 'wipe', progress: 0.55, amount: 0.02, feather: 0.2 },
  },
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback: 'linear-gradient(135deg,#213450,#edac76)',
  async setup({ ctx, input }) {
    const second = defaultFilterInput(ctx.device);
    const data = new Float32Array(64 * 64 * 4);
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++)
        data.set([0.7 - y / 90, 0.15 + x / 100, 0.12, 1], (y * 64 + x) * 4);
    ctx.device.queue.writeTexture(
      { texture: second.texture },
      data,
      { bytesPerRow: 64 * 16 },
      [64, 64],
    );
    try {
      const pass = await createFilterPass(ctx, code, 'image-hover', [
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
          const b = ctx.inputs?.get('imageB') ?? second;
          pass.draw(encoder, target, [
            filterGroup(ctx, pass, input(), [
              {
                binding: 3,
                resource: b.texture.createView({ baseMipLevel: b.mipLevel ?? 0, mipLevelCount: 1 }),
              },
            ]),
          ]);
        },
        dispose() {
          pass.dispose();
          second.texture.destroy();
        },
        sources: { fragment: pass.source },
        diagnostics: pass.diagnostics,
        textureTaps() {
          return { secondImage: second };
        },
        memory() {
          return { textureBytes: 64 * 64 * 16, bufferBytes: 0 };
        },
      };
    } catch (error) {
      second.texture.destroy();
      throw error;
    }
  },
});
