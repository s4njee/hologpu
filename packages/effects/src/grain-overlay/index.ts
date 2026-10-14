import { defineEffect, createFilterPass, filterGroup, hash } from '@mk7s/hologpu-core';
import type { TextureTap } from '@mk7s/hologpu-core';

const params = {
  intensity: {
    type: 'f32',
    default: 0.04,
    min: 0,
    max: 1,
    step: 0.01,
    css: true,
    group: 'Texture',
    description: 'Grain alpha; 0.03–0.06 is recommended over page backgrounds.',
  },
  rate: {
    type: 'f32',
    default: 18,
    min: 12,
    max: 24,
    step: 1,
    group: 'Motion',
    description:
      'Actual scheduled grain updates per second; explicit draws still render immediately.',
  },
  luminanceWeight: {
    type: 'f32',
    default: 0.25,
    min: 0,
    max: 1,
    step: 0.01,
    group: 'Texture',
    description:
      'Optional image luminance reduces grain in dark areas; no image gives uniform grain.',
  },
  tint: {
    type: 'color',
    default: '#ffffff',
    css: true,
    group: 'Palette',
    description: 'Light grain colour.',
  },
  shadow: {
    type: 'color',
    default: '#000000',
    css: true,
    group: 'Palette',
    description: 'Dark grain colour.',
  },
} as const;

export default defineEffect({
  id: 'grain-overlay',
  budget: { expectedMs: 0.3, referenceSize: [640, 400] },
  title: 'Quiet film grain',
  family: 'procedural',
  tier: 'T1',
  core: true,
  tags: ['launch-page', 'grain', 'transparent', 'rate-limited'],
  params,
  presets: {
    film: { intensity: 0.04, rate: 18 },
    paper: { intensity: 0.035, rate: 12, tint: '#f8eedb', shadow: '#514b42' },
  },
  inputs: ['time', 'image'],
  features: [],
  renderRate: 'rate',
  quality: { resolutionScale: [0.5, 1] },
  reducedMotion: { time: 0 },
  poster: new URL('./poster.png', import.meta.url).href,
  fallback: `url('${new URL('./noise-tile.png', import.meta.url).href}') repeat`,
  async create(ctx) {
    const texture = ctx.device.createTexture({
      label: 'grain-neutral-image',
      size: [1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    ctx.device.queue.writeTexture({ texture }, new Uint8Array([255, 255, 255, 255]), {}, [1, 1]);
    const neutral: TextureTap = {
      texture,
      width: 1,
      height: 1,
      format: 'rgba8unorm',
      kind: 'float',
    };
    try {
      const pass = await createFilterPass(
        ctx,
        /* wgsl */ `
fn effect(uv:vec2f)->vec4f {
  let tick=u32(floor(frame.time*params.rate+0.000001));
  let n=hash_2d(floor(uv*frame.resolution),frame.seed+tick*1013u);
  let imageColor=sample_image(uv);
  let luma=clamp(dot(imageColor.rgb/max(imageColor.a,0.00001),vec3f(0.2126,0.7152,0.0722)),0.0,1.0);
  let response=mix(1.0,0.35+0.65*luma,params.luminanceWeight);
  let c=mix(params.shadow,params.tint,n);
  let alpha=params.intensity*response*c.a;
  return vec4f(c.rgb*alpha,alpha);
}`,
        'hgpu-grain-overlay',
        [],
        [hash],
      );
      let previous: GPUTexture | undefined;
      let previousMip: number | undefined;
      let previousLayer: number | undefined;
      let group: GPUBindGroup | undefined;
      let disposed = false;
      return {
        resize() {},
        update() {},
        reset() {},
        render(_frame, encoder, target) {
          const input = ctx.inputs?.get('image') ?? neutral;
          if (
            previous !== input.texture ||
            previousMip !== input.mipLevel ||
            previousLayer !== input.arrayLayer
          ) {
            previous = input.texture;
            previousMip = input.mipLevel;
            previousLayer = input.arrayLayer;
            group = filterGroup(ctx, pass, input);
          }
          pass.draw(encoder, target, [group!]);
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          pass.dispose();
          texture.destroy();
        },
        memory: () => ({ textureBytes: disposed ? 0 : 4, bufferBytes: 0 }),
        sources: { fragment: pass.source },
        diagnostics: pass.diagnostics,
      };
    } catch (error) {
      texture.destroy();
      throw error;
    }
  },
});
