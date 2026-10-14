/** Median-split sphere BVH. Leaves retain original sphere IDs; packed nodes are 32 bytes. */
export function sphereBVH(spheres: readonly (readonly [number, number, number, number])[]) {
  if (!spheres.length || spheres.some((s) => s.some((x) => !Number.isFinite(x)) || s[3] <= 0))
    throw new RangeError('Invalid spheres');
  const nodes: { lo: number[]; hi: number[]; left: number; right: number }[] = [];
  function build(ids: number[]): number {
    const lo = [0, 1, 2].map((a) => Math.min(...ids.map((i) => spheres[i]![a]! - spheres[i]![3])));
    const hi = [0, 1, 2].map((a) => Math.max(...ids.map((i) => spheres[i]![a]! + spheres[i]![3])));
    const index = nodes.length;
    const node = { lo, hi, left: 0xffffffff, right: ids[0]! };
    nodes.push(node);
    if (ids.length > 1) {
      const axis = [0, 1, 2].sort((a, b) => hi[b]! - lo[b]! - (hi[a]! - lo[a]!))[0]!;
      ids.sort((a, b) => spheres[a]![axis]! - spheres[b]![axis]!);
      const middle = Math.floor(ids.length / 2);
      node.left = build(ids.slice(0, middle));
      node.right = build(ids.slice(middle));
    }
    return index;
  }
  build(spheres.map((_, i) => i));
  const bytes = new ArrayBuffer(nodes.length * 32),
    f = new Float32Array(bytes),
    u = new Uint32Array(bytes);
  nodes.forEach((n, i) => {
    f.set(n.lo, i * 8);
    u[i * 8 + 3] = n.left;
    f.set(n.hi, i * 8 + 4);
    u[i * 8 + 7] = n.right;
  });
  return { bytes, nodes };
}
export const tracerSpheres: readonly (readonly [number, number, number, number])[] = [
  [0, -100.8, 0, 100],
  [-0.7, -0.18, 0, 0.62],
  [0.7, -0.28, -0.35, 0.52],
  [0, 0.65, -1.2, 0.35],
  [0, 3, -0.5, 0.6],
  [-1.55, -0.48, -1, 0.32],
  [1.6, -0.48, -1, 0.32],
];
