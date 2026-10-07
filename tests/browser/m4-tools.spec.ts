import { test, expect, type Page } from '@playwright/test';
async function start(page: Page) {
  await page.routeWebSocket(/.*/, (socket) => socket.close());
  await page.goto(
    '/?effect=color-grade&playing=false&quality=fixed&params=' +
      encodeURIComponent(JSON.stringify({ toneMap: 'linear', look: 'identity', lutAmount: 0 })),
  );
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.locator('#media-inputs > summary').click();
  await expect(page.locator('#media-source')).toBeVisible();
  await page.locator('#stage').evaluate((node: HTMLElement) => {
    node.style.width = '162px';
    node.style.height = '162px';
  });
  await expect
    .poll(() => page.evaluate(() => window.hologpu.field!.surface!.size[0]))
    .toBe(await page.evaluate(() => 160 * devicePixelRatio));
}
const inputTap = (page: Page, name = 'image') =>
  page.evaluate(async (name) => {
    const f = window.hologpu.field!;
    f.advance(0);
    const tap = f.textureTaps[`input:${name}`];
    if (!tap) return null;
    const values = Array.from((await f.readTap(`input:${name}`)).values);
    return {
      width: tap.width,
      height: tap.height,
      values: Array.from({ length: 128 }, (_, i) => values[Math.floor((i * values.length) / 128)]!),
    };
  }, name);

test('Media picker uses decoded image, live canvas and text; clear releases input allocations', async ({
  page,
}) => {
  await start(page);
  const base = await page.evaluate(() => window.hologpu.field!.memory().textureBytes);
  await page.selectOption('#media-source', 'image');
  await expect(page.locator('#media-status')).toContainText('Image · 960 × 640');
  const image = await inputTap(page);
  expect(image?.width).toBe(960);
  expect(image?.values.some((v) => v > 0)).toBe(true);
  await page.selectOption('#media-source', 'canvas');
  await expect(page.locator('#media-status')).toContainText('Animated canvas');
  const first = await inputTap(page);
  await page.waitForTimeout(80);
  expect((await inputTap(page))?.values).not.toEqual(first?.values);
  await page.locator('#media-text').fill('HELLO');
  await page.click('#media-text-apply');
  await expect(page.locator('#media-status')).toContainText('Text mask · HELLO');
  expect((await inputTap(page))?.width).toBe(960);
  await page.selectOption('#media-source', 'none');
  await expect(page.locator('#media-status')).toContainText('effect fallback');
  expect(await inputTap(page)).toBeNull();
  expect(await page.evaluate(() => window.hologpu.field!.memory().textureBytes)).toBe(base);
  expect(await page.evaluate(() => window.hologpu.field!.session.errors)).toEqual([]);
});

test('Sample video decodes, advances while field is paused, then clears its owned decoder', async ({
  page,
}) => {
  await start(page);
  await page.selectOption('#media-source', 'video');
  await expect(page.locator('#media-status')).toContainText('Video · 1920 × 1080');
  const a = await inputTap(page);
  expect(a?.width).toBe(1920);
  expect(a?.height).toBe(1080);
  expect(await page.evaluate(() => window.hologpu.field!.playing)).toBe(false);
  await page.waitForTimeout(80);
  const b = await inputTap(page);
  expect(b?.values).not.toEqual(a?.values);
  await page.selectOption('#media-source', 'none');
  await expect(page.locator('#media-preview video')).toHaveCount(0);
  expect(await inputTap(page)).toBeNull();
  expect(await page.evaluate(() => window.hologpu.field!.session.errors)).toEqual([]);
});

test('Media picker borrows another actual field and releases the extra session client on switch', async ({
  page,
}) => {
  await start(page);
  const clients = await page.evaluate(() => window.hologpu.field!.session.clients);
  await page.selectOption('#media-source', 'effect');
  await expect(page.locator('#media-status')).toContainText('Another effect');
  expect(await page.evaluate(() => window.hologpu.field!.session.clients)).toBe(clients + 1);
  expect((await inputTap(page))?.values.some((v) => v > 0)).toBe(true);
  await page.selectOption('#media-source', 'none');
  await expect(page.locator('#media-preview canvas')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.hologpu.field!.session.clients)).toBe(clients);
  expect(await page.evaluate(() => window.hologpu.field!.session.errors)).toEqual([]);
});

test('Camera and microphone request permissions only from their buttons; denial keeps a usable fallback', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let requests = 0;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          requests++;
          throw new DOMException('Fixture permission denied', 'NotAllowedError');
        },
      },
    });
    Object.defineProperty(window, 'mediaPermissionRequests', { get: () => requests });
  });
  await start(page);
  await page.selectOption('#media-source', 'camera');
  expect(await page.evaluate(() => Reflect.get(window, 'mediaPermissionRequests'))).toBe(0);
  await page.click('#media-camera-start');
  await expect(page.locator('#media-status')).toContainText('Fixture permission denied');
  expect(await page.evaluate(() => Reflect.get(window, 'mediaPermissionRequests'))).toBe(1);
  await page.click('#media-microphone-start');
  await expect(page.locator('#media-audio-status')).toContainText('Fixture permission denied');
  expect(await page.evaluate(() => Reflect.get(window, 'mediaPermissionRequests'))).toBe(2);
  await page.selectOption('#media-source', 'image');
  await expect(page.locator('#media-status')).toContainText('Image ·');
  expect((await inputTap(page))?.width).toBe(960);
  expect(await page.evaluate(() => window.hologpu.field!.state)).toBe('ready');
});

test('Sample audio binds actual analyser samples and closes its owned AudioContext on stop', async ({
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
    Object.defineProperty(window, 'mediaAudioContexts', { get: () => contexts });
  });
  await start(page);
  await page.click('#media-audio-sample');
  await expect(page.locator('#media-audio-status')).toContainText('Audio file');
  expect((await inputTap(page, 'audio'))?.height).toBe(2);
  await page.click('#media-audio-stop');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const contexts = Reflect.get(window, 'mediaAudioContexts') as AudioContext[];
        return contexts.every((c) => c.state === 'closed');
      }),
    )
    .toBe(true);
  expect(await inputTap(page, 'audio')).toBeNull();
});

test('Picker unmount cleans an active mocked webcam stream and uploaded object URLs', async ({
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
    Object.defineProperty(window, 'mediaActiveURLs', { get: () => urls.size });
  });
  await start(page);
  await page.locator('#media-image-file').setInputFiles({
    name: 'owned.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>',
    ),
  });
  await expect(page.locator('#media-status')).toContainText('Image · 16 × 16');
  expect(await page.evaluate(() => Reflect.get(window, 'mediaActiveURLs'))).toBe(0);
  // A real browser canvas-capture stream supplies deterministic camera frames without requesting devices.
  await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 48;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'orange';
    ctx.fillRect(0, 0, 64, 48);
    const stream = canvas.captureStream(30);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => stream },
    });
    Object.defineProperty(window, 'mediaOwnedStream', { value: stream });
    let frame = 0;
    const draw = () => {
      if (stream.getTracks().every((t) => t.readyState === 'ended')) return;
      ctx.fillStyle = frame++ % 2 ? 'orange' : 'red';
      ctx.fillRect(0, 0, 64, 48);
      requestAnimationFrame(draw);
    };
    draw();
  });
  await page.click('#media-camera-start');
  await expect(page.locator('#media-status')).toContainText('Webcam · 64 × 48');
  await page.locator('#effects [data-effect="gradient-oklch"]').click();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await expect
    .poll(() =>
      page.evaluate(() =>
        (Reflect.get(window, 'mediaOwnedStream') as MediaStream)
          .getTracks()
          .every((t) => t.readyState === 'ended'),
      ),
    )
    .toBe(true);
});
