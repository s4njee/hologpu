import {
  feedbackEffect,
  createComputePass,
  createSimulationDisplay,
  createMipGenerator,
  simulationSource,
  simulationUniformLayout,
  type TextureTap,
} from '@mk7s/hologpu-core';
const params = {
  size: {
    type: 'u32',
    default: 256,
    min: 16,
    max: 512,
    step: 16,
    uniform: false,
    group: 'Texture',
    description: 'Base texture dimensions; all levels down to 1×1 are generated on GPU.',
  },
  shape: {
    type: 'enum',
    default: '2d',
    options: ['2d', 'cube'],
    uniform: false,
    group: 'Texture',
    description:
      'A two-dimensional texture or all six independent faces of a cube-compatible array.',
  },
  level: {
    type: 'u32',
    default: 3,
    min: 0,
    max: 9,
    step: 1,
    group: 'Inspection',
    description: 'Mip level shown in the right comparison panel, clamped to the available chain.',
  },
  frequency: {
    type: 'f32',
    default: 48,
    min: 2,
    max: 128,
    step: 1,
    group: 'Pattern',
    description: 'Checkerboard spatial frequency, exposing how lower mips suppress aliasing.',
  },
  tint: {
    type: 'color',
    default: '#efcba0',
    group: 'Palette',
    description: 'Checkerboard bright color.',
  },
  background: {
    type: 'color',
    default: '#123046',
    group: 'Palette',
    description: 'Checkerboard dark color.',
  },
} as const;
export default feedbackEffect({
  id: 'mipgen',
  title: '2D and cube mip generation',
  family: 'primitives',
  core: true,
  tags: ['compute', 'texture', 'mipmap', 'cube'],
  inputs: [],
  features: [],
  params,
  presets: {
    fine: { frequency: 96, level: 5, tint: '#c3d0f5' },
    cube: { shape: 'cube', frequency: 32, level: 2, tint: '#b5e5a8' },
  },
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback: 'repeating-conic-gradient(#123046 0 25%,#efcba0 0 50%) 0/24px 24px',
  async setup(ctx) {
    const device = ctx.device,
      uniform = simulationUniformLayout(device),
      leases: { dispose(): void }[] = [];
    let texture: GPUTexture | null = null;
    let size = 0,
      layers = 0;
    try {
      const mip = await createMipGenerator(ctx.session);
      leases.push(mip);
      const initLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            storageTexture: {
              format: 'rgba16float',
              access: 'write-only',
              viewDimension: '2d-array',
            },
          },
        ],
      });
      const initSource = simulationSource(
        ctx.params.schema,
        `@group(1) @binding(0) var image:texture_storage_2d_array<rgba16float,write>;@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){let n=textureDimensions(image);if(any(id.xy>=n)){return;}let uv=(vec2f(id.xy)+.5)/vec2f(n);let checker=(u32(uv.x*params.frequency)+u32(uv.y*params.frequency))&1u;let face=f32(id.z)/6.0;let color=mix(params.background.rgb,params.tint.rgb,f32(checker));textureStore(image,vec2i(id.xy),i32(id.z),vec4f(mix(color,color.zxy,face*.7),1));}`,
      );
      const initialize = await createComputePass(ctx.session, initSource, 'mipgen-initialize', [
        uniform,
        initLayout,
      ]);
      leases.push(initialize);
      const displayLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' },
          },
        ],
      });
      const displaySource = simulationSource(
        ctx.params.schema,
        `@group(1) @binding(0) var image:texture_2d_array<f32>;@fragment fn fragment(in:VertexOut)->@location(0)vec4f{let level=select(0u,min(params.level,textureNumLevels(image)-1u),in.uv.x>.5);let uv=vec2f(fract(in.uv.x*2.0),in.uv.y);let layers=textureNumLayers(image);let face=select(0u,min(layers-1u,u32(uv.y*f32(layers))),layers>1u);let local=vec2f(uv.x,fract(uv.y*f32(layers)));let n=textureDimensions(image,i32(level));let p=clamp(vec2i(local*vec2f(n)),vec2i(0),vec2i(n)-1);let color=textureLoad(image,p,i32(face),i32(level));let divider=1.0-smoothstep(.002,.007,abs(in.uv.x-.5));return vec4f(mix(color.rgb,vec3f(.8),divider),1);}`,
      );
      const display = await createSimulationDisplay(
        ctx.session,
        displaySource,
        ctx.format,
        'mipgen-display',
        [uniform, displayLayout],
      );
      leases.push(display);
      const resize = () => {
        const nextSize = Number(ctx.params.values.size),
          nextLayers = ctx.params.values.shape === 'cube' ? 6 : 1;
        if (size === nextSize && layers === nextLayers) return false;
        const next = device.createTexture({
          label: 'mipgen-chain',
          size: [nextSize, nextSize, nextLayers],
          format: 'rgba16float',
          mipLevelCount: 1 + Math.floor(Math.log2(nextSize)),
          usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.STORAGE_BINDING |
            GPUTextureUsage.COPY_SRC |
            GPUTextureUsage.COPY_DST,
        });
        texture?.destroy();
        texture = next;
        size = nextSize;
        layers = nextLayers;
        return true;
      };
      resize();
      const run = (encoder: GPUCommandEncoder, uniforms: GPUBindGroup) => {
        const group = device.createBindGroup({
          layout: initLayout,
          entries: [
            {
              binding: 0,
              resource: texture!.createView({
                dimension: '2d-array',
                baseMipLevel: 0,
                mipLevelCount: 1,
              }),
            },
          ],
        });
        initialize.dispatch(
          encoder,
          [uniforms, group],
          [Math.ceil(size / 8), Math.ceil(size / 8), layers],
        );
        mip.encode(encoder, texture!);
      };
      return {
        resize,
        initialize(encoder, _frame, uniforms) {
          run(encoder, uniforms);
        },
        step(encoder, _frame, uniforms) {
          run(encoder, uniforms);
        },
        display(encoder, target, _frame, uniforms) {
          const group = device.createBindGroup({
            layout: displayLayout,
            entries: [{ binding: 0, resource: texture!.createView({ dimension: '2d-array' }) }],
          });
          display.draw(encoder, target, [uniforms, group]);
        },
        sources: { initialize: initialize.source, display: display.source, ...mip.sources },
        diagnostics: [...initialize.diagnostics, ...display.diagnostics, ...mip.diagnostics],
        textureTaps() {
          const taps: Record<string, TextureTap> = {};
          for (let layer = 0; layer < layers; layer++)
            for (let level = 0; level < texture!.mipLevelCount; level++) {
              const dimension = Math.max(1, size >> level);
              taps[`face-${layer}-mip-${level}`] = {
                texture: texture!,
                format: 'rgba16float',
                width: dimension,
                height: dimension,
                kind: 'float',
                mipLevel: level,
                arrayLayer: layer,
                label: `Face ${layer}, level ${level}`,
              };
            }
          return taps;
        },
        memory() {
          let cells = 0;
          for (let level = 0; level < texture!.mipLevelCount; level++) {
            cells += Math.max(1, size >> level) ** 2;
          }
          return { textureBytes: cells * layers * 8, bufferBytes: 0 };
        },
        dispose() {
          texture?.destroy();
          leases.forEach((l) => l.dispose());
        },
      };
    } catch (error) {
      (texture as GPUTexture | null)?.destroy();
      leases.forEach((l) => l.dispose());
      throw error;
    }
  },
});
