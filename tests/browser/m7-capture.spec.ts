import { test, expect, chromium } from '@playwright/test';
test('Flagged Chrome captures real DOM paint, text edits and resize; source DOM survives teardown', async ({}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chrome-hardware',
    'HTML-in-canvas is a separate flagged Chrome experiment',
  );
  test.setTimeout(90000);
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-blink-features=CanvasDrawElement'],
  });
  const page = await browser.newPage({
    viewport: { width: 1400, height: 1000 },
    deviceScaleFactor: 1,
  });
  try {
    await page.routeWebSocket(/.*/, (socket) => socket.close());
    await page.goto(
      'http://127.0.0.1:5175/?effect=backdrop-glass&playing=false&quality=fixed&resolution=.5&params=' +
        encodeURIComponent(JSON.stringify({ refraction: 0, frost: 0, dispersion: 0 })),
    );
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready', {
      timeout: 30000,
    });
    await expect(page.locator('#backdrop-experiment button')).toBeEnabled();
    await page.locator('#backdrop-experiment button').click();
    await expect
      .poll(() => page.evaluate(() => Object.keys(window.hologpu.field!.textureTaps)))
      .toContain('domCapture');
    const snapshot = () =>
      page.evaluate(async () => {
        const f = window.hologpu.field!;
        f.advance(0);
        const tap = await f.readTap('domCapture');
        return {
          width: tap.width,
          height: tap.height,
          values: Array.from(tap.values),
          pixels: Array.from((await f.readPixels()).pixels),
        };
      });
    const first = await snapshot();
    expect(first.width).toBe(320);
    expect(first.height).toBe(160);
    const pixel = (x: number, y: number) =>
      first.values.slice((x + y * 320) * 4, (x + y * 320) * 4 + 4);
    expect(pixel(5, 5)[0]).toBeGreaterThan(pixel(5, 5)[2]!);
    expect(pixel(315, 5)[2]).toBeGreaterThan(pixel(315, 5)[0]!);
    await page.locator('#backdrop-content input').fill('GPU paint changed');
    await expect
      .poll(async () => JSON.stringify((await snapshot()).values))
      .not.toBe(JSON.stringify(first.values));
    const second = await snapshot();
    expect(second.pixels).not.toEqual(first.pixels);
    await page.locator('#backdrop-content').evaluate((el: HTMLElement) => {
      el.style.width = '256px';
      el.style.background = '#00ff00';
    });
    await expect
      .poll(() => page.evaluate(() => window.hologpu.field!.textureTaps.domCapture?.width))
      .toBe(256);
    const resized = await snapshot();
    expect(resized.values[1]).toBeGreaterThan(0.9);
    expect(resized.values[0]).toBeLessThan(0.01);
    // Straight sRGB capture is converted to linear premultiplied colour before filtering.
    await page.locator('#backdrop-content').evaluate((el: HTMLElement) => {
      el.style.background = 'rgba(255,0,0,.5)';
    });
    await expect.poll(async () => (await snapshot()).values[3]).toBeCloseTo(0.5, 2);
    const alphaResult = (await snapshot()).pixels.slice(0, 4);
    expect(alphaResult).toEqual([128, 0, 0, 128]);
    const generation = await page.evaluate(() => {
      const f = window.hologpu.field!,
        generation = f.session.generation;
      f.session.device.destroy();
      return generation;
    });
    await expect
      .poll(() => page.evaluate(() => window.hologpu.field!.session.generation))
      .toBeGreaterThan(generation);
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready', {
      timeout: 30000,
    });
    await expect
      .poll(() => page.evaluate(() => window.hologpu.field!.textureTaps.domCapture?.width))
      .toBe(256);
    expect((await snapshot()).values[3]).toBeCloseTo(0.5, 2);
    const result = await page.evaluate(() => {
      const f = window.hologpu.field!,
        s = f.session;
      f.destroy();
      const content = document.querySelector('#backdrop-content')!;
      content.setAttribute('data-survives', 'yes');
      return {
        errors: s.errors,
        refs: s.resources.stats().references,
        memory: f.memory(),
        survives: content.isConnected,
        text: (content.querySelector('input') as HTMLInputElement).value,
      };
    });
    expect(result.errors).toEqual([]);
    expect(result.refs).toBe(0);
    expect(result.memory.textureBytes).toBe(0);
    expect(result.survives).toBe(true);
    expect(result.text).toBe('GPU paint changed');
  } finally {
    await browser.close();
  }
});
