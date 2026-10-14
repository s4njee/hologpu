import { describe, expect, it } from 'vitest';
import { configurePageBudget, estimateEffectBudget } from './budget.ts';
describe('declared page budget', () => {
  it('scales render-target area including DPR and resolution', () => {
    const budget = { expectedMs: 0.5, referenceSize: [640, 400] as const };
    expect(estimateEffectBudget(budget, [640, 400])).toBe(0.5);
    expect(estimateEffectBudget(budget, [1280, 800])).toBe(2);
    expect(estimateEffectBudget(budget, [320, 200])).toBe(0.125);
  });
  it('rejects invalid page limits', () => {
    for (const milliseconds of [0, -1, Infinity, NaN])
      expect(() => configurePageBudget({ milliseconds })).toThrow(RangeError);
    configurePageBudget({ milliseconds: 4, enabled: false });
  });
});
