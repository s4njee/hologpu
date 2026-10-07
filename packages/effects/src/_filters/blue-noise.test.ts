import { expect, test } from 'vitest';
import { blueNoiseRanks } from './blue-noise.ts';
test('Void/cluster tile is seeded, uniform and suppresses low-frequency binary pattern energy', () => {
  const size = 32,
    tile = blueNoiseRanks(size, 7),
    histogram = new Uint32Array(256);
  tile.forEach((value) => (histogram[value] = histogram[value]! + 1));
  expect(Array.from(histogram)).toEqual(Array(256).fill(4));
  expect(blueNoiseRanks(size, 7)).toEqual(tile);
  expect(blueNoiseRanks(size, 8)).not.toEqual(tile);
  const power = (pattern: readonly number[]) => {
    let energy = 0;
    for (let fy = -3; fy <= 3; fy++)
      for (let fx = -3; fx <= 3; fx++) {
        if (fx === 0 && fy === 0) continue;
        let re = 0,
          im = 0;
        for (let y = 0; y < size; y++)
          for (let x = 0; x < size; x++) {
            const angle = (2 * Math.PI * (fx * x + fy * y)) / size,
              value = pattern[y * size + x]! - 0.5;
            re += value * Math.cos(angle);
            im += value * Math.sin(angle);
          }
        energy += re * re + im * im;
      }
    return energy;
  };
  let state = 7;
  const white = Array.from({ length: size * size }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state < 2147483648 ? 0 : 1;
  });
  expect(power(Array.from(tile, (value) => (value < 128 ? 0 : 1)))).toBeLessThan(
    power(white) * 0.2,
  );
});
