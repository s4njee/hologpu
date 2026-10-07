import { createFilterPass, filterGroup, filterTarget } from '@mk7s/hologpu-core';
import type {
  EffectContext,
  TextureTap,
  FullscreenPass,
  ParamSchema,
  ParamSpec,
} from '@mk7s/hologpu-core';
export const f = (value: number, min: number, max: number, description: string, group = 'Filter') =>
  ({
    type: 'f32' as const,
    default: value,
    min,
    max,
    step: 0.01,
    description,
    group,
  }) satisfies ParamSpec;
export const u = (value: number, min: number, max: number, description: string, group = 'Filter') =>
  ({
    type: 'u32' as const,
    default: value,
    min,
    max,
    step: 1,
    description,
    group,
  }) satisfies ParamSpec;
export const e = (
  value: string,
  options: readonly string[],
  description: string,
  group = 'Filter',
) => ({ type: 'enum' as const, default: value, options, description, group }) satisfies ParamSpec;
export const v = (
  value: readonly number[],
  min: number,
  max: number,
  description: string,
  group = 'Colour',
) =>
  ({
    type: 'vec3' as const,
    default: value,
    min,
    max,
    step: 0.01,
    description,
    group,
  }) satisfies ParamSpec;
export const straight = `fn straight(c:vec4f)->vec3f {return c.rgb/max(c.a,0.00001);}\nfn premul(c:vec3f,a:f32)->vec4f {return vec4f(c*a,a);}\nfn luminance(c:vec3f)->f32 {return dot(c,vec3f(.2126,.7152,.0722));}`;
export function targetSet(
  ctx: EffectContext,
  sizes: readonly (readonly [number, number])[],
  label: string,
) {
  return sizes.map((size, i) => filterTarget(ctx.device, size, `${label}-${i}`));
}
export const texBytes = (targets: readonly TextureTap[]) =>
  targets.reduce((n, t) => n + t.width * t.height * 8, 0);
export const textureBinding = (binding: number): GPUBindGroupLayoutEntry => ({
  binding,
  visibility: GPUShaderStage.FRAGMENT,
  texture: { sampleType: 'unfilterable-float' },
});
export interface Stage {
  pass: FullscreenPass;
  settings: GPUBuffer;
  draw(
    encoder: GPUCommandEncoder,
    target: GPUTextureView,
    input: TextureTap,
    other?: TextureTap,
  ): void;
  dispose(): void;
}
/** One immutable settings buffer per stage avoids queue-write aliasing across encoded passes. */
export async function stage(
  ctx: EffectContext,
  code: string,
  label: string,
  settings: readonly number[],
  other = false,
): Promise<Stage> {
  const buffer = ctx.device.createBuffer({
    label: `${label}-settings`,
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  ctx.device.queue.writeBuffer(buffer, 0, new Float32Array(settings));
  try {
    const pass = await createFilterPass(
      ctx,
      `@group(0) @binding(3) var<uniform> stage:vec4f;\n${other ? '@group(0) @binding(4) var secondImage:texture_2d<f32>;' : ''}\n${code}`,
      label,
      [
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        ...(other ? [textureBinding(4)] : []),
      ],
      [],
      'rgba16float',
    );
    return {
      pass,
      settings: buffer,
      draw(encoder, target, input, second) {
        pass.draw(encoder, target, [
          filterGroup(ctx, pass, input, [
            { binding: 3, resource: { buffer } },
            ...(other ? [{ binding: 4, resource: second!.texture.createView() }] : []),
          ]),
        ]);
      },
      dispose() {
        pass.dispose();
        buffer.destroy();
      },
    };
  } catch (error) {
    buffer.destroy();
    throw error;
  }
}
export const kawaseDown = `fn effect(uv:vec2f)->vec4f {let texel=1.0/vec2f(textureDimensions(image));let d=texel*stage.z;return (sample_image(uv)*4.0+sample_image(uv+vec2f(-d.x,-d.y))+sample_image(uv+vec2f(d.x,-d.y))+sample_image(uv+vec2f(-d.x,d.y))+sample_image(uv+d))/8.0;}`;
export const kawaseUp = `fn effect(uv:vec2f)->vec4f {let d=stage.z/vec2f(textureDimensions(image));var c=sample_image(uv+vec2f(-2.0*d.x,0))+sample_image(uv+vec2f(2.0*d.x,0))+sample_image(uv+vec2f(0,-2.0*d.y))+sample_image(uv+vec2f(0,2.0*d.y));c+=2.0*(sample_image(uv-d)+sample_image(uv+d)+sample_image(uv+vec2f(d.x,-d.y))+sample_image(uv+vec2f(-d.x,d.y)));return c/12.0;}`;
