import { describe, it, expect } from 'vitest';
import {
  InputManager,
  inputMipCount,
  inputTextureBytes,
  inputSRGBToLinear,
  normalizeInputSource,
} from './inputs.ts';
import type { DeviceSession } from './device.ts';
describe('texture input contracts', () => {
  it('uses the sRGB breakpoint and maps encoded midgrey to linear intensity', () => {
    expect(inputSRGBToLinear(0)).toBe(0);
    expect(inputSRGBToLinear(1)).toBe(1);
    expect(inputSRGBToLinear(0.04045)).toBeCloseTo(0.003130805, 8);
    expect(inputSRGBToLinear(128 / 255)).toBeCloseTo(0.2158605, 7);
  });
  it('accounts for complete odd and rectangular mip chains', () => {
    expect(inputMipCount(3, 5)).toBe(3);
    expect(inputTextureBytes(3, 5)).toBe((15 + 2 + 1) * 8);
    expect(inputTextureBytes(1920, 1080)).toBe(22117240);
    expect(() => inputMipCount(0, 1)).toThrow();
    expect(() => inputMipCount(1.5, 1)).toThrow();
  });
  it('allocates nothing before an input, normalizes descriptors, rejects ambiguous objects', () => {
    const manager = new InputManager({} as DeviceSession);
    expect(manager.memory()).toEqual({ textureBytes: 0, bufferBytes: 0 });
    expect(manager.get('image')).toBeUndefined();
    expect(normalizeInputSource('GPU')).toEqual({ kind: 'text', text: 'GPU' });
    expect(normalizeInputSource(null)).toBeNull();
    expect(() => normalizeInputSource({ source: 'image' })).toThrow('Unsupported');
  });
});
