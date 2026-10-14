import { it, expect } from 'vitest';
import { sphereBVH, tracerSpheres } from './bvh.ts';
it('builds a bounded median hierarchy covering each original sphere exactly once', () => {
  const { nodes, bytes } = sphereBVH(tracerSpheres);
  expect(nodes).toHaveLength(2 * tracerSpheres.length - 1);
  expect(bytes.byteLength).toBe(nodes.length * 32);
  const leaves: number[] = [];
  function visit(index: number, depth: number) {
    expect(depth).toBeLessThan(32);
    const node = nodes[index]!;
    expect(node).toBeDefined();
    if (node.left === 0xffffffff) {
      leaves.push(node.right);
      const s = tracerSpheres[node.right]!;
      for (let a = 0; a < 3; a++) {
        expect(node.lo[a]).toBeLessThanOrEqual(s[a]! - s[3]);
        expect(node.hi[a]).toBeGreaterThanOrEqual(s[a]! + s[3]);
      }
    } else {
      for (const child of [node.left, node.right]) {
        expect(child).toBeGreaterThan(index);
        for (let a = 0; a < 3; a++) {
          expect(nodes[child]!.lo[a]).toBeGreaterThanOrEqual(node.lo[a]!);
          expect(nodes[child]!.hi[a]).toBeLessThanOrEqual(node.hi[a]!);
        }
        visit(child, depth + 1);
      }
    }
  }
  visit(0, 0);
  expect(leaves.sort((a, b) => a - b)).toEqual(tracerSpheres.map((_, i) => i));
  const u = new Uint32Array(bytes);
  nodes.forEach((n, i) => {
    expect(u[i * 8 + 3]).toBe(n.left);
    expect(u[i * 8 + 7]).toBe(n.right);
  });
});
it('rejects empty, non-finite and non-positive sphere bounds', () => {
  expect(() => sphereBVH([])).toThrow();
  expect(() => sphereBVH([[0, 0, 0, 0]])).toThrow();
  expect(() => sphereBVH([[NaN, 0, 0, 1]])).toThrow();
});
