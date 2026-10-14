import {
  createFullscreenPass,
  compose,
  fullscreen,
  chunk,
  filterTarget,
} from '../../../packages/core/src/index.ts';
import type { EffectField } from '../../../packages/core/src/index.ts';
import { readTextureTap } from '../../../packages/core/src/texture-readback.ts';

/** Surfaces are sampleable but intentionally lack COPY_SRC; copy without SDR resolve. */
export async function readFieldLinear(field: EffectField) {
  const pass = await createFullscreenPass(
    field.session,
    compose(
      fullscreen,
      chunk(
        'test-linear-readback',
        `@group(0) @binding(0) var image:texture_2d<f32>;
        @fragment fn fragment(in:VertexOut)->@location(0) vec4f {
          return textureLoad(image,vec2i(in.uv*vec2f(textureDimensions(image))),0);
        }`,
      ),
    ),
    'rgba16float',
    'test-linear-readback',
    [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float' },
      },
    ],
  );
  const tap = field.output!;
  const target = filterTarget(
    field.session.device,
    [tap.width, tap.height],
    'test-readable-output',
  );
  try {
    const group = field.session.device.createBindGroup({
      layout: pass.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: tap.texture.createView() }],
    });
    pass.draw(field.session.encoder(), target.texture.createView(), [group]);
    field.session.submit();
    return await readTextureTap(field.session.device, target);
  } finally {
    pass.dispose();
    target.texture.destroy();
  }
}
