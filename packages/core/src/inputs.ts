import type { DeviceSession } from './device.ts';
import type { EffectMemory, FrameInfo, TextureTap } from './effect.ts';
import { createComputePass, type ComputePass } from './compute.ts';
import { createMipGenerator, type MipGenerator } from './primitives/mipgen.ts';
import { chunk, compose } from './wgsl/composer.ts';

export type ImageInput = { kind: 'image'; source: HTMLImageElement | ImageBitmap };
export type CanvasInput = { kind: 'canvas'; source: HTMLCanvasElement | OffscreenCanvas };
export type VideoInput = { kind: 'video'; source: HTMLVideoElement };
export type TextInput = {
  kind: 'text';
  text: string;
  width?: number;
  height?: number;
  font?: string;
};
/** Audio textures have FFT amplitude in row zero and signed waveform samples in row one. */
export type AudioInput = {
  kind: 'audio';
  analyser?: AnalyserNode;
  fft?: Float32Array;
  waveform?: Float32Array;
};
export type TextureInput = {
  kind: 'texture';
  source: TextureTap | (() => TextureTap | undefined);
  session?: DeviceSession;
  colourSpace?: 'linear' | 'srgb';
  premultiplied?: boolean;
};
export type DataInput = { kind: 'data'; data: Float32Array; width: number; height: number };
export type InputSource =
  ImageInput | CanvasInput | VideoInput | TextInput | AudioInput | TextureInput | DataInput;
/** Typed descriptor factory. Media creation and browser permission prompts stay with the caller. */
export function inputSource<T extends InputSource>(source: T): T {
  return source;
}
export function isInputSource(value: unknown): value is InputSource {
  return (
    !!value &&
    typeof value === 'object' &&
    'kind' in value &&
    ['image', 'canvas', 'video', 'text', 'audio', 'texture', 'data'].includes(String(value.kind))
  );
}
/** Convenience conversion for existing DOM-image callers; descriptors disambiguate text/audio/textures. */
export function normalizeInputSource(value: unknown): InputSource | null {
  if (value == null) return null;
  if (isInputSource(value)) return value;
  if (typeof value === 'string') return { kind: 'text', text: value };
  if (typeof HTMLVideoElement !== 'undefined' && value instanceof HTMLVideoElement)
    return { kind: 'video', source: value };
  if (
    (typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement) ||
    (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas)
  )
    return { kind: 'canvas', source: value as HTMLCanvasElement | OffscreenCanvas };
  if (
    (typeof HTMLImageElement !== 'undefined' && value instanceof HTMLImageElement) ||
    (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap)
  )
    return { kind: 'image', source: value as HTMLImageElement | ImageBitmap };
  throw new TypeError('Unsupported input source; use a typed inputSource descriptor');
}
export function inputMipCount(width: number, height: number): number {
  if (![width, height].every((n) => Number.isInteger(n) && n > 0))
    throw new RangeError('Input dimensions must be positive integers');
  return Math.floor(Math.log2(Math.max(width, height))) + 1;
}
export function inputTextureBytes(width: number, height: number): number {
  const levels = inputMipCount(width, height);
  let bytes = 0;
  for (let i = 0; i < levels; i++) bytes += Math.max(1, width >> i) * Math.max(1, height >> i) * 8;
  return bytes;
}
/** Reference transfer function used by the GPU normalizer. Alpha is multiplied after decoding. */
export function inputSRGBToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}
interface Entry {
  source: InputSource;
  image?: ImageBitmap | HTMLCanvasElement | OffscreenCanvas;
  output?: GPUTexture;
  upload?: GPUTexture;
  uniform: GPUBuffer;
  dirty: boolean;
  ready: boolean;
  cancelVideo?: () => void;
  cancelAudio?: () => void;
  scratch?: OffscreenCanvas;
}
const conversion = `fn linear(c:vec3f)->vec3f{return select(pow(max((c+vec3f(0.055))/1.055,vec3f(0)),vec3f(2.4)),c/12.92,c<=vec3f(0.04045));}
struct Options{srgb:u32,premultiplied:u32,pad:vec2u};
@group(0) @binding(1) var output:texture_storage_2d<rgba16float,write>;
@group(0) @binding(2) var<uniform> options:Options;
fn normalized(c:vec4f)->vec4f {var rgb=c.rgb;let a=clamp(c.a,0.0,1.0);if(options.premultiplied==1u){rgb=select(vec3f(0),rgb/max(a,1e-8),a>0.0);}if(options.srgb==1u){rgb=linear(rgb);}return vec4f(rgb*a,a);}`;

/** Per-field, owned linear-premultiplied mip chains. Caller media, tracks and borrowed textures are never disposed. */
export class InputManager {
  readonly #entries = new Map<string, Entry>();
  readonly #versions = new Map<string, number>();
  #normal?: ComputePass;
  #external?: ComputePass;
  #mips?: MipGenerator;
  #normalLayout?: GPUBindGroupLayout;
  #externalLayout?: GPUBindGroupLayout;
  #externalSampler?: GPUSampler;
  #building?: Promise<void>;
  #disposed = false;
  #epoch = 0;
  #softwareMedia = false;
  #videoCanvasMedia = false;
  get mediaPath(): 'external' | 'software-copy' | 'canvas-copy' {
    return this.#softwareMedia
      ? 'software-copy'
      : this.#videoCanvasMedia
        ? 'canvas-copy'
        : 'external';
  }
  readonly session: DeviceSession;
  readonly onChange: () => void;
  constructor(session: DeviceSession, onChange: () => void = () => {}) {
    this.session = session;
    this.onChange = onChange;
  }
  async #initialize() {
    if (this.#building) return this.#building;
    this.#building = (async () => {
      const d = this.session.device,
        epoch = this.#epoch,
        generation = this.session.generation;
      const check = () => {
        if (
          this.#disposed ||
          epoch !== this.#epoch ||
          generation !== this.session.generation ||
          this.session.state !== 'ready' ||
          this.session.device !== d
        )
          throw new Error('Input pipeline build was superseded');
      };
      const adapter = this.session.capabilities.adapter;
      const softwareMedia =
        adapter.isFallbackAdapter ||
        /swiftshader/i.test(`${adapter.architecture} ${adapter.description}`);
      const common: GPUBindGroupLayoutEntry[] = [
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'rgba16float' },
        },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ];
      const normalLayout = d.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            texture: { sampleType: 'unfilterable-float' },
          },
          ...common,
        ],
      });
      const externalSampler = d.createSampler({ minFilter: 'linear', magFilter: 'linear' });
      const externalLayout = d.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, externalTexture: {} },
          { binding: 3, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
          ...common,
        ],
      });
      let normal: ComputePass | undefined,
        external: ComputePass | undefined,
        mips: MipGenerator | undefined;
      try {
        normal = await createComputePass(
          this.session,
          compose(
            chunk(
              'input:normalize',
              `@group(0) @binding(0) var image:texture_2d<f32>;${conversion}\n@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){let size=textureDimensions(output);if(any(id.xy>=size)){return;}textureStore(output,vec2i(id.xy),normalized(textureLoad(image,vec2i(id.xy),0)));}`,
            ),
          ),
          'hgpu-input-normalize',
          [normalLayout],
        );
        check();
        external = await createComputePass(
          this.session,
          compose(
            chunk(
              'input:external',
              `@group(0) @binding(0) var image:texture_external;@group(0) @binding(3) var imageSampler:sampler;${conversion}\n@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){let size=textureDimensions(output);if(any(id.xy>=size)){return;}textureStore(output,vec2i(id.xy),normalized(textureSampleBaseClampToEdge(image,imageSampler,(vec2f(id.xy)+.5)/vec2f(size))));}`,
            ),
          ),
          'hgpu-input-video',
          [externalLayout],
        );
        check();
        mips = await createMipGenerator(this.session);
        check();
        this.#normal = normal;
        this.#external = external;
        this.#mips = mips;
        this.#normalLayout = normalLayout;
        this.#externalLayout = externalLayout;
        this.#externalSampler = externalSampler;
        this.#softwareMedia = softwareMedia;
        this.#videoCanvasMedia =
          /AppleWebKit/.test(navigator.userAgent) &&
          !/Chrome|Chromium|Edg/.test(navigator.userAgent);
      } catch (error) {
        normal?.dispose();
        external?.dispose();
        mips?.dispose();
        if (epoch === this.#epoch) this.#building = undefined;
        throw error;
      }
    })();
    return this.#building;
  }
  async set(name: string, source: InputSource | null): Promise<void> {
    if (this.#disposed) throw new Error('Input manager is disposed');
    if (!name) throw new TypeError('Input name must not be empty');
    const epoch = this.#epoch,
      generation = this.session.generation;
    const version = (this.#versions.get(name) ?? 0) + 1;
    this.#versions.set(name, version);
    if (source === null) {
      this.session.submit();
      const old = this.#entries.get(name);
      if (old) this.#release(old);
      this.#entries.delete(name);
      this.onChange();
      return;
    }
    let owned: ImageBitmap | undefined;
    try {
      if (source.kind === 'image') {
        if (source.source instanceof HTMLImageElement) await source.source.decode();
        owned = await createImageBitmap(source.source);
      }
      if (source.kind === 'data') {
        inputMipCount(source.width, source.height);
        if (
          !(source.data instanceof Float32Array) ||
          source.data.length !== source.width * source.height * 4 ||
          !source.data.every((v) => Number.isFinite(v) && Math.abs(v) <= 65504)
        )
          throw new TypeError(
            'Data input needs finite RGBA Float32Array matching its dimensions and float16 range',
          );
        source = { ...source, data: source.data.slice() };
      }
      if (source.kind === 'text') {
        if (typeof source.text !== 'string') throw new TypeError('Text input needs a string');
      }
      if (source.kind === 'audio' && !source.analyser && !source.fft && !source.waveform)
        throw new TypeError('Audio input needs an analyser or sample arrays');
      if (
        source.kind === 'texture' &&
        source.session &&
        source.session.device !== this.session.device
      )
        throw new TypeError('Effect texture must use the same GPUDevice');
      if (
        this.#disposed ||
        epoch !== this.#epoch ||
        generation !== this.session.generation ||
        version !== this.#versions.get(name)
      ) {
        owned?.close();
        return;
      }
      await this.#initialize();
      if (
        this.#disposed ||
        epoch !== this.#epoch ||
        generation !== this.session.generation ||
        version !== this.#versions.get(name)
      ) {
        owned?.close();
        return;
      }
      const entry: Entry = {
        source,
        uniform: this.session.device.createBuffer({
          size: 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          label: `hgpu-input-${name}-options`,
        }),
        dirty: true,
        ready: false,
      };
      try {
        entry.image = owned;
        if (owned) entry.source = { kind: 'image', source: owned };
        if (source.kind === 'text') {
          const canvas = new OffscreenCanvas(source.width ?? 512, source.height ?? 256),
            ctx = canvas.getContext('2d')!;
          inputMipCount(canvas.width, canvas.height);
          ctx.font = source.font ?? 'bold 120px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'white';
          ctx.fillText(source.text, canvas.width / 2, canvas.height / 2, canvas.width * 0.9);
          entry.image = canvas;
        }
        const size = this.#size(entry);
        if (size) this.#resize(entry, ...size);
        if (source.kind === 'video') {
          const video = source.source;
          let callback = 0,
            alive = true;
          const tick = () => {
            if (!alive) return;
            entry.dirty = true;
            this.onChange();
            if (typeof video.requestVideoFrameCallback === 'function')
              callback = video.requestVideoFrameCallback(tick);
          };
          if (typeof video.requestVideoFrameCallback === 'function') {
            callback = video.requestVideoFrameCallback(tick);
            entry.cancelVideo = () => {
              alive = false;
              video.cancelVideoFrameCallback(callback);
            };
          } else {
            video.addEventListener('timeupdate', tick);
            entry.cancelVideo = () => {
              alive = false;
              video.removeEventListener('timeupdate', tick);
            };
          }
        }
        if (
          source.kind === 'audio' &&
          source.analyser &&
          typeof requestAnimationFrame === 'function'
        ) {
          let handle = 0,
            active = true;
          const analyser = source.analyser;
          const tick = () => {
            if (!active || analyser.context.state === 'closed') return;
            this.onChange();
            handle = requestAnimationFrame(tick);
          };
          handle = requestAnimationFrame(tick);
          entry.cancelAudio = () => {
            active = false;
            cancelAnimationFrame(handle);
          };
        }
        this.session.submit();
        const old = this.#entries.get(name);
        if (old) this.#release(old);
        this.#entries.set(name, entry);
        this.onChange();
      } catch (error) {
        this.#release(entry);
        throw error;
      }
    } catch (error) {
      owned?.close();
      throw error;
    }
  }
  #tap(source: TextureInput) {
    const tap = typeof source.source === 'function' ? source.source() : source.source;
    if (
      tap &&
      (tap.kind !== 'float' ||
        !(tap.texture.usage & GPUTextureUsage.TEXTURE_BINDING) ||
        tap.texture.dimension !== '2d' ||
        tap.texture.sampleCount !== 1)
    )
      throw new TypeError('Input texture must be a float-sampled single-sample 2D texture');
    if (tap) {
      const level = tap.mipLevel ?? 0,
        layer = tap.arrayLayer ?? 0;
      if (
        tap.depthSlice !== undefined ||
        tap.format !== tap.texture.format ||
        /uint$|sint$|^depth|^stencil/.test(tap.format)
      )
        throw new TypeError('Input tap must describe a matching float 2D subresource');
      if (
        !Number.isInteger(level) ||
        level < 0 ||
        level >= tap.texture.mipLevelCount ||
        !Number.isInteger(layer) ||
        layer < 0 ||
        layer >= tap.texture.depthOrArrayLayers ||
        !Number.isInteger(tap.width) ||
        !Number.isInteger(tap.height) ||
        tap.width !== Math.max(1, tap.texture.width >> level) ||
        tap.height !== Math.max(1, tap.texture.height >> level)
      )
        throw new RangeError('Input tap dimensions, mip or array layer are invalid');
    }
    return tap;
  }
  #size(entry: Entry): [number, number] | undefined {
    const s = entry.source;
    if (s.kind === 'video')
      return s.source.readyState >= 2 && s.source.videoWidth > 0
        ? [s.source.videoWidth, s.source.videoHeight]
        : undefined;
    if (s.kind === 'texture') {
      const tap = this.#tap(s);
      return tap ? [tap.width, tap.height] : undefined;
    }
    if (s.kind === 'data') return [s.width, s.height];
    if (s.kind === 'audio') {
      const n = s.analyser?.fftSize ?? Math.max(s.fft?.length ?? 0, s.waveform?.length ?? 0);
      return [Math.max(1, n), 2];
    }
    const image = entry.image ?? (s.kind === 'canvas' ? s.source : undefined);
    return image ? [image.width, image.height] : undefined;
  }
  #resize(entry: Entry, width: number, height: number) {
    const levels = inputMipCount(width, height),
      d = this.session.device;
    if (width > d.limits.maxTextureDimension2D || height > d.limits.maxTextureDimension2D)
      throw new RangeError('Input exceeds maxTextureDimension2D');
    if (entry.output?.width === width && entry.output.height === height) return;
    entry.output?.destroy();
    entry.upload?.destroy();
    entry.output = d.createTexture({
      label: 'hgpu-input-linear',
      size: [width, height],
      format: 'rgba16float',
      mipLevelCount: levels,
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST,
    });
    if (
      entry.source.kind !== 'texture' &&
      (entry.source.kind !== 'video' || this.#softwareMedia || this.#videoCanvasMedia)
    )
      entry.upload = d.createTexture({
        label: 'hgpu-input-upload',
        size: [width, height],
        format: ['audio', 'data'].includes(entry.source.kind) ? 'rgba32float' : 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
    entry.dirty = true;
    entry.ready = false;
  }
  get(name: string): TextureTap | undefined {
    const entry = this.#entries.get(name);
    if (entry?.source.kind === 'texture' && !this.#tap(entry.source)) return undefined;
    const t = entry?.ready ? entry.output : undefined;
    return t
      ? {
          texture: t,
          format: 'rgba16float',
          width: t.width,
          height: t.height,
          kind: 'float',
          label: `input:${name}`,
        }
      : undefined;
  }
  taps(): Readonly<Record<string, TextureTap>> {
    const result: Record<string, TextureTap> = {};
    for (const name of this.#entries.keys()) {
      const tap = this.get(name);
      if (tap) {
        result[name] = tap;
        for (let level = 1; level < tap.texture.mipLevelCount; level++)
          result[`${name}:mip-${level}`] = {
            ...tap,
            mipLevel: level,
            width: Math.max(1, tap.width >> level),
            height: Math.max(1, tap.height >> level),
          };
      }
    }
    return result;
  }
  prepare(_frame: FrameInfo, encoder: GPUCommandEncoder): void {
    if (this.#disposed) throw new Error('Input manager is disposed');
    const d = this.session.device;
    for (const entry of this.#entries.values()) {
      const s = entry.source,
        size = this.#size(entry);
      if (!size) continue;
      this.#resize(entry, ...size);
      const dynamic = ['canvas', 'audio', 'texture'].includes(s.kind);
      if (!entry.dirty && !dynamic) continue;
      let resource: GPUBindingResource,
        srgb = 1,
        premultiplied = 0,
        pass = this.#normal!,
        layout = this.#normalLayout!;
      if (s.kind === 'video' && !this.#softwareMedia && !this.#videoCanvasMedia) {
        try {
          resource = d.importExternalTexture({ source: s.source, colorSpace: 'srgb' });
        } catch (error) {
          if (error instanceof DOMException && error.name === 'OperationError') {
            entry.dirty = true;
            continue;
          }
          throw error;
        }
        pass = this.#external!;
        layout = this.#externalLayout!;
      } else if (s.kind === 'texture') {
        const tap = this.#tap(s);
        if (!tap) continue;
        resource = tap.texture.createView({
          dimension: '2d',
          baseMipLevel: tap.mipLevel ?? 0,
          mipLevelCount: 1,
          baseArrayLayer: tap.arrayLayer ?? 0,
          arrayLayerCount: 1,
        });
        srgb = s.colourSpace === 'srgb' ? 1 : 0;
        premultiplied = s.premultiplied === false ? 0 : 1;
      } else if (s.kind === 'data') {
        d.queue.writeTexture(
          { texture: entry.upload! },
          s.data,
          { bytesPerRow: s.width * 16, rowsPerImage: s.height },
          size,
        );
        resource = entry.upload!.createView();
        srgb = 0;
        premultiplied = 1;
      } else if (s.kind === 'audio') {
        const width = size[0],
          values = new Float32Array(width * 2 * 4);
        let fft = s.fft,
          wave = s.waveform;
        if (s.analyser) {
          fft = new Float32Array(s.analyser.frequencyBinCount);
          wave = new Float32Array(s.analyser.fftSize);
          s.analyser.getFloatFrequencyData(fft as Float32Array<ArrayBuffer>);
          s.analyser.getFloatTimeDomainData(wave as Float32Array<ArrayBuffer>);
        }
        for (let i = 0; i < width; i++) {
          const frequency = fft?.[i] ?? 0;
          values[i * 4] = s.analyser
            ? i < (fft?.length ?? 0)
              ? Math.pow(10, frequency / 20)
              : 0
            : Number.isFinite(frequency)
              ? frequency
              : 0;
          values[(width + i) * 4] = Number.isFinite(wave?.[i]) ? wave![i]! : 0;
          values[i * 4 + 3] = values[(width + i) * 4 + 3] = 1;
        }
        d.queue.writeTexture(
          { texture: entry.upload! },
          values,
          { bytesPerRow: width * 16, rowsPerImage: 2 },
          [width, 2],
        );
        resource = entry.upload!.createView();
        srgb = 0;
      } else {
        const image =
          entry.image ?? (s.kind === 'canvas' || s.kind === 'video' ? s.source : undefined)!;
        if (this.#softwareMedia || (s.kind === 'video' && this.#videoCanvasMedia)) {
          const scratch = (entry.scratch ??= new OffscreenCanvas(size[0], size[1]));
          if (scratch.width !== size[0] || scratch.height !== size[1]) {
            scratch.width = size[0];
            scratch.height = size[1];
          }
          const ctx = scratch.getContext('2d')!;
          ctx.clearRect(0, 0, ...size);
          ctx.drawImage(image, 0, 0, ...size);
          const bytes = this.#softwareMedia ? ctx.getImageData(0, 0, ...size).data : undefined;
          if (this.#softwareMedia)
            d.queue.writeTexture(
              { texture: entry.upload! },
              bytes!,
              { bytesPerRow: size[0] * 4, rowsPerImage: size[1] },
              size,
            );
          else
            d.queue.copyExternalImageToTexture(
              { source: scratch },
              { texture: entry.upload!, colorSpace: 'srgb', premultipliedAlpha: false },
              size,
            );
        } else
          d.queue.copyExternalImageToTexture(
            { source: image },
            { texture: entry.upload!, colorSpace: 'srgb', premultipliedAlpha: false },
            size,
          );
        resource = entry.upload!.createView();
      }
      d.queue.writeBuffer(entry.uniform, 0, new Uint32Array([srgb, premultiplied, 0, 0]));
      const group = d.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource },
          { binding: 1, resource: entry.output!.createView({ baseMipLevel: 0, mipLevelCount: 1 }) },
          { binding: 2, resource: { buffer: entry.uniform } },
          ...(s.kind === 'video' && !this.#softwareMedia && !this.#videoCanvasMedia
            ? [{ binding: 3, resource: this.#externalSampler! }]
            : []),
        ],
      });
      pass.dispatch(encoder, [group], [Math.ceil(size[0] / 8), Math.ceil(size[1] / 8)]);
      this.#mips!.encode(encoder, entry.output!);
      entry.dirty = false;
      entry.ready = true;
    }
  }
  memory(): EffectMemory {
    let textureBytes = 0,
      bufferBytes = 0;
    for (const e of this.#entries.values()) {
      bufferBytes += 16;
      if (e.output) textureBytes += inputTextureBytes(e.output.width, e.output.height);
      if (e.upload)
        textureBytes +=
          e.upload.width * e.upload.height * (['audio', 'data'].includes(e.source.kind) ? 16 : 4);
    }
    return { textureBytes, bufferBytes };
  }
  #release(entry: Entry) {
    entry.cancelVideo?.();
    entry.cancelAudio?.();
    if (entry.image instanceof ImageBitmap) entry.image.close();
    entry.output?.destroy();
    entry.upload?.destroy();
    entry.uniform.destroy();
    if (entry.scratch) {
      entry.scratch.width = 0;
      entry.scratch.height = 0;
    }
    if (entry.image instanceof OffscreenCanvas) {
      entry.image.width = 0;
      entry.image.height = 0;
    }
  }
  /** Rebuild GPU resources after the session restores its device; caller media keep running. */
  async restore(): Promise<void> {
    if (this.#disposed) throw new Error('Input manager is disposed');
    this.#epoch++;
    for (const [name, version] of this.#versions) this.#versions.set(name, version + 1);
    const retained = [...this.#entries.entries()];
    this.#entries.clear();
    this.#normal?.dispose();
    this.#external?.dispose();
    this.#mips?.dispose();
    this.#normal = undefined;
    this.#external = undefined;
    this.#mips = undefined;
    this.#building = undefined;
    for (const [, e] of retained) {
      e.cancelVideo?.();
      e.cancelAudio?.();
      e.output?.destroy();
      e.upload?.destroy();
      e.uniform.destroy();
      if (e.scratch) {
        e.scratch.width = 0;
        e.scratch.height = 0;
      }
      if (e.image instanceof OffscreenCanvas) {
        e.image.width = 0;
        e.image.height = 0;
      }
    }
    try {
      for (const [name, e] of retained) await this.set(name, e.source);
    } finally {
      for (const [, e] of retained) if (e.image instanceof ImageBitmap) e.image.close();
    }
  }
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#epoch++;
    for (const [name, version] of this.#versions) this.#versions.set(name, version + 1);
    this.session.submit();
    for (const e of this.#entries.values()) this.#release(e);
    this.#entries.clear();
    this.#normal?.dispose();
    this.#external?.dispose();
    this.#mips?.dispose();
  }
}
