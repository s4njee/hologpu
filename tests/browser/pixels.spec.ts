import { expect, test } from '@playwright/test';
import { referenceColors } from '../../packages/core/src/measure.ts';
import type { SpikeSession } from '../../packages/core/src/spikes.ts';
declare global {
  interface Window {
    m0?: SpikeSession;
  }
}

test('seeded float resolve readback is repeatable and alpha is premultiplied', async ({ page }) => {
  await page.goto('/?count=1');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  const adapter = await page.evaluate(() => window.m0!.report.adapter);
  expect(`${adapter.architecture} ${adapter.description}`).toMatch(/swiftshader/i);
  expect(adapter.isFallbackAdapter).toBe(true);
  await page.locator('.stage').evaluate((stage: HTMLElement) => {
    stage.style.width = '65px';
    stage.style.height = '33px';
  });
  await expect
    .poll(() => page.evaluate(() => window.m0!.sizes()[0]!.width))
    .toBe(await page.evaluate(() => 65 * devicePixelRatio));
  const capture = () =>
    page.evaluate(async () => {
      window.m0!.render(9);
      return window.m0!.readPixels();
    });
  const first = await capture();
  expect(await capture()).toEqual(first);
  const reference = referenceColors(7, 9).slice(0, 4);
  // Every pixel, including row-padding boundaries, must match the compute reference.
  let maxError = 0;
  for (let y = 0; y < first.height; y++) {
    for (let x = 0; x < first.width; x++) {
      const alpha = x + 0.5 < first.width / 2 ? 0.5 : 1;
      for (let c = 0; c < 4; c++) {
        const expected = Math.round(reference[c]! * alpha);
        maxError = Math.max(
          maxError,
          Math.abs(first.bytes[(y * first.width + x) * 4 + c]! - expected),
        );
      }
    }
  }
  expect(maxError).toBeLessThanOrEqual(1);
  await expect(page.locator('.stage')).toHaveScreenshot('m0-premultiplied.png', {
    scale: 'css',
    maxDiffPixels: 0,
  });
  const changed = await page.evaluate(async () => {
    window.m0!.render(10);
    return window.m0!.readPixels();
  });
  expect(changed.bytes).not.toEqual(first.bytes);
  expect(await page.evaluate(() => window.m0!.errors)).toEqual([]);
});
