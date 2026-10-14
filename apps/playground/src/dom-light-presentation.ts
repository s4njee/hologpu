import { createFullscreenPass, compose, fullscreen, colour, chunk } from '@mk7s/hologpu';
import type { DeviceSession, TextureTap } from '@mk7s/hologpu';

/** One final pass in the field's existing submission; no extra simulation or RAF loop. */
export async function createLightPresentation(
  session: DeviceSession,
  canvas: HTMLCanvasElement,
  requestHDR: boolean,
  inputKind: 'fluid' | 'particles' = 'fluid',
) {
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('Canvas WebGPU context unavailable');
  let hdr = false;
  let colorSpace: PredefinedColorSpace = 'srgb';
  let format = session.capabilities.preferredFormat;
  if (requestHDR) {
    // Older browsers may reject either float presentation or the extended range.
    for (const gamut of ['display-p3', 'srgb'] as const) {
      try {
        await session.validate(async () => {
          context.configure({
            device: session.device,
            format: 'rgba16float',
            alphaMode: 'opaque',
            colorSpace: gamut,
            toneMapping: { mode: 'extended' },
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
          });
        });
        const accepted = context.getConfiguration();
        if (
          accepted?.format !== 'rgba16float' ||
          accepted.colorSpace !== gamut ||
          accepted.toneMapping?.mode !== 'extended'
        )
          throw new Error('Extended presentation was not accepted');
        hdr = true;
        colorSpace = gamut;
        format = 'rgba16float';
        break;
      } catch {
        context.unconfigure();
        // Device loss should be handled by the field's recovery, not an SDR downgrade.
        if (session.state !== 'ready') throw new Error('Device lost during presentation setup');
      }
    }
  }
  if (!hdr)
    context.configure({
      device: session.device,
      format,
      alphaMode: 'opaque',
      colorSpace,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
  const device = session.device;
  const uniforms = device.createBuffer({
    label: 'dom-light',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  try {
    const pass = await createFullscreenPass(
      session,
      compose(
        fullscreen,
        colour,
        chunk(
          'dom-light',
          /* wgsl */ `
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var<uniform> light: vec4f;
@fragment fn fragment(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let base = srgb_to_linear(vec3f(8.0, 15.0, 20.0) / 255.0);
  let original = textureLoad(image, vec2i(p.xy), 0).rgb;
  // Keep empty regions dark; particle input is the raw additive trail, before tone mapping.
  ${
    inputKind === 'fluid'
      ? 'let emission = max(original - base, vec3f(0));'
      : hdr
        ? 'let emission = max(original * light.y, vec3f(0));'
        : 'let c = max(original * light.y, vec3f(0)); let emission = (vec3f(1) - base) * c / (vec3f(1) + c);'
  }
  var rgb = base + emission * light.x;
  ${
    hdr
      ? colorSpace === 'display-p3'
        ? 'rgb = mat3x3f(vec3f(.82259287,.03319951,.01708535),vec3f(.17753395,.9667835,.07239572),vec3f(0,0,.91030148)) * rgb;'
        : ''
      : `// A hue-preserving shoulder keeps boosted SDR dye from clipping to white.
  let peak = max(emission.r, max(emission.g, emission.b));
  let boosted = peak * light.x;
  let headroom = 1.0 - max(base.r, max(base.g, base.b));
  let mapped = boosted / (1.0 + peak / headroom * (light.x - 1.0));
  rgb = base + emission * (mapped / max(peak, 0.00001));`
  }
  return vec4f(linear_to_srgb(max(rgb, vec3f(0))), 1);
}`,
        ),
      ),
      format,
      'dom-light-present',
      [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float' },
        },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    );
    const groups = new WeakMap<GPUTexture, GPUBindGroup>();
    let brightness = NaN;
    let exposure = NaN;
    let disposed = false;
    return {
      hdr,
      configuration: context.getConfiguration()!,
      generation: session.generation,
      draw(encoder: GPUCommandEncoder, input: TextureTap, boost: number, inputExposure = 1) {
        if (disposed) throw new Error('Light presentation disposed');
        if (input.width !== canvas.width || input.height !== canvas.height)
          throw new RangeError('Light presentation size mismatch');
        if (boost !== brightness || inputExposure !== exposure) {
          brightness = boost;
          exposure = inputExposure;
          device.queue.writeBuffer(uniforms, 0, new Float32Array([boost, inputExposure, 0, 0]));
        }
        let group = groups.get(input.texture);
        if (!group) {
          group = device.createBindGroup({
            layout: pass.pipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: input.texture.createView() },
              { binding: 1, resource: { buffer: uniforms } },
            ],
          });
          groups.set(input.texture, group);
        }
        const output = context.getCurrentTexture();
        pass.draw(encoder, output.createView(), [group!]);
        return output;
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        context.unconfigure();
        uniforms.destroy();
        pass.dispose();
      },
    };
  } catch (error) {
    uniforms.destroy();
    context.unconfigure();
    throw error;
  }
}
