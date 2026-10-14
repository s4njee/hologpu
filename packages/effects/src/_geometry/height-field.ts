import {
  createComputePass,
  simulationSource,
  simulationUniformLayout,
  noise,
  type EffectContext,
  type ParamSchema,
  type TextureTap,
} from '@mk7s/hologpu-core';
/** Vertex-displacement input with a race-free, per-texel r32float read/write remap. */
export async function terrainHeightField<S extends ParamSchema>(ctx: EffectContext<S>) {
  const device = ctx.device,
    uniform = simulationUniformLayout(device),
    readWrite =
      navigator.gpu.wgslLanguageFeatures?.has('readonly_and_readwrite_storage_textures') ?? false;
  const layout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'r32float' },
        },
      ],
    }),
    remapLayout = readWrite
      ? device.createBindGroupLayout({
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.COMPUTE,
              storageTexture: { access: 'read-write', format: 'r32float' },
            },
          ],
        })
      : undefined;
  const source = simulationSource(
    ctx.params.schema,
    `@group(1) @binding(0) var field:texture_storage_2d<r32float,write>;@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){let size=textureDimensions(field);if(any(id.xy>=size)){return;}let p=vec2f(id.xy)/vec2f(size-1u)*2.0-1.0;let h=fbm(p*params.frequency+vec2f(1.3,2.7),frame.seed,0u,5u);textureStore(field,vec2i(id.xy),vec4f(${readWrite ? 'h' : 'mix(h,h*h*(3.0-2.0*h),params.sculpt)*params.height'},0,0,1));}`,
    [noise],
  );
  const leases: Awaited<ReturnType<typeof createComputePass>>[] = [];
  let texture: GPUTexture | undefined,
    generate: GPUBindGroup,
    remap: GPUBindGroup | undefined,
    extent = 0,
    signature = '';
  try {
    const generatePass = await createComputePass(ctx.session, source, 'terrain-height-generate', [
      uniform,
      layout,
    ]);
    leases.push(generatePass);
    const remapPass = readWrite
      ? await createComputePass(
          ctx.session,
          simulationSource(
            ctx.params.schema,
            `@group(1) @binding(0) var field:texture_storage_2d<r32float,read_write>;@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){if(any(id.xy>=textureDimensions(field))){return;}let h=textureLoad(field,vec2i(id.xy)).r;textureStore(field,vec2i(id.xy),vec4f(mix(h,h*h*(3.0-2.0*h),params.sculpt)*params.height,0,0,1));}`,
          ),
          'terrain-height-read-write',
          [uniform, remapLayout!],
        )
      : undefined;
    if (remapPass) leases.push(remapPass);
    return {
      resize(segments: number) {
        const next = segments + 1;
        if (next === extent) return;
        texture?.destroy();
        extent = next;
        signature = '';
        texture = device.createTexture({
          label: 'terrain-height-r32float',
          size: [extent, extent],
          format: 'r32float',
          usage:
            GPUTextureUsage.STORAGE_BINDING |
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_SRC,
        });
        generate = device.createBindGroup({
          layout,
          entries: [{ binding: 0, resource: texture.createView() }],
        });
        if (remapLayout)
          remap = device.createBindGroup({
            layout: remapLayout,
            entries: [{ binding: 0, resource: texture.createView() }],
          });
      },
      get view() {
        return texture!.createView();
      },
      encode(encoder: GPUCommandEncoder, uniforms: GPUBindGroup, seed: number) {
        const next = JSON.stringify([
          extent,
          seed,
          ctx.params.values.frequency,
          ctx.params.values.height,
          ctx.params.values.sculpt,
        ]);
        if (signature === next) return;
        generatePass.dispatch(
          encoder,
          [uniforms, generate],
          [Math.ceil(extent / 8), Math.ceil(extent / 8)],
        );
        if (remapPass)
          remapPass.dispatch(
            encoder,
            [uniforms, remap!],
            [Math.ceil(extent / 8), Math.ceil(extent / 8)],
          );
        signature = next;
      },
      textureTaps: () => ({
        heightField: {
          texture: texture!,
          format: 'r32float',
          width: extent,
          height: extent,
          kind: 'float',
          label: readWrite
            ? 'Seeded height after in-place r32float remap'
            : 'Seeded height; fused write-only language fallback',
        } satisfies TextureTap,
      }),
      get bytes() {
        return extent * extent * 4;
      },
      sources: Object.fromEntries(
        leases.map((l) => [l === generatePass ? 'height-generate' : 'height-read-write', l.source]),
      ),
      diagnostics: leases.flatMap((l) => l.diagnostics),
      dispose() {
        texture?.destroy();
        leases.forEach((l) => l.dispose());
      },
    };
  } catch (error) {
    texture?.destroy();
    leases.reverse().forEach((l) => l.dispose());
    throw error;
  }
}
