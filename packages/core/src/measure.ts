/** Spike measurements are allocation estimates and CPU/rAF timings, never GPU timings. */
export function backingSize(
  width: number,
  height: number,
  dpr: number,
  maxDimension: number,
  physical?: { width: number; height: number },
): { width: number; height: number } {
  const scale = Math.min(2, Math.max(0.1, dpr));
  // Browser DPR emulation can expose unscaled device-pixel boxes. Use those boxes
  // only when they agree with the effective DPR, allowing physical edge snapping.
  const exact =
    physical &&
    dpr <= 2 &&
    Math.abs(physical.width - width * scale) <= 1 &&
    Math.abs(physical.height - height * scale) <= 1;
  let w = exact ? physical.width : Math.round(width * scale);
  let h = exact ? physical.height : Math.round(height * scale);
  const limitScale = Math.min(1, maxDimension / Math.max(1, w, h));
  w = Math.max(1, Math.floor(w * limitScale));
  h = Math.max(1, Math.floor(h * limitScale));
  return { width: w, height: h };
}

export function summarize(samples: readonly number[]) {
  if (!samples.length) return { count: 0, mean: 0, p50: 0, p95: 0, max: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    p50: sorted[Math.floor((sorted.length - 1) * 0.5)]!,
    p95: sorted[Math.ceil((sorted.length - 1) * 0.95)]!,
    max: sorted[sorted.length - 1]!,
  };
}

/** Integer-only reference for the GPU compute spike. One RGBA value per surface. */
export function referenceColors(seed: number, step: number): number[] {
  return Array.from({ length: 6 }, (_, index) => {
    const hash = (Math.imul((seed + step + index + 1) >>> 0, 1664525) + 1013904223) >>> 0;
    return [hash & 255, (hash >>> 8) & 255, (hash >>> 16) & 255, 255];
  }).flat();
}
