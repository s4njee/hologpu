import { expect, test, type Page } from '@playwright/test';
import type { Attachment } from '../../packages/dom/src/index.ts';
import type { EffectField } from '../../packages/core/src/index.ts';

type AmbientWindow = Window & {
  ambientDemo: { attachments: Attachment[]; fields: EffectField[] };
};

test.beforeEach(async ({ page }) => {
  // Keep both real hosts visible during scheduler assertions; layout cases override this.
  await page.setViewportSize({ width: 1200, height: 2000 });
});

async function demo(page: Page, query = 'reduce=1') {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ contentType: 'text/css', body: '' }),
  );
  await page.goto('/ambient.html?' + query);
  await expect
    .poll(
      () =>
        page.evaluate(() => (window as unknown as AmbientWindow).ambientDemo?.attachments.length),
      { timeout: 25_000 },
    )
    .toBe(2);
  await page.evaluate(async () => {
    await document.fonts.ready;
    const fields = (window as unknown as AmbientWindow).ambientDemo.fields;
    await fields[0]?.session.device.queue.onSubmittedWorkDone();
  });
}

async function observeDraws(page: Page) {
  await page.evaluate(() => {
    for (const item of (window as unknown as AmbientWindow).ambientDemo.attachments) {
      item.host.dataset['draws'] = '0';
      item.field!.onRendered(() => {
        item.host.dataset['draws'] = String(Number(item.host.dataset['draws']) + 1);
      });
    }
  });
}

async function counts(page: Page) {
  return page
    .locator('#drift, #network')
    .evaluateAll((hosts) => hosts.map((host) => Number((host as HTMLElement).dataset['draws'])));
}

async function settled(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as AmbientWindow).ambientDemo.fields.every(
          (f) => !f.playing && !f.dirty,
        ),
      ),
    )
    .toBe(true);
}

for (const mobile of [false, true])
  test(`ambient fields keep readable copy in a ${mobile ? 'mobile' : 'desktop'} layout`, async ({
    page,
  }, info) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1200, height: 900 });
    await demo(page);
    await page.evaluate(async () => {
      const fields = (window as unknown as AmbientWindow).ambientDemo.fields;
      for (const field of fields) {
        field.session.scheduler.setHidden(true);
        field.visible = true;
        field.beforeFrame();
        field.render();
        field.dirty = false;
      }
      fields[0]!.session.submit();
      await fields[0]!.session.device.queue.onSubmittedWorkDone();
    });
    const result = await page.evaluate(() => {
      const d = (window as unknown as AmbientWindow).ambientDemo;
      return {
        states: d.attachments.map((a) => a.state),
        ids: d.fields.map((f) => f.effect.id),
        reduced: d.fields.map((f) => f.reducedMotion),
        playing: d.fields.map((f) => f.playing),
        errors: d.fields.flatMap((f) => f.session.errors),
        overflow: document.documentElement.scrollWidth - innerWidth,
        boxes: d.attachments.map((a) => [a.host.clientWidth, a.host.clientHeight]),
      };
    });
    expect(result).toMatchObject({
      states: ['ready', 'ready'],
      ids: ['particle-drift', 'constellation'],
      reduced: [true, true],
      playing: [false, false],
      errors: [],
    });
    expect(result.overflow).toBeLessThanOrEqual(1);
    expect(result.boxes.every(([width, height]) => width! > 250 && height! > 200)).toBe(true);
    await expect(
      page.getByRole('heading', { name: 'A little atmosphere. Plenty of room.' }),
    ).toBeVisible();
    if (info.project.name.startsWith('swiftshader'))
      await expect(page).toHaveScreenshot(`ambient-${mobile ? 'mobile' : 'desktop'}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.01,
      });
  });

test('native intensity and palette controls update the fields through CSS tokens', async ({
  page,
}) => {
  await demo(page);
  await observeDraws(page);
  await settled(page);
  const initial = await counts(page);
  const before = await Promise.all(
    ['drift', 'network'].map((id) => page.locator('#' + id).screenshot()),
  );
  await page.locator('#intensity').fill('0.35');
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as AmbientWindow).ambientDemo.attachments.map(
          (a) => a.params['intensity'],
        ),
      ),
    )
    .toEqual([0.35, 0.35]);
  await expect.poll(async () => (await counts(page)).every((n, i) => n > initial[i]!)).toBe(true);
  await settled(page);
  const after = await Promise.all(
    ['drift', 'network'].map((id) => page.locator('#' + id).screenshot()),
  );
  before.forEach((image, i) => expect(image.equals(after[i]!)).toBe(false));
  const palettes: string[][] = [];
  for (const palette of ['ember', 'paper', 'dusk']) {
    await page.locator('#palette').selectOption(palette);
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as AmbientWindow).ambientDemo.attachments.every(
            (a) =>
              a.params['tint'] === getComputedStyle(a.host).getPropertyValue('--hgpu-tint').trim(),
          ),
        ),
      )
      .toBe(true);
    palettes.push(
      await page.evaluate(() =>
        (window as unknown as AmbientWindow).ambientDemo.attachments.map((a) =>
          String(a.params['tint']),
        ),
      ),
    );
  }
  expect(new Set(palettes.map((colors) => colors.join('|'))).size).toBe(3);
  expect(palettes.every((colors) => colors[0] !== colors[1])).toBe(true);
});

test('manual motion and local pointer motion stop after pausing or leaving', async ({ page }) => {
  await demo(page, '');
  await observeDraws(page);
  await settled(page);
  const initial = await counts(page);
  await page.locator('#play').click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as AmbientWindow).ambientDemo.fields.every((f) => f.playing),
      ),
    )
    .toBe(true);
  await expect.poll(async () => (await counts(page)).every((n, i) => n > initial[i]!)).toBe(true);
  await page.locator('#play').click();
  await settled(page);
  await page.locator('#drift').hover({ position: { x: 80, y: 100 } });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as AmbientWindow).ambientDemo.fields.map((f) => f.playing),
      ),
    )
    .toEqual([true, false]);
  await page.locator('#play').hover();
  await settled(page);
  const stopped = await counts(page);
  await page.waitForTimeout(250);
  expect(await counts(page)).toEqual(stopped);
});

test('reduced motion renders a settled scatter once and still responds to later CSS changes', async ({
  page,
}) => {
  await demo(page, '');
  await observeDraws(page);
  await page.locator('#play').click();
  await page.locator('#motion').click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as AmbientWindow).ambientDemo.fields.every(
          (f) => f.reducedMotion && !f.playing,
        ),
      ),
    )
    .toBe(true);
  await settled(page);
  const initial = await counts(page);
  await page.waitForTimeout(250);
  expect(await counts(page)).toEqual(initial);
  await page.locator('#intensity').fill('0.42');
  await expect.poll(async () => (await counts(page)).every((n, i) => n > initial[i]!)).toBe(true);
  await settled(page);
  const updated = await counts(page);
  await page.waitForTimeout(250);
  expect(await counts(page)).toEqual(updated);
  await expect(
    page.getByRole('heading', { name: 'A little atmosphere. Plenty of room.' }),
  ).toBeVisible();
});

test('forced fallback displays loaded posters behind native readable content', async ({ page }) => {
  await demo(page, 'fallback=1&reduce=1');
  const result = await page.evaluate(async () => {
    const d = (window as unknown as AmbientWindow).ambientDemo;
    const posters = await Promise.all(
      d.attachments.map(async (a) => {
        const poster = a.host.shadowRoot!.querySelector<HTMLImageElement>('.hgpu-poster')!;
        await poster.decode();
        return {
          width: poster.naturalWidth,
          height: poster.naturalHeight,
          display: getComputedStyle(poster).display,
          visibility: getComputedStyle(poster).visibility,
        };
      }),
    );
    return { states: d.attachments.map((a) => a.state), fields: d.fields.length, posters };
  });
  expect(result.states).toEqual(['fallback', 'fallback']);
  expect(result.fields).toBe(0);
  expect(
    result.posters.every(
      (p) => p.width > 0 && p.height > 0 && p.display !== 'none' && p.visibility === 'visible',
    ),
  ).toBe(true);
  await expect(
    page.getByRole('heading', { name: 'A little atmosphere. Plenty of room.' }),
  ).toBeVisible();
  await page.locator('#palette').selectOption('paper');
  await page.locator('#intensity').fill('0.3');
  await page.locator('#motion').click();
  await expect(page.locator('#play')).toBeVisible();
});

test('destroying the particle field releases its ownership while the sibling stays usable', async ({
  page,
}) => {
  await demo(page);
  const result = await page.evaluate(async () => {
    const d = (window as unknown as AmbientWindow).ambientDemo;
    const [drift, network] = d.fields;
    const session = drift!.session;
    const initial = { clients: session.clients, scheduled: session.scheduler.surfaceCount };
    d.attachments[0]!.destroy();
    network!.visible = true;
    network!.store.set('intensity', 0.4);
    network!.beforeFrame();
    network!.render();
    session.submit();
    await session.device.queue.onSubmittedWorkDone();
    const remaining = {
      clients: session.clients,
      scheduled: session.scheduler.surfaceCount,
      drift: drift!.state,
      network: network!.state,
      driftBuffers: drift!.memory().bufferBytes,
      errors: [...session.errors],
    };
    window.dispatchEvent(new Event('pagehide'));
    return {
      initial,
      remaining,
      after: {
        clients: session.clients,
        scheduled: session.scheduler.surfaceCount,
        states: [drift!.state, network!.state],
        demoFields: d.fields.length,
        demoAttachments: d.attachments.length,
      },
    };
  });
  expect(result.initial).toEqual({ clients: 2, scheduled: 2 });
  expect(result.remaining).toEqual({
    clients: 1,
    scheduled: 1,
    drift: 'disposed',
    network: 'ready',
    driftBuffers: 0,
    errors: [],
  });
  expect(result.after).toEqual({
    clients: 0,
    scheduled: 0,
    states: ['disposed', 'disposed'],
    demoFields: 0,
    demoAttachments: 0,
  });
});
