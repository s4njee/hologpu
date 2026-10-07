export interface ResourceLease<T> {
  readonly value: T;
  release(): void;
}
interface Entry {
  value: unknown;
  refs: number;
  dispose: (value: never) => void;
  bytes: number;
}
/** Device-scoped, reference-counted cache. Failed async creations never poison the cache. */
export class Resources {
  readonly #entries = new Map<string, Entry>();
  #closed = false;
  acquire<T>(
    key: string,
    create: () => T,
    dispose: (value: T) => void = () => {},
    bytes = 0,
  ): ResourceLease<T> {
    if (this.#closed) throw new Error('Resource cache is closed');
    let entry = this.#entries.get(key);
    if (!entry) {
      entry = { value: create(), refs: 0, dispose: dispose as (value: never) => void, bytes };
      this.#entries.set(key, entry);
    }
    entry.refs++;
    const captured = entry;
    let held = true;
    return {
      value: entry.value as T,
      release: () => {
        if (!held) return;
        held = false;
        if (this.#entries.get(key) !== captured) return;
        if (--captured.refs === 0) {
          this.#entries.delete(key);
          captured.dispose(captured.value as never);
        }
      },
    };
  }
  async acquireAsync<T>(key: string, create: () => Promise<T>): Promise<ResourceLease<T>> {
    const lease = this.acquire<Promise<T>>(key, create);
    try {
      const value = await lease.value;
      return { value, release: lease.release };
    } catch (error) {
      lease.release();
      throw error;
    }
  }
  sampler(device: GPUDevice, descriptor: GPUSamplerDescriptor = {}) {
    return this.acquire(`sampler:${JSON.stringify(descriptor)}`, () =>
      device.createSampler(descriptor),
    );
  }
  stats() {
    return {
      entries: this.#entries.size,
      references: [...this.#entries.values()].reduce((n, e) => n + e.refs, 0),
      bytes: [...this.#entries.values()].reduce((n, e) => n + e.bytes, 0),
    };
  }
  dispose() {
    this.#closed = true;
    const entries = [...this.#entries.values()];
    this.#entries.clear();
    for (const e of entries) e.dispose(e.value as never);
  }
}
/** Explicitly bounded texture pool; idle entries can be trimmed under memory pressure. */
export class TexturePool {
  readonly #device: GPUDevice;
  readonly #idle = new Map<string, GPUTexture[]>();
  readonly #live = new Set<GPUTexture>();
  #closed = false;
  constructor(device: GPUDevice) {
    this.#device = device;
  }
  acquire(descriptor: GPUTextureDescriptor): ResourceLease<GPUTexture> {
    if (this.#closed) throw new Error('Texture pool is closed');
    const key = JSON.stringify({ ...descriptor, label: undefined });
    const idle = this.#idle.get(key);
    const value = idle?.pop() ?? this.#device.createTexture(descriptor);
    let held = true;
    this.#live.add(value);
    return {
      value,
      release: () => {
        if (!held) return;
        held = false;
        if (!this.#live.delete(value)) return;
        const list = this.#idle.get(key) ?? [];
        if (list.length < 2) {
          list.push(value);
          this.#idle.set(key, list);
        } else value.destroy();
      },
    };
  }
  dispose() {
    this.#closed = true;
    this.trim();
    for (const texture of this.#live) texture.destroy();
    this.#live.clear();
  }
  trim() {
    for (const list of this.#idle.values()) for (const texture of list) texture.destroy();
    this.#idle.clear();
  }
}
