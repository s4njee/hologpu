import type { DeviceSession } from './device.ts';
import type { TextureTap } from './effect.ts';
type ElementQueue = GPUQueue & {
  copyElementImageToTexture?: (
    source: { source: HTMLElement },
    destination: {
      destination: { texture: GPUTexture; premultipliedAlpha: boolean };
      width: number;
      height: number;
    },
  ) => void;
  drawElementImageToTexture?: (
    source: {
      source: HTMLElement;
      sourceX: number;
      sourceY: number;
      sourceWidth: number;
      sourceHeight: number;
    },
    destination: {
      texture: GPUTexture;
      size: { width: number; height: number };
      premultipliedAlpha: boolean;
    },
  ) => void;
};
export function elementCaptureMethod(queue: GPUQueue): 'draw' | 'copy' | null {
  const q = queue as ElementQueue;
  // Chrome 154 exposes a draw-named alias with the older copy dictionaries.
  // Pair the newer spelling with its drawable-content API generation.
  const modern =
    typeof HTMLCanvasElement !== 'undefined' && 'content' in HTMLCanvasElement.prototype;
  if (modern && typeof q.drawElementImageToTexture === 'function') return 'draw';
  if (typeof q.copyElementImageToTexture === 'function') return 'copy';
  return typeof q.drawElementImageToTexture === 'function' ? 'draw' : null;
}
/** Opt-in HTML-in-canvas capture. Caller owns the DOM and the drawable source canvas. */
export function createElementCapture(
  session: DeviceSession,
  element: HTMLElement,
  onChange?: () => void,
) {
  const method = elementCaptureMethod(session.device.queue);
  if (!method) throw new Error('HTML-in-canvas WebGPU capture is unavailable');
  const canvas = element.parentElement;
  if (
    !(canvas instanceof HTMLCanvasElement) ||
    !(canvas.hasAttribute('layoutsubtree') || canvas.getAttribute('content') === 'drawable')
  )
    throw new TypeError('Capture source must be a direct child of a drawable canvas');
  let texture: GPUTexture | undefined,
    width = 0,
    height = 0,
    ready = false,
    disposed = false,
    error: string | null = null,
    revision = 0;
  const queue = session.device.queue as ElementQueue;
  const capture = () => {
    if (disposed) return;
    try {
      const w = Math.ceil(element.offsetWidth),
        h = Math.ceil(element.offsetHeight);
      if (w < 1 || h < 1 || Math.max(w, h) > session.device.limits.maxTextureDimension2D)
        throw new RangeError('Capture source dimensions exceed texture limits');
      if (w !== width || h !== height) {
        const next = session.device.createTexture({
          label: 'html-in-canvas-capture',
          format: 'rgba8unorm-srgb',
          size: [w, h],
          usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.COPY_SRC |
            GPUTextureUsage.RENDER_ATTACHMENT,
        });
        texture?.destroy();
        texture = next;
        width = w;
        height = h;
        ready = false;
      }
      if (method === 'draw')
        queue.drawElementImageToTexture!(
          { source: element, sourceX: 0, sourceY: 0, sourceWidth: width, sourceHeight: height },
          { texture: texture!, size: { width, height }, premultipliedAlpha: false },
        );
      else
        queue.copyElementImageToTexture!(
          { source: element },
          { destination: { texture: texture!, premultipliedAlpha: false }, width, height },
        );
      ready = true;
      error = null;
      revision++;
    } catch (reason) {
      ready = false;
      error = reason instanceof Error ? reason.message : String(reason);
    }
    onChange?.();
  };
  canvas.addEventListener('paint', capture);
  // On device recovery the caller's canvas may already have a painted snapshot.
  if (element.isConnected && element.offsetWidth > 0 && element.offsetHeight > 0) capture();
  return {
    method,
    get ready() {
      return ready;
    },
    get error() {
      return error;
    },
    get revision() {
      return revision;
    },
    get tap(): TextureTap | undefined {
      return ready
        ? {
            texture: texture!,
            width,
            height,
            format: 'rgba8unorm-srgb',
            kind: 'float',
            label: 'Straight-alpha DOM capture (sRGB decoded on sample)',
          }
        : undefined;
    },
    get bytes() {
      return texture ? width * height * 4 : 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      canvas.removeEventListener('paint', capture);
      texture?.destroy();
      texture = undefined;
      ready = false;
    },
  };
}
