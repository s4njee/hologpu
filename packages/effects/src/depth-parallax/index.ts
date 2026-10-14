import { filterEffect, createFilterPass } from '@mk7s/hologpu-core';
import type { TextureTap } from '@mk7s/hologpu-core';
import { f, e } from '../_filters/common.ts';

const code = /* wgsl */ `
fn effect(uv:vec2f)->vec4f {
  let amount=clamp(params.amount,0.0,0.02)*clamp(params.intensity,0.0,1.0);
  if(frame.reducedMotion>.5||amount<=0.0){return sample_image(uv);}
  var direction=vec2f(0);
  if(params.mode!=1u){direction=(clamp(frame.pointer,vec2f(0),vec2f(1))-.5)*2.0;}
  if(params.mode!=0u){direction+=vec2f(0,(clamp(params.progress,0.0,1.0)-.5)*2.0);}
  direction/=max(length(direction),1.0);
  let depth=clamp(sample_depthSource(uv).r,0.0,1.0);
  let aspect=frame.resolution.x/max(frame.resolution.y,1.0);
  let offset=direction*vec2f(1,aspect)*amount*depth;
  if(dot(offset,offset)<1e-16){return sample_image(uv);}
  let warped=uv+offset;
  let texel=1.0/vec2f(textureDimensions(image));
  let clamped=clamp(warped,texel*.5,vec2f(1)-texel*.5);
  let centre=sample_image(clamped);
  // Upsampling can already clamp the original UV beyond source texel centres.
  // Only additional outward spill from displacement represents a disocclusion.
  let original=clamp(uv,texel*.5,vec2f(1)-texel*.5);
  let extraSpill=max(abs(warped-clamped)-abs(uv-original),vec2f(0))/texel;
  let spill=max(extraSpill.x,extraSpill.y);
  if(spill<=0.0||params.edgeBlur<=0.0){return centre;}
  // Only disoccluded boundary pixels use this small premultiplied cross blur.
  let stepUV=params.edgeBlur*frame.dpr/max(frame.resolution,vec2f(1));
  let filled=(centre*4.0+sample_image(clamped+vec2f(stepUV.x,0))
    +sample_image(clamped-vec2f(stepUV.x,0))+sample_image(clamped+vec2f(0,stepUV.y))
    +sample_image(clamped-vec2f(0,stepUV.y)))/8.0;
  return mix(centre,filled,clamp(spill,0.0,1.0));
}`;

export default filterEffect({
  id: 'depth-parallax',
  budget: { expectedMs: 0.7, referenceSize: [640, 400] },
  title: 'Subtle product image depth parallax',
  family: 'dom',
  core: true,
  tags: ['image', 'depth', 'parallax', 'pointer', 'progress', 'css'],
  inputs: ['image', 'depth', 'pointer', 'css'],
  features: [],
  params: {
    depthSource: {
      type: 'texture',
      default: 'depth',
      description:
        'Linear grayscale depth binding: white moves near content, black keeps far content fixed.',
      group: 'Source',
    },
    mode: e(
      'pointer',
      ['pointer', 'progress', 'combined'],
      'Pointer, vertical progress or their bounded combination.',
      'Motion',
    ),
    amount: {
      ...f(
        0.015,
        0,
        0.02,
        'Maximum displacement as a fraction of CSS image width, before intensity.',
        'Motion',
      ),
      step: 0.001,
      css: true,
    },
    intensity: {
      ...f(
        0.25,
        0,
        1,
        'Fraction of the bounded parallax displacement to apply; zero preserves the image.',
        'Motion',
      ),
      css: true,
    },
    progress: {
      ...f(
        0.5,
        0,
        1,
        'Vertical displacement position; 0.5 is neutral, used in progress and combined modes.',
        'Motion',
      ),
      css: true,
    },
    edgeBlur: {
      ...f(0.75, 0, 2, 'Small CSS-pixel blur of clamp-filled disoccluded edges only.', 'Edges'),
      unit: 'px',
    },
  },
  presets: {
    subtle: { mode: 'pointer', amount: 0.015, intensity: 0.25 },
    scroll: { mode: 'progress', amount: 0.012, intensity: 0.25, progress: 0.5 },
    layered: { mode: 'combined', amount: 0.018, intensity: 0.3, edgeBlur: 1 },
  },
  quality: { resolutionScale: [0.5, 1] },
  reducedMotion: { time: 0 },
  fallback: 'transparent',
  imageFallback: true,
  poster: new URL('./poster.png', import.meta.url).href,
  async setup({ ctx, input }) {
    const texture = ctx.device.createTexture({
      label: 'depth-parallax-neutral-depth',
      size: [1, 1],
      format: 'r8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    ctx.device.queue.writeTexture({ texture }, new Uint8Array([0]), { bytesPerRow: 1 }, [1, 1]);
    const neutral: TextureTap = {
      texture,
      width: 1,
      height: 1,
      format: 'r8unorm',
      kind: 'float',
      label: 'neutral-depth',
    };
    try {
      const pass = await createFilterPass(ctx, code, 'hgpu-depth-parallax');
      let image: TextureTap | undefined,
        depth: TextureTap | undefined,
        group: GPUBindGroup | undefined;
      const view = (tap: TextureTap) =>
        tap.texture.createView({
          baseMipLevel: tap.mipLevel ?? 0,
          mipLevelCount: 1,
          baseArrayLayer: tap.arrayLayer ?? 0,
          arrayLayerCount: 1,
          dimension: '2d',
        });
      const changed = (a: TextureTap | undefined, b: TextureTap) =>
        !a || a.texture !== b.texture || a.mipLevel !== b.mipLevel || a.arrayLayer !== b.arrayLayer;
      let disposed = false;
      return {
        resize() {},
        update() {},
        reset() {},
        shouldRender: () => false,
        render(_frame, encoder, target) {
          const nextImage = input(),
            nextDepth = ctx.inputs?.get('depthSource') ?? neutral;
          if (!group || changed(image, nextImage) || changed(depth, nextDepth))
            group = ctx.device.createBindGroup({
              label: 'depth-parallax-inputs',
              layout: pass.pipeline.getBindGroupLayout(0),
              entries: [
                { binding: 0, resource: { buffer: ctx.frameBuffer } },
                { binding: 1, resource: { buffer: ctx.paramsBuffer } },
                { binding: 2, resource: view(nextImage) },
                { binding: 16, resource: view(nextDepth) },
              ],
            });
          image = nextImage;
          depth = nextDepth;
          pass.draw(encoder, target, [group]);
        },
        dispose() {
          if (!disposed) {
            disposed = true;
            pass.dispose();
            texture.destroy();
          }
        },
        sources: { fragment: pass.source },
        diagnostics: pass.diagnostics,
        textureTaps(): Readonly<Record<string, TextureTap>> {
          return disposed ? {} : { depth: depth ?? neutral };
        },
        memory: () => ({ textureBytes: disposed ? 0 : 1, bufferBytes: 0 }),
      };
    } catch (error) {
      texture.destroy();
      throw error;
    }
  },
});
