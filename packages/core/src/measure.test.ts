import { describe, expect, it } from 'vitest';
import { backingSize, referenceColors, summarize } from './measure.ts';

describe('physical canvas dimensions', () => {
  it('uses exact device pixels, caps DPR, and preserves aspect ratio at the GPU limit', () => {
    expect(backingSize(100.25, 40.5, 1.5, 4096, { width: 151, height: 61 })).toEqual({
      width: 151,
      height: 61,
    });
    expect(backingSize(100, 50, 3, 4096, { width: 300, height: 150 })).toEqual({
      width: 200,
      height: 100,
    });
    expect(backingSize(3000, 1500, 2, 4096)).toEqual({ width: 4096, height: 2048 });
    expect(backingSize(100, 50, 2, 4096, { width: 100, height: 50 })).toEqual({
      width: 200,
      height: 100,
    });
    expect(backingSize(0, 0, 1, 4096)).toEqual({ width: 1, height: 1 });
  });
});
it('summarizes frame samples without changing their order', () => {
  const samples = [3, 1, 2];
  expect(summarize(samples)).toEqual({ count: 3, mean: 2, p50: 2, p95: 3, max: 3 });
  expect(samples).toEqual([3, 1, 2]);
  expect(summarize([]).count).toBe(0);
});
it('uses unsigned wrapping for deterministic compute input', () => {
  expect(referenceColors(0xffffffff, 1)).toEqual(referenceColors(0, 0));
  expect(referenceColors(7, 9)).toHaveLength(24);
});
