import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { Attachment } from '../../packages/dom/src/index.ts';
import type { EffectField } from '../../packages/core/src/index.ts';
type ProductWindow = Window & {
  productsDemo: { attachments: Attachment[]; fields: EffectField[]; video: HTMLVideoElement };
};

async function demo(page: Page, query = 'reduce=1', freeze = true) {
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ contentType: 'text/css', body: '' }),
  );
  await page.goto('/products.html?' + query);
  await expect
    .poll(
      () =>
        page.evaluate(() => (window as unknown as ProductWindow).productsDemo?.attachments.length),
      { timeout: 25_000 },
    )
    .toBe(6);
  if (!freeze) {
    await page.evaluate(() => document.fonts.ready);
    return;
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    const fields = (window as unknown as ProductWindow).productsDemo.fields;
    for (const field of fields) field.session.scheduler.setHidden(true);
    const ordered = [
      ...fields.filter((f) => f.effect.id === 'pointer-map'),
      ...fields.filter((f) => f.effect.id !== 'pointer-map'),
    ];
    for (let n = 0; n < 3; n++) {
      await new Promise(requestAnimationFrame);
      for (const field of ordered) {
        await field.whenInputsReady();
        field.beforeFrame();
        field.drawAt(0, 7);
      }
      await fields[0]?.session.device.queue.onSubmittedWorkDone();
    }
  });
}

test('mouse and keyboard scrubbing repaint images independently of the last pointer position', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 2000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await demo(page, '', false);
  await page.locator('#console').hover({ position: { x: 20, y: 20 } });
  const slider = page.locator('#progress');
  await slider.press('Home');
  await slider.press('ArrowRight');
  expect(
    await page.evaluate(() =>
      (window as unknown as ProductWindow).productsDemo.attachments
        .filter((a) => a.effect.id === 'depth-parallax')
        .map((a) => a.field!.params['mode']),
    ),
  ).toEqual(['progress', 'progress']);

  // Observe scheduler renders; readPixels would itself paint a dirty field and hide this bug.
  await page.evaluate(() => {
    const demo = (window as unknown as ProductWindow).productsDemo;
    for (const item of demo.attachments.filter((a) =>
      ['depth-parallax', 'product-sheen'].includes(a.effect.id),
    )) {
      item.host.dataset['renders'] = '0';
      item.field!.onRendered(() => {
        item.host.dataset['renders'] = String(Number(item.host.dataset['renders']) + 1);
      });
    }
  });
  async function capturePose() {
    await expect
      .poll(() =>
        page.evaluate(() => {
          const progress = Number((document.querySelector('#progress') as HTMLInputElement).value);
          return (window as unknown as ProductWindow).productsDemo.attachments
            .filter((a) => ['depth-parallax', 'product-sheen'].includes(a.effect.id))
            .every((a) => a.params['progress'] === progress && !a.field!.dirty);
        }),
      )
      .toBe(true);
    return Promise.all(
      ['console', 'modules', 'sheen'].map((id) => page.locator('#' + id).screenshot()),
    );
  }
  async function scrub(fraction: number) {
    const box = (await slider.boundingBox())!;
    const before = await page
      .locator('#console, #modules, #sheen')
      .evaluateAll((hosts) =>
        hosts.map((host) => Number((host as HTMLElement).dataset['renders'])),
      );
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 8 + (box.width - 16) * fraction, box.y + box.height / 2, {
      steps: 6,
    });
    await page.mouse.up();
    await expect
      .poll(() =>
        page
          .locator('#console, #modules, #sheen')
          .evaluateAll(
            (hosts, before) =>
              hosts.every(
                (host, i) => Number((host as HTMLElement).dataset['renders']) > before[i]!,
              ),
            before,
          ),
      )
      .toBe(true);
    return capturePose();
  }
  const early = await scrub(0.2);
  const earlyProgress = Number(await slider.inputValue());
  const late = await scrub(0.5);
  early.forEach((image, i) =>
    expect(image.equals(late[i]!), ['console', 'modules', 'sheen'][i]).toBe(false),
  );
  await page.locator('#console').hover({ position: { x: 500, y: 300 } });
  expect(
    await page.evaluate(
      () =>
        (window as unknown as ProductWindow).productsDemo.attachments.find(
          (a) => a.host.id === 'console',
        )!.params['mode'],
    ),
  ).toBe('pointer');
  // Native range thumb dimensions differ by engine. Replay the exact first value with keys.
  await slider.press('Home');
  for (let n = 0; n < Math.round(earlyProgress * 100); n++) await slider.press('ArrowRight');
  expect(Number(await slider.inputValue())).toBe(earlyProgress);
  const replay = await capturePose();
  early.forEach((image, i) => expect(image.equals(replay[i]!)).toBe(true));
});

for (const mobile of [false, true])
  test(`product imagery has a readable ${mobile ? 'mobile' : 'desktop'} layout and aligned asset pairs`, async ({
    page,
  }, info) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1200, height: 900 });
    await demo(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    const result = await page.evaluate(() => {
      const demo = (window as unknown as ProductWindow).productsDemo;
      return {
        fields: demo.fields.length,
        states: demo.attachments.map((a) => a.state),
        errors: demo.fields.flatMap((f) => f.session.errors),
        depth: demo.attachments
          .filter((a) => a.effect.id === 'depth-parallax')
          .map((a) => {
            const image = a.field!.inputTexture('image')!,
              depth = a.field!.inputTexture('depth')!;
            return {
              image: [image.width, image.height],
              depth: [depth.width, depth.height],
              format: depth.format,
            };
          }),
      };
    });
    expect(result).toMatchObject({ fields: 7, states: Array(6).fill('ready'), errors: [] });
    expect(result.depth).toEqual(
      Array(2).fill({ image: [1200, 800], depth: [1200, 800], format: 'r8unorm' }),
    );
    await expect(
      page.getByRole('heading', { name: 'A little movement. A clearer picture.' }),
    ).toBeVisible();
    if (info.project.name.startsWith('swiftshader'))
      await expect(page).toHaveScreenshot(`products-${mobile ? 'mobile' : 'desktop'}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.01,
      });
  });

test('native progress, depth inspection and motion controls drive the integrated effects', async ({
  page,
}) => {
  await demo(page, '');
  await page.locator('#progress').fill('0.8');
  const progress = await page.evaluate(() =>
    (window as unknown as ProductWindow).productsDemo.attachments
      .filter((a) => ['depth-parallax', 'product-sheen'].includes(a.effect.id))
      .map((a) => a.params['progress']),
  );
  expect(progress).toEqual([0.8, 0.8, 0.8]);
  await page.getByRole('button', { name: 'Show depth maps' }).click();
  await expect(page.locator('#console .depth-map')).toBeVisible();
  expect(
    await page
      .locator('#console')
      .evaluate(
        (host) => (host.shadowRoot!.querySelector('canvas') as HTMLCanvasElement).style.visibility,
      ),
  ).toBe('hidden');
  await page.getByRole('button', { name: 'Show depth maps' }).click();
  await page.getByRole('button', { name: 'Show originals' }).click();
  expect(
    await page.locator('#console .original').evaluate((img) => getComputedStyle(img).visibility),
  ).toBe('visible');
  await page.getByRole('button', { name: 'Show effects' }).click();
  await page.getByRole('button', { name: 'Reduce motion' }).click();
  expect(
    await page.evaluate(() =>
      (window as unknown as ProductWindow).productsDemo.fields.every((f) => f.reducedMotion),
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Play video', exact: true }).click();
  expect(await page.locator('video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Restore motion' }).click();
  await expect
    .poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.paused))
    .toBe(false);
  const video = await page
    .locator('video')
    .evaluate((video: HTMLVideoElement) => [video.videoWidth, video.videoHeight]);
  expect(video).toEqual([1280, 720]);
  await page.getByRole('button', { name: 'Pause video' }).click();
  expect(await page.locator('video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(
    true,
  );
});

test('forced fallback keeps authored images, baked glow, native video and controls', async ({
  page,
}) => {
  await demo(page, 'fallback=1');
  const result = await page.evaluate(() => {
    const demo = (window as unknown as ProductWindow).productsDemo;
    return {
      fields: demo.fields.length,
      states: demo.attachments.map((a) => a.state),
      posters: demo.attachments.map((a) => ({
        id: a.host.id,
        src: a.host.shadowRoot!.querySelector('img')!.getAttribute('src'),
      })),
      images: [...document.querySelectorAll<HTMLImageElement>('.media>img:not(.depth-map)')].map(
        (i) => ({ loaded: i.naturalWidth > 0, visible: getComputedStyle(i).visibility }),
      ),
    };
  });
  expect(result.fields).toBe(0);
  expect(result.states).toEqual(Array(6).fill('fallback'));
  expect(result.images.every((i) => i.loaded && i.visible === 'visible')).toBe(true);
  expect(result.posters.filter((p) => p.id !== 'glow').every((p) => p.src === null)).toBe(true);
  expect(result.posters.find((p) => p.id === 'glow')!.src).toBe('/media/products/glow-overlay.png');
  await page.getByRole('button', { name: 'Show originals' }).click();
  expect(
    await page
      .locator('#glow')
      .evaluate(
        (host) => getComputedStyle(host.shadowRoot!.querySelector('.hgpu-poster')!).visibility,
      ),
  ).toBe('hidden');
  await page.getByRole('button', { name: 'Show effects' }).click();
  expect(
    await page
      .locator('#glow')
      .evaluate(
        (host) => getComputedStyle(host.shadowRoot!.querySelector('.hgpu-poster')!).visibility,
      ),
  ).toBe('visible');
  await page.getByRole('button', { name: 'Play video', exact: true }).click();
  await expect
    .poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.paused))
    .toBe(false);
});

test('hero video grade preserves the image and alpha with repeatable frozen grain', async ({
  page,
}) => {
  const core = '/@fs' + fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url));
  const recipe =
    '/@fs' + fileURLToPath(new URL('../../packages/hologpu/src/recipes.ts', import.meta.url));
  await page.route('**/__video_grade', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><canvas style="width:16px;height:16px"></canvas>',
    }),
  );
  await page.goto('/__video_grade');
  const result = await page.evaluate(
    async ({ core, recipe }) => {
      const { createEffect, readTextureTap } = (await import(
        core
      )) as typeof import('../../packages/core/src/index.ts');
      const { heroVideoGrade } = (await import(
        recipe
      )) as typeof import('../../packages/hologpu/src/recipes.ts');
      const field = await createEffect(document.querySelector('canvas')!, heroVideoGrade, {
        playing: false,
        reducedMotion: true,
        adaptiveQuality: false,
        params: { s0_exposure: 0, s1_intensity: 0 },
      });
      const data = new Float32Array([0.1, 0.2, 0.3, 0.5]);
      try {
        await field.bindInput('image', { kind: 'data', data, width: 1, height: 1 });
        field.drawAt(0, 7);
        const identity = Array.from(
          (await readTextureTap(field.session.device, field.output!)).values.slice(0, 4),
        );
        field.store.set('s1_intensity', 0.04);
        field.drawAt(0, 7);
        const frozen = Array.from(
          (await readTextureTap(field.session.device, field.output!)).values,
        );
        field.drawAt(99, 7);
        const repeat = Array.from(
          (await readTextureTap(field.session.device, field.output!)).values,
        );
        return {
          identity,
          repeat: frozen.every((v, i) => v === repeat[i]),
          varied: frozen.some((v, i) => i % 4 !== 3 && Math.abs(v - data[i % 4]!) > 0.002),
          errors: [...field.session.errors],
        };
      } finally {
        field.destroy();
      }
    },
    { core, recipe },
  );
  [0.1, 0.2, 0.3, 0.5].forEach((v, i) => expect(result.identity[i]).toBeCloseTo(v, 3));
  expect(result).toMatchObject({ repeat: true, varied: true, errors: [] });
});
