export interface GPUProfileFrame {
  index: number;
  totalMs: number;
  passes: Readonly<Record<string, { ms: number; count: number }>>;
  truncated: boolean;
}
interface Slot {
  queries: GPUQuerySet;
  resolve: GPUBuffer;
  readback: GPUBuffer;
  busy: boolean;
}
interface Capture {
  slot: Slot;
  labels: string[];
  index: number;
  truncated: boolean;
}
/** Bounded asynchronous timestamp readback; never waits in the animation loop. */
export class GPUProfiler {
  readonly supported: boolean;
  enabled = false;
  latest: GPUProfileFrame | null = null;
  readonly history: GPUProfileFrame[] = [];
  droppedFrames = 0;
  readonly #device: GPUDevice;
  readonly #capacity: number;
  readonly #slots: Slot[] = [];
  readonly #captures = new WeakMap<GPUCommandEncoder, Capture>();
  readonly #skipped = new WeakSet<GPUCommandEncoder>();
  readonly #pending = new Set<Promise<void>>();
  readonly #listeners = new Set<(frame: GPUProfileFrame) => void>();
  #index = 0;
  #disposed = false;
  constructor(device: GPUDevice, capacity = 512) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 2048)
      throw new RangeError('Timestamp pass capacity must be in [1, 2048]');
    this.#device = device;
    this.#capacity = capacity;
    this.supported = device.features.has('timestamp-query');
  }
  onFrame(listener: (frame: GPUProfileFrame) => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  get bytes() {
    return this.#slots.length * this.#capacity * 2 * 8 * 2;
  }
  timestampWrites(
    encoder: GPUCommandEncoder,
    label: string,
  ): GPUComputePassTimestampWrites | undefined {
    if (!this.enabled || !this.supported || this.#disposed) return;
    if (this.#skipped.has(encoder)) return;
    let capture = this.#captures.get(encoder);
    if (!capture) {
      let slot = this.#slots.find((s) => !s.busy);
      if (!slot && this.#slots.length < 3) {
        const size = this.#capacity * 2 * 8;
        const queries = this.#device.createQuerySet({
          type: 'timestamp',
          count: this.#capacity * 2,
        });
        let resolve: GPUBuffer | undefined;
        let readback: GPUBuffer | undefined;
        try {
          resolve = this.#device.createBuffer({
            size,
            usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
          });
          readback = this.#device.createBuffer({
            size,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          });
          slot = { queries, resolve, readback, busy: false };
          this.#slots.push(slot);
        } catch (error) {
          queries.destroy();
          resolve?.destroy();
          readback?.destroy();
          throw error;
        }
      }
      if (!slot) {
        this.droppedFrames++;
        this.#skipped.add(encoder);
        return;
      }
      slot.busy = true;
      capture = { slot, labels: [], index: ++this.#index, truncated: false };
      this.#captures.set(encoder, capture);
    }
    if (capture.labels.length >= this.#capacity) {
      capture.truncated = true;
      return;
    }
    const beginningOfPassWriteIndex = capture.labels.length * 2;
    capture.labels.push(label);
    return {
      querySet: capture.slot.queries,
      beginningOfPassWriteIndex,
      endOfPassWriteIndex: beginningOfPassWriteIndex + 1,
    };
  }
  /** Call before finishing the encoder; the returned callback runs immediately after submit. */
  resolve(encoder: GPUCommandEncoder): (() => void) | undefined {
    const capture = this.#captures.get(encoder);
    if (!capture || this.#disposed) return;
    this.#captures.delete(encoder);
    const { slot, labels } = capture;
    const count = labels.length * 2;
    encoder.resolveQuerySet(slot.queries, 0, count, slot.resolve, 0);
    encoder.copyBufferToBuffer(slot.resolve, 0, slot.readback, 0, count * 8);
    return () => {
      const pending = slot.readback
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          if (this.#disposed) return;
          const times = new BigUint64Array(slot.readback.getMappedRange());
          const passes: Record<string, { ms: number; count: number }> = {};
          let totalMs = 0;
          labels.forEach((label, i) => {
            const start = times[i * 2]!,
              end = times[i * 2 + 1]!;
            const ms = end >= start ? Number(end - start) / 1e6 : 0;
            const entry = (passes[label] ??= { ms: 0, count: 0 });
            entry.ms += ms;
            entry.count++;
            totalMs += ms;
          });
          slot.readback.unmap();
          const frame = { index: capture.index, totalMs, passes, truncated: capture.truncated };
          if (!this.latest || frame.index > this.latest.index) this.latest = frame;
          this.history.push(frame);
          if (this.history.length > 240) this.history.shift();
          for (const listener of this.#listeners) listener(frame);
        })
        .catch(() => {
          /* Device loss cancels pending reads. */
        })
        .finally(() => {
          slot.busy = false;
          this.#pending.delete(pending);
        });
      this.#pending.add(pending);
    };
  }
  async settle() {
    while (this.#pending.size) await Promise.all([...this.#pending]);
  }
  clear() {
    this.history.length = 0;
    this.latest = null;
    this.droppedFrames = 0;
  }
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const slot of this.#slots) {
      slot.queries.destroy();
      slot.resolve.destroy();
      slot.readback.destroy();
    }
    this.#slots.length = 0;
    this.#listeners.clear();
  }
}
