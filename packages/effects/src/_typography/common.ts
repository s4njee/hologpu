import { createFilterPass, filterGroup } from '@mk7s/hologpu-core';
import type {
  EffectContext,
  EffectMemory,
  FullscreenPass,
  ParamSchema,
  TextureTap,
  WGSLChunk,
} from '@mk7s/hologpu-core';

/** Default coverage fixture for standalone catalogue/poster renders; DOM attachments bind real text. */
export function defaultTextMask(device: GPUDevice): TextureTap {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const painter = canvas.getContext('2d', { willReadFrequently: true })!;
  painter.font = 'bold 150px sans-serif';
  painter.textAlign = 'center';
  painter.textBaseline = 'middle';
  painter.fillStyle = 'white';
  painter.fillText('GPU', 256, 136);
  const pixels = painter.getImageData(0, 0, 512, 256).data;
  for (let i = 0; i < pixels.length; i += 4)
    pixels[i] = pixels[i + 1] = pixels[i + 2] = pixels[i + 3]!;
  const texture = device.createTexture({
    label: 'typography-default-text-mask',
    size: [512, 256],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
  });
  // Only alpha is sampled; RGBA matches the runtime's normalized DOM-text textures.
  device.queue.writeTexture({ texture }, pixels, { bytesPerRow: 512 * 4 }, [512, 256]);
  return {
    texture,
    width: 512,
    height: 256,
    format: 'rgba8unorm',
    kind: 'float',
    label: 'default-text-mask',
  };
}
export interface TextPass {
  readonly pass: FullscreenPass;
  draw(encoder: GPUCommandEncoder, target: GPUTextureView): void;
  dispose(): void;
  memory(): EffectMemory;
  textureTaps(): Readonly<Record<string, TextureTap>>;
}
/** One baseline fragment pass consuming text alpha, with a small owned fixture fallback. */
export async function createTextPass<S extends ParamSchema>(
  ctx: EffectContext<S>,
  code: string,
  label: string,
  chunks: readonly WGSLChunk[] = [],
): Promise<TextPass> {
  const fallback = defaultTextMask(ctx.device);
  try {
    const pass = await createFilterPass(ctx, code, label, [], chunks);
    let input = fallback,
      group = filterGroup(ctx, pass, input),
      disposed = false;
    return {
      pass,
      draw(encoder, target) {
        const current = ctx.inputs?.get('text') ?? fallback;
        if (
          current.texture !== input.texture ||
          current.mipLevel !== input.mipLevel ||
          current.arrayLayer !== input.arrayLayer
        ) {
          group = filterGroup(ctx, pass, current);
        }
        input = current;
        pass.draw(encoder, target, [group]);
      },
      dispose() {
        if (!disposed) {
          disposed = true;
          pass.dispose();
          fallback.texture.destroy();
        }
      },
      memory() {
        return { textureBytes: disposed ? 0 : 512 * 256 * 4, bufferBytes: 0 };
      },
      textureTaps(): Readonly<Record<string, TextureTap>> {
        return disposed ? {} : { textMask: input };
      },
    };
  } catch (error) {
    fallback.texture.destroy();
    throw error;
  }
}
