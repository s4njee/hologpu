import type { DeviceSession } from './device.ts';
import type { TextureTap } from './effect.ts';
import { createFullscreenPass } from './passes.ts';
import { compose, chunk, fullscreen, colour } from './wgsl/index.ts';
/** Opt-in HDR presentation over black. Owns only this opaque canvas context/pass. */
export async function createHDRCanvas(
  session: DeviceSession,
  canvas: HTMLCanvasElement,
  colorSpace: PredefinedColorSpace = 'display-p3',
) {
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('WebGPU canvas context unavailable');
  if (!['srgb', 'display-p3'].includes(colorSpace))
    throw new RangeError('Unsupported HDR colour space');
  const source = compose(
    fullscreen,
    colour,
    chunk(
      'hdr-present',
      `@group(0) @binding(0) var image:texture_2d<f32>;@fragment fn fragment(@builtin(position) p:vec4f)->@location(0)vec4f{let c=textureLoad(image,vec2i(p.xy),0);${colorSpace === 'display-p3' ? 'let rgb=mat3x3f(vec3f(.82259287,.03319951,.01708535),vec3f(.17753395,.9667835,.07239572),vec3f(0,0,.91030148))*c.rgb;' : 'let rgb=c.rgb;'}return vec4f(linear_to_srgb(max(rgb,vec3f(0))),1);}`,
    ),
  );
  const pass = await createFullscreenPass(session, source, 'rgba16float', 'hgpu-hdr-present', [
    {
      binding: 0,
      visibility: GPUShaderStage.FRAGMENT,
      texture: { sampleType: 'unfilterable-float' },
    },
  ]);
  try {
    await session.validate(async () =>
      context.configure({
        device: session.device,
        format: 'rgba16float',
        alphaMode: 'opaque',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        colorSpace,
        toneMapping: { mode: 'extended' },
      }),
    );
    const configuration = context.getConfiguration();
    if (
      configuration?.format !== 'rgba16float' ||
      configuration.colorSpace !== colorSpace ||
      configuration.toneMapping?.mode !== 'extended'
    )
      throw new Error('Extended HDR canvas configuration was not accepted');
    let disposed = false;
    return {
      configuration,
      source: pass.source,
      diagnostics: pass.diagnostics,
      draw(encoder: GPUCommandEncoder, input: TextureTap) {
        if (disposed) throw new Error('HDR canvas disposed');
        if (input.width !== canvas.width || input.height !== canvas.height)
          throw new RangeError('HDR canvas dimensions must match the effect output');
        if (
          input.texture.sampleCount !== 1 ||
          input.texture.dimension !== '2d' ||
          input.texture.depthOrArrayLayers !== 1
        )
          throw new TypeError('HDR presentation needs a single-sample 2D effect output');
        const group = session.device.createBindGroup({
          layout: pass.pipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: input.texture.createView() }],
        });
        const output = context.getCurrentTexture();
        pass.draw(encoder, output.createView(), [group]);
        return output;
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        context.unconfigure();
        pass.dispose();
      },
    };
  } catch (error) {
    context.unconfigure();
    pass.dispose();
    throw error;
  }
}
