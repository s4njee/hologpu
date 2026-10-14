import { describe, it, expect } from 'vitest';
import { perspective, lookAt, multiplyMat4, cubeMesh, sphereMesh, planeMesh } from './geometry.ts';
import { cubeDirection } from './environment.ts';
const transform = (m: ArrayLike<number>, p: readonly number[]) =>
  Array.from({ length: 4 }, (_, r) => p.reduce((sum, x, c) => sum + x * m[c * 4 + r]!, 0));
describe('minimal geometry conventions', () => {
  it('maps near/far planes to WebGPU depth 0/1 with right-handed view', () => {
    const m = perspective(Math.PI / 2, 2, 0.1, 100);
    for (const [z, expected] of [
      [-0.1, 0],
      [-100, 1],
    ]) {
      const p = transform(m, [0, 0, z!, 1]);
      expect(p[2]! / p[3]!).toBeCloseTo(expected!, 5);
    }
    expect(m[0]).toBeCloseTo(0.5);
    expect(m[5]).toBeCloseTo(1);
  });
  it('maps eye to origin and target ahead of the camera; matrix product composes', () => {
    const v = lookAt([3, 2, 4], [0, 0, 0]);
    transform(v, [3, 2, 4, 1]).forEach((x, i) => expect(x).toBeCloseTo(i === 3 ? 1 : 0, 5));
    const p = perspective(1, 1),
      point = [0, 0, 0, 1];
    const a = transform(multiplyMat4(p, v), point),
      b = transform(p, transform(v, point));
    a.forEach((x, i) => expect(x).toBeCloseTo(b[i]!, 5));
    expect(a[3]).toBeGreaterThan(0);
  });
  it('rejects invalid frusta, camera bases and mesh sizes', () => {
    expect(() => perspective(1, 0)).toThrow();
    expect(() => perspective(1, 1, 1, 1)).toThrow();
    expect(() => lookAt([0, 0, 0], [0, 0, 0])).toThrow();
    expect(() => lookAt([0, 1, 0], [0, 0, 0])).toThrow();
    expect(() => planeMesh(0)).toThrow();
    expect(() => sphereMesh(2)).toThrow();
  });
  it('provides outward indexed triangles, unit normals, finite UVs and bounded indices', () => {
    for (const mesh of [cubeMesh(), sphereMesh(16, 8), planeMesh(8)]) {
      expect(mesh.vertices.length % 8).toBe(0);
      expect(mesh.indices.length % 3).toBe(0);
      expect([...mesh.vertices].every(Number.isFinite)).toBe(true);
      for (const i of mesh.indices) expect(i).toBeLessThan(mesh.vertices.length / 8);
      for (let i = 0; i < mesh.vertices.length; i += 8)
        expect(Math.hypot(...mesh.vertices.slice(i + 3, i + 6))).toBeCloseTo(1, 5);
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const a = mesh.indices[i]! * 8,
          b = mesh.indices[i + 1]! * 8,
          c = mesh.indices[i + 2]! * 8;
        const u = [0, 1, 2].map((k) => mesh.vertices[b + k]! - mesh.vertices[a + k]!),
          v = [0, 1, 2].map((k) => mesh.vertices[c + k]! - mesh.vertices[a + k]!);
        const cross = [
          u[1]! * v[2]! - u[2]! * v[1]!,
          u[2]! * v[0]! - u[0]! * v[2]!,
          u[0]! * v[1]! - u[1]! * v[0]!,
        ];
        expect(
          cross.reduce((sum, x, k) => sum + x * mesh.vertices[a + 3 + k]!, 0),
        ).toBeGreaterThanOrEqual(-1e-6);
      }
    }
  });
  it('uses the six WebGPU cube face axes and matching directions across seams', () => {
    [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ].forEach((axis, i) =>
      cubeDirection(i, 0.5, 0.5).forEach((x, k) => expect(x).toBeCloseTo(axis[k]!, 6)),
    );
    expect(cubeDirection(0, 0, 0.3)).toEqual(cubeDirection(4, 1, 0.3));
    expect(cubeDirection(0, 1, 0.3)).toEqual(cubeDirection(5, 0, 0.3));
    expect(() => cubeDirection(6, 0, 0)).toThrow();
  });
});
