/** Axis-aligned, normalized container-local rectangle: left, top, right, bottom. */
export type ObstacleRect = readonly [number, number, number, number];
export interface DomRectsOptions {
  selector?: string;
  maxRects?: number;
  onChange?: () => void;
  /** Query tags in the container, but normalize to this actual rendering box. */
  coordinateTarget?: Element;
}
export interface DomRectsSource {
  readonly kind: 'dom-rects';
  snapshot(): readonly ObstacleRect[];
  buffer(device: GPUDevice): GPUBuffer;
}
/** Clips browser-transformed viewport boxes to a container's viewport box. */
export function localObstacleRect(
  box: Pick<DOMRectReadOnly, 'left' | 'top' | 'right' | 'bottom'>,
  container: Pick<DOMRectReadOnly, 'left' | 'top' | 'width' | 'height'>,
): ObstacleRect | undefined {
  if (!(container.width > 0 && container.height > 0)) return;
  const rect = [
    Math.max(0, (box.left - container.left) / container.width),
    Math.max(0, (box.top - container.top) / container.height),
    Math.min(1, (box.right - container.left) / container.width),
    Math.min(1, (box.bottom - container.top) / container.height),
  ] as const;
  return rect.every(Number.isFinite) && rect[2] > rect[0] && rect[3] > rect[1] ? rect : undefined;
}
/** Storage ABI: 16-byte header (u32 count, three zero words), then vec4f rectangles. */
export function packObstacleRects(rects: readonly ObstacleRect[]): ArrayBuffer {
  const bytes = new ArrayBuffer(16 + Math.max(1, rects.length) * 16);
  new Uint32Array(bytes)[0] = rects.length;
  const floats = new Float32Array(bytes);
  rects.forEach((rect, i) => floats.set(rect, 4 + i * 4));
  return bytes;
}
/**
 * Borrowed by effects, owned by the DOM attachment/caller. Rectangles use actual browser
 * bounding boxes, including CSS transforms, and document order truncation at maxRects.
 * Call refresh in the owning field's before-frame hook for transform/layout animation.
 */
export class DomRectsInput implements DomRectsSource {
  readonly kind = 'dom-rects' as const;
  readonly container: HTMLElement;
  readonly maxRects: number;
  readonly selector: string;
  readonly coordinateTarget: Element;
  #rects: readonly ObstacleRect[] = [];
  #version = 0;
  #disposed = false;
  #listeners = new Set<() => void>();
  #resize: ResizeObserver;
  #mutation: MutationObserver;
  #buffers = new Map<GPUDevice, { buffer: GPUBuffer; capacity: number; version: number }>();
  #observed: Element[] = [];
  #retired = new Map<GPUDevice, GPUBuffer[]>();
  constructor(container: HTMLElement, options: DomRectsOptions = {}) {
    this.container = container;
    this.coordinateTarget = options.coordinateTarget ?? container;
    this.maxRects = options.maxRects ?? 128;
    if (!Number.isInteger(this.maxRects) || this.maxRects < 1 || this.maxRects > 4096)
      throw new RangeError('maxRects must be an integer from 1 to 4096');
    this.selector = options.selector ?? '[data-hgpu-obstacle]';
    container.querySelectorAll(this.selector); // Validate before observers/resources exist.
    if (options.onChange) this.#listeners.add(options.onChange);
    const update = () => this.refresh();
    this.#resize = new ResizeObserver(update);
    this.#resize.observe(container);
    if (this.coordinateTarget !== container) this.#resize.observe(this.coordinateTarget);
    this.#mutation = new MutationObserver(update);
    this.#mutation.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    window.addEventListener('scroll', this.#scroll, true);
    window.addEventListener('resize', this.#scroll);
    this.refresh();
  }
  #scroll = () => {
    this.refresh();
  };
  subscribe(listener: () => void): () => void {
    if (this.#disposed) throw new Error('DOM rect input is disposed');
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  /** Last observed geometry; this read performs no layout/style work. */
  snapshot(): readonly ObstacleRect[] {
    return this.#rects;
  }
  /** Synchronize transformed/layout boxes in the owner's one before-frame hook. */
  refresh(): readonly ObstacleRect[] {
    if (this.#disposed) return [];
    const bounds = this.coordinateTarget.getBoundingClientRect();
    const nodes = [...this.container.querySelectorAll(this.selector)].slice(0, this.maxRects);
    if (
      nodes.length !== this.#observed.length ||
      nodes.some((node, i) => node !== this.#observed[i])
    ) {
      this.#resize.disconnect();
      this.#resize.observe(this.container);
      if (this.coordinateTarget !== this.container) this.#resize.observe(this.coordinateTarget);
      nodes.forEach((node) => this.#resize.observe(node));
      this.#observed = nodes;
    }
    const next: ObstacleRect[] = [];
    for (const node of nodes) {
      if (next.length >= this.maxRects) break;
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = localObstacleRect(node.getBoundingClientRect(), bounds);
      if (rect) next.push(Object.freeze(rect));
    }
    if (
      next.length !== this.#rects.length ||
      next.some((rect, i) => rect.some((v, j) => v !== this.#rects[i]?.[j]))
    ) {
      this.#rects = Object.freeze(next);
      this.#version++;
      this.#listeners.forEach((listener) => listener());
    }
    return this.#rects;
  }
  buffer(device: GPUDevice): GPUBuffer {
    if (this.#disposed) throw new Error('DOM rect input is disposed');
    const byteLength = 16 + Math.max(1, this.#rects.length) * 16;
    let entry = this.#buffers.get(device);
    if (!entry || entry.capacity < byteLength) {
      if (entry) {
        const retired = this.#retired.get(device) ?? [];
        retired.push(entry.buffer);
        this.#retired.set(device, retired);
      }
      const capacity = 2 ** Math.ceil(Math.log2(byteLength));
      entry = {
        buffer: device.createBuffer({
          label: 'hgpu-dom-rects',
          size: capacity,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        }),
        capacity,
        version: -1,
      };
      this.#buffers.set(device, entry);
      // A replacement device rebuilds from DOM state; old-device buffers are never reused.
      for (const [old, lease] of this.#buffers)
        if (old !== device) {
          lease.buffer.destroy();
          this.#buffers.delete(old);
          this.#retired.get(old)?.forEach((buffer) => buffer.destroy());
          this.#retired.delete(old);
        }
    }
    if (entry.version !== this.#version) {
      device.queue.writeBuffer(entry.buffer, 0, packObstacleRects(this.#rects));
      entry.version = this.#version;
    }
    return entry.buffer;
  }
  get bufferBytes(): number {
    return (
      [...this.#buffers.values()].reduce((n, e) => n + e.capacity, 0) +
      [...this.#retired.values()].flat().reduce((n, b) => n + b.size, 0)
    );
  }
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#resize.disconnect();
    this.#mutation.disconnect();
    window.removeEventListener('scroll', this.#scroll, true);
    window.removeEventListener('resize', this.#scroll);
    for (const entry of this.#buffers.values()) entry.buffer.destroy();
    this.#buffers.clear();
    this.#retired.forEach((buffers) => buffers.forEach((buffer) => buffer.destroy()));
    this.#retired.clear();
    this.#listeners.clear();
    this.#observed = [];
    this.#rects = [];
  }
}
export function domRectsInput(container: HTMLElement, options?: DomRectsOptions): DomRectsInput {
  return new DomRectsInput(container, options);
}
