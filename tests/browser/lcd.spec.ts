import { test, expect } from '@playwright/test';
import type { EffectField } from '../../packages/core/src/runtime.ts';

test.beforeEach(async ({ page }) => {
  // Other research work can update the shared Vite server during this suite.
  await page.routeWebSocket(/.*/, (socket) => socket.close());
});

test('Rain moves in the background and leaves the tablet and hands clear', async ({ page }) => {
  await page.goto('lcd.html');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready', { timeout: 60000 });
  await page.locator('#light-motion').click();
  await page.locator('#billboard-motion').click();
  await expect(page.locator('#rain-motion')).toHaveText('Play rain');
  const result = await page.evaluate(async () => {
    const field = (Reflect.get(window, 'lcdDemo') as { rainField: EffectField }).rainField;
    field.drawAt(0.5);
    const a = await field.readPixels();
    field.drawAt(1.1);
    const b = await field.readPixels();
    let changed = 0,
      foreground = 0;
    for (let y = 0; y < b.height; y++)
      for (let x = 0; x < b.width; x++) {
        const u = x / b.width,
          v = y / b.height;
        const i = (y * b.width + x) * 4;
        if (Math.abs(a.pixels[i + 3]! - b.pixels[i + 3]!) > 1) changed++;
        if (u > 0.36 && u < 0.69 && v > 0.33 && v < 0.78 && b.pixels[i + 3]! > 0) foreground++;
      }
    return { changed, foreground, errors: field.session.errors };
  });
  expect(result.changed).toBeGreaterThan(100);
  expect(result.foreground).toBe(0);
  expect(result.errors).toEqual([]);
  await page.locator('#rain-motion').click();
  await expect(page.locator('#rain-motion')).toHaveText('Pause rain');
  await page.locator('#original').click();
  await expect(page.locator('.rain-canvas')).toBeHidden();
});

test('Billboards scroll down with HoloCSS and selected fixtures flicker through real bloom passes', async ({
  page,
}) => {
  await page.goto('lcd.html');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready', { timeout: 60000 });
  await expect(page.locator('.billboard')).toHaveCount(6);
  const phase = () =>
    page
      .locator('.billboard-scroll')
      .first()
      .evaluate((strip) => getComputedStyle(strip).getPropertyValue('--hcss-number'));
  const firstPhase = await phase();
  await expect.poll(phase).not.toBe(firstPhase);
  await page.locator('#billboard-motion').click();
  await expect(page.locator('#billboard-motion')).toHaveText('Play signs');
  await expect(page.locator('#billboards')).toHaveAttribute('data-hcss-motion', 'none');
  await page.locator('#light-motion').click();
  const result = await page.evaluate(async () => {
    const demo = Reflect.get(window, 'lcdDemo') as { field: EffectField; lightField: EffectField };
    const field = demo.lightField;
    field.drawAt(0.5);
    const a = await field.readPixels();
    field.drawAt(3.2);
    const b = await field.readPixels();
    const changed = b.pixels.filter((v, i) => i % 4 !== 3 && Math.abs(v - a.pixels[i]!) > 1).length;
    return {
      changed,
      taps: Object.keys(field.textureTaps),
      errors: field.session.errors,
      lcdPlaying: demo.field.playing,
    };
  });
  expect(result.changed).toBeGreaterThan(25);
  expect(result.taps.filter((name) => name.includes('bloom')).length).toBeGreaterThanOrEqual(4);
  expect(result.errors).toEqual([]);
  expect(result.lcdPlaying).toBe(false);
  await page.locator('#original').click();
  await expect(page.locator('#scene')).toHaveClass(/show-original/);
  await expect(page.locator('.light-canvas')).toBeHidden();
});

test('Every surface mode responds to mouse movement with both map encodings', async ({ page }) => {
  await page.goto('lcd.html');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready', { timeout: 60000 });
  await page.locator('#light-motion').click();
  await page.locator('#scene').evaluate((scene: HTMLElement) => {
    scene.style.width = '480px';
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => (Reflect.get(window, 'lcdDemo') as { field: EffectField }).field.canvas.width,
      ),
    )
    .toBeLessThan(800);
  await page.locator('#amount').fill('55');
  const box = (await page.locator('#lcd-canvas').boundingBox())!;
  const read = () =>
    page.evaluate(async () => {
      const read = await (
        Reflect.get(window, 'lcdDemo') as { field: EffectField }
      ).field.readPixels();
      const samples: number[] = [];
      for (let y = 0; y < 40; y++)
        for (let x = 0; x < 64; x++) {
          const sx = Math.floor((0.33 + (x / 64) * 0.38) * read.width);
          const sy = Math.floor((0.3 + (y / 40) * 0.48) * read.height);
          const i = (sy * read.width + sx) * 4;
          samples.push(read.pixels[i]!, read.pixels[i + 1]!, read.pixels[i + 2]!);
        }
      return samples;
    });
  const move = async (u: number, v: number) => {
    await page.mouse.move(box.x + box.width * u, box.y + box.height * v);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const demo = Reflect.get(window, 'lcdDemo') as {
            field: EffectField;
            mapField: EffectField;
          };
          return (
            JSON.stringify(demo.mapField.params['center']) ===
              JSON.stringify(demo.field.frame.pointer) &&
            !demo.mapField.dirty &&
            !demo.field.dirty
          );
        }),
      )
      .toBe(true);
  };
  for (const encoding of ['normal', 'flow']) {
    await page.selectOption('#encoding', encoding);
    for (const mode of ['ripple', 'liquid', 'glass', 'refraction']) {
      await page.locator(`[data-mode="${mode}"]`).click();
      await move(0.46, 0.48);
      const before = await read();
      await move(0.58, 0.61);
      const after = await read();
      const changed = after.filter((value, i) => Math.abs(value - before[i]!) > 2).length;
      expect(changed, `${mode} / ${encoding} should follow the pointer`).toBeGreaterThan(100);
    }
  }
  expect(
    await page.evaluate(
      () => (Reflect.get(window, 'lcdDemo') as { field: EffectField }).field.session.errors,
    ),
  ).toEqual([]);
});

test('LCD refraction changes the glass while preserving the street and foreground hands', async ({
  page,
}, testInfo) => {
  await page.goto('lcd.html');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready', { timeout: 60000 });
  const result = await page.evaluate(async () => {
    const field = (Reflect.get(window, 'lcdDemo') as { field: EffectField }).field;
    field.setReducedMotion(false);
    field.frame.pointer = [0.52, 0.55];
    field.store.set('s1_blend', 0);
    field.drawAt(1.2);
    const original = await field.readPixels();
    field.store.set('s1_blend', 1);
    field.drawAt(1.2);
    const refracted = await field.readPixels();
    let outsideChanged = 0,
      glassChanged = 0,
      handsChanged = 0;
    for (let y = 0; y < original.height; y++) {
      for (let x = 0; x < original.width; x++) {
        const u = x / original.width,
          v = y / original.height;
        const i = (y * original.width + x) * 4;
        const difference = Math.max(
          ...[0, 1, 2].map((channel) =>
            Math.abs(original.pixels[i + channel]! - refracted.pixels[i + channel]!),
          ),
        );
        if (difference <= 1) continue;
        if (u < 0.32 || u > 0.71 || v < 0.29 || v > 0.78) outsideChanged++;
        if (u > 0.45 && u < 0.6 && v > 0.4 && v < 0.68) glassChanged++;
        const leftThumb = u > 0.359 && u < 0.369 && v > 0.55 && v < 0.567;
        const rightThumb = u > 0.66 && u < 0.67 && v > 0.56 && v < 0.575;
        if (leftThumb || rightThumb) handsChanged++;
      }
    }
    return { outsideChanged, glassChanged, handsChanged, errors: field.session.errors };
  });
  expect(result.outsideChanged).toBe(0);
  expect(result.handsChanged).toBe(0);
  expect(result.glassChanged).toBeGreaterThan(1000);
  expect(result.errors).toEqual([]);
  await page.locator('[data-mode="liquid"]').click();
  await expect(page.locator('[data-mode="liquid"]')).toHaveAttribute('aria-pressed', 'true');
  await page.selectOption('#encoding', 'flow');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (Reflect.get(window, 'lcdDemo') as { field: EffectField }).field.params['s0_encoding'],
      ),
    )
    .toBe('flow');
  await page.locator('#amount').fill('80');
  await expect(page.locator('#amount-value')).toHaveText('80%');
  for (const mode of ['glass', 'refraction', 'ripple']) {
    await page.locator(`[data-mode="${mode}"]`).click();
    await expect(page.locator(`[data-mode="${mode}"]`)).toHaveAttribute('aria-pressed', 'true');
  }
  await page.locator('#original').click();
  await expect(page.locator('#original')).toHaveText('View effect');
  await page.locator('#original').click();
  expect(
    await page.evaluate(
      () => (Reflect.get(window, 'lcdDemo') as { field: EffectField }).field.session.errors,
    ),
  ).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('lcd-demo.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#original')).toBeVisible();
});

test('Defaults to Ripple at 10% and remains still without pointer input', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('lcd.html');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready', { timeout: 60000 });
  await expect(page.locator('[data-mode="ripple"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#amount-value')).toHaveText('10%');
  const snapshot = () =>
    page.evaluate(() => {
      const demo = Reflect.get(window, 'lcdDemo') as { field: EffectField; mapField: EffectField };
      return {
        time: demo.field.frame.time,
        center: demo.mapField.params['center'],
        playing: demo.field.playing,
        mapPlaying: demo.mapField.playing,
        polling: demo.field.polling,
        mapPolling: demo.mapField.polling,
      };
    });
  const before = await snapshot();
  await page.waitForTimeout(500);
  expect(await snapshot()).toEqual(before);
  expect(before).toMatchObject({
    time: 0,
    playing: false,
    mapPlaying: false,
    polling: false,
    mapPolling: false,
  });
});

test('The photograph remains visible without WebGPU', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }));
  await page.goto('lcd.html');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#photo')).toBeVisible();
  expect(
    await page
      .locator('#photo')
      .evaluate((photo: HTMLImageElement) => photo.complete && photo.naturalWidth > 0),
  ).toBe(true);
  await expect(page.locator('#original')).toBeDisabled();
});
