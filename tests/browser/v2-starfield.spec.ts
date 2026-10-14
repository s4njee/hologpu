import { expect, test } from '@playwright/test';

// Dedicated precision regressions: no cross-adapter screenshot assumptions.
test('starfield: dusk and rebased long-running camera retain smooth seeded motion', async ({
  page,
}) => {
  await page.goto('/?effect=starfield&playing=false&resolution=1');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready', { timeout: 20000 });
  await page.locator('#stage').evaluate((node: HTMLElement) => {
    node.style.width = '258px';
    node.style.height = '194px';
  });
  await expect
    .poll(() => page.evaluate(() => window.hologpu.field!.surface!.size[0]))
    .toBe(await page.evaluate(() => 256 * devicePixelRatio));
  const result = await page.evaluate(async () => {
    const field = window.hologpu.field!;
    const read = async (time: number) => {
      field.drawAt(time, 7);
      return Array.from((await field.readPixels()).pixels);
    };
    const dusk = field.effect.presets.dusk!;
    field.store.patch({ ...dusk, density: 50, layers: 1, size: 3, speed: 0.25, twinkle: 0 });
    const start = 2 ** 24;
    const first = await read(start),
      repeat = await read(start),
      next = await read(start + 1 / 60);
    const changes = next.reduce((n, value, i) => n + Math.abs(value - first[i]!), 0);
    // This crosses an integer world-origin boundary at a deliberately large time.
    const boundary = 1000001 / (0.7 * 0.25 * 0.45 * 50);
    const before = await read(boundary - 0.00001),
      after = await read(boundary + 0.00001);
    const maximumJump = before.reduce(
      (maximum, value, i) => Math.max(maximum, Math.abs(value - after[i]!)),
      0,
    );
    return {
      dusk,
      deterministic: first.every((value, i) => value === repeat[i]),
      changes,
      maximumJump,
      errors: field.session.errors,
      diagnostics: field.diagnostics,
    };
  });
  expect(result.dusk.density).toBeCloseTo(26 / 3);
  expect(result.dusk.nebula).toBe(0);
  expect(result.deterministic).toBe(true);
  expect(result.changes).toBeGreaterThan(20);
  expect(result.maximumJump).toBeLessThanOrEqual(2);
  expect(result.errors).toEqual([]);
  expect(result.diagnostics).toEqual([]);
});
