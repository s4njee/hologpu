import type { DeviceSession } from './device.ts';
import type {
  EffectContext,
  EffectDefinition,
  EffectMemory,
  FrameInfo,
  FragmentOptions,
  TextureTap,
  BufferTap,
} from './effect.ts';
import { defineEffect } from './effect.ts';
import type { ParamSchema } from './params.ts';
import type { ComposedWGSL } from './wgsl/composer.ts';
import type { ShaderDiagnostic } from './debug.ts';
import { simulationUniformLayout } from './compute.ts';

/** Uncompressed formats intended for state; memory accounting never guesses unknown formats. */
export function textureTexelBytes(format: GPUTextureFormat): number {
  switch (format) {
    case 'r8unorm':
    case 'r8snorm':
    case 'r8uint':
    case 'r8sint':
      return 1;
    case 'r16float':
    case 'r16uint':
    case 'r16sint':
    case 'rg8unorm':
    case 'rg8snorm':
    case 'rg8uint':
    case 'rg8sint':
      return 2;
    case 'r32float':
    case 'r32uint':
    case 'r32sint':
    case 'rg16float':
    case 'rg16uint':
    case 'rg16sint':
    case 'rgba8unorm':
    case 'rgba8unorm-srgb':
    case 'rgba8snorm':
    case 'rgba8uint':
    case 'rgba8sint':
    case 'bgra8unorm':
    case 'bgra8unorm-srgb':
    case 'rgb10a2unorm':
    case 'rgb10a2uint':
    case 'rg11b10ufloat':
      return 4;
    case 'rg32float':
    case 'rg32uint':
    case 'rg32sint':
    case 'rgba16float':
    case 'rgba16uint':
    case 'rgba16sint':
      return 8;
    case 'rgba32float':
    case 'rgba32uint':
    case 'rgba32sint':
      return 16;
    default:
      throw new RangeError(`State texture format has no uncompressed byte accounting: ${format}`);
  }
}
export interface PingPongTargets {
  readonly read: GPUTexture;
  readonly write: GPUTexture;
  readonly size: readonly [number, number];
  readonly format: GPUTextureFormat;
  readonly bytes: number;
  swap(): void;
  /** Returns whether allocations changed. New targets require initialization of both sides. */
  resize(size: readonly [number, number]): boolean;
  dispose(): void;
}
export function createPingPongTargets(
  session: DeviceSession,
  options: {
    label: string;
    format: GPUTextureFormat;
    size: readonly [number, number];
    usage?: GPUTextureUsageFlags;
  },
): PingPongTargets {
  const device = session.device;
  const texelBytes = textureTexelBytes(options.format);
  const usage =
    options.usage ??
    GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.COPY_DST;
  let size: readonly [number, number] = [0, 0];
  let pair: GPUTexture[] = [];
  let side = 0;
  let disposed = false;
  function resize(next: readonly [number, number]) {
    if (disposed) throw new Error('Ping-pong targets are disposed');
    if (
      !next.every((n) => Number.isInteger(n) && n > 0 && n <= device.limits.maxTextureDimension2D)
    )
      throw new RangeError('State texture dimensions exceed device limits');
    if (next[0] === size[0] && next[1] === size[1]) return false;
    const created: GPUTexture[] = [];
    try {
      for (let index = 0; index < 2; index++)
        created.push(
          device.createTexture({
            label: `${options.label}-${index}`,
            format: options.format,
            size: [next[0], next[1]],
            usage,
          }),
        );
    } catch (error) {
      created.forEach((texture) => texture.destroy());
      throw error;
    }
    pair.forEach((texture) => texture.destroy());
    pair = created;
    size = [next[0], next[1]];
    side = 0;
    return true;
  }
  resize(options.size);
  return {
    get read() {
      if (disposed) throw new Error('Ping-pong targets are disposed');
      return pair[side]!;
    },
    get write() {
      if (disposed) throw new Error('Ping-pong targets are disposed');
      return pair[1 - side]!;
    },
    get size() {
      return size;
    },
    format: options.format,
    get bytes() {
      return disposed ? 0 : size[0] * size[1] * texelBytes * 2;
    },
    swap() {
      if (disposed) throw new Error('Ping-pong targets are disposed');
      side = 1 - side;
    },
    resize,
    dispose() {
      if (disposed) return;
      disposed = true;
      pair.forEach((texture) => texture.destroy());
      pair = [];
    },
  };
}
/** Same 64-byte Frame layout used by the runtime, with f32 and u32 fields kept distinct. */
export function packFrame(frame: FrameInfo): ArrayBuffer {
  const bytes = new ArrayBuffer(64);
  const floats = new Float32Array(bytes);
  const ints = new Uint32Array(bytes);
  floats.set([
    ...frame.resolution,
    frame.dpr,
    frame.time,
    ...frame.pointer,
    ...frame.velocity,
    frame.delta,
  ]);
  ints[9] = frame.index;
  ints[10] = frame.buttons;
  ints[11] = frame.seed;
  floats.set([frame.scroll, frame.visibility, frame.pressure, 0], 12);
  return bytes;
}
export function cloneFrame(frame: FrameInfo): FrameInfo {
  return {
    ...frame,
    resolution: [...frame.resolution],
    pointer: [...frame.pointer],
    velocity: [...frame.velocity],
  };
}
interface UniformSlot {
  frame: GPUBuffer;
  params: GPUBuffer;
  group: GPUBindGroup;
}
/**
 * Nonaliasing uniforms within a command buffer. Slot reuse begins on a new encoder:
 * callers must submit the old encoder before beginning another (DeviceSession does).
 * Queue writes to reused slots consequently follow the prior submission in queue order.
 */
export class UniformSnapshots {
  readonly #device: GPUDevice;
  readonly #layout: GPUBindGroupLayout;
  readonly #paramBytes: number;
  readonly #label: string;
  readonly #slots: UniformSlot[] = [];
  #encoder: GPUCommandEncoder | null = null;
  #cursor = 0;
  #disposed = false;
  constructor(device: GPUDevice, paramBytes: number, label = 'hgpu-snapshot') {
    if (!Number.isInteger(paramBytes) || paramBytes < 16 || paramBytes % 16 !== 0)
      throw new RangeError('Snapshot parameter storage must be 16-byte aligned');
    this.#device = device;
    this.#layout = simulationUniformLayout(device);
    this.#paramBytes = paramBytes;
    this.#label = label;
  }
  group(encoder: GPUCommandEncoder, frame: FrameInfo, params: ArrayBuffer): GPUBindGroup {
    if (this.#disposed) throw new Error('Uniform snapshots are disposed');
    if (params.byteLength !== this.#paramBytes)
      throw new RangeError('Snapshot parameter byte length mismatch');
    if (encoder !== this.#encoder) {
      this.#encoder = encoder;
      this.#cursor = 0;
    }
    const index = this.#cursor;
    let slot = this.#slots[index];
    if (!slot) {
      const create = (name: string, size: number) =>
        this.#device.createBuffer({
          label: `${this.#label}-${index}-${name}`,
          size,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
      const frameBuffer = create('frame', 64);
      let paramsBuffer: GPUBuffer | undefined;
      try {
        paramsBuffer = create('params', this.#paramBytes);
        slot = {
          frame: frameBuffer,
          params: paramsBuffer,
          group: this.#device.createBindGroup({
            label: `${this.#label}-${index}`,
            layout: this.#layout,
            entries: [
              { binding: 0, resource: { buffer: frameBuffer } },
              { binding: 1, resource: { buffer: paramsBuffer } },
            ],
          }),
        };
        this.#slots.push(slot);
      } catch (error) {
        frameBuffer.destroy();
        paramsBuffer?.destroy();
        throw error;
      }
    }
    this.#device.queue.writeBuffer(slot.frame, 0, packFrame(frame));
    this.#device.queue.writeBuffer(slot.params, 0, params);
    this.#cursor++;
    return slot.group;
  }
  get bytes() {
    return this.#slots.length * (64 + this.#paramBytes);
  }
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#slots.forEach((slot) => {
      slot.frame.destroy();
      slot.params.destroy();
    });
    this.#slots.length = 0;
    this.#encoder = null;
  }
}
export interface FeedbackProgram {
  /** Optional borrowed input; caller retains ownership. */
  setInput?(name: string, value: unknown): void | Promise<void>;
  /** Return false when the internal grid is unchanged, preserving the simulation. */
  resize(size: readonly [number, number]): boolean | void;
  /** Deterministically initializes every state side and clears custom counters/buffers. */
  initialize(encoder: GPUCommandEncoder, frame: FrameInfo, uniforms: GPUBindGroup): void;
  /** Parameter bytes are the same immutable snapshot bound to this step's group zero. */
  step(
    encoder: GPUCommandEncoder,
    frame: FrameInfo,
    uniforms: GPUBindGroup,
    params: ArrayBuffer,
  ): void;
  display(
    encoder: GPUCommandEncoder,
    target: GPUTextureView,
    frame: FrameInfo,
    uniforms: GPUBindGroup,
  ): void;
  dispose(): void;
  readonly sources?: Readonly<Record<string, ComposedWGSL>>;
  readonly diagnostics?: readonly ShaderDiagnostic[];
  textureTaps?(): Readonly<Record<string, TextureTap>>;
  bufferTaps?(): Readonly<Record<string, BufferTap>>;
  memory?(): EffectMemory;
}
export interface FeedbackOptions<S extends ParamSchema> extends Omit<
  FragmentOptions<S>,
  'wgsl' | 'chunks'
> {
  setup(ctx: EffectContext<S>): FeedbackProgram | Promise<FeedbackProgram>;
}
/** Stateful T2 contract: updates enqueue fixed steps; renders initialize, flush and display. */
export function feedbackEffect<const S extends ParamSchema>(
  options: FeedbackOptions<S>,
): EffectDefinition<S> {
  const { setup, ...metadata } = options;
  return defineEffect({
    ...metadata,
    tier: 'T2',
    family: options.family ?? 'feedback',
    core: options.core ?? false,
    tags: options.tags ?? [],
    features: options.features ?? [],
    inputs: options.inputs ?? [],
    presets: options.presets ?? {},
    quality: options.quality ?? { resolutionScale: [0.25, 1] },
    reducedMotion: options.reducedMotion ?? { time: 0 },
    fallback: options.fallback ?? 'linear-gradient(135deg,#122b35,#506762)',
    async create(ctx) {
      const program = await setup(ctx);
      let snapshots: UniformSnapshots;
      try {
        snapshots = new UniformSnapshots(
          ctx.device,
          ctx.params.layout.byteLength,
          `hgpu-${options.id}-snapshot`,
        );
      } catch (error) {
        program.dispose();
        throw error;
      }
      let pending: { frame: FrameInfo; params: ArrayBuffer }[] = [];
      let initial = true;
      let seed = 7;
      let disposed = false;
      return {
        ...(program.setInput
          ? {
              setInput: (name: string, value: unknown) => {
                if (disposed) throw new Error('Feedback effect is disposed');
                return program.setInput!(name, value);
              },
            }
          : {}),
        resize(size) {
          if (disposed) return;
          if (program.resize(size) !== false) {
            pending = [];
            initial = true;
          }
        },
        reset(nextSeed) {
          if (disposed) return;
          seed = nextSeed >>> 0;
          pending = [];
          initial = true;
        },
        update(frame) {
          if (disposed) return;
          pending.push({ frame: cloneFrame(frame), params: ctx.params.pack().slice(0) });
        },
        render(frame, encoder, target) {
          if (disposed) return;
          if (initial) {
            const first = { ...cloneFrame(frame), time: 0, delta: 0, index: 0, seed };
            program.initialize(encoder, first, snapshots.group(encoder, first, ctx.params.pack()));
            initial = false;
          }
          for (const update of pending)
            program.step(
              encoder,
              update.frame,
              snapshots.group(encoder, update.frame, update.params),
              update.params,
            );
          pending = [];
          program.display(
            encoder,
            target,
            frame,
            snapshots.group(encoder, frame, ctx.params.pack()),
          );
        },
        get sources() {
          return program.sources ?? {};
        },
        get diagnostics() {
          return program.diagnostics ?? [];
        },
        textureTaps: () => program.textureTaps?.() ?? {},
        bufferTaps: () => program.bufferTaps?.() ?? {},
        memory() {
          if (disposed) return { textureBytes: 0, bufferBytes: 0 };
          const memory = program.memory?.() ?? { textureBytes: 0, bufferBytes: 0 };
          return {
            textureBytes: memory.textureBytes,
            bufferBytes: memory.bufferBytes + snapshots.bytes,
          };
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          pending = [];
          program.dispose();
          snapshots.dispose();
        },
      };
    },
  });
}
