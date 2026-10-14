import { Resources, TexturePool } from './resources.ts';
import { Scheduler } from './scheduler.ts';
import { GPUProfiler } from './profiler.ts';
import type { ComposedWGSL } from './wgsl/composer.ts';
export interface Capabilities {
  features: readonly string[];
  enabledFeatures: readonly string[];
  limits: Record<string, number>;
  adapter: {
    vendor: string;
    architecture: string;
    device: string;
    description: string;
    isFallbackAdapter: boolean;
  };
  preferredFormat: GPUTextureFormat;
}
export class WebGPUUnavailableError extends Error {
  constructor(message = 'WebGPU is unavailable. Use HTTPS or localhost with a supported GPU.') {
    super(message);
    this.name = 'WebGPUUnavailableError';
  }
}
export type DeviceEvent = 'lost' | 'ready' | 'error';
export class DeviceSession {
  readonly #gpu: GPU;
  readonly #listeners = new Set<(event: DeviceEvent, error?: Error) => void | Promise<void>>();
  readonly #requested = new Set<GPUFeatureName>();
  #device: GPUDevice | null = null;
  #adapter: GPUAdapter | null = null;
  #closed = false;
  #clients = 0;
  #encoder: GPUCommandEncoder | null = null;
  #validation = Promise.resolve();
  #pending: Promise<void>;
  resources = new Resources();
  pool: TexturePool | null = null;
  profiler!: GPUProfiler;
  readonly scheduler: Scheduler;
  readonly errors: string[] = [];
  generation = 0;
  state: 'building' | 'ready' | 'lost' | 'error' | 'closed' = 'building';
  constructor(gpu: GPU, features: readonly GPUFeatureName[]) {
    this.#gpu = gpu;
    features.forEach((f) => this.#requested.add(f));
    this.scheduler = new Scheduler(
      () => this.submit(),
      undefined,
      () => this.device.queue.onSubmittedWorkDone(),
      {
        pipelinedSubmissionLimit:
          typeof navigator !== 'undefined' && /Firefox\/\d/.test(navigator.userAgent) ? 8 : 1,
      },
    );
    this.onState((event) => {
      if (event === 'lost') this.scheduler.resetSubmission();
    });
    this.#pending = this.#initialize();
  }
  get device() {
    if (!this.#device || this.state !== 'ready') throw new Error('GPU device is not ready');
    return this.#device;
  }
  get ready() {
    return this.#pending;
  }
  get clients() {
    return this.#clients;
  }
  get capabilities(): Capabilities {
    const adapter = this.#adapter!;
    const info = adapter.info;
    const limits: Record<string, number> = {};
    // GPUSupportedLimits properties are prototype accessors, not enumerable own keys.
    for (const name of [
      'maxTextureDimension1D',
      'maxTextureDimension2D',
      'maxTextureDimension3D',
      'maxTextureArrayLayers',
      'maxBindGroups',
      'maxUniformBufferBindingSize',
      'maxStorageBufferBindingSize',
      'maxBufferSize',
      'minUniformBufferOffsetAlignment',
      'maxComputeWorkgroupSizeX',
      'maxComputeInvocationsPerWorkgroup',
      'maxColorAttachments',
    ])
      limits[name] = Number(Reflect.get(this.device.limits, name));
    return {
      features: [...adapter.features].sort(),
      enabledFeatures: [...this.device.features].sort(),
      limits,
      adapter: {
        vendor: info.vendor,
        architecture: info.architecture,
        device: info.device,
        description: info.description,
        isFallbackAdapter: info.isFallbackAdapter,
      },
      preferredFormat: this.#gpu.getPreferredCanvasFormat(),
    };
  }
  retain() {
    if (this.#closed) throw new Error('GPU session closed');
    this.#clients++;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      if (--this.#clients === 0) this.dispose();
    };
  }
  onState(listener: (event: DeviceEvent, error?: Error) => void | Promise<void>) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
  async require(features: readonly GPUFeatureName[]) {
    await this.#pending;
    for (const feature of features)
      if (!this.#adapter!.features.has(feature))
        throw new WebGPUUnavailableError(`Required GPU feature missing: ${feature}`);
    if (features.every((f) => this.#requested.has(f))) return;
    features.forEach((f) => this.#requested.add(f));
    this.#pending = this.#pending.then(() => this.#rebuild());
    await this.#pending;
  }
  encoder(): GPUCommandEncoder {
    return (this.#encoder ??= this.device.createCommandEncoder({ label: 'hgpu-frame' }));
  }
  submit() {
    if (!this.#encoder) return;
    const encoder = this.#encoder;
    this.#encoder = null;
    this.submitEncoder(encoder);
  }
  submitEncoder(encoder: GPUCommandEncoder) {
    const read = this.profiler.resolve(encoder);
    this.device.queue.submit([encoder.finish()]);
    read?.();
  }
  /** Instance-local editing uses a bound session proxy to substitute composed sources. */
  shaderSource(_label: string, source: ComposedWGSL): ComposedWGSL {
    return source;
  }
  async validate<T>(create: () => Promise<T>): Promise<T> {
    let result!: T;
    const run = this.#validation.then(async () => {
      const device = this.device;
      device.pushErrorScope('validation');
      let failed = false;
      try {
        result = await create();
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        const error = await device.popErrorScope();
        if (error && !failed) throw new Error(error.message);
      }
    });
    this.#validation = run.then(
      () => {},
      () => {},
    );
    await run;
    return result;
  }
  async #initialize() {
    const adapter = await this.#gpu.requestAdapter();
    if (!adapter) throw new WebGPUUnavailableError('No WebGPU adapter available');
    for (const feature of this.#requested)
      if (!adapter.features.has(feature))
        throw new WebGPUUnavailableError(`Required GPU feature missing: ${feature}`);
    const device = await adapter.requestDevice({
      label: 'hgpu-shared-device',
      requiredFeatures: [
        ...new Set([
          ...this.#requested,
          ...(adapter.features.has('timestamp-query') ? ['timestamp-query' as const] : []),
        ]),
      ],
    });
    if (this.#closed) {
      device.destroy();
      return;
    }
    this.#adapter = adapter;
    this.#device = device;
    this.pool = new TexturePool(device);
    this.profiler = new GPUProfiler(device);
    this.generation++;
    this.state = 'ready';
    device.addEventListener('uncapturederror', this.#error);
    void device.lost.then(async (info) => {
      if (this.#closed || this.#device !== device) return;
      this.state = 'lost';
      this.scheduler.setHidden(true);
      this.#encoder = null;
      for (const listener of this.#listeners) await listener('lost', new Error(info.message));
      // Recovery scheduling is shared; DOM lifecycle recovery is completed in M5.
      this.#pending = this.#rebuild();
      void this.#pending.catch(() => {});
    });
  }
  async #rebuild() {
    if (this.#closed) return;
    this.scheduler.setHidden(true);
    this.state = 'building';
    this.#encoder = null;
    for (const listener of this.#listeners) await listener('lost');
    const previous = this.#device;
    this.#device = null;
    previous?.removeEventListener('uncapturederror', this.#error);
    previous?.destroy();
    this.resources.dispose();
    this.resources = new Resources();
    this.pool?.dispose();
    this.profiler?.dispose();
    try {
      await this.#initialize();
      if (this.#closed) return;
      for (const listener of this.#listeners) await listener('ready');
      this.scheduler.setHidden(typeof document !== 'undefined' && document.hidden);
    } catch (problem) {
      this.state = 'error';
      const error = problem instanceof Error ? problem : new Error(String(problem));
      this.errors.push(error.message);
      for (const listener of this.#listeners) await listener('error', error);
      throw error;
    }
  }
  #error = (event: GPUUncapturedErrorEvent) => {
    this.errors.push(event.error.message);
    for (const listener of this.#listeners) void listener('error', new Error(event.error.message));
  };
  dispose() {
    if (this.#closed) return;
    this.#closed = true;
    this.state = 'closed';
    this.scheduler.stop();
    this.#encoder = null;
    this.resources.dispose();
    this.pool?.dispose();
    this.profiler?.dispose();
    this.#device?.removeEventListener('uncapturederror', this.#error);
    this.#device?.destroy();
    this.#device = null;
    this.#listeners.clear();
    sessions.delete(this.#gpu);
  }
}
const sessions = new WeakMap<GPU, DeviceSession>();
export async function acquireDevice(
  features: readonly GPUFeatureName[] = [],
  gpu: GPU | undefined = globalThis.navigator?.gpu,
) {
  if (!gpu) throw new WebGPUUnavailableError();
  let session = sessions.get(gpu);
  if (!session) {
    session = new DeviceSession(gpu, features);
    sessions.set(gpu, session);
  }
  const release = session.retain();
  try {
    await session.require(features);
    return { session, release };
  } catch (error) {
    release();
    throw error;
  }
}
