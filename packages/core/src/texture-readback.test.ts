import { it, expect } from 'vitest';
import { halfToFloat } from './texture-readback.ts';
it('decodes exact IEEE half-float values used by simulation taps', () => {
  expect(halfToFloat(0x3c00)).toBe(1);
  expect(halfToFloat(0xc000)).toBe(-2);
  expect(halfToFloat(0x7bff)).toBe(65504);
  expect(halfToFloat(0x0001)).toBe(2 ** -24);
  expect(halfToFloat(0x03ff)).toBe(1023 * 2 ** -24);
  expect(halfToFloat(0x8000)).toBe(-0);
  expect(halfToFloat(0x7c00)).toBe(Infinity);
  expect(halfToFloat(0xfc00)).toBe(-Infinity);
  expect(halfToFloat(0x7e00)).toBeNaN();
});
