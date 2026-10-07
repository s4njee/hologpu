import { expect, test } from '@playwright/test';
import { referenceColors } from '../../packages/core/src/measure.ts';
import type { SpikeSession } from '../../packages/core/src/spikes.ts';
declare global {
  interface Window {
    m0?: SpikeSession;
  }
}

async function ready(page: import('@playwright/test').Page, query = '') {
  await page.goto(`/${query}`);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
}

test('compute results match the CPU reference and six surfaces share the device', async ({
  page,
}) => {
  await ready(page);
  const colors = await page.evaluate(async () => {
    window.m0!.render(9);
    return window.m0!.readColors();
  });
  expect(colors).toEqual(referenceColors(7, 9));
  expect(await page.evaluate(() => window.m0!.sizes())).toHaveLength(6);
  await page.locator('.stage').evaluateAll((stages) => {
    for (const stage of stages) {
      (stage as HTMLElement).style.width = '8px';
      (stage as HTMLElement).style.height = '4px';
    }
  });
  await expect
    .poll(() =>
      page.evaluate(() => window.m0!.sizes().every((s) => s.width <= 16 && s.height <= 8)),
    )
    .toBe(true);
  const samples = await page.evaluate(async () => {
    window.m0!.render(9);
    const result = [];
    for (let i = 0; i < 6; i++) {
      const pixels = await window.m0!.readPixels(i);
      result.push(pixels.bytes.slice((pixels.width - 1) * 4, pixels.width * 4));
    }
    return result.flat();
  });
  expect(samples).toEqual(referenceColors(7, 9));
  expect(await page.evaluate(() => window.m0!.errors)).toEqual([]);
  expect(await page.evaluate(() => window.m0!.diagnostics)).toEqual([]);
});

test('canvas follows fractional resize, DPR and page scrolling', async ({ page }) => {
  await ready(page);
  await page
    .locator('.stage')
    .first()
    .evaluate((stage: HTMLElement) => {
      stage.style.width = '133.25px';
      stage.style.height = '79.5px';
    });
  await expect
    .poll(() =>
      page.evaluate(() =>
        Math.abs(window.m0!.sizes()[0]!.width - 133.25 * Math.min(devicePixelRatio, 2)),
      ),
    )
    .toBeLessThanOrEqual(1);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Math.abs(window.m0!.sizes()[0]!.height - 79.5 * Math.min(devicePixelRatio, 2)),
      ),
    )
    .toBeLessThanOrEqual(1);
  const before = await page.locator('canvas').first().boundingBox();
  await page.evaluate(() => window.scrollTo(0, 150));
  const after = await page.locator('canvas').first().boundingBox();
  expect(after!.y).toBeCloseTo(before!.y - 150, 0);
  const colors = await page.evaluate(async () => {
    window.m0!.render(12);
    return window.m0!.readColors();
  });
  expect(colors).toEqual(referenceColors(7, 12));
  expect(await page.evaluate(() => window.m0!.errors)).toEqual([]);
});

test('direct target mode works without owned float textures', async ({ page }) => {
  await ready(page, '?count=1&mode=direct');
  expect(await page.evaluate(() => window.m0!.memory().ownedTextureBytes)).toBe(0);
  expect(await page.evaluate(() => window.m0!.readColors())).toEqual(referenceColors(7, 0));
  expect(await page.evaluate(() => window.m0!.errors)).toEqual([]);
});

test('missing WebGPU keeps DOM content available', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }));
  await page.goto('/');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'fallback');
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('#animate')).toBeDisabled();
});

test('disposal stops rendering and permits a fresh session', async ({ page }) => {
  await ready(page, '?count=1');
  await page.evaluate(() => {
    window.m0!.start();
    window.m0!.dispose();
    window.m0!.dispose();
  });
  await page.reload();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  expect(await page.evaluate(() => window.m0!.errors)).toEqual([]);
});

test('benchmark records measured frames, scrolling and allocation sizes', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(() => window.m0!.benchmark(3, 1, true));
  expect(result.cpuEncodeMs.count).toBe(3);
  expect(result.rafIntervalMs.count).toBe(3);
  expect(result.maxScrollY).toBeGreaterThan(0);
  expect(result.memory.ownedTextureBytes).toBe(
    result.sizes.reduce((sum, s) => sum + s.width * s.height * 8, 0),
  );
  expect(result.errors).toEqual([]);
});
