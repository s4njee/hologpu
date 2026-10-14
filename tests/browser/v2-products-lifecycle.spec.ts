import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type {
  DeviceSession,
  EffectField,
  ScheduledSurface,
} from '../../packages/core/src/index.ts';

const core = '/@fs' + fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url));
type LifecycleWindow = Window & {
  productLifecycle: {
    active: Set<ScheduledSurface>;
    fields: EffectField[];
    sessions: Set<DeviceSession>;
    gate: { entered: boolean; released: boolean; release(): void };
  };
};

/** Observe public scheduler ownership before importing the real demo, without changing its code. */
async function instrument(page: Page, delayMap = false) {
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ contentType: 'text/css', body: '' }),
  );
  await page.route('**/products.html*', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      /src="\/src\/products\.ts(?:\?[^"\n]*)?"/,
      'src="/__products_lifecycle"',
    );
    if (!body.includes('src="/__products_lifecycle"'))
      throw new Error('The lifecycle harness must load before the product demo');
    await route.fulfill({ response, body });
  });
  await page.route('**/__products_lifecycle', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `
import { Scheduler } from ${JSON.stringify(core)};
const ledger = window.productLifecycle = {
  active: new Set(), fields: [], sessions: new Set(),
  gate: { entered: false, released: false, release() {} }
};
const add = Scheduler.prototype.add;
Scheduler.prototype.add = function(surface) {
  // These tests observe lifetime; shader draws are unnecessary.
  this.setHidden(true);
  const remove = add.call(this, surface);
  ledger.active.add(surface);
  ledger.fields.push(surface);
  if (surface.session) ledger.sessions.add(surface.session);
  return () => { remove(); ledger.active.delete(surface); };
};
if (${delayMap}) {
  const create = GPUDevice.prototype.createRenderPipelineAsync;
  let release;
  const held = new Promise(resolve => { release = resolve; });
  ledger.gate.release = () => { release(); };
  GPUDevice.prototype.createRenderPipelineAsync = async function(descriptor) {
    const pipeline = await create.call(this, descriptor);
    if (descriptor.label === 'hgpu-pointer-map') {
      ledger.gate.entered = true;
      await held;
      ledger.gate.released = true;
    }
    return pipeline;
  };
}
await import('/src/products.ts');
`,
    }),
  );
}

async function lifetime(page: Page) {
  return page.evaluate(() => {
    const ledger = (window as unknown as LifecycleWindow).productLifecycle;
    return {
      registered: ledger.fields.length,
      active: ledger.active.size,
      states: ledger.fields.map((field) => field.state),
      clients: [...ledger.sessions].reduce((total, session) => total + session.clients, 0),
      scheduled: [...ledger.sessions].reduce(
        (total, session) => total + session.scheduler.surfaceCount,
        0,
      ),
      mapStates: ledger.fields
        .filter((field) => field.effect.id === 'pointer-map')
        .map((field) => field.state),
    };
  });
}

test.afterEach(async ({ page }) => {
  // Never leave a deliberately held factory pending if an assertion fails.
  await page
    .evaluate(() => {
      const ledger = (window as unknown as LifecycleWindow).productLifecycle;
      ledger?.gate.release();
      window.dispatchEvent(new Event('pagehide'));
    })
    .catch(() => {});
});

test('a failed video decode cleans up GPU fields and preserves authored native media', async ({
  page,
}) => {
  await instrument(page);
  await page.route('**/media/products/hero-720p.mp4*', (route) => route.abort('failed'));
  await page.goto('/products.html?reduce=1');
  await expect(page.getByRole('status')).toContainText('Native media fallbacks', {
    timeout: 25_000,
  });
  const state = await lifetime(page);
  // Ensure this tests cleanup after genuine GPU setup, rather than an unrelated early failure.
  expect(state.registered).toBeGreaterThan(0);
  expect(state.active).toBe(0);
  expect(state.scheduled).toBe(0);
  expect(state.clients).toBe(0);
  expect(state.states.every((value) => value === 'disposed')).toBe(true);
  const images = page.locator('.media img:not(.depth-map)');
  await expect(images).toHaveCount(5);
  for (const image of await images.all()) await expect(image).toBeVisible();
  await expect(page.locator('video')).toBeVisible();
  const media = await page.locator('video').evaluate(async (video: HTMLVideoElement) => {
    const poster = new Image();
    poster.src = video.poster;
    await poster.decode();
    return {
      failed: video.error !== null || video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE,
      paused: video.paused,
      visible: getComputedStyle(video).visibility,
      poster: video.poster,
      posterSize: [poster.naturalWidth, poster.naturalHeight],
    };
  });
  expect(media).toMatchObject({ failed: true, paused: true, visible: 'visible' });
  expect(media.poster).toMatch(/\/media\/products\/screenshot\.png$/);
  expect(media.posterSize).toEqual([1200, 750]);
  const survivingGPU = await page
    .locator('.media')
    .evaluateAll((hosts) =>
      hosts.some((host) =>
        [...(host.shadowRoot?.querySelectorAll('.hgpu-canvas,.hgpu-poster') ?? [])].some(
          (layer) => getComputedStyle(layer).display !== 'none',
        ),
      ),
    );
  expect(survivingGPU).toBe(false);
});

test('pagehide during pointer-map creation disposes the late field and releases its device client', async ({
  page,
}) => {
  await instrument(page, true);
  await page.goto('/products.html?reduce=1');
  await expect
    .poll(
      () =>
        page.evaluate(() => (window as unknown as LifecycleWindow).productLifecycle?.gate.entered),
      { timeout: 25_000 },
    )
    .toBe(true);
  const before = await lifetime(page);
  expect(before.registered).toBeGreaterThan(0);
  expect(before.active).toBeGreaterThan(0);
  expect(before.mapStates).toEqual([]);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const pending = await lifetime(page);
  expect(pending.active).toBe(0);
  expect(pending.scheduled).toBe(0);
  expect(pending.clients).toBeGreaterThan(0); // The awaited factory still holds its own lease.
  await page.evaluate(() => (window as unknown as LifecycleWindow).productLifecycle.gate.release());
  await expect.poll(async () => (await lifetime(page)).mapStates).toEqual(['disposed']);
  const after = await lifetime(page);
  expect(after.active).toBe(0);
  expect(after.scheduled).toBe(0);
  expect(after.clients).toBe(0);
  expect(after.states.every((value) => value === 'disposed')).toBe(true);
  expect(
    await page.evaluate(
      () => (window as unknown as LifecycleWindow).productLifecycle.gate.released,
    ),
  ).toBe(true);
});
