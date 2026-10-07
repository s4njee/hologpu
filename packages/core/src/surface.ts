import { backingSize } from './measure.ts';
import { createFullscreenPass, resolveSource } from './passes.ts';
import type { FullscreenPass } from './passes.ts';
import type { DeviceSession } from './device.ts';
const owners = new WeakMap<HTMLCanvasElement, Surface>();
export class Surface {
  readonly canvas: HTMLCanvasElement;
  readonly session: DeviceSession;
  readonly context: GPUCanvasContext | null;
  target: GPUTexture | null = null;
  #resolve: FullscreenPass | null = null;
  #resolveGeneration = -1;
  #group: GPUBindGroup | null = null;
  #observer: ResizeObserver;
  #disposed = false;
  #dpr = 0;
  #physical: { width: number; height: number } | undefined;
  #cssWidth = 1;
  #cssHeight = 1;
  resolutionScale: number;
  dprCap: number;
  readonly onResize: () => void;
  private constructor(
    canvas: HTMLCanvasElement,
    session: DeviceSession,
    onResize: () => void,
    scale: number,
    dprCap: number,
    present: boolean,
  ) {
    this.canvas = canvas;
    this.session = session;
    this.onResize = onResize;
    this.resolutionScale = scale;
    this.dprCap = dprCap;
    const context = present ? canvas.getContext('webgpu') : null;
    if (present && !context) throw new Error('Canvas WebGPU context unavailable');
    this.context = context;
    owners.set(canvas, this);
    this.#observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || this.#disposed) return;
      this.#cssWidth = entry.contentRect.width;
      this.#cssHeight = entry.contentRect.height;
      const box = entry.devicePixelContentBoxSize?.[0];
      this.#physical = box ? { width: box.inlineSize, height: box.blockSize } : undefined;
      this.resize();
    });
    const rect = canvas.getBoundingClientRect();
    this.#cssWidth = rect.width;
    this.#cssHeight = rect.height;
    try {
      this.#observer.observe(canvas, { box: 'device-pixel-content-box' });
    } catch {
      this.#observer.observe(canvas);
    }
  }
  static async create(
    canvas: HTMLCanvasElement,
    session: DeviceSession,
    onResize: () => void,
    scale = 1,
    dprCap = 2,
    present = true,
  ) {
    const surface = new Surface(canvas, session, onResize, scale, dprCap, present);
    try {
      await surface.restore();
      return surface;
    } catch (error) {
      surface.dispose();
      throw error;
    }
  }
  get size(): readonly [number, number] {
    return [this.canvas.width, this.canvas.height];
  }
  get dpr() {
    return Math.min(window.devicePixelRatio, this.dprCap) * this.resolutionScale;
  }
  get bytes() {
    return this.target ? this.canvas.width * this.canvas.height * 8 : 0;
  }
  async restore() {
    const device = this.session.device;
    const generation = this.session.generation;
    if (!this.context) {
      if (this.#disposed || owners.get(this.canvas) !== this) return;
      this.#resolveGeneration = generation;
      this.destroyTarget();
      this.resize();
      return;
    }
    const format = this.session.capabilities.preferredFormat;
    this.#resolve?.dispose();
    this.#resolve = null;
    const resolve = await createFullscreenPass(this.session, resolveSource, format, 'hgpu-resolve');
    if (this.#disposed) {
      resolve.dispose();
      return;
    }
    if (owners.get(this.canvas) !== this) {
      resolve.dispose();
      throw new Error('Surface was superseded');
    }
    if (
      this.session.state !== 'ready' ||
      this.session.generation !== generation ||
      this.session.device !== device
    ) {
      resolve.dispose();
      throw new Error('GPU device changed during surface restoration');
    }
    this.#resolve = resolve;
    this.#resolveGeneration = generation;
    this.context.configure({
      device,
      format,
      alphaMode: 'premultiplied',
      colorSpace: 'srgb',
    });
    this.target?.destroy();
    this.target = null;
    this.resize();
  }
  resize() {
    if (
      this.#disposed ||
      owners.get(this.canvas) !== this ||
      this.session.state !== 'ready' ||
      (this.context !== null && !this.#resolve) ||
      this.#resolveGeneration !== this.session.generation
    )
      return;
    this.#dpr = window.devicePixelRatio;
    const effectiveDpr = Math.min(this.#dpr, this.dprCap);
    const raw = backingSize(
      this.#cssWidth,
      this.#cssHeight,
      effectiveDpr,
      this.session.device.limits.maxTextureDimension2D,
      this.#dpr <= this.dprCap ? this.#physical : undefined,
    );
    const width = Math.max(1, Math.round(raw.width * this.resolutionScale));
    const height = Math.max(1, Math.round(raw.height * this.resolutionScale));
    if (this.target && this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.target?.destroy();
    this.target = this.session.device.createTexture({
      label: 'hgpu-surface-float',
      size: [width, height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.#group = this.#resolve
      ? this.session.device.createBindGroup({
          label: 'hgpu-resolve-texture',
          layout: this.#resolve.pipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: this.target.createView() }],
        })
      : null;
    this.onResize();
  }
  ensureDpr() {
    if (window.devicePixelRatio !== this.#dpr) {
      this.#physical = undefined;
      this.resize();
    }
  }
  present(encoder: GPUCommandEncoder) {
    if (
      this.#disposed ||
      !this.context ||
      owners.get(this.canvas) !== this ||
      this.#resolveGeneration !== this.session.generation
    )
      return;
    this.#resolve!.draw(encoder, this.context.getCurrentTexture().createView(), [this.#group!]);
  }
  destroyTarget() {
    this.target?.destroy();
    this.target = null;
    this.#group = null;
  }
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#observer.disconnect();
    if (owners.get(this.canvas) === this) {
      this.context?.unconfigure();
      owners.delete(this.canvas);
    }
    this.destroyTarget();
    this.#resolve?.dispose();
    this.#resolve = null;
  }
}
