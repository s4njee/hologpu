import { test, expect } from '@playwright/test';
for (const id of ['instances', 'terrain', 'material-ball', 'glass'])
  test(`${id}: rebuilds owned geometry after device loss with identical paused output`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.routeWebSocket(/.*/, (socket) => socket.close());
    await page.goto(
      '/?' +
        new URLSearchParams({
          effect: id,
          playing: 'false',
          quality: 'fixed',
          resolution: '.5',
          params: JSON.stringify(
            id === 'instances' ? { count: 64 } : id === 'terrain' ? { segments: 16 } : {},
          ),
        }),
    );
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready', {
      timeout: 30000,
    });
    await page.locator('#stage').evaluate((el: HTMLElement) => {
      el.style.width = '162px';
      el.style.height = '162px';
    });
    await expect
      .poll(() => page.evaluate(() => window.hologpu.field!.surface!.size[0]))
      .toBe(await page.evaluate(() => 80 * devicePixelRatio));
    const result = await page.evaluate(async () => {
      const f = window.hologpu.field!,
        session = f.session,
        generation = session.generation;
      f.params.tint = '#d89b75';
      f.drawAt(0.5, 13);
      const before = Array.from((await f.readPixels()).pixels),
        params = JSON.stringify(f.store.snapshot());
      await new Promise<void>((resolve, reject) => {
        const remove = f.onChange(() => {
          if (f.state === 'ready' && session.generation > generation) {
            remove();
            resolve();
          } else if (f.state === 'error') {
            remove();
            reject(new Error(session.errors.join('\n')));
          }
        });
        session.device.destroy();
      });
      f.drawAt(0.5, 13);
      const after = Array.from((await f.readPixels()).pixels),
        answer = {
          equal: JSON.stringify(before) === JSON.stringify(after),
          sameParams: params === JSON.stringify(f.store.snapshot()),
          newDevice: session.generation > generation,
          errors: [...session.errors],
          bytes: f.memory().textureBytes,
        };
      f.destroy();
      return { ...answer, remaining: f.memory(), references: session.resources.stats().references };
    });
    expect(result.equal).toBe(true);
    expect(result.sameParams).toBe(true);
    expect(result.newDevice).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.remaining.textureBytes).toBe(0);
    expect(result.remaining.bufferBytes).toBe(0);
    expect(result.references).toBe(0);
  });
