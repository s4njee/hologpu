import { describe, expect, it } from 'vitest';
import { localObstacleRect, packObstacleRects } from './dom-rects.ts';
describe('DOM rectangles', () => {
  it('subtracts viewport origin, clips and normalizes transformed axis aligned boxes', () => {
    expect(
      localObstacleRect(
        { left: 80, top: 60, right: 160, bottom: 140 },
        { left: 100, top: 40, width: 200, height: 100 },
      ),
    ).toEqual([0, 0.2, 0.3, 1]);
    expect(
      localObstacleRect(
        { left: 301, top: 0, right: 320, bottom: 20 },
        { left: 100, top: 0, width: 200, height: 100 },
      ),
    ).toBeUndefined();
    expect(
      localObstacleRect(
        { left: 0, top: 0, right: 1, bottom: 1 },
        { left: 0, top: 0, width: 0, height: 1 },
      ),
    ).toBeUndefined();
  });
  it('normalizes a heading to the inner canvas rather than a padded host border box', () => {
    const heading = { left: 44, top: 48, right: 140, bottom: 72 };
    expect(localObstacleRect(heading, { left: 32, top: 32, width: 192, height: 128 })).toEqual([
      0.0625, 0.125, 0.5625, 0.3125,
    ]);
    expect(localObstacleRect(heading, { left: 0, top: 0, width: 256, height: 192 })).not.toEqual([
      0.0625, 0.125, 0.5625, 0.3125,
    ]);
  });
  it('packs count followed by aligned vec4f storage, including a legal empty binding', () => {
    const bytes = packObstacleRects([
      [0.125, 0.25, 0.5, 0.75],
      [0, 0, 1, 1],
    ]);
    expect(new Uint32Array(bytes).slice(0, 4)).toEqual(new Uint32Array([2, 0, 0, 0]));
    expect([...new Float32Array(bytes).slice(4)]).toEqual([0.125, 0.25, 0.5, 0.75, 0, 0, 1, 1]);
    expect(packObstacleRects([]).byteLength).toBe(32);
  });
});
