import { ParamStore, paramLayout } from './params.ts';
import type { ParamSchema, ParamValues } from './params.ts';
import { compose, chunk, frame, fullscreen, sampling } from './wgsl/index.ts';
import type { WGSLChunk, ComposedWGSL } from './wgsl/composer.ts';
import { createFullscreenPass } from './passes.ts';
import type { DeviceSession } from './device.ts';
import type { ShaderDiagnostic } from './debug.ts';
export interface FrameInfo {
  time: number;
  delta: number;
  index: number;
  resolution: readonly [number, number];
  dpr: number;
  pointer: readonly [number, number];
  velocity: readonly [number, number];
  buttons: number;
  pressure: number;
  scroll: number;
  visibility: number;
  seed: number;
}
export interface EffectContext<S extends ParamSchema = ParamSchema> {
  session: DeviceSession;
  device: GPUDevice;
  params: ParamStore<S>;
  paramsBuffer: GPUBuffer;
  frameBuffer: GPUBuffer;
  format: GPUTextureFormat;
  /** User/runtime scale for solver iterations; never changes the fixed timestep. */
  qualitySteps: () => number;
}
export interface TextureTap {
  readonly texture: GPUTexture;
  readonly format: GPUTextureFormat;
  readonly width: number;
  readonly height: number;
  readonly label?: string;
  readonly kind: 'float' | 'uint';
}
export interface EffectMemory {
  textureBytes: number;
  bufferBytes: number;
}
export interface BufferTap {
  readonly buffer: GPUBuffer;
  readonly label?: string;
  readonly stride?: number;
  readonly count?: number;
}
export interface EffectInstance {
  resize(size: readonly [number, number]): void;
  update(frame: FrameInfo): void;
  render(frame: FrameInfo, encoder: GPUCommandEncoder, target: GPUTextureView): void;
  reset(seed: number): void;
  dispose(): void;
  readonly sources?: Readonly<Record<string, ComposedWGSL>>;
  readonly diagnostics?: readonly ShaderDiagnostic[];
  textureTaps?(): Readonly<Record<string, TextureTap>>;
  bufferTaps?(): Readonly<Record<string, BufferTap>>;
  memory?(): EffectMemory;
}
export interface EffectDefinition<S extends ParamSchema = ParamSchema> {
  readonly id: string;
  readonly family: string;
  readonly title: string;
  readonly tier: 'T1' | 'T2' | 'T3' | 'T4' | 'T5';
  readonly tags: readonly string[];
  readonly core: boolean;
  readonly features: readonly GPUFeatureName[];
  readonly inputs: readonly string[];
  readonly params: S;
  readonly presets: Readonly<Record<string, ParamValues>>;
  readonly quality: { resolutionScale: readonly [number, number] };
  readonly reducedMotion: { time: number };
  readonly fallback: string;
  create(ctx: EffectContext<S>): EffectInstance | Promise<EffectInstance>;
}
export function defineEffect<S extends ParamSchema>(
  definition: EffectDefinition<S>,
): EffectDefinition<S> {
  if (!/^[a-z][a-z0-9-]*$/.test(definition.id))
    throw new Error(`Invalid effect id: ${definition.id}`);
  const store = new ParamStore(definition.params);
  for (const preset of Object.values(definition.presets)) store.patch(preset);
  const [min, max] = definition.quality.resolutionScale;
  if (min <= 0 || max < min || max > 1) throw new Error('Invalid resolution scale range');
  return Object.freeze(definition);
}
export interface FragmentOptions<S extends ParamSchema> extends Omit<
  EffectDefinition<S>,
  | 'create'
  | 'tier'
  | 'family'
  | 'core'
  | 'features'
  | 'inputs'
  | 'tags'
  | 'quality'
  | 'reducedMotion'
  | 'fallback'
  | 'presets'
> {
  wgsl: string | WGSLChunk;
  chunks?: readonly WGSLChunk[];
  family?: string;
  core?: boolean;
  features?: readonly GPUFeatureName[];
  inputs?: readonly string[];
  tags?: readonly string[];
  presets?: Readonly<Record<string, ParamValues>>;
  quality?: { resolutionScale: readonly [number, number] };
  reducedMotion?: { time: number };
  fallback?: string;
}
/** A fragment body implements `fn effect(uv: vec2f) -> vec4f` in linear, straight-alpha color. */
export function fragmentEffect<const S extends ParamSchema>(
  options: FragmentOptions<S>,
): EffectDefinition<S> {
  const { wgsl, chunks: dependencies = [], ...metadata } = options;
  const body = typeof wgsl === 'string' ? chunk(`effect:${options.id}`, wgsl, dependencies) : wgsl;
  const source = compose(
    frame,
    fullscreen,
    sampling,
    chunk(
      'params',
      `${paramLayout(options.params).wgsl}\n@group(0) @binding(1) var<uniform> params: Params;`,
    ),
    body,
    chunk(
      'fragment',
      /* wgsl */ `
@fragment fn fragment(in: VertexOut) -> @location(0) vec4f {
  let c=effect(in.uv);let a=clamp(c.a,0.0,1.0);return vec4f(c.rgb*a,a);
}`,
    ),
  );
  return defineEffect({
    ...metadata,
    family: options.family ?? 'procedural',
    tier: 'T1',
    core: options.core ?? false,
    tags: options.tags ?? [],
    features: options.features ?? [],
    inputs: options.inputs ?? [],
    presets: options.presets ?? {},
    quality: options.quality ?? { resolutionScale: [0.25, 1] },
    reducedMotion: options.reducedMotion ?? { time: 0 },
    fallback: options.fallback ?? 'linear-gradient(135deg, #263448, #775da9)',
    async create(ctx) {
      const pass = await createFullscreenPass(
        ctx.session,
        source,
        ctx.format,
        `hgpu-${options.id}`,
        [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        ],
      );
      const group = ctx.device.createBindGroup({
        label: `hgpu-${options.id}-uniforms`,
        layout: pass.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: ctx.frameBuffer } },
          { binding: 1, resource: { buffer: ctx.paramsBuffer } },
        ],
      });
      return {
        resize() {},
        update() {},
        reset() {},
        render(_frame, encoder, target) {
          pass.draw(encoder, target, [group]);
        },
        dispose() {
          pass.dispose();
        },
        sources: { fragment: source },
        diagnostics: pass.diagnostics,
      };
    },
  });
}
