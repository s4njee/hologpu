import { test, expect, type Page } from '@playwright/test';
async function start(page: Page, id: string) {
  await page.routeWebSocket(/.*/, (socket) => socket.close());
  await page.goto(
    '/?' +
      new URLSearchParams({
        effect: id,
        mode: 'full',
        playing: 'false',
        quality: 'fixed',
        resolution: '1',
        seed: '7',
      }),
  );
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.locator('#media-inputs > summary').click();
  await expect(page.locator('#media-input-controls')).toBeVisible();
  await page.locator('#stage').evaluate((node: HTMLElement) => {
    node.style.width = '162px';
    node.style.height = '162px';
  });
  await expect
    .poll(() => page.evaluate(() => window.hologpu.field!.surface!.size[0]))
    .toBe(await page.evaluate(() => 160 * devicePixelRatio));
}
async function inspect(page: Page, name: string) {
  return page.evaluate(async (name) => {
    const f = window.hologpu.field!;
    f.advance(0);
    const tap = f.textureTaps[`input:${name}`];
    if (!tap) return null;
    const read = await f.readTap(`input:${name}`);
    let hash = 2166136261,
      red = 0,
      fft = 0,
      wave = 0;
    for (let i = 0; i < read.values.length; i++) {
      const value = read.values[i]!;
      if (!Number.isFinite(value)) throw new Error('Nonfinite input');
      hash = Math.imul(hash ^ Math.round(value * 65535), 16777619);
      if (i % 4 === 0 && value > 0) red++;
      if (i < tap.width * 4 && i % 4 === 0 && value > 0) fft++;
      if (i >= tap.width * 4 && i % 4 === 0 && value !== 0) wave++;
    }
    return { width: tap.width, height: tap.height, hash: hash >>> 0, red, fft, wave };
  }, name);
}
const picture = {
  name: 'second.svg',
  mimeType: 'image/svg+xml',
  buffer: Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#00ff00"/></svg>',
  ),
};

test('text-only dissolve binds authored masks to text and clearing restores its private fallback', async ({
  page,
}) => {
  await start(page, 'text-dissolve');
  await expect(page.locator('#media-text')).toBeVisible();
  await expect(page.locator('#media-image-file')).toHaveCount(0);
  await expect(page.locator('#media-audio-sample')).toHaveCount(0);
  const baseline = await page.evaluate(async () => {
    const f = window.hologpu.field!;
    f.advance(0);
    return { memory: f.memory().textureBytes, pixels: Array.from((await f.readPixels()).pixels) };
  });
  await page.locator('#media-text').fill('HELLO');
  await page.locator('#media-text-apply').click();
  await expect(page.locator('#media-status')).toContainText('Text mask · HELLO');
  const hello = await inspect(page, 'text');
  expect(hello?.width).toBe(960);
  expect(hello?.height).toBe(540);
  expect(hello?.red).toBeGreaterThan(0);
  expect(await inspect(page, 'image')).toBeNull();
  await page.locator('#media-text').fill('');
  await page.locator('#media-text-apply').click();
  await expect(page.locator('#media-status')).toContainText('(empty)');
  expect((await inspect(page, 'text'))?.red).toBe(0);
  expect(
    await page.evaluate(async () =>
      Array.from((await window.hologpu.field!.readPixels()).pixels).every(
        (value, i) => i % 4 !== 3 || value === 0,
      ),
    ),
  ).toBe(true);
  await page.selectOption('#media-source', 'none');
  await expect(page.locator('#media-status')).toContainText('effect fallback');
  expect(await inspect(page, 'text')).toBeNull();
  expect(await page.evaluate(() => window.hologpu.field!.memory().textureBytes)).toBe(
    baseline.memory,
  );
  expect(
    await page.evaluate(async () => Array.from((await window.hologpu.field!.readPixels()).pixels)),
  ).toEqual(baseline.pixels);
  expect(await page.evaluate(() => window.hologpu.field!.session.errors)).toEqual([]);
});

test('image-hover has independently owned A and B uploads, real endpoint pixels and separate clear controls', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const urls = new Set<string>(),
      create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object) => {
      const url = create(object);
      urls.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      urls.delete(url);
      revoke(url);
    };
    Object.defineProperty(window, 'm5MediaURLs', { get: () => urls.size });
  });
  await start(page, 'image-hover');
  await expect(page.locator('#media-imageB-file')).toBeVisible();
  await page.selectOption('#media-source', 'image');
  await expect(page.locator('#media-status')).toContainText('Image · 960 × 640');
  const a = await inspect(page, 'image');
  const withA = await page.evaluate(() => window.hologpu.field!.memory().textureBytes);
  await page.locator('#media-imageB-file').setInputFiles(picture);
  await expect(page.locator('#media-imageB-status')).toContainText('Image · 80 × 40');
  expect((await inspect(page, 'imageB'))?.width).toBe(80);
  expect(await inspect(page, 'image')).toEqual(a);
  expect(await page.evaluate(() => Reflect.get(window, 'm5MediaURLs'))).toBe(0);
  const endpoint = await page.evaluate(async () => {
    const f = window.hologpu.field!;
    f.store.patch({ progress: 1, amount: 0 });
    f.advance(0);
    return Array.from((await f.readPixels()).pixels);
  });
  expect(endpoint.every((value, i) => value === [0, 255, 0, 255][i % 4])).toBe(true);
  await page.locator('#media-imageB-clear').click();
  await expect(page.locator('#media-imageB-status')).toContainText('effect fallback');
  expect(await inspect(page, 'imageB')).toBeNull();
  expect(await inspect(page, 'image')).toEqual(a);
  expect(await page.evaluate(() => window.hologpu.field!.memory().textureBytes)).toBe(withA);
  await page.locator('#media-imageB-sample').click();
  await expect(page.locator('#media-imageB-status')).toContainText('Image · 960 × 640');
  const b = await inspect(page, 'imageB');
  await page.selectOption('#media-source', 'none');
  await expect(page.locator('#media-status')).toContainText('effect fallback');
  expect(await inspect(page, 'image')).toBeNull();
  expect(await inspect(page, 'imageB')).toEqual(b);
  expect(await page.evaluate(() => window.hologpu.field!.session.errors)).toEqual([]);
});

test('unmount immediately revokes an unfinished second-image upload and ignores its late decode', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const urls = new Set<string>(),
      create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL),
      decode = HTMLImageElement.prototype.decode;
    let resume: (() => void) | undefined;
    URL.createObjectURL = (object) => {
      const url = create(object);
      urls.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      urls.delete(url);
      revoke(url);
    };
    HTMLImageElement.prototype.decode = async function () {
      if (this.src.startsWith('blob:'))
        await new Promise<void>((resolve) => {
          resume = resolve;
        });
      return decode.call(this);
    };
    Object.defineProperty(window, 'm5PendingURLs', { get: () => urls.size });
    Object.defineProperty(window, 'm5ResumeImage', { value: () => resume?.() });
  });
  await start(page, 'image-hover');
  await page.locator('#media-imageB-file').setInputFiles(picture);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'm5PendingURLs'))).toBe(1);
  await page.locator('#effects [data-effect="gradient-oklch"]').click();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  expect(await page.evaluate(() => Reflect.get(window, 'm5PendingURLs'))).toBe(0);
  await page.evaluate(() => Reflect.get(window, 'm5ResumeImage')());
  await expect
    .poll(() => page.evaluate(() => window.hologpu.field!.effect.id))
    .toBe('gradient-oklch');
  expect(
    await page.evaluate(() =>
      Object.keys(window.hologpu.field!.textureTaps).filter((name) => name.startsWith('input:')),
    ),
  ).toEqual([]);
  expect(await page.evaluate(() => window.hologpu.field!.session.errors)).toEqual([]);
});

test('audio-only spectrum accepts an actual sample analyser and closes its context on stop and unmount', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = AudioContext;
    const contexts: AudioContext[] = [];
    window.AudioContext = class extends Native {
      constructor(options?: AudioContextOptions) {
        super(options);
        contexts.push(this);
      }
    };
    Object.defineProperty(window, 'm5AudioContexts', { get: () => contexts });
  });
  await start(page, 'audio-spectrum');
  await expect(page.locator('#media-audio-sample')).toBeVisible();
  await expect(page.locator('#media-source')).toHaveCount(0);
  await expect(page.locator('#media-image-file')).toHaveCount(0);
  const baseline = await page.evaluate(() => window.hologpu.field!.memory().textureBytes);
  await page.locator('#media-audio-sample').click();
  await expect(page.locator('#media-audio-status')).toContainText('Audio file');
  await expect.poll(async () => (await inspect(page, 'audio'))?.fft ?? 0).toBeGreaterThan(0);
  const tap = await inspect(page, 'audio');
  expect(tap?.width).toBe(1024);
  expect(tap?.height).toBe(2);
  expect(tap?.wave).toBeGreaterThan(0);
  await page.locator('#media-audio-stop').click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (Reflect.get(window, 'm5AudioContexts') as AudioContext[]).every(
          (context) => context.state === 'closed',
        ),
      ),
    )
    .toBe(true);
  expect(await inspect(page, 'audio')).toBeNull();
  expect(await page.evaluate(() => window.hologpu.field!.memory().textureBytes)).toBe(baseline);
  await page.locator('#media-audio-sample').click();
  await expect(page.locator('#media-audio-status')).toContainText('Audio file');
  await page.locator('#effects [data-effect="gradient-oklch"]').click();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await expect
    .poll(() =>
      page.evaluate(() =>
        (Reflect.get(window, 'm5AudioContexts') as AudioContext[]).every(
          (context) => context.state === 'closed',
        ),
      ),
    )
    .toBe(true);
  expect(await page.evaluate(() => window.hologpu.field!.session.errors)).toEqual([]);
});

test('audio-only microphone requests a device only on its explicit button and denial leaves samples usable', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let requests = 0;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          requests++;
          throw new DOMException('M5 fixture permission denied', 'NotAllowedError');
        },
      },
    });
    Object.defineProperty(window, 'm5AudioPermissionRequests', { get: () => requests });
  });
  await start(page, 'audio-spectrum');
  expect(await page.evaluate(() => Reflect.get(window, 'm5AudioPermissionRequests'))).toBe(0);
  await page.locator('#media-microphone-start').click();
  await expect(page.locator('#media-audio-status')).toContainText('M5 fixture permission denied');
  expect(await page.evaluate(() => Reflect.get(window, 'm5AudioPermissionRequests'))).toBe(1);
  expect(await page.evaluate(() => window.hologpu.field!.state)).toBe('ready');
  expect(await inspect(page, 'audio')).toBeNull();
  await page.locator('#media-audio-sample').click();
  await expect(page.locator('#media-audio-status')).toContainText('Audio file');
  expect((await inspect(page, 'audio'))?.height).toBe(2);
  expect(await page.evaluate(() => Reflect.get(window, 'm5AudioPermissionRequests'))).toBe(1);
  await page.locator('#media-audio-stop').click();
  await expect(page.locator('#media-audio-status')).toContainText('effect fallback');
});
