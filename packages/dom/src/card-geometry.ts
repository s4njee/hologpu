/** Resolve and normalize CSS elliptical corners in TL, TR, BR, BL order. */
export function resolveCornerRadii(values: readonly string[], width: number, height: number) {
  const side = (value: string, size: number) => {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? Math.max(0, n * (value.endsWith('%') ? size / 100 : 1)) : 0;
  };
  const x: number[] = [],
    y: number[] = [];
  for (const value of values) {
    const parts = value.trim().split(/\s+/);
    x.push(side(parts[0] ?? '0', width));
    y.push(side(parts[1] ?? parts[0] ?? '0', height));
  }
  const ratio = (size: number, sum: number) => (sum > 0 ? size / sum : 1);
  const factor = Math.min(
    1,
    ratio(width, x[0]! + x[1]!),
    ratio(width, x[3]! + x[2]!),
    ratio(height, y[0]! + y[3]!),
    ratio(height, y[1]! + y[2]!),
  );
  return { radiiX: x.map((v) => v * factor), radiiY: y.map((v) => v * factor) };
}

export function cardGeometry(host: HTMLElement, canvas: HTMLCanvasElement) {
  const bounds = host.getBoundingClientRect(),
    target = canvas.getBoundingClientRect();
  const style = getComputedStyle(host);
  const radii = resolveCornerRadii(
    [
      style.borderTopLeftRadius,
      style.borderTopRightRadius,
      style.borderBottomRightRadius,
      style.borderBottomLeftRadius,
    ],
    bounds.width,
    bounds.height,
  );
  return {
    rect: [
      (bounds.left - target.left) / Math.max(1, target.width),
      (bounds.top - target.top) / Math.max(1, target.height),
      bounds.width / Math.max(1, target.width),
      bounds.height / Math.max(1, target.height),
    ],
    radius: Math.min(radii.radiiX[0]!, radii.radiiY[0]!),
    ...radii,
  };
}
