import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { Attachment } from '../../packages/dom/src/index.ts';
import type { EffectDefinition } from '../../packages/core/src/index.ts';

type CardsWindow = Window & { cardsDemo: { attachments: Attachment[]; hero: Attachment } };
const source = (path: string) => '/@fs' + fileURLToPath(new URL(path, import.meta.url));

test('catalogue canvas forwards a press while procedural motion is paused', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/?effect=press-ripple&mode=full&playing=false&quality=fixed&resolution=1');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.evaluate(() => {
    const field = window.hologpu.field!;
    field.session.scheduler.setHidden(true);
    field.drawAt(0, 7);
    const original = field.instance!.onPointerDown!;
    Reflect.set(window, 'cataloguePresses', []);
    field.instance!.onPointerDown = (position, frame) => {
      (Reflect.get(window, 'cataloguePresses') as number[][]).push([...position]);
      return original(position, frame);
    };
  });
  await page.locator('#canvas').click();
  const result = await page.evaluate(async () => {
    const field = window.hologpu.field!;
    field.drawAt(0.15, 7);
    const active = await field.readPixels();
    field.drawAt(0.7, 7);
    const settled = await field.readPixels();
    return {
      presses: Reflect.get(window, 'cataloguePresses') as number[][],
      activeAlpha: active.pixels.some((value, i) => i % 4 === 3 && value > 0),
      settledAlpha: settled.pixels.some((value, i) => i % 4 === 3 && value > 0),
      playing: field.playing,
      errors: [...field.session.errors],
    };
  });
  expect(result.presses).toHaveLength(1);
  result.presses[0]!.forEach((value) => expect(value).toBeCloseTo(0.5, 2));
  expect(result).toMatchObject({
    activeAlpha: true,
    settledAlpha: false,
    playing: false,
    errors: [],
  });
});

async function demo(page: Page, query = 'reduce=1') {
  // Local system fonts keep the screenshots independent of external font availability.
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ contentType: 'text/css', body: '' }),
  );
  await page.goto('/cards.html?' + query);
  await expect
    .poll(
      () => page.evaluate(() => (window as unknown as CardsWindow).cardsDemo?.attachments.length),
      { timeout: 20_000 },
    )
    .toBe(12);
  await page.evaluate(async () => {
    await document.fonts.ready;
    const items = (window as unknown as CardsWindow).cardsDemo.attachments;
    for (const item of items) item.field?.session.scheduler.setHidden(true);
    // Hero renders before its borrowed consumers, then immutable inputs settle.
    for (let n = 0; n < 3; n++) {
      await new Promise(requestAnimationFrame);
      for (const item of items)
        if (item.field) {
          await item.field.whenInputsReady();
          item.field.beforeFrame();
          item.field.drawAt(item.field.effect.reducedMotion.time, 7);
        }
      await items.find((item) => item.field)?.field!.session.device.queue.onSubmittedWorkDone();
    }
  });
}

test('card spotlight is a quiet white transparent overlay with the requested CSS radius', async ({
  page,
}) => {
  await page.route('**/__v2_card_spotlight', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><canvas style="width:512px;height:512px"></canvas>',
    }),
  );
  await page.goto('/__v2_card_spotlight');
  const result = await page.evaluate(
    async ({ core, effect }) => {
      const { createEffect } = (await import(
        core
      )) as typeof import('../../packages/core/src/index.ts');
      const { default: definition } = (await import(effect)) as { default: EffectDefinition };
      const field = await createEffect(document.querySelector('canvas')!, definition, {
        playing: false,
        adaptiveQuality: false,
        preset: 'card-spotlight',
        params: { pageRect: [0, 0, 512, 512], pagePointer: [256, 256] },
      });
      field.drawAt(0, 7);
      const read = await field.readPixels();
      const centre = (Math.floor(read.height / 2) * read.width + Math.floor(read.width / 2)) * 4;
      const result = {
        radius: field.store.values['radius'],
        intensity: field.store.values['intensity'],
        tint: field.store.values['tint'],
        centreAlpha: read.pixels[centre + 3],
        corner: Array.from(read.pixels.slice(0, 4)),
        errors: [...field.session.errors],
      };
      field.destroy();
      return result;
    },
    {
      core: source('../../packages/core/src/index.ts'),
      effect: source('../../packages/effects/src/spotlight/index.ts'),
    },
  );
  expect(result).toMatchObject({
    radius: 320,
    intensity: 0.15,
    tint: '#ffffff',
    corner: [0, 0, 0, 0],
    errors: [],
  });
  expect(result.centreAlpha).toBeGreaterThan(30);
  expect(result.centreAlpha).toBeLessThanOrEqual(39);
});

test('one spotlight follows a grid in continuous viewport CSS coordinates while scrolling', async ({
  page,
}) => {
  await demo(page);
  await page.locator('#grid').scrollIntoViewIfNeeded();
  const lights = await page.evaluate(() =>
    (window as unknown as CardsWindow).cardsDemo.attachments
      .filter((a) => a.effect.id === 'spotlight')
      .map((a) => a.host.id),
  );
  expect(lights).toEqual(['grid']);
  for (const index of [0, 2]) {
    const bounds = await page.locator('.trace').nth(index).boundingBox();
    expect(bounds).not.toBeNull();
    const x = bounds!.x + bounds!.width * 0.5,
      y = bounds!.y + bounds!.height * 0.5;
    await page.evaluate(() => {
      Reflect.set(window, 'observedCardPointer', undefined);
      document.addEventListener(
        'pointermove',
        (event) => {
          Reflect.set(window, 'observedCardPointer', [event.clientX, event.clientY]);
        },
        { capture: true, once: true },
      );
    });
    await page.mouse.move(x, y);
    const probe = await page.evaluate(() => {
      const light = (window as unknown as CardsWindow).cardsDemo.attachments.find(
        (a) => a.effect.id === 'spotlight',
      )!;
      light.field!.beforeFrame();
      light.field!.drawAt(0, 7);
      const bounds = light.host.getBoundingClientRect();
      return {
        pointer: light.field!.store.values['pagePointer'],
        reportedPointer: Reflect.get(window, 'observedCardPointer') as number[],
        rect: light.field!.store.values['pageRect'],
        bounds: [bounds.left, bounds.top, bounds.width, bounds.height],
      };
    });
    const pointer = probe.pointer as number[],
      rect = probe.rect as number[];
    expect(probe.reportedPointer).toHaveLength(2);
    expect(pointer).toEqual(probe.reportedPointer);
    expect(probe.reportedPointer[0]).toBeGreaterThanOrEqual(bounds!.x);
    expect(probe.reportedPointer[0]).toBeLessThanOrEqual(bounds!.x + bounds!.width);
    expect(probe.reportedPointer[1]).toBeGreaterThanOrEqual(bounds!.y);
    expect(probe.reportedPointer[1]).toBeLessThanOrEqual(bounds!.y + bounds!.height);
    rect.forEach((value, i) => expect(Math.abs(value - probe.bounds[i]!)).toBeLessThanOrEqual(1));
    if (index === 0) await page.evaluate(() => window.scrollBy(0, 48));
  }
});

test('native CTA and glass drag handles remain usable by pointer and keyboard', async ({
  page,
}) => {
  await demo(page);
  await page.getByRole('button', { name: 'Start something' }).click();
  await expect(page.locator('#count')).toHaveText('Action 1 received.');
  await page.getByRole('button', { name: 'Start something' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#count')).toHaveText('Action 2 received.');
  const handle = page.getByRole('button', { name: 'Move Signal window' });
  await handle.scrollIntoViewIfNeeded();
  const before = await page.locator('#glass-one').boundingBox();
  const grip = await handle.boundingBox();
  await page.mouse.move(grip!.x + 20, grip!.y + 10);
  await page.mouse.down();
  await page.mouse.move(grip!.x + 60, grip!.y + 30);
  await page.mouse.up();
  const dragged = await page.locator('#glass-one').boundingBox();
  expect(dragged!.x - before!.x).toBeCloseTo(40, 0);
  expect(dragged!.y - before!.y).toBeCloseTo(20, 0);
  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  const geometry = await page.evaluate(() => {
    const demo = (window as unknown as CardsWindow).cardsDemo,
      panel = demo.attachments.find((a) => a.host.id === 'glass-one')!,
      field = panel.field!;
    field.beforeFrame();
    const rect = field.store.values['sourceRect'] as number[],
      host = panel.host.getBoundingClientRect(),
      hero = demo.hero.host.getBoundingClientRect();
    return {
      rect,
      expected: [
        (host.left - hero.left) / hero.width,
        (host.top - hero.top) / hero.height,
        host.width / hero.width,
        host.height / hero.height,
      ],
      errors: [...field.session.errors],
    };
  });
  geometry.rect.forEach((v, i) =>
    expect(Math.abs(v - geometry.expected[i]!)).toBeLessThan(1 / 1200),
  );
  expect(geometry.errors).toEqual([]);
});

for (const mobile of [false, true])
  test(`cards demo has a readable ${mobile ? 'mobile' : 'desktop'} settled layout without horizontal overflow`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1200, height: 900 });
    await demo(page);
    await page.mouse.move(0, 0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(1);
    const cardRows = await page
      .locator('.lift')
      .evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().top));
    const coverage = await page.locator('.grid-cards').evaluate((grid) => {
      const width = grid.getBoundingClientRect().width;
      return [...grid.querySelectorAll('.lift')].map(
        (card) => card.getBoundingClientRect().width / width,
      );
    });
    if (mobile) for (const ratio of coverage) expect(ratio).toBeGreaterThan(0.95);
    else expect(coverage.reduce((sum, ratio) => sum + ratio, 0)).toBeGreaterThan(0.9);
    if (!mobile)
      for (const top of cardRows) expect(Math.abs(top - cardRows[0]!)).toBeLessThanOrEqual(1);
    else expect(cardRows[2]! > cardRows[1]! && cardRows[1]! > cardRows[0]!).toBe(true);
    await expect(
      page.getByRole('heading', { name: /A little depth\.\s*A lighter touch\./ }),
    ).toBeVisible();
    const states = await page.evaluate(() =>
      (window as unknown as CardsWindow).cardsDemo.attachments.map((a) => ({
        state: a.state,
        reduced: a.field!.frame.reducedMotion,
        errors: [...a.field!.session.errors],
      })),
    );
    expect(states).toHaveLength(12);
    for (const state of states) {
      expect(state.state).toBe('ready');
      expect(state.reduced).toBe(true);
      expect(state.errors).toEqual([]);
    }
    if (testInfo.project.name.startsWith('swiftshader'))
      await expect(page).toHaveScreenshot(`cards-${mobile ? 'mobile' : 'desktop'}.png`, {
        fullPage: true,
        scale: 'css',
        maxDiffPixelRatio: 0.002,
      });
    await page.getByRole('button', { name: 'Motion reduced' }).click();
    await expect(page.locator('#motion')).toHaveAttribute('aria-pressed', 'false');
    expect(
      await page.evaluate(() =>
        (window as unknown as CardsWindow).cardsDemo.attachments.every(
          (a) => a.field!.frame.reducedMotion === false,
        ),
      ),
    ).toBe(true);
    await page.getByRole('button', { name: 'Reduce motion' }).click();
    expect(
      await page.evaluate(() =>
        (window as unknown as CardsWindow).cardsDemo.attachments.every(
          (a) => a.field!.frame.reducedMotion === true,
        ),
      ),
    ).toBe(true);
  });

test('CSS fallback keeps the native CTA, keyboard dragging and reduced-motion control', async ({
  page,
}) => {
  await demo(page, 'fallback=1&reduce=1');
  await expect(page.locator('#status')).toContainText('CSS fallbacks');
  expect(
    await page.evaluate(() =>
      (window as unknown as CardsWindow).cardsDemo.attachments.every(
        (a) => a.state === 'fallback' && a.field === null,
      ),
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Start something' }).click();
  await expect(page.locator('#count')).toHaveText('Action 1 received.');
  await page.getByRole('button', { name: 'Start something' }).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#count')).toHaveText('Action 2 received.');
  await page.getByRole('button', { name: 'Move Clarity window' }).focus();
  const before = await page.locator('#glass-two').boundingBox();
  await page.keyboard.press('ArrowRight');
  const after = await page.locator('#glass-two').boundingBox();
  expect(after!.x - before!.x).toBeCloseTo(4, 0);
  await page.getByRole('button', { name: 'Motion reduced' }).click();
  await expect(page.locator('#motion')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('link', { name: 'GPU preview' })).toHaveAttribute('href', '?');
});
