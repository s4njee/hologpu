import { expect, test, type Page } from '@playwright/test';
import type { Attachment } from '../../packages/dom/src/index.ts';
import type { EffectField } from '../../packages/core/src/index.ts';

type DemoWindow = Window & {
  transitionsDemo: {
    attachments: Attachment[];
    fields: EffectField[];
    progress: number;
    following: boolean;
    timeline: string;
  };
};
async function demo(page: Page, query = 'progress=0.45&reduce=1') {
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ contentType: 'text/css', body: '' }),
  );
  await page.goto('/transitions.html?' + query);
  await expect
    .poll(
      () =>
        page.evaluate(() => (window as unknown as DemoWindow).transitionsDemo?.attachments.length),
      { timeout: 25_000 },
    )
    .toBe(3);
  await expect
    .poll(() => page.locator('#wave svg').evaluate((svg) => svg.getBoundingClientRect().height))
    .toBeGreaterThan(50);
  await expect
    .poll(() => page.locator('#line svg').evaluate((svg) => svg.getBoundingClientRect().height))
    .toBeGreaterThan(100);
  await expect
    .poll(() => page.locator('#wipe .first').evaluate((img) => img.getBoundingClientRect().height))
    .toBeGreaterThan(100);
  await expect(page.getByRole('img')).toHaveCount(2);
  await page.evaluate(async () => {
    await document.fonts.ready;
    const fields = (window as unknown as DemoWindow).transitionsDemo.fields;
    for (const field of fields) field.session.scheduler.setHidden(true);
    for (let n = 0; n < 3; n++) {
      await new Promise(requestAnimationFrame);
      for (const field of fields) {
        await field.whenInputsReady();
        field.beforeFrame();
        field.drawAt(0, 7);
      }
      await fields[0]?.session.device.queue.onSubmittedWorkDone();
    }
  });
}

for (const mobile of [false, true])
  test(`transitions have a readable ${mobile ? 'mobile' : 'desktop'} layout and native geometry`, async ({
    page,
  }, info) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1200, height: 900 });
    await demo(page);
    const result = await page.evaluate(() => {
      const d = (window as unknown as DemoWindow).transitionsDemo;
      return {
        states: d.attachments.map((a) => a.state),
        errors: d.fields.flatMap((f) => f.session.errors),
        overflow: document.documentElement.scrollWidth - innerWidth,
        paths: [...document.querySelectorAll('svg path')].map((p) => p.getAttribute('d')),
        image: d.fields[0]!.inputTexture('image')?.width,
        next: d.fields[0]!.inputTexture('next')?.width,
      };
    });
    expect(result).toMatchObject({
      states: ['ready', 'ready', 'ready'],
      errors: [],
      image: 1200,
      next: 1200,
    });
    expect(result.overflow).toBeLessThanOrEqual(1);
    expect(result.paths.every((path) => path?.startsWith('M'))).toBe(true);
    await expect(
      page.getByRole('heading', { name: 'A softer way to move forward.' }),
    ).toBeVisible();
    if (info.project.name.startsWith('swiftshader'))
      await expect(page).toHaveScreenshot(`transitions-${mobile ? 'mobile' : 'desktop'}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.01,
      });
  });

test('manual progress, reveal modes, motion and fallbacks preserve native content', async ({
  page,
}) => {
  await demo(page, 'progress=0.2');
  await page.locator('#progress').fill('0.8');
  expect(
    await page.evaluate(() =>
      (window as unknown as DemoWindow).transitionsDemo.attachments
        .filter((a) => a.effect.id !== 'wave-divider')
        .map((a) => a.params.progress),
    ),
  ).toEqual([0.8, 0.8]);
  await page.locator('#wipe-mode').selectOption('luminance');
  expect(
    await page.evaluate(
      () => (window as unknown as DemoWindow).transitionsDemo.attachments[0]!.params.mode,
    ),
  ).toBe('luminance');
  await page.getByRole('button', { name: 'Reduce motion', exact: true }).click();
  expect(
    await page.evaluate(() =>
      (window as unknown as DemoWindow).transitionsDemo.fields.every((f) => f.reducedMotion),
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Show fallbacks', exact: true }).click();
  expect(
    await page.locator('#wipe .second').evaluate((image) => ({
      opacity: getComputedStyle(image).opacity,
      visibility: getComputedStyle(image).visibility,
    })),
  ).toEqual({ opacity: '1', visibility: 'visible' });
  await page.locator('#progress').fill('0.2');
  expect(
    await page.locator('#wipe .second').evaluate((image) => getComputedStyle(image).opacity),
  ).toBe('0');
  for (const id of ['wave', 'line']) await expect(page.locator(`#${id} svg`)).toBeVisible();
  await page.getByRole('button', { name: 'Restore motion', exact: true }).click();
  expect(
    await page.locator('#wipe .second').evaluate((image) => getComputedStyle(image).opacity),
  ).toBe('0.2');
  await expect(page.locator('.steps li')).toHaveCount(3);
});

for (const geometry of [false, true])
  test(`scroll progress uses ${geometry ? 'portable geometry' : 'the available view timeline'} and survives resize`, async ({
    page,
  }) => {
    await demo(page, `reduce=1${geometry ? '&timeline=geometry' : ''}`);
    const before = await page.evaluate(
      () => (window as unknown as DemoWindow).transitionsDemo.progress,
    );
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await expect
      .poll(() => page.evaluate(() => (window as unknown as DemoWindow).transitionsDemo.progress))
      .toBeGreaterThan(before + 0.3);
    const following = await page.evaluate(
      () => (window as unknown as DemoWindow).transitionsDemo.following,
    );
    expect(following).toBe(true);
    await page.setViewportSize({ width: 740, height: 800 });
    const dimensions = await page.locator('#wave').evaluate((host) => ({
      width: host.clientWidth,
      viewBox: host.querySelector('svg')!.getAttribute('viewBox'),
    }));
    await expect
      .poll(() => page.locator('#wave svg').getAttribute('viewBox'))
      .toBe(`0 0 ${dimensions.width} 100`);
    if (geometry)
      expect(
        await page.evaluate(() => (window as unknown as DemoWindow).transitionsDemo.timeline),
      ).toBe('geometry');
    await page.locator('#progress').fill('0.35');
    await page.evaluate(() => scrollTo(0, 0));
    expect(
      await page.evaluate(() => (window as unknown as DemoWindow).transitionsDemo.progress),
    ).toBe(0.35);
  });

test('forced fallback has no GPU fields, crossfades authored images and draws native SVGs', async ({
  page,
}) => {
  await demo(page, 'fallback=1&progress=0.4');
  const result = await page.evaluate(() => {
    const d = (window as unknown as DemoWindow).transitionsDemo;
    return {
      fields: d.fields.length,
      states: d.attachments.map((a) => a.state),
      posters: d.attachments.map((a) =>
        a.host.shadowRoot!.querySelector('img')!.getAttribute('src'),
      ),
      images: [...document.querySelectorAll<HTMLImageElement>('.wipe img')].map((i) => ({
        width: i.naturalWidth,
        visibility: getComputedStyle(i).visibility,
      })),
      opacity: getComputedStyle(document.querySelector('.wipe .second')!).opacity,
    };
  });
  expect(result).toEqual({
    fields: 0,
    states: ['fallback', 'fallback', 'fallback'],
    posters: [null, null, null],
    images: [
      { width: 1200, visibility: 'visible' },
      { width: 1200, visibility: 'visible' },
    ],
    opacity: '0.4',
  });
  for (const id of ['wave', 'line']) await expect(page.locator(`#${id} svg`)).toBeVisible();
  await page.locator('#progress').fill('0');
  await expect(page.locator('#line svg')).toBeHidden();
  await page.locator('#progress').fill('1');
  expect(
    await page
      .locator('#line path')
      .evaluate((path) => Number.parseFloat(getComputedStyle(path).strokeDashoffset)),
  ).toBe(0);
});
