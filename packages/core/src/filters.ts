import { defineEffect } from './effect.ts';
import type {
  EffectContext,
  EffectDefinition,
  EffectInstance,
  FragmentOptions,
  TextureTap,
  FrameInfo,
} from './effect.ts';
import { ParamStore } from './params.ts';
import type { ParamSchema, ParamSpec, ParamValues } from './params.ts';
import { compose, chunk, frame, fullscreen, sampling } from './wgsl/index.ts';
import { createFullscreenPass } from './passes.ts';
import type { FullscreenPass } from './passes.ts';
import type { DeviceSession } from './device.ts';
import type { WGSLChunk } from './wgsl/composer.ts';

const textureParams = (schema: ParamSchema) =>
  Object.entries(schema).filter(([, spec]) =>
    ['texture', 'curve', 'gradient'].includes(String(spec.type)),
  );
export const filterBindings: readonly GPUBindGroupLayoutEntry[] = [
  { binding: 0, visibility: 2, buffer: { type: 'uniform' } },
  { binding: 1, visibility: 2, buffer: { type: 'uniform' } },
  { binding: 2, visibility: 2, texture: { sampleType: 'unfilterable-float' } },
];
/** Composes a premultiplied-linear filter body. Extras start at binding 3. */
export async function createFilterPass<S extends ParamSchema>(
  ctx: EffectContext<S>,
  wgsl: string | WGSLChunk,
  label: string,
  extras: readonly GPUBindGroupLayoutEntry[] = [],
  chunks: readonly WGSLChunk[] = [],
  format: GPUTextureFormat = ctx.format,
): Promise<FullscreenPass> {
  const source = compose(
    frame,
    fullscreen,
    sampling,
    chunk(
      'filter-params',
      `${ctx.params.layout.wgsl}\n@group(0) @binding(1) var<uniform> params: Params;`,
    ),
    ...chunks,
    chunk(
      'filter-schema-textures',
      textureParams(ctx.params.schema)
        .map(
          ([name, spec], i) =>
            `@group(0) @binding(${16 + i}) var param_${name}:texture_2d<f32>;\nfn sample_${name}(uv:vec2f)->vec4f {${String(spec.type) === 'texture' ? `return sample_bilinear(param_${name},uv);` : `let width=f32(textureDimensions(param_${name}).x);let x=(clamp(uv.x,0.0,1.0)*(width-1.0)+.5)/width;return sample_bilinear(param_${name},vec2f(x,.5));`}}`,
        )
        .join('\n'),
    ),
    chunk(
      'filter-input',
      `@group(0) @binding(2) var image: texture_2d<f32>;\nfn sample_image(uv: vec2f)->vec4f {return sample_bilinear(image,uv);}`,
    ),
    typeof wgsl === 'string' ? chunk(label, wgsl) : wgsl,
    chunk(
      'filter-fragment',
      `@fragment fn fragment(in: VertexOut)->@location(0) vec4f {return effect(in.uv);}`,
    ),
  );
  return createFullscreenPass(ctx.session, source, format, label, [
    ...filterBindings,
    ...extras,
    ...textureParams(ctx.params.schema).map(([,], i) => ({
      binding: 16 + i,
      visibility: 2,
      texture: { sampleType: 'unfilterable-float' as const },
    })),
  ]);
}
export function filterGroup<S extends ParamSchema>(
  ctx: EffectContext<S>,
  pass: FullscreenPass,
  input: TextureTap,
  extras: readonly GPUBindGroupEntry[] = [],
): GPUBindGroup {
  if (input.kind !== 'float') throw new TypeError('Filters require float texture inputs');
  return ctx.device.createBindGroup({
    layout: pass.pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: ctx.frameBuffer } },
      { binding: 1, resource: { buffer: ctx.paramsBuffer } },
      {
        binding: 2,
        resource: input.texture.createView({
          baseMipLevel: input.mipLevel ?? 0,
          mipLevelCount: 1,
          baseArrayLayer: input.arrayLayer ?? 0,
          arrayLayerCount: 1,
          dimension: '2d',
        }),
      },
      ...extras,
      ...textureParams(ctx.params.schema).map(([name], i) => ({
        binding: 16 + i,
        resource: (ctx.inputs?.get(name) ?? input).texture.createView({
          baseMipLevel: (ctx.inputs?.get(name) ?? input).mipLevel ?? 0,
          mipLevelCount: 1,
          baseArrayLayer: (ctx.inputs?.get(name) ?? input).arrayLayer ?? 0,
          arrayLayerCount: 1,
          dimension: '2d',
        }),
      })),
    ],
  });
}
export function filterTarget(
  device: GPUDevice,
  size: readonly [number, number],
  label: string,
): TextureTap {
  const texture = device.createTexture({
    label,
    size: { width: size[0], height: size[1] },
    format: 'rgba16float',
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.COPY_SRC,
  });
  return { texture, width: size[0], height: size[1], format: 'rgba16float', kind: 'float', label };
}
/** Stable linear-HDR, premultiplied test card; never depends on network/image decode. */
export function defaultFilterInput(device: GPUDevice): TextureTap {
  const width = 64,
    height = 64;
  const texture = device.createTexture({
    label: 'filter-default-image',
    size: [width, height],
    format: 'rgba32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
  });
  const pixels = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        u = x / (width - 1),
        v = y / (height - 1),
        disk = (u - 0.7) ** 2 + (v - 0.3) ** 2 < 0.018,
        stripe = (Math.floor(x / 8) + Math.floor(y / 8)) % 2;
      pixels.set(
        [
          disk ? 3 : 0.08 + u * 0.8,
          disk ? 1.6 : 0.05 + v * 0.65,
          disk ? 0.4 : 0.1 + stripe * 0.45,
          1,
        ],
        i,
      );
    }
  device.queue.writeTexture({ texture }, pixels, { bytesPerRow: width * 16 }, { width, height });
  return { texture, width, height, format: 'rgba32float', kind: 'float', label: 'default-image' };
}
export interface FilterSetup<S extends ParamSchema> {
  ctx: EffectContext<S>;
  input(name?: string): TextureTap;
}
export interface FilterOptions<S extends ParamSchema> extends Omit<FragmentOptions<S>, 'wgsl'> {
  wgsl?: string | WGSLChunk;
  /** Multipass filters own and report their resources; the wrapper owns its fallback. */
  setup?(setup: FilterSetup<S>): EffectInstance | Promise<EffectInstance>;
}
/** Filter bodies return premultiplied linear colour, including alpha. */
export function filterEffect<const S extends ParamSchema>(
  options: FilterOptions<S>,
): EffectDefinition<S> {
  const { wgsl, setup, chunks = [], ...metadata } = options;
  return defineEffect({
    ...metadata,
    family: options.family ?? 'post-process',
    tier: 'T4',
    core: options.core ?? false,
    tags: options.tags ?? [],
    features: options.features ?? [],
    inputs: options.inputs ?? ['image'],
    presets: options.presets ?? {},
    quality: options.quality ?? { resolutionScale: [0.25, 1] },
    reducedMotion: options.reducedMotion ?? { time: 0 },
    fallback: options.fallback ?? 'linear-gradient(135deg,#213450,#edac76)',
    async create(ctx) {
      const fallback = defaultFilterInput(ctx.device);
      let disposed = false;
      const input = (name = 'image') => ctx.inputs?.get(name) ?? fallback;
      let instance: EffectInstance;
      try {
        if (setup) instance = await setup({ ctx, input });
        else {
          if (!wgsl) throw new Error('filterEffect requires wgsl or setup');
          const pass = await createFilterPass(ctx, wgsl, `hgpu-${options.id}`, [], chunks);
          instance = {
            resize() {},
            update() {},
            reset() {},
            render(_frame, encoder, target) {
              pass.draw(encoder, target, [filterGroup(ctx, pass, input())]);
            },
            dispose() {
              pass.dispose();
            },
            sources: { fragment: pass.source },
            diagnostics: pass.diagnostics,
          };
        }
      } catch (error) {
        fallback.texture.destroy();
        throw error;
      }
      return {
        resize: (size) => instance.resize(size),
        update: (f) => instance.update(f),
        shouldRender: instance.shouldRender?.bind(instance),
        onPointerDown: instance.onPointerDown?.bind(instance),
        render: (f, e, t) => instance.render(f, e, t),
        reset: (s) => instance.reset(s),
        setInput: instance.setInput?.bind(instance),
        get sources() {
          return instance.sources;
        },
        get diagnostics() {
          return instance.diagnostics;
        },
        textureTaps() {
          return { defaultImage: fallback, ...instance.textureTaps?.() };
        },
        bufferTaps: instance.bufferTaps?.bind(instance),
        memory() {
          const m = instance.memory?.() ?? { textureBytes: 0, bufferBytes: 0 };
          return {
            textureBytes: disposed ? 0 : m.textureBytes + 64 * 64 * 16,
            bufferBytes: disposed ? 0 : m.bufferBytes,
          };
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          instance.dispose();
          fallback.texture.destroy();
        },
      };
    },
  });
}
/** Compose a source of any tier with one or more filters. Parameters use s0_, s1_, ... prefixes. */
export function chain(...stages: readonly EffectDefinition[]): EffectDefinition {
  if (stages.length < 2) throw new RangeError('chain needs a source and a filter');
  if (stages.slice(1).some((s) => s.tier !== 'T4'))
    throw new TypeError('Stages after the source must be T4 filters');
  const params: Record<string, ParamSpec> = {};
  stages.forEach((s, i) =>
    Object.entries(s.params).forEach(([name, spec]) => {
      params[`s${i}_${name}`] = {
        ...spec,
        group: `${i + 1}. ${s.title} / ${spec.group ?? 'Parameters'}`,
      };
    }),
  );
  const preset = (which: number): ParamValues =>
    Object.assign(
      {},
      ...stages.map((s, i) =>
        Object.fromEntries(
          Object.entries(Object.values(s.presets)[which] ?? {}).map(([k, v]) => [`s${i}_${k}`, v]),
        ),
      ),
    );
  return defineEffect({
    id: `chain-${stages.map((s) => s.id).join('-')}`,
    title: stages.map((s) => s.title).join(' → '),
    family: 'post-process',
    tier: 'T4',
    core: false,
    tags: ['chain'],
    features: [...new Set(stages.flatMap((s) => s.features))],
    inputs: [
      ...new Set(stages.flatMap((s, i) => s.inputs.filter((name) => i === 0 || name !== 'image'))),
    ],
    params,
    presets: { first: preset(0), second: preset(1) },
    quality: {
      resolutionScale: [
        Math.max(...stages.map((s) => s.quality.resolutionScale[0])),
        Math.min(...stages.map((s) => s.quality.resolutionScale[1])),
      ],
    },
    reducedMotion: stages[0]!.reducedMotion,
    fallback: stages[0]!.fallback,
    async create(ctx) {
      const children: EffectInstance[] = [],
        stores: ParamStore[] = [],
        buffers: GPUBuffer[] = [],
        targets: TextureTap[] = [];
      let disposed = false;
      const free = () => {
        children.forEach((c) => c.dispose());
        buffers.forEach((b) => b.destroy());
        targets.forEach((t) => t.texture.destroy());
        targets.length = 0;
      };
      try {
        for (let i = 0; i < stages.length; i++) {
          const stage = stages[i]!,
            store = new ParamStore(
              stage.params,
              Object.fromEntries(
                Object.keys(stage.params).map((name) => [
                  name,
                  ctx.params.values[`s${i}_${name}`]!,
                ]),
              ),
            ),
            buffer = ctx.device.createBuffer({
              label: `chain-stage-${i}-params`,
              size: store.layout.byteLength,
              usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
          stores.push(store);
          buffers.push(buffer);
          children.push(
            await stage.create({
              ...ctx,
              session: new Proxy(ctx.session, {
                get(target, key) {
                  if (key === 'shaderSource')
                    return (label: string, source: import('./wgsl/composer.ts').ComposedWGSL) =>
                      ctx.session.shaderSource(`chain-${i}:${label}`, {
                        code: `// chain stage ${i}\n${source.code}`,
                        regions: [
                          { id: `chain-stage-${i}`, startLine: 1, endLine: 1 },
                          ...source.regions.map((region) => ({
                            ...region,
                            startLine: region.startLine + 1,
                            endLine: region.endLine + 1,
                          })),
                        ],
                      });
                  const value: unknown = Reflect.get(target, key, target);
                  return typeof value === 'function' ? value.bind(target) : value;
                },
              }) as DeviceSession,
              params: store,
              paramsBuffer: buffer,
              format: 'rgba16float',
              inputs: {
                get(name: string) {
                  return i > 0 && name === 'image'
                    ? targets[i - 1]
                    : (ctx.inputs?.get(`s${i}_${name}`) ?? ctx.inputs?.get(name));
                },
              },
            }),
          );
        }
      } catch (error) {
        free();
        throw error;
      }
      const sync = () =>
        stores.forEach((s, i) => {
          for (const key of Object.keys(s.schema)) s.set(key, ctx.params.values[`s${i}_${key}`]!);
          s.flush(ctx.device, buffers[i]!);
        });
      const stageFrame = (f: FrameInfo) => ({
        ...f,
        resolution: [f.resolution[0], f.resolution[1]] as const,
      });
      return {
        resize(size) {
          targets.forEach((t) => t.texture.destroy());
          targets.length = 0;
          for (let i = 0; i < stages.length - 1; i++)
            targets.push(filterTarget(ctx.device, size, `chain-stage-${i}`));
          children.forEach((c) => c.resize(size));
        },
        update(f) {
          sync();
          children.forEach((c) => c.update(stageFrame(f)));
        },
        render(f, e, t) {
          sync();
          children.forEach((c, i) =>
            c.render(
              stageFrame(f),
              e,
              i === children.length - 1 ? t : targets[i]!.texture.createView(),
            ),
          );
        },
        reset(seed) {
          sync();
          children.forEach((c) => c.reset(seed));
        },
        async setInput(name, value) {
          await Promise.all(children.map((c) => c.setInput?.(name, value)));
        },
        get sources() {
          return Object.assign(
            {},
            ...children.map((c, i) =>
              Object.fromEntries(
                Object.entries(c.sources ?? {}).map(([k, v]) => [`s${i}:${k}`, v]),
              ),
            ),
          );
        },
        get diagnostics() {
          return children.flatMap((c) => c.diagnostics ?? []);
        },
        textureTaps() {
          return Object.assign(
            Object.fromEntries(targets.map((t, i) => [`s${i}:output`, t])),
            ...children.map((c, i) =>
              Object.fromEntries(
                Object.entries(c.textureTaps?.() ?? {}).map(([k, v]) => [`s${i}:${k}`, v]),
              ),
            ),
          );
        },
        bufferTaps() {
          return Object.assign(
            {},
            ...children.map((c, i) =>
              Object.fromEntries(
                Object.entries(c.bufferTaps?.() ?? {}).map(([k, v]) => [`s${i}:${k}`, v]),
              ),
            ),
          );
        },
        memory() {
          const totals = children.reduce(
            (m, c) => {
              const n = c.memory?.() ?? { textureBytes: 0, bufferBytes: 0 };
              return {
                textureBytes: m.textureBytes + n.textureBytes,
                bufferBytes: m.bufferBytes + n.bufferBytes,
              };
            },
            { textureBytes: 0, bufferBytes: buffers.reduce((s, b) => s + b.size, 0) },
          );
          totals.textureBytes += targets.reduce((s, t) => s + t.width * t.height * 8, 0);
          return disposed ? { textureBytes: 0, bufferBytes: 0 } : totals;
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          free();
        },
      };
    },
  });
}
