import { test, expect } from '@playwright/test';
import type { EffectField } from '../../packages/core/src/index.ts';

type InkWindow = Window & {
  inkPaper: { field: EffectField; mask: HTMLCanvasElement; replay(play?: boolean): Promise<void> };
};

test('Top-fed pigment advances down paper while wax lettering rejects permanent deposits', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/ink-paper.html?playing=false&grid=96');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'paused');
  // Allow the initial ResizeObserver notification to finish its mask upload/reset.
  await page.evaluate(async () => {
    await (window as unknown as InkWindow).inkPaper.replay(false);
  });
  const initial = await page.evaluate(async () => {
    const field = (window as unknown as InkWindow).inkPaper.field;
    const deposit = await field.readTap('paper');
    return Array.from(deposit.values).reduce((sum, x) => sum + x, 0);
  });
  expect(initial).toBe(0);
  const first = await page.evaluate(async () => {
    const field = (window as unknown as InkWindow).inkPaper.field;
    field.advance(60);
    const dye = await field.readTap('dye');
    let top = 0,
      bottom = 0;
    for (let y = 0; y < dye.height; y++)
      for (let x = 0; x < dye.width; x++) {
        const amount =
          dye.values[(y * dye.width + x) * 4]! + dye.values[(y * dye.width + x) * 4 + 1]!;
        if (y < dye.height * 0.2) top += amount;
        if (y > dye.height * 0.5) bottom += amount;
      }
    return { top, bottom };
  });
  expect(first.top).toBeGreaterThan(1);
  expect(first.bottom).toBeLessThan(first.top * 0.01);

  const result = await page.evaluate(async () => {
    const { field, mask } = (window as unknown as InkWindow).inkPaper;
    for (let i = 0; i < 6; i++) {
      field.advance(60);
      await field.session.device.queue.onSubmittedWorkDone();
    }
    const paper = await field.readTap('paper');
    const pixels = mask.getContext('2d')!.getImageData(0, 0, mask.width, mask.height).data;
    let coated = 0,
      uncoated = 0,
      coatedAmount = 0,
      uncoatedAmount = 0;
    for (let y = 0; y < paper.height; y++)
      for (let x = 0; x < paper.width; x++) {
        const mx = Math.floor(((x + 0.5) / paper.width) * mask.width);
        const my = Math.floor(((y + 0.5) / paper.height) * mask.height);
        const coverage = pixels[(my * mask.width + mx) * 4 + 3]!;
        const amount =
          paper.values[(y * paper.width + x) * 4]! + paper.values[(y * paper.width + x) * 4 + 1]!;
        if (coverage === 255) {
          coated++;
          coatedAmount += amount;
        }
        if (coverage === 0 && y > paper.height * 0.25 && y < paper.height * 0.6) {
          uncoated++;
          uncoatedAmount += amount;
        }
      }
    return {
      coated,
      coatedMean: coatedAmount / coated,
      uncoatedMean: uncoatedAmount / uncoated,
      errors: field.session.errors,
      state: field.state,
    };
  });
  expect(result.coated).toBeGreaterThan(10);
  expect(result.coatedMean).toBeLessThan(0.00001);
  expect(result.uncoatedMean).toBeGreaterThan(0.03);
  expect(result.errors).toEqual([]);
  expect(result.state).toBe('ready');
  await page.screenshot({
    path: `artifacts/ink-paper-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test('Mobile controls update the secret and replay; reduced motion waits for an explicit reveal', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/ink-paper.html?grid=64');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'paused');
  await expect(page.locator('#pause')).toHaveText('Reveal');
  expect(
    await page.evaluate(() => (window as unknown as InkWindow).inkPaper.field.frame.time),
  ).toBe(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  await page.locator('#message').fill('Meet me / at midnight.');
  await page.locator('#write').click();
  await expect(page.locator('#ink')).toHaveAttribute('aria-label', /Meet me at midnight\./);
  await expect(page.locator('#pause')).toHaveText('Pause');
  await page.locator('#pause').click();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'paused');
  const changed = await page.evaluate(() => {
    const field = (window as unknown as InkWindow).inkPaper.field;
    return { playing: field.playing, reduced: field.reducedMotion, errors: field.session.errors };
  });
  expect(changed).toEqual({ playing: false, reduced: false, errors: [] });
  await page.locator('#flow').fill('0.3');
  await expect(page.locator('#flow-value')).toHaveText('Swift');
  expect(
    await page.evaluate(() => (window as unknown as InkWindow).inkPaper.field.params['paperFlow']),
  ).toBe(0.3);
  await page.locator('#replay').click();
  await expect(page.locator('#pause')).toHaveText('Pause');
  await page.evaluate(() => {
    const field = (window as unknown as InkWindow).inkPaper.field;
    field.frame.time = 24;
    field.render();
    field.session.submit();
  });
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'settled');
  await expect(page.locator('#pause')).toHaveText('Reveal again');
  expect(await page.evaluate(() => (window as unknown as InkWindow).inkPaper.field.playing)).toBe(
    false,
  );
  await page.locator('#pause').click();
  await expect(page.locator('#pause')).toHaveText('Pause');
});
