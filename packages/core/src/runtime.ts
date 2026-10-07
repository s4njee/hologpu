import { acquireDevice } from './device.ts';
import type { DeviceSession } from './device.ts';
import { ParamStore } from './params.ts';
import type { ParamSchema, ParamValues, ValuesOf } from './params.ts';
import type { EffectDefinition, EffectInstance, FrameInfo } from './effect.ts';
import type { ScheduledSurface } from './scheduler.ts';
import { Surface } from './surface.ts';
import { QualityController } from './quality.ts';
import { readTextureTap } from './texture-readback.ts';
import { createFullscreenPass, resolveSource } from './passes.ts';
export interface MountOptions {
  params?: ParamValues;
  preset?: string;
  seed?: number;
  playing?: boolean;
  resolutionScale?: number;
  dprCap?: number;
  reducedMotion?: boolean;
  timeScale?: number;
  adaptiveQuality?: boolean;
}
/** Owns instance resources; effect definitions own only pipelines and custom allocations. */
export class EffectField<S extends ParamSchema = ParamSchema> implements ScheduledSurface {
  readonly effect: EffectDefinition<S>;
  readonly canvas: HTMLCanvasElement;
  readonly session: DeviceSession;
  readonly store: ParamStore<S>;
  readonly params: ValuesOf<S>;
  surface: Surface | null = null;
  instance: EffectInstance | null = null;
  visible = true;
  playing: boolean;
  dirty = true;
  timeScale = 1;
  adaptiveQuality = false;
  quality: QualityController;
  #rateAccumulator = 0;
  #qualityPending = false;
  state: 'building' | 'ready' | 'lost' | 'error' | 'disposed' = 'building';
  frame: FrameInfo = {
    time: 0,
    delta: 0,
    index: 0,
    resolution: [1, 1],
    dpr: 1,
    pointer: [0, 0],
    velocity: [0, 0],
    buttons: 0,
    pressure: 0,
    scroll: 0,
    visibility: 1,
    seed: 7,
  };
  #frameBuffer: GPUBuffer | null = null;
  #paramsBuffer: GPUBuffer | null = null;
  readonly #releaseDevice: () => void;
  #removeScheduled: () => void = () => {};
  #removeState: () => void = () => {};
  #removeParams: () => void = () => {};
  #intersection: IntersectionObserver | null = null;
  readonly #motion: MediaQueryList;
  #disposed = false;
  #generation = 0;
  #wasPlaying: boolean;
  #motionOverride: boolean | undefined;
  #lastPointer: readonly [number, number] = [0, 0];
  #lastPointerTime = 0;
  #listeners = new Set<(field: EffectField<S>) => void>();
  private constructor(
    canvas: HTMLCanvasElement,
    effect: EffectDefinition<S>,
    session: DeviceSession,
    release: () => void,
    options: MountOptions,
  ) {
    this.canvas = canvas;
    this.quality = new QualityController(
      options.resolutionScale ?? 1,
      effect.quality.resolutionScale[0],
    );
    this.adaptiveQuality = options.adaptiveQuality ?? false;
    this.setTimeScale(options.timeScale ?? 1);
    this.effect = effect;
    this.session = session;
    this.#releaseDevice = release;
    this.store = new ParamStore(effect.params, {
      ...effect.presets[options.preset ?? ''],
      ...options.params,
    });
    this.params = this.store.values;
    this.frame.seed = (options.seed ?? 7) >>> 0;
    this.playing = options.playing ?? true;
    this.#wasPlaying = this.playing;
    this.#motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.#motionOverride = options.reducedMotion;
    this.#removeParams = this.store.onChange((name) => {
      if (this.effect.params[name]?.uniform === false) this.instance?.resize(this.frame.resolution);
      this.invalidate();
    });
  }
  static async create<S extends ParamSchema>(
    canvas: HTMLCanvasElement,
    effect: EffectDefinition<S>,
    options: MountOptions = {},
  ) {
    const scale = options.resolutionScale ?? 1,
      cap = options.dprCap ?? 2;
    if (
      !Number.isFinite(scale) ||
      scale < effect.quality.resolutionScale[0] ||
      scale > effect.quality.resolutionScale[1]
    )
      throw new RangeError('Resolution scale outside effect quality range');
    if (!Number.isFinite(cap) || cap <= 0 || cap > 2)
      throw new RangeError('DPR cap must be in (0, 2]');
    const { session, release } = await acquireDevice(effect.features);
    let field: EffectField<S> | undefined;
    try {
      field = new EffectField(canvas, effect, session, release, options);
      await field.#initialize(options);
      field.#removeState = session.onState(async (event) => {
        if (field!.#disposed) return;
        if (event === 'lost') {
          field!.state = 'lost';
          field!.instance?.dispose();
          field!.instance = null;
          field!.surface?.destroyTarget();
          field!.#frameBuffer?.destroy();
          field!.#paramsBuffer?.destroy();
          field!.notify();
        } else if (event === 'ready') {
          await field!.#restore();
          field!.invalidate();
        } else {
          field!.state = 'error';
          field!.pause();
          field!.notify();
        }
      });
      field.#removeScheduled = session.scheduler.add(field);
      field.#intersection = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (!entry) return;
          field!.visible = entry.isIntersecting;
          field!.frame.visibility = entry.intersectionRatio;
          field!.invalidate();
        },
        { rootMargin: '64px' },
      );
      field.#intersection.observe(canvas);
      field.#motion.addEventListener('change', field.#motionChanged);
      document.addEventListener('visibilitychange', field.#visibilityChanged);
      canvas.addEventListener('pointermove', field.#pointer);
      canvas.addEventListener('pointerdown', field.#pointer);
      canvas.addEventListener('pointerup', field.#pointer);
      canvas.addEventListener('pointerleave', field.#leave);
      canvas.addEventListener('pointercancel', field.#cancelPointer);
      canvas.addEventListener('lostpointercapture', field.#cancelPointer);
      return field;
    } catch (error) {
      if (field) field.destroy();
      else release();
      throw error;
    }
  }
  async #initialize(options: MountOptions) {
    this.surface = await Surface.create(
      this.canvas,
      this.session,
      () => {
        this.frame.resolution = this.surface?.size ?? [this.canvas.width, this.canvas.height];
        this.instance?.resize(this.frame.resolution);
        this.invalidate();
      },
      options.resolutionScale ?? 1,
      options.dprCap ?? 2,
    );
    await this.#restore(false);
  }
  async #restore(restoreSurface = true) {
    const generation = ++this.#generation;
    if (restoreSurface) await this.surface!.restore();
    if (this.#disposed) return;
    const device = this.session.device;
    this.#frameBuffer = device.createBuffer({
      label: `hgpu-${this.effect.id}-frame`,
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.#paramsBuffer = device.createBuffer({
      label: `hgpu-${this.effect.id}-params`,
      size: this.store.layout.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const instance = await this.effect.create({
      session: this.session,
      device,
      params: this.store,
      paramsBuffer: this.#paramsBuffer,
      frameBuffer: this.#frameBuffer,
      format: 'rgba16float',
      qualitySteps: () => (this.adaptiveQuality ? this.quality.state.stepScale : 1),
    });
    if (this.#disposed || generation !== this.#generation) {
      instance.dispose();
      return;
    }
    this.instance = instance;
    this.frame.resolution = this.surface!.size;
    this.instance.resize(this.frame.resolution);
    this.instance.reset(this.frame.seed);
    device.queue.writeBuffer(this.#paramsBuffer, 0, this.store.pack());
    this.#applyMotion();
    this.state = 'ready';
    this.invalidate();
    this.notify();
  }
  onChange(listener: (field: EffectField<S>) => void) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
  notify() {
    for (const listener of this.#listeners) listener(this);
  }
  invalidate() {
    if (this.#disposed) return;
    this.dirty = true;
    this.session.scheduler.invalidate();
  }
  update(frame: import('./scheduler.ts').Tick) {
    this.#rateAccumulator += frame.delta * this.timeScale;
    while (this.#rateAccumulator + 1e-10 >= 1 / 60) {
      this.#simulationStep();
      this.#rateAccumulator -= 1 / 60;
    }
  }
  #simulationStep() {
    this.frame.delta = 1 / 60;
    this.frame.time += 1 / 60;
    this.frame.index++;
    this.instance?.update(this.frame);
  }
  /** Explicit fixed-step replay, independent of rAF/time scale; fix quality for repeatable work. */
  advance(steps = 1) {
    if (!Number.isInteger(steps) || steps < 0 || steps > 4096)
      throw new RangeError('Steps must be an integer in [0, 4096]');
    if (this.#disposed || this.state !== 'ready') throw new Error('Field is not ready');
    this.pause();
    for (let i = 0; i < steps; i++) if (!this.reducedMotion) this.#simulationStep();
    this.render();
    this.session.submit();
    this.dirty = false;
  }
  setTimeScale(scale: number) {
    if (!Number.isFinite(scale) || scale < 0.25 || scale > 2)
      throw new RangeError('Time scale must be in [0.25, 2]');
    this.timeScale = scale;
    this.#rateAccumulator = 0;
  }
  setAdaptiveQuality(enabled: boolean) {
    const ceiling = this.quality.maxResolution;
    this.adaptiveQuality = enabled;
    this.quality = new QualityController(ceiling, this.effect.quality.resolutionScale[0]);
    if (!enabled && this.surface && this.surface.resolutionScale !== ceiling) {
      this.surface.resolutionScale = ceiling;
      this.surface.resize();
    }
    this.invalidate();
  }
  frameCompleted(stats: { cpuMs: number; intervalMs: number }) {
    if (!this.adaptiveQuality || !this.playing || this.#qualityPending || this.state !== 'ready')
      return;
    this.#qualityPending = true;
    const start = performance.now(),
      instance = this.instance;
    void this.session.device.queue
      .onSubmittedWorkDone()
      .then(() => {
        if (
          this.#disposed ||
          !this.adaptiveQuality ||
          this.instance !== instance ||
          this.state !== 'ready'
        )
          return;
        const change = this.quality.observe(stats.cpuMs + performance.now() - start);
        if (change && this.surface && this.surface.resolutionScale !== change.resolutionScale) {
          this.surface.resolutionScale = change.resolutionScale;
          this.surface.resize();
          this.invalidate();
        }
      })
      .catch(() => {})
      .finally(() => {
        this.#qualityPending = false;
      });
  }
  get textureTaps() {
    return this.instance?.textureTaps?.() ?? {};
  }
  get bufferTaps() {
    return this.instance?.bufferTaps?.() ?? {};
  }
  async readTap(name: string) {
    if (this.#disposed || this.state !== 'ready') throw new Error('Field is not ready');
    if (this.dirty) {
      this.render();
      this.dirty = false;
    }
    this.session.submit();
    const tap = this.textureTaps[name];
    if (!tap) throw new Error(`Unknown texture tap: ${name}`);
    return readTextureTap(this.session.device, tap);
  }
  render() {
    if (this.#disposed || this.state !== 'ready' || !this.surface?.target || !this.instance) return;
    this.surface.ensureDpr();
    this.frame.resolution = this.surface.size;
    this.frame.dpr = this.surface.dpr;
    const rect = this.canvas.getBoundingClientRect();
    this.frame.scroll = Math.min(
      1,
      Math.max(0, (innerHeight - rect.top) / (innerHeight + rect.height)),
    );
    this.#writeFrame();
    this.store.flush(this.session.device, this.#paramsBuffer!);
    const encoder = this.session.encoder();
    this.instance.render(this.frame, encoder, this.surface.target.createView());
    this.surface.present(encoder);
  }
  #writeFrame() {
    const bytes = new ArrayBuffer(64);
    const floats = new Float32Array(bytes);
    const ints = new Uint32Array(bytes);
    floats.set([
      ...this.frame.resolution,
      this.frame.dpr,
      this.frame.time,
      ...this.frame.pointer,
      ...this.frame.velocity,
      this.frame.delta,
    ]);
    ints[9] = this.frame.index;
    ints[10] = this.frame.buttons;
    ints[11] = this.frame.seed;
    floats.set([this.frame.scroll, this.frame.visibility, this.frame.pressure, 0], 12);
    this.session.device.queue.writeBuffer(this.#frameBuffer!, 0, bytes);
  }
  drawAt(time: number, seed = this.frame.seed) {
    this.pause();
    this.frame.time = Math.max(0, time);
    this.frame.index = Math.round(time * 60);
    this.frame.delta = 0;
    this.frame.seed = seed >>> 0;
    this.render();
    this.session.submit();
    this.dirty = false;
  }
  play() {
    this.#wasPlaying = true;
    if (!this.reducedMotion) {
      this.playing = true;
      this.invalidate();
    }
  }
  pause() {
    this.#wasPlaying = false;
    this.playing = false;
  }
  reset(seed = this.frame.seed) {
    this.frame.time = this.reducedMotion ? this.effect.reducedMotion.time : 0;
    this.frame.index = 0;
    this.#rateAccumulator = 0;
    this.frame.seed = seed >>> 0;
    this.instance?.reset(this.frame.seed);
    this.invalidate();
  }
  step() {
    this.pause();
    if (!this.reducedMotion) {
      this.#simulationStep();
    }
    this.invalidate();
  }
  setResolutionScale(scale: number) {
    if (!Number.isFinite(scale)) throw new TypeError('Finite resolution scale required');
    const [min, max] = this.effect.quality.resolutionScale;
    this.surface!.resolutionScale = Math.max(min, Math.min(max, scale));
    this.quality = new QualityController(this.surface!.resolutionScale, min);
    this.surface!.resize();
    this.invalidate();
  }
  get reducedMotion() {
    return this.#motionOverride ?? this.#motion.matches;
  }
  setReducedMotion(value: boolean | undefined) {
    this.#motionOverride = value;
    this.#applyMotion();
    this.invalidate();
  }
  #applyMotion() {
    if (this.reducedMotion) {
      this.playing = false;
      this.frame.time = this.effect.reducedMotion.time;
      this.frame.delta = 0;
      this.frame.index = 0;
      this.#rateAccumulator = 0;
      this.instance?.reset(this.frame.seed);
    } else this.playing = this.#wasPlaying;
  }
  #motionChanged = () => {
    this.#applyMotion();
    this.invalidate();
  };
  #visibilityChanged = () => this.session.scheduler.setHidden(document.hidden);
  #pointer = (event: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    const point: readonly [number, number] = [
      Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(rect.width, 1))),
      Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(rect.height, 1))),
    ];
    const dt = Math.max(0.001, (event.timeStamp - this.#lastPointerTime) / 1000);
    const intensity = this.#lastPointerTime === 0 ? 0 : this.reducedMotion ? 0.25 : 1;
    if (event.type === 'pointerdown') {
      try {
        this.canvas.setPointerCapture(event.pointerId);
      } catch {
        /* Synthetic events need no capture. */
      }
    }
    this.frame.velocity = [
      ((point[0] - this.#lastPointer[0]) / dt) * intensity,
      ((point[1] - this.#lastPointer[1]) / dt) * intensity,
    ];
    this.frame.pointer = point;
    this.frame.buttons = event.buttons;
    this.frame.pressure = event.pressure;
    this.#lastPointer = point;
    this.#lastPointerTime = event.timeStamp;
    this.invalidate();
  };
  #cancelPointer = () => {
    this.frame.velocity = [0, 0];
    this.frame.buttons = 0;
    this.frame.pressure = 0;
    this.#lastPointerTime = 0;
    this.invalidate();
  };
  #leave = (event: PointerEvent) => {
    if (this.canvas.hasPointerCapture(event.pointerId)) return;
    this.frame.velocity = [0, 0];
    this.frame.buttons = 0;
    this.invalidate();
  };
  get sources() {
    return this.instance?.sources ?? {};
  }
  get diagnostics() {
    return this.instance?.diagnostics ?? [];
  }
  memory() {
    const owned = this.instance?.memory?.();
    return {
      textureBytes: (this.surface?.bytes ?? 0) + (owned?.textureBytes ?? 0),
      bufferBytes: this.#disposed
        ? 0
        : 64 + this.store.layout.byteLength + (owned?.bufferBytes ?? 0),
      shared: this.session.resources.stats(),
    };
  }
  async readPixels() {
    if (this.#disposed || !this.surface?.target) throw new Error('No rendered target');
    const device = this.session.device;
    const [width, height] = this.surface.size;
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const pass = await createFullscreenPass(
      this.session,
      resolveSource,
      'rgba8unorm',
      'hgpu-readback',
    );
    const texture = device.createTexture({
      label: 'hgpu-readback',
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const buffer = device.createBuffer({
      label: 'hgpu-readback-staging',
      size: bytesPerRow * height,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    try {
      const group = device.createBindGroup({
        layout: pass.pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: this.surface.target.createView() }],
      });
      const encoder = device.createCommandEncoder();
      pass.draw(encoder, texture.createView(), [group]);
      encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [width, height]);
      device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const mapped = new Uint8Array(buffer.getMappedRange());
      const pixels = new Uint8Array(width * height * 4);
      for (let row = 0; row < height; row++)
        pixels.set(
          mapped.subarray(row * bytesPerRow, row * bytesPerRow + width * 4),
          row * width * 4,
        );
      return { width, height, pixels };
    } finally {
      buffer.destroy();
      texture.destroy();
      pass.dispose();
    }
  }
  destroy() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#generation++;
    this.state = 'disposed';
    this.#removeScheduled();
    this.#removeState();
    this.#removeParams();
    this.#intersection?.disconnect();
    this.#motion.removeEventListener('change', this.#motionChanged);
    document.removeEventListener('visibilitychange', this.#visibilityChanged);
    for (const name of ['pointermove', 'pointerdown', 'pointerup'] as const)
      this.canvas.removeEventListener(name, this.#pointer);
    this.canvas.removeEventListener('pointerleave', this.#leave);
    this.canvas.removeEventListener('pointercancel', this.#cancelPointer);
    this.canvas.removeEventListener('lostpointercapture', this.#cancelPointer);
    this.instance?.dispose();
    this.instance = null;
    this.surface?.dispose();
    this.surface = null;
    this.#frameBuffer?.destroy();
    this.#paramsBuffer?.destroy();
    this.#listeners.clear();
    this.#releaseDevice();
  }
}
export function createEffect<S extends ParamSchema>(
  canvas: HTMLCanvasElement,
  effect: EffectDefinition<S>,
  options: MountOptions = {},
) {
  return EffectField.create(canvas, effect, options);
}
