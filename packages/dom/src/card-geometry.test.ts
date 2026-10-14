import { describe, expect, it } from 'vitest';
import { resolveCornerRadii } from './card-geometry.ts';
describe('CSS corner normalization', () => {
  it('resolves every elliptical corner and percentages against the correct edge', () => {
    expect(resolveCornerRadii(['10% 20%', '12px 4px', '0', '8px'], 200, 100)).toEqual({
      radiiX: [20, 12, 0, 8],
      radiiY: [20, 4, 0, 8],
    });
  });
  it('scales all eight radii together when any adjacent pair overlaps', () => {
    expect(
      resolveCornerRadii(['80px 40px', '80px 40px', '20px 10px', '20px 10px'], 100, 100),
    ).toEqual({ radiiX: [50, 50, 12.5, 12.5], radiiY: [25, 25, 6.25, 6.25] });
  });
});
