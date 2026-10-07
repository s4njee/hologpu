import type { DeviceSession } from '../device.ts';
import { createComputePass } from '../compute.ts';
import { chunk, compose } from '../wgsl/composer.ts';
export type MipFormat = 'rgba8unorm' | 'rgba16float' | 'rgba32float' | 'r32float' | 'rg32float';
/** Area-weighted linear box mip chain. Array layers include six-face cube textures. */
export async function createMipGenerator(
  session: DeviceSession,
  format: MipFormat = 'rgba16float',
) {
  const source = compose(
    chunk(
      'primitive:mipgen',
      `@group(0) @binding(0) var input:texture_2d<f32>;@group(0) @binding(1) var output:texture_storage_2d<${format},write>;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){let extent=textureDimensions(output);if(any(id.xy>=extent)){return;}let size=textureDimensions(input);let start=id.xy*size;let end=(id.xy+1u)*size;let lower=start/extent;let upper=(end+extent-1u)/extent;var total=vec4f(0);var weight=0.0;for(var y=lower.y;y<upper.y;y++){for(var x=lower.x;x<upper.x;x++){let pixel=vec2u(x,y);let overlap=min(end,(pixel+1u)*extent)-max(start,pixel*extent);let area=vec2f(overlap);let w=area.x*area.y;total+=textureLoad(input,vec2i(pixel),0)*w;weight+=w;}}textureStore(output,vec2i(id.xy),total/max(weight,1.0));}`,
    ),
  );
  const layout = session.device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: 'unfilterable-float' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: 'write-only', format },
      },
    ],
  });
  const pass = await createComputePass(session, source, 'hgpu-mipgen', [layout]);
  let disposed = false;
  return {
    format,
    encode(encoder: GPUCommandEncoder, texture: GPUTexture) {
      if (disposed) throw new Error('Primitive is disposed');
      if (texture.format !== format || texture.dimension !== '2d' || texture.sampleCount !== 1)
        throw new TypeError(
          'Mip generator requires a matching single-sample 2D or cube-array texture',
        );
      if (
        !(texture.usage & GPUTextureUsage.STORAGE_BINDING) ||
        !(texture.usage & GPUTextureUsage.TEXTURE_BINDING)
      )
        throw new TypeError('Mip texture needs STORAGE_BINDING and TEXTURE_BINDING');
      for (let level = 1; level < texture.mipLevelCount; level++) {
        const width = Math.max(1, texture.width >> level),
          height = Math.max(1, texture.height >> level);
        for (let layer = 0; layer < texture.depthOrArrayLayers; layer++) {
          const group = session.device.createBindGroup({
            layout,
            entries: [
              {
                binding: 0,
                resource: texture.createView({
                  dimension: '2d',
                  baseMipLevel: level - 1,
                  mipLevelCount: 1,
                  baseArrayLayer: layer,
                  arrayLayerCount: 1,
                }),
              },
              {
                binding: 1,
                resource: texture.createView({
                  dimension: '2d',
                  baseMipLevel: level,
                  mipLevelCount: 1,
                  baseArrayLayer: layer,
                  arrayLayerCount: 1,
                }),
              },
            ],
          });
          pass.dispatch(encoder, [group], [Math.ceil(width / 8), Math.ceil(height / 8)]);
        }
      }
    },
    sources: { mipgen: pass.source },
    diagnostics: pass.diagnostics,
    memory: { bufferBytes: 0, textureBytes: 0 },
    dispose() {
      if (disposed) return;
      disposed = true;
      pass.dispose();
    },
  };
}
export type MipGenerator = Awaited<ReturnType<typeof createMipGenerator>>;
