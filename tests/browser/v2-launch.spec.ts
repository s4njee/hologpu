import { expect, test, type Page } from '@playwright/test';
import type { Attachment, PageBudgetSnapshot } from '../../packages/dom/src/index.ts';
type DemoWindow = Window & {
  launchDemo: {
    attachments: Attachment[];
    budget: () => PageBudgetSnapshot;
    configureBudget: (options: { milliseconds?: number; enabled?: boolean }) => void;
  };
};
async function ready(page: Page, query = 'reduce=1') {
  await page.goto('/launch.html?' + query);
  await expect
    .poll(
      () => page.evaluate(() => (window as unknown as DemoWindow).launchDemo?.attachments.length),
      { timeout: 45000 },
    )
    .toBe(10);
  await expect(page.locator('#status')).not.toHaveText('Surface setup failed');
}
test('launch page retains real copy and settled surfaces at desktop and mobile sizes', async ({
  page,
}, info) => {
  await ready(page);
  await expect(page.getByRole('heading', { name: 'Good ideas need room.' })).toBeVisible();
  const state = await page.evaluate(() =>
    (window as unknown as DemoWindow).launchDemo.attachments.map((item) => ({
      state: item.state,
      motion: item.field?.reducedMotion,
      errors: item.field?.session.errors,
      size: item.field?.surface?.size,
      timings: item.timings,
    })),
  );
  for (const item of state) {
    expect(item.state).toBe('ready');
    expect(item.motion).toBe(true);
    expect(item.errors).toEqual([]);
    expect(item.size?.every((n) => n > 1)).toBe(true);
    expect(item.timings.firstFrameMs).toBeGreaterThan(0);
  }
  expect(
    await page
      .locator('.card')
      .evaluateAll((cards) =>
        cards.every(
          (card) =>
            Math.abs(card.getBoundingClientRect().top - cards[0]!.getBoundingClientRect().top) < 2,
        ),
      ),
  ).toBe(true);
  if (info.project.name.startsWith('swiftshader'))
    await expect(page).toHaveScreenshot('launch-desktop.png', {
      fullPage: true,
      animations: 'disabled',
    });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await expect(page.getByRole('heading', { name: 'Good ideas need room.' })).toBeVisible();
  // Prime native text layers after the DPR/viewport reflow before a full-page capture.
  // Offscreen compositor tiles can otherwise be blank on software DPR 2.
  await page.evaluate(async () => {
    for (const id of ['details', 'product', 'join', 'home']) {
      document.getElementById(id)!.scrollIntoView({ behavior: 'instant' });
      for (let i = 0; i < 2; i++) await new Promise(requestAnimationFrame);
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  if (info.project.name.startsWith('swiftshader'))
    await expect(page).toHaveScreenshot('launch-mobile.png', {
      fullPage: true,
      animations: 'disabled',
    });
});
test('fallback page keeps authored image, native controls, copy and links', async ({ page }) => {
  await ready(page, 'fallback=1');
  expect(
    await page.evaluate(() =>
      (window as unknown as DemoWindow).launchDemo.attachments.every(
        (a) => a.state === 'fallback' && !a.field,
      ),
    ),
  ).toBe(true);
  await expect(
    page.getByRole('img', {
      name: 'Signal console with six rotary controls and a green waveform display',
    }),
  ).toHaveCSS('opacity', '1');
  await page.locator('#scrub').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#scrub-value')).toHaveText('51%');
  await page.locator('#palette').selectOption('paper');
  await expect(page.locator('body')).toHaveAttribute('data-palette', 'paper');
  await page.getByRole('link', { name: 'Find your focus' }).click();
  await expect(page).toHaveURL(/#product$/);
});
test('product scrub works after pointer activity and keyboard control', async ({ page }) => {
  await ready(page, '');
  await page.locator('#shot').hover();
  await page.locator('#scrub').scrollIntoViewIfNeeded();
  await page.locator('#scrub').focus();
  await page.keyboard.press('ArrowRight');
  const result = await page.evaluate(() => {
    const item = (window as unknown as DemoWindow).launchDemo.attachments.find(
      (a) => a.effect.id === 'depth-parallax',
    )!;
    return { mode: item.params.mode, progress: item.params.progress };
  });
  expect(result.progress).toBeCloseTo(0.51);
  expect(result.mode).toBe('progress');
  await page.locator('#palette').selectOption('dusk');
  await expect(page.locator('body')).toHaveAttribute('data-palette', 'dusk');
});
test('page budget excludes paused and offscreen work and warns when a live estimate exceeds it', async ({
  page,
}) => {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  await ready(page, '');
  const initial = await page.evaluate(() => (window as unknown as DemoWindow).launchDemo.budget());
  expect(initial.expectedMs).toBeLessThanOrEqual(4);
  expect(initial.undeclared).toEqual([]);
  expect(initial.expectedMs).toBeGreaterThan(0);
  await page.evaluate(() => {
    (window as unknown as DemoWindow).launchDemo.configureBudget({
      milliseconds: 0.001,
      enabled: true,
    });
  });
  await expect.poll(() => warnings.some((s) => s.includes('declared page budget'))).toBe(true);
  await page.evaluate(() => {
    for (const item of (window as unknown as DemoWindow).launchDemo.attachments) item.pause();
  });
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as DemoWindow).launchDemo.budget().expectedMs),
    )
    .toBe(0);
  await page.evaluate(() => {
    for (const item of (window as unknown as DemoWindow).launchDemo.attachments) item.destroy();
  });
  expect(
    await page.evaluate(() => (window as unknown as DemoWindow).launchDemo.budget().fields.length),
  ).toBe(0);
});
test('device page exercises native controls and the complete P0 set', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/device-check.html');
  await page.locator('#native').click();
  await expect(page.locator('#clicks')).toHaveText('1');
  await page.locator('#progress').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#value')).toHaveText('51');
  await page.locator('#run').click();
  await expect(page.locator('#save')).toBeEnabled({ timeout: 60000 });
  const report = JSON.parse(await page.locator('#report').inputValue());
  expect(report.rows).toHaveLength(10);
  expect(report.errors).toEqual([]);
  expect(report.cleanup).toBe(true);
  for (const row of report.rows) {
    expect(row.state).toBe('ready');
    expect(row.gpuErrors).toEqual([]);
    expect(row.poseStable).toBe(true);
    expect(row.unchangedScheduledFrames).toBe(0);
  }
});
