import { backingSize, referenceColors, summarize } from './measure.ts';
import { computeShader, renderShader, resolveShader } from './shaders.ts';

export type TargetMode = 'float' | 'direct';
interface Surface {
  canvas: HTMLCanvasElement;
  context: GPUCanvasContext;
  uniform: GPUBuffer;
  group: GPUBindGroup;
  target: GPUTexture | null;
  resolveGroup: GPUBindGroup | null;
}
export interface SpikeOptions {
  mode?: TargetMode;
  seed?: number;
}

/** Isolated M0 harness: one device, one compute pass, N in-flow canvases, one submission. */
export class SpikeSession {
  readonly device: GPUDevice;
  readonly report: {
    userAgent: string;
    preferredFormat: GPUTextureFormat;
    features: string[];
    adapter: {
      vendor: string;
      architecture: string;
      device: string;
      description: string;
      isFallbackAdapter?: boolean;
    };
    limits: { maxTextureDimension2D: number; maxStorageBuffersPerShaderStage: number };
    mode: TargetMode;
  };
  readonly errors: string[] = [];
  readonly diagnostics: string[] = [];
  readonly #surfaces: Surface[] = [];
  readonly #clock: GPUBuffer;
  readonly #colors: GPUBuffer;
  readonly #compute: GPUComputePipeline;
  readonly #render: GPURenderPipeline;
  readonly #resolve: GPURenderPipeline;
  readonly #readbackResolve: GPURenderPipeline;
  readonly #computeGroup: GPUBindGroup;
  readonly #observer: ResizeObserver;
  readonly #mode: TargetMode;
  readonly #seed: number;
  #raf = 0;
  #step = 0;
  #disposed = false;
  #lastDpr = window.devicePixelRatio;

  static async create(canvases: HTMLCanvasElement[], options: SpikeOptions = {}) {
    if (!navigator.gpu)
      throw new Error('WebGPU unavailable. Use HTTPS or localhost and a supported browser.');
    if (canvases.length < 1 || canvases.length > 6)
      throw new Error('M0 expects one to six canvases.');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No WebGPU adapter available.');
    const device = await adapter.requestDevice({ label: 'hgpu-m0-shared-device' });
    try {
      return await this.#initialize(adapter, device, canvases, options);
    } catch (error) {
      device.destroy();
      throw error;
    }
  }

  static async #initialize(
    adapter: GPUAdapter,
    device: GPUDevice,
    canvases: HTMLCanvasElement[],
    options: SpikeOptions,
  ) {
    const format = navigator.gpu.getPreferredCanvasFormat();
    const diagnostics: string[] = [];
    async function module(label: string, code: string) {
      const result = device.createShaderModule({ label, code });
      const info = await result.getCompilationInfo();
      for (const message of info.messages)
        diagnostics.push(
          `${label}:${message.lineNum}:${message.linePos} ${message.type}: ${message.message}`,
        );
      if (info.messages.some((message) => message.type === 'error' || message.type === 'warning'))
        throw new Error(diagnostics.join('\n'));
      return result;
    }
    device.pushErrorScope('validation');
    let pipelines;
    try {
      const compute = await module('hgpu-m0-compute', computeShader);
      const render = await module('hgpu-m0-triangle', renderShader);
      const resolve = await module('hgpu-m0-resolve', resolveShader);
      async function renderPipeline(
        label: string,
        shader: GPUShaderModule,
        target: GPUTextureFormat,
      ) {
        return device.createRenderPipelineAsync({
          label,
          layout: 'auto',
          vertex: { module: shader, entryPoint: 'vertex' },
          fragment: { module: shader, entryPoint: 'fragment', targets: [{ format: target }] },
          primitive: { topology: 'triangle-list' },
        });
      }
      pipelines = {
        compute: await device.createComputePipelineAsync({
          label: 'hgpu-m0-compute',
          layout: 'auto',
          compute: { module: compute, entryPoint: 'compute' },
        }),
        render: await renderPipeline(
          'hgpu-m0-triangle',
          render,
          options.mode === 'direct' ? format : 'rgba16float',
        ),
        resolve: await renderPipeline('hgpu-m0-resolve', resolve, format),
        readbackResolve: await renderPipeline('hgpu-m0-readback', resolve, 'rgba8unorm'),
      };
    } finally {
      const error = await device.popErrorScope();
      if (error) throw new Error(error.message);
    }
    const session = new SpikeSession(adapter, device, format, canvases, options, pipelines);
    session.diagnostics.push(...diagnostics);
    try {
      session.render(0);
      await device.queue.onSubmittedWorkDone();
      if (session.errors.length) throw new Error(session.errors.join('\n'));
      return session;
    } catch (error) {
      session.dispose();
      throw error;
    }
  }

  private constructor(
    adapter: GPUAdapter,
    device: GPUDevice,
    format: GPUTextureFormat,
    canvases: HTMLCanvasElement[],
    options: SpikeOptions,
    pipelines: {
      compute: GPUComputePipeline;
      render: GPURenderPipeline;
      resolve: GPURenderPipeline;
      readbackResolve: GPURenderPipeline;
    },
  ) {
    this.device = device;
    this.#mode = options.mode ?? 'float';
    this.#seed = options.seed ?? 7;
    this.#compute = pipelines.compute;
    this.#render = pipelines.render;
    this.#resolve = pipelines.resolve;
    this.#readbackResolve = pipelines.readbackResolve;
    const info = adapter.info;
    this.report = {
      userAgent: navigator.userAgent,
      preferredFormat: format,
      features: [...adapter.features].sort(),
      adapter: {
        vendor: info.vendor,
        architecture: info.architecture,
        device: info.device,
        description: info.description,
        isFallbackAdapter: info.isFallbackAdapter,
      },
      limits: {
        maxTextureDimension2D: device.limits.maxTextureDimension2D,
        maxStorageBuffersPerShaderStage: device.limits.maxStorageBuffersPerShaderStage,
      },
      mode: this.#mode,
    };
    device.addEventListener('uncapturederror', this.#onError);
    void device.lost.then((info) => {
      if (!this.#disposed) {
        this.errors.push(`Device lost: ${info.reason}: ${info.message}`);
        this.stop();
      }
    });
    this.#clock = device.createBuffer({
      label: 'hgpu-m0-clock',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.#colors = device.createBuffer({
      label: 'hgpu-m0-colors',
      size: 96,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this.#computeGroup = device.createBindGroup({
      label: 'hgpu-m0-compute-group',
      layout: this.#compute.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.#colors } },
        { binding: 1, resource: { buffer: this.#clock } },
      ],
    });
    for (const canvas of canvases) {
      const context = canvas.getContext('webgpu');
      if (!context) throw new Error('Canvas WebGPU context unavailable.');
      context.configure({ device, format, alphaMode: 'premultiplied', colorSpace: 'srgb' });
      const uniform = device.createBuffer({
        label: 'hgpu-m0-surface',
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const group = device.createBindGroup({
        label: 'hgpu-m0-render-group',
        layout: this.#render.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.#colors } },
          { binding: 1, resource: { buffer: uniform } },
        ],
      });
      this.#surfaces.push({ canvas, context, uniform, group, target: null, resolveGroup: null });
    }
    this.#observer = new ResizeObserver((entries) => {
      if (this.#disposed) return;
      for (const entry of entries) {
        const surface = this.#surfaces.find((s) => s.canvas === entry.target)!;
        const box = entry.devicePixelContentBoxSize?.[0];
        this.#resize(
          surface,
          entry.contentRect.width,
          entry.contentRect.height,
          box ? { width: box.inlineSize, height: box.blockSize } : undefined,
        );
      }
      this.render(this.#step);
    });
    for (const surface of this.#surfaces) {
      const rect = surface.canvas.getBoundingClientRect();
      this.#resize(surface, rect.width, rect.height);
      try {
        this.#observer.observe(surface.canvas, { box: 'device-pixel-content-box' });
      } catch {
        this.#observer.observe(surface.canvas);
      }
    }
  }

  #onError = (event: GPUUncapturedErrorEvent) => {
    this.errors.push(event.error.message);
  };

  #resize(
    surface: Surface,
    width: number,
    height: number,
    physical?: { width: number; height: number },
  ) {
    const size = backingSize(
      width,
      height,
      window.devicePixelRatio,
      this.device.limits.maxTextureDimension2D,
      physical,
    );
    if (
      surface.canvas.width === size.width &&
      surface.canvas.height === size.height &&
      (surface.target || this.#mode === 'direct')
    )
      return;
    surface.canvas.width = size.width;
    surface.canvas.height = size.height;
    surface.target?.destroy();
    if (this.#mode === 'float') {
      surface.target = this.device.createTexture({
        label: 'hgpu-m0-float-target',
        size: [size.width, size.height],
        format: 'rgba16float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      surface.resolveGroup = this.device.createBindGroup({
        label: 'hgpu-m0-resolve-group',
        layout: this.#resolve.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: surface.target.createView() }],
      });
    }
    this.device.queue.writeBuffer(
      surface.uniform,
      0,
      new Uint32Array([this.#surfaces.indexOf(surface), size.width, size.height, 0]),
    );
  }

  #draw(
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    pipeline: GPURenderPipeline,
    group: GPUBindGroup,
  ) {
    const pass = encoder.beginRenderPass({
      label: 'hgpu-m0-fullscreen',
      colorAttachments: [{ view, clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();
  }

  render(step = this.#step): void {
    if (this.#disposed) return;
    this.#step = step >>> 0;
    if (window.devicePixelRatio !== this.#lastDpr) {
      this.#lastDpr = window.devicePixelRatio;
      for (const surface of this.#surfaces) {
        const rect = surface.canvas.getBoundingClientRect();
        this.#resize(surface, rect.width, rect.height);
      }
    }
    this.device.queue.writeBuffer(this.#clock, 0, new Uint32Array([this.#seed, this.#step, 0, 0]));
    const encoder = this.device.createCommandEncoder({ label: 'hgpu-m0-frame' });
    const compute = encoder.beginComputePass({ label: 'hgpu-m0-step' });
    compute.setPipeline(this.#compute);
    compute.setBindGroup(0, this.#computeGroup);
    compute.dispatchWorkgroups(1);
    compute.end();
    for (const surface of this.#surfaces) {
      this.#draw(
        encoder,
        surface.target?.createView() ?? surface.context.getCurrentTexture().createView(),
        this.#render,
        surface.group,
      );
      if (surface.target)
        this.#draw(
          encoder,
          surface.context.getCurrentTexture().createView(),
          this.#resolve,
          surface.resolveGroup!,
        );
    }
    this.device.queue.submit([encoder.finish()]);
  }

  start() {
    if (this.#raf || this.#disposed) return;
    const tick = () => {
      this.render(this.#step + 1);
      this.#raf = requestAnimationFrame(tick);
    };
    this.#raf = requestAnimationFrame(tick);
  }
  stop() {
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
  }

  get step() {
    return this.#step;
  }

  async verify() {
    this.stop();
    const fixedStep = 9;
    this.render(fixedStep);
    const colors = await this.readColors();
    const expected = referenceColors(this.#seed, fixedStep);
    const computeMatches = colors.every((value, index) => value === expected[index]);
    let pixelMaxError: number | null = null;
    let repeatable: boolean | null = null;
    let checkedPixels = 0;
    if (this.#mode === 'float') {
      const first = await this.readPixels();
      this.render(fixedStep);
      const second = await this.readPixels();
      repeatable = first.bytes.every((value, index) => value === second.bytes[index]);
      pixelMaxError = 0;
      checkedPixels = first.width * first.height;
      for (let y = 0; y < first.height; y++) {
        for (let x = 0; x < first.width; x++) {
          const alpha = x + 0.5 < first.width / 2 ? 0.5 : 1;
          for (let c = 0; c < 4; c++) {
            pixelMaxError = Math.max(
              pixelMaxError,
              Math.abs(
                first.bytes[(y * first.width + x) * 4 + c]! - Math.round(expected[c]! * alpha),
              ),
            );
          }
        }
      }
    }
    return {
      passed:
        computeMatches &&
        (repeatable ?? true) &&
        (pixelMaxError ?? 0) <= 1 &&
        this.errors.length === 0,
      computeMatches,
      repeatable,
      pixelMaxError,
      checkedPixels,
      dpr: devicePixelRatio,
      sizes: this.sizes(),
      errors: [...this.errors],
    };
  }

  sizes() {
    return this.#surfaces.map(({ canvas }) => ({
      width: canvas.width,
      height: canvas.height,
      cssWidth: canvas.getBoundingClientRect().width,
      cssHeight: canvas.getBoundingClientRect().height,
    }));
  }
  memory() {
    const pixels = this.#surfaces.reduce(
      (sum, { canvas }) => sum + canvas.width * canvas.height,
      0,
    );
    return {
      ownedBufferBytes: 112 + 16 * this.#surfaces.length,
      ownedTextureBytes: this.#mode === 'float' ? pixels * 8 : 0,
      canvasBytesPerImageEstimate: pixels * 4,
      note: 'Logical payload only. Canvas swapchain image count, driver padding, pipelines and browser allocations are unknown.',
    };
  }

  async readColors(): Promise<number[]> {
    const buffer = this.device.createBuffer({
      label: 'hgpu-m0-color-readback',
      size: 96,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    try {
      const encoder = this.device.createCommandEncoder();
      encoder.copyBufferToBuffer(this.#colors, 0, buffer, 0, 96);
      this.device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      return Array.from(new Float32Array(buffer.getMappedRange()), (value) =>
        Math.round(value * 255),
      );
    } finally {
      buffer.destroy();
    }
  }

  /** Resolves float pixels into RGBA8, then removes 256-byte row padding on the CPU. */
  async readPixels(index = 0): Promise<{ width: number; height: number; bytes: number[] }> {
    const surface = this.#surfaces[index];
    if (!surface?.target)
      throw new Error('Pixel readback requires float mode and a valid surface.');
    const { width, height } = surface.canvas;
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const texture = this.device.createTexture({
      label: 'hgpu-m0-pixel-readback',
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const buffer = this.device.createBuffer({
      label: 'hgpu-m0-pixel-staging',
      size: bytesPerRow * height,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    try {
      const group = this.device.createBindGroup({
        layout: this.#readbackResolve.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: surface.target.createView() }],
      });
      const encoder = this.device.createCommandEncoder();
      this.#draw(encoder, texture.createView(), this.#readbackResolve, group);
      encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [width, height]);
      this.device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const mapped = new Uint8Array(buffer.getMappedRange());
      const bytes = new Uint8Array(width * height * 4);
      for (let row = 0; row < height; row++)
        bytes.set(
          mapped.subarray(row * bytesPerRow, row * bytesPerRow + width * 4),
          row * width * 4,
        );
      return { width, height, bytes: Array.from(bytes) };
    } finally {
      buffer.destroy();
      texture.destroy();
    }
  }

  async benchmark(frames = 180, warmup = 30, scroll = false) {
    if (this.#disposed) throw new Error('Session disposed.');
    if (!Number.isInteger(frames) || frames < 1 || !Number.isInteger(warmup) || warmup < 1)
      throw new Error('Use positive integer frame and warm-up counts.');
    this.stop();
    const cpu: number[] = [];
    const intervals: number[] = [];
    let previous = 0;
    const initialScroll = window.scrollY;
    let maxScrollY = initialScroll;
    try {
      for (let i = 0; i < frames + warmup; i++) {
        const time = await new Promise<number>((resolve, reject) => {
          const handle = requestAnimationFrame((time) => {
            clearTimeout(timeout);
            resolve(time);
          });
          const timeout = setTimeout(() => {
            cancelAnimationFrame(handle);
            reject(new Error('No animation frames received. Keep the benchmark tab visible.'));
          }, 2000);
        });
        if (this.#disposed) throw new Error('Session disposed during benchmark.');
        if (scroll) {
          window.scrollTo(
            0,
            (0.5 - 0.5 * Math.cos(i / 20)) * (document.documentElement.scrollHeight - innerHeight),
          );
          maxScrollY = Math.max(maxScrollY, window.scrollY);
        }
        const start = performance.now();
        this.render(i);
        if (i >= warmup) {
          cpu.push(performance.now() - start);
          intervals.push(time - previous);
        }
        previous = time;
      }
      await this.device.queue.onSubmittedWorkDone();
    } finally {
      if (scroll) window.scrollTo(0, initialScroll);
    }
    return {
      date: new Date().toISOString(),
      frames,
      warmup,
      scroll,
      maxScrollY,
      report: this.report,
      dpr: devicePixelRatio,
      viewport: { width: innerWidth, height: innerHeight },
      sizes: this.sizes(),
      memory: this.memory(),
      cpuEncodeMs: summarize(cpu),
      rafIntervalMs: summarize(intervals),
      errors: [...this.errors],
      diagnostics: [...this.diagnostics],
    };
  }

  async probeCanvas() {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgpu')!;
    let configuration: GPUCanvasConfiguration | null = null;
    let thrown: string | null = null;
    this.device.pushErrorScope('validation');
    try {
      context.configure({
        device: this.device,
        format: 'rgba16float',
        alphaMode: 'premultiplied',
        colorSpace: 'display-p3',
        toneMapping: { mode: 'extended' },
      });
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: [2, 0, 0, 1],
          },
        ],
      });
      pass.end();
      this.device.queue.submit([encoder.finish()]);
      await this.device.queue.onSubmittedWorkDone();
      configuration = context.getConfiguration?.() ?? null;
    } catch (error) {
      thrown = String(error);
    }
    const validation = await this.device.popErrorScope();
    context.unconfigure();
    // Acceptance of a dictionary alone cannot prove that toneMapping was recognized.
    return {
      rgba16floatAccepted: !thrown && !validation,
      extendedConfigurationReported: configuration?.toneMapping?.mode === 'extended',
      displayP3Reported: configuration?.colorSpace === 'display-p3',
      hdrDisplayReported: matchMedia('(dynamic-range: high)').matches,
      error: thrown ?? validation?.message ?? null,
    };
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.stop();
    this.#observer.disconnect();
    for (const surface of this.#surfaces) {
      surface.context.unconfigure();
      surface.target?.destroy();
      surface.uniform.destroy();
    }
    this.#clock.destroy();
    this.#colors.destroy();
    this.device.removeEventListener('uncapturederror', this.#onError);
    this.device.destroy();
  }
}
