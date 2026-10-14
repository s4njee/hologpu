import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import type { Attachment } from '../../packages/dom/src/index.ts';
import type { EffectDefinition } from '../../packages/core/src/index.ts';

const dom = '/@fs' + fileURLToPath(new URL('../../packages/dom/src/index.ts', import.meta.url));
const effectPath = (id: string) =>
  '/@fs' + fileURLToPath(new URL(`../../packages/effects/src/${id}/index.ts`, import.meta.url));
type TextWindow = Window & {
  textAttachment: Attachment;
  fallbacks: Attachment[];
  fontEvents: number;
  fontLoadingEvents: number;
};
const fontCandidates = [
  '/System/Library/Fonts/Supplemental/Courier New.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
  'C:\\Windows\\Fonts\\cour.ttf',
];
const fontReads = await Promise.allSettled(fontCandidates.map((path) => readFile(path)));
const fixtureFont = fontReads.find((result) => result.status === 'fulfilled');

async function fixture(page: Page) {
  await page.route('**/__v2_dom_text', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><style>body{margin:0;background:black;color:white}.frame{padding:24px;font-family:Arial,sans-serif}.frame.large{font-size:46px}h1{width:260px;padding:12px 14px;border:3px solid #222;margin:0;font:700 40px/1.3 Arial,sans-serif}h1 em{font-style:italic;font-weight:400}.frame.large h1{font-size:46px}.fallback{width:300px;border:0;font-size:28px;margin-top:12px}a{color:inherit}</style><main class="frame"><h1 id="headline">Launch   <em>beautiful</em>\n products with real   text</h1></main>',
    }),
  );
  await page.goto('/__v2_dom_text');
  await page.evaluate(async () => {
    await document.fonts.ready;
    (window as unknown as TextWindow).fontEvents = 0;
    (window as unknown as TextWindow).fontLoadingEvents = 0;
    document.fonts.addEventListener(
      'loading',
      () => (window as unknown as TextWindow).fontLoadingEvents++,
    );
    document.fonts.addEventListener(
      'loadingdone',
      () => (window as unknown as TextWindow).fontEvents++,
    );
  });
}

async function attachWhite(page: Page) {
  return page.evaluate(
    async ({ dom, effect }) => {
      const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
      const { default: definition } = (await import(effect)) as { default: EffectDefinition };
      const host = document.getElementById('headline')!;
      const attachment = await attach(host, definition, {
        layer: 'front',
        playing: false,
        adaptiveQuality: false,
        reducedMotion: true,
        params: { first: '#ffffff', second: '#ffffff', third: '#ffffff', intensity: 1 },
      });
      const field = attachment.field!;
      (window as unknown as TextWindow).textAttachment = attachment;
      field.session.scheduler.setHidden(true);
      // Attach readiness precedes the visible-canvas ResizeObserver and immutable mask upload.
      for (let i = 0; i < 20; i++) {
        await new Promise(requestAnimationFrame);
        await field.whenInputsReady();
        field.drawAt(0, 7);
        await field.session.device.queue.onSubmittedWorkDone();
        const tap = field.textureTaps['input:text'];
        if (
          tap &&
          tap.width === field.surface!.size[0] &&
          tap.height === field.surface!.size[1] &&
          tap.width > 1
        )
          break;
      }
      return {
        version: field.textureTaps['input:text']!.version,
        size: [field.textureTaps['input:text']!.width, field.textureTaps['input:text']!.height],
      };
    },
    { dom, effect: effectPath('text-shimmer') },
  );
}

async function uploadVersion(page: Page) {
  return page.evaluate(async () => {
    const field = (window as unknown as TextWindow).textAttachment.field!;
    await field.whenInputsReady();
    field.drawAt(0, 7);
    await field.session.device.queue.onSubmittedWorkDone();
    return field.textureTaps['input:text']?.version ?? 0;
  });
}

async function changedMask(page: Page, previous: number) {
  await expect.poll(() => uploadVersion(page), { timeout: 10_000 }).toBeGreaterThan(previous);
  return uploadVersion(page);
}

test('actual wrapped DOM glyphs align with the GPU mask independently of the raster helper', async ({
  page,
}, testInfo) => {
  await fixture(page);
  const native = await page.locator('#headline').screenshot();
  if (testInfo.project.name.startsWith('swiftshader'))
    await expect(page.locator('#headline')).toHaveScreenshot('native-dom-heading.png', {
      scale: 'css',
    });
  const initialGeometry = await page.evaluate(() => {
    const host = document.getElementById('headline')!,
      bounds = host.getBoundingClientRect(),
      range = document.createRange();
    range.selectNodeContents(host);
    const rects = [...range.getClientRects()]
      .filter((rect) => rect.width > 0)
      .map((rect) => ({
        left: rect.left - bounds.left,
        right: rect.right - bounds.left,
        top: rect.top - bounds.top,
        bottom: rect.bottom - bounds.top,
      }));
    return {
      width: bounds.width,
      height: bounds.height,
      rects,
      lineCount: new Set(rects.map((rect) => Math.round(rect.top))).size,
    };
  });
  expect(initialGeometry.lineCount).toBeGreaterThan(2);
  await attachWhite(page);
  await page.locator('#headline').evaluate((host) => {
    host.style.color = 'transparent';
  });
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await uploadVersion(page);
  const rendered = await page.locator('#headline').screenshot();
  if (testInfo.project.name.startsWith('swiftshader'))
    await expect(page.locator('#headline')).toHaveScreenshot('gpu-only-dom-heading.png', {
      scale: 'css',
      maxDiffPixelRatio: 0.001,
    });
  const alignment = await page.evaluate(
    async ({ native, rendered, geometry }) => {
      const decode = async (base64: string) => {
        const image = new Image();
        image.src = 'data:image/png;base64,' + base64;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        const rgba = context.getImageData(0, 0, image.width, image.height).data;
        const mask = Uint8Array.from({ length: image.width * image.height }, (_, i) =>
          Math.max(rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!) > 150 ? 1 : 0,
        );
        return { width: image.width, height: image.height, mask };
      };
      const expected = await decode(native),
        actual = await decode(rendered);
      if (expected.width !== actual.width || expected.height !== actual.height)
        throw new Error('Attachment changed heading layout dimensions');
      let union = 0,
        intersection = 0,
        missed = 0,
        extra = 0,
        expectedCount = 0,
        actualCount = 0;
      const bbox = (mask: Uint8Array) => {
        let left = expected.width,
          right = -1,
          top = expected.height,
          bottom = -1;
        mask.forEach((on, i) => {
          if (on) {
            const x = i % expected.width,
              y = Math.floor(i / expected.width);
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
        });
        return [left, top, right, bottom];
      };
      const near = (mask: Uint8Array, x: number, y: number) => {
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const px = x + dx,
              py = y + dy;
            if (
              px >= 0 &&
              px < expected.width &&
              py >= 0 &&
              py < expected.height &&
              mask[py * expected.width + px]
            )
              return true;
          }
        return false;
      };
      for (let i = 0; i < expected.mask.length; i++) {
        const a = expected.mask[i]!,
          b = actual.mask[i]!,
          x = i % expected.width,
          y = Math.floor(i / expected.width);
        if (a || b) union++;
        if (a && b) intersection++;
        expectedCount += a;
        actualCount += b;
        if (a && !near(actual.mask, x, y)) missed++;
        if (b && !near(expected.mask, x, y)) extra++;
      }
      const scale = expected.width / geometry.width;
      const actualBounds = bbox(actual.mask).map((value) => value / scale);
      return {
        iou: intersection / union,
        fuzzyRecall: 1 - missed / expectedCount,
        fuzzyPrecision: 1 - extra / actualCount,
        expectedBounds: bbox(expected.mask).map((value) => value / scale),
        actualBounds,
        scale,
        actualCount,
        ranges: geometry.rects,
      };
    },
    {
      native: native.toString('base64'),
      rendered: rendered.toString('base64'),
      geometry: initialGeometry,
    },
  );
  await testInfo.attach('independent-glyph-alignment', {
    body: JSON.stringify(alignment, null, 2),
    contentType: 'application/json',
  });
  expect(alignment.actualCount).toBeGreaterThan(1000);
  expect(alignment.iou).toBeGreaterThan(0.8);
  expect(alignment.fuzzyRecall).toBeGreaterThan(0.96);
  expect(alignment.fuzzyPrecision).toBeGreaterThan(0.96);
  alignment.actualBounds.forEach((value, index) =>
    expect(Math.abs(value - alignment.expectedBounds[index]!)).toBeLessThanOrEqual(1.5),
  );
  const cleanup = await page.evaluate(() => {
    const attachment = (window as unknown as TextWindow).textAttachment,
      field = attachment.field!;
    const result = { errors: [...field.session.errors], diagnostics: [...field.diagnostics] };
    attachment.destroy();
    return result;
  });
  expect(cleanup.errors).toEqual([]);
  expect(cleanup.diagnostics).toEqual([]);
});

test('DOM mask uploads only when content, wrapping, font or ancestor styling changes', async ({
  page,
}) => {
  await fixture(page);
  await attachWhite(page);
  let version = await uploadVersion(page);
  const initial = version;
  const unchanged = await page.evaluate(async () => {
    const field = (window as unknown as TextWindow).textAttachment.field!;
    for (let i = 0; i < 5; i++) {
      field.store.set('first', i % 2 ? '#aaccff' : '#ffffff');
      field.drawAt(i * 20, 7);
      await new Promise(requestAnimationFrame);
    }
    document.getElementById('headline')!.style.color = '#ffeedd';
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    field.drawAt(120, 7);
    return field.textureTaps['input:text']!.version;
  });
  expect(unchanged).toBe(initial);
  await page.locator('#headline em').evaluate((node) => {
    node.textContent = 'remarkable';
  });
  version = await changedMask(page, version);
  await page.locator('#headline').evaluate((node) => {
    node.style.width = '340px';
  });
  version = await changedMask(page, version);
  await page.locator('#headline').evaluate((node) => {
    node.style.fontFamily = 'monospace';
  });
  version = await changedMask(page, version);
  await page.locator('.frame').evaluate((node) => {
    node.classList.add('large');
  });
  version = await changedMask(page, version);
  const final = await page.evaluate(() => {
    const attachment = (window as unknown as TextWindow).textAttachment,
      field = attachment.field!;
    const tap = field.textureTaps['input:text']!;
    const result = { version: tap.version, height: tap.height, errors: [...field.session.errors] };
    attachment.destroy();
    return result;
  });
  expect(final.version).toBe(version);
  expect(final.height).toBeGreaterThan(1);
  expect(final.errors).toEqual([]);
});

test('asynchronously loaded real font refreshes a fixed-size DOM mask after loading readiness', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(
    !fixtureFont || fixtureFont.status !== 'fulfilled',
    'No local OS TrueType fixture font is available',
  );
  await fixture(page);
  await attachWhite(page);
  const initialVersion = await uploadVersion(page);
  await page.locator('#headline').evaluate((host) => {
    host.style.height = getComputedStyle(host).height;
    host.style.whiteSpace = 'nowrap';
  });
  const fixedVersion = await changedMask(page, initialVersion);
  const fixedBounds = await page.locator('#headline').boundingBox();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/__v2_fixture_font.ttf', async (route) => {
    await gate;
    await route.fulfill({
      contentType: 'font/ttf',
      body: fixtureFont!.status === 'fulfilled' ? fixtureFont!.value : Buffer.alloc(0),
    });
  });
  const fontRequested = page.waitForRequest('**/__v2_fixture_font.ttf');
  await page.evaluate(() => {
    const font = new FontFace('V2LateFont', 'url("/__v2_fixture_font.ttf")');
    document.fonts.add(font);
    document.getElementById('headline')!.style.fontFamily = 'V2LateFont, Arial';
    void document.fonts.load('700 40px V2LateFont');
  });
  await fontRequested;
  // Settle the authored family change while the font request is still blocked.
  const pending = await changedMask(page, fixedVersion);
  const beforePixels = await page.evaluate(async () =>
    Array.from(
      (await (window as unknown as TextWindow).textAttachment.field!.readTap('input:text')).values,
    ),
  );
  release();
  await page.evaluate(async () => {
    await document.fonts.load('700 40px V2LateFont');
    await document.fonts.ready;
  });
  const uploaded = await changedMask(page, pending);
  // Installed WebKit emits loading but omits loadingdone for JS FontFaces.
  // The fixed geometry and changed pixels require the production loading/ready path.
  if (browserName !== 'webkit')
    await expect
      .poll(() => page.evaluate(() => (window as unknown as TextWindow).fontEvents))
      .toBeGreaterThan(0);
  const result = await page.evaluate(async () => {
    const w = window as unknown as TextWindow,
      field = w.textAttachment.field!;
    const result = {
      loaded: document.fonts.check('700 40px V2LateFont'),
      events: w.fontEvents,
      loadingEvents: w.fontLoadingEvents,
      pixels: Array.from((await field.readTap('input:text')).values),
      version: field.textureTaps['input:text']!.version,
      errors: [...field.session.errors],
    };
    w.textAttachment.destroy();
    return result;
  });
  expect(result.loaded).toBe(true);
  expect(result.loadingEvents).toBeGreaterThan(0);
  if (browserName !== 'webkit') expect(result.events).toBeGreaterThan(0);
  await testInfo.attach('font-loading-events', {
    body: JSON.stringify({
      loading: result.loadingEvents,
      loadingdone: result.events,
      browserName,
    }),
    contentType: 'application/json',
  });
  expect(await page.locator('#headline').boundingBox()).toEqual(fixedBounds);
  expect(result.pixels).not.toEqual(beforePixels);
  expect(result.version).toBe(uploaded);
  expect(result.errors).toEqual([]);
});

test('forced typography fallback preserves actual content, CSS tokens and keyboard focus', async ({
  page,
}, testInfo) => {
  await fixture(page);
  const result = await page.evaluate(
    async ({ dom, effects }) => {
      const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
      for (const name of ['first', 'second', 'third', 'tint'])
        try {
          CSS.registerProperty({
            name: `--hgpu-${name}`,
            syntax: '<color> | none',
            inherits: false,
            initialValue: 'none',
          });
        } catch {}
      for (const name of ['intensity', 'glow'])
        try {
          CSS.registerProperty({
            name: `--hgpu-${name}`,
            syntax: '<number> | none',
            inherits: false,
            initialValue: 'none',
          });
        } catch {}
      const attachments = [],
        rows = [];
      for (const [index, path] of effects.entries()) {
        const { default: definition } = (await import(path)) as { default: EffectDefinition };
        const host = document.createElement('h1');
        host.className = 'fallback';
        host.id = `fallback-${definition.id}`;
        host.innerHTML = `Actual launch words ${index === 0 ? '<a id="focus-link" href="#visited">Read details</a>' : ''}`;
        document.querySelector('main')!.append(host);
        const text = host.textContent;
        const attachment = await attach(host, definition, { forceFallback: true });
        attachments.push(attachment);
        const content = host.shadowRoot!.querySelector<HTMLElement>('.hgpu-content')!,
          poster = host.shadowRoot!.querySelector<HTMLImageElement>('.hgpu-poster')!;
        rows.push({
          id: definition.id,
          textSame: text === host.textContent,
          state: attachment.state,
          gradient: content.style.backgroundImage,
          shadow: getComputedStyle(content).textShadow,
          fill: content.style.getPropertyValue('-webkit-text-fill-color'),
          posterHidden: poster.hidden,
          field: Boolean(attachment.field),
        });
      }
      (window as unknown as TextWindow).fallbacks = attachments;
      return rows;
    },
    { dom, effects: ['text-shimmer', 'text-outline-glow', 'heading-reveal'].map(effectPath) },
  );
  for (const row of result) {
    expect(row.state).toBe('fallback');
    expect(row.textSame && row.posterHidden).toBe(true);
    expect(row.field).toBe(false);
  }
  expect(result[0]!.gradient).toContain('linear-gradient');
  expect(result[0]!.fill).toBe('transparent');
  expect(result[1]!.shadow).not.toBe('none');
  expect(result[2]!.gradient).toBe('');
  expect(result[2]!.fill).toBe('');
  await page.locator('#focus-link').focus();
  await expect(page.locator('#focus-link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#visited$/);
  if (testInfo.project.name.startsWith('swiftshader'))
    await expect(page.locator('main')).toHaveScreenshot('actual-typography-fallbacks.png', {
      scale: 'css',
    });
  await page.evaluate(() => {
    const shimmer = document.getElementById('fallback-text-shimmer')!;
    for (const [name, value] of Object.entries({
      first: '#ed5566',
      second: '#77bbcc',
      third: '#eee0aa',
    }))
      shimmer.style.setProperty(`--hgpu-${name}`, value);
    const glow = document.getElementById('fallback-text-outline-glow')!;
    for (const [name, value] of Object.entries({ tint: '#cc8877', glow: '12', intensity: '.27' }))
      glow.style.setProperty(`--hgpu-${name}`, value);
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const shimmer = document
          .getElementById('fallback-text-shimmer')!
          .shadowRoot!.querySelector<HTMLElement>('.hgpu-content')!;
        const glow = document
          .getElementById('fallback-text-outline-glow')!
          .shadowRoot!.querySelector<HTMLElement>('.hgpu-content')!;
        return {
          gradient: shimmer.style.backgroundImage,
          shadow: getComputedStyle(glow).textShadow,
        };
      }),
    )
    .toMatchObject({
      gradient: expect.stringContaining('237, 85, 102'),
      shadow: expect.stringContaining('12px'),
    });
  const shadow = await page.evaluate(
    () =>
      getComputedStyle(
        document
          .getElementById('fallback-text-outline-glow')!
          .shadowRoot!.querySelector<HTMLElement>('.hgpu-content')!,
      ).textShadow,
  );
  expect(shadow).toContain('0.27');
  const authored = await page.locator('#fallback-text-shimmer').screenshot();
  const coloredGlyphs = await page.evaluate(async (data) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + data;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const painter = canvas.getContext('2d')!;
    painter.drawImage(image, 0, 0);
    const pixels = painter.getImageData(0, 0, canvas.width, canvas.height).data;
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (
        Math.max(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) > 80 &&
        Math.max(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) -
          Math.min(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) >
          30
      )
        colored++;
    return colored;
  }, authored.toString('base64'));
  expect(coloredGlyphs).toBeGreaterThan(100);
  if (testInfo.project.name.startsWith('swiftshader'))
    await expect(page.locator('main')).toHaveScreenshot('authored-typography-fallbacks.png', {
      scale: 'css',
    });
  await page.evaluate(() =>
    (window as unknown as TextWindow).fallbacks.forEach((attachment) => attachment.destroy()),
  );
});

test('aborting during asynchronous mask creation closes the bitmap and disconnects observers', async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(
    async ({ dom, effect }) => {
      const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
      const { default: definition } = (await import(effect)) as { default: EffectDefinition };
      const w = window as unknown as TextWindow & {
        abortMask: () => void;
        releaseMask: () => void;
        maskPending: boolean;
        finishMask: () => Promise<{
          state: string;
          active: number;
          bitmapWidth: number;
          fieldReleased: boolean;
        }>;
      };
      const active = new Set<object>();
      const originalMutation = window.MutationObserver,
        originalResize = window.ResizeObserver,
        originalBitmap = window.createImageBitmap;
      window.MutationObserver = class extends originalMutation {
        override observe(...args: Parameters<MutationObserver['observe']>) {
          active.add(this);
          super.observe(...args);
        }
        override disconnect() {
          active.delete(this);
          super.disconnect();
        }
      };
      window.ResizeObserver = class extends originalResize {
        override observe(...args: Parameters<ResizeObserver['observe']>) {
          active.add(this);
          super.observe(...args);
        }
        override disconnect() {
          active.delete(this);
          super.disconnect();
        }
      };
      let bitmap: ImageBitmap | undefined;
      const gate = new Promise<void>((resolve) => {
        w.releaseMask = resolve;
      });
      window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
        bitmap = await originalBitmap(...args);
        w.maskPending = true;
        await gate;
        return bitmap;
      }) as typeof createImageBitmap;
      const controller = new AbortController();
      w.abortMask = () => controller.abort();
      const pending = attach(document.getElementById('headline')!, definition, {
        signal: controller.signal,
        playing: false,
        adaptiveQuality: false,
      });
      w.finishMask = async () => {
        const attachment = await pending;
        document.getElementById('headline')!.textContent = 'Mutation after disposal';
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        window.MutationObserver = originalMutation;
        window.ResizeObserver = originalResize;
        window.createImageBitmap = originalBitmap;
        return {
          state: attachment.state,
          active: active.size,
          bitmapWidth: bitmap!.width,
          fieldReleased: attachment.field === null,
        };
      };
    },
    { dom, effect: effectPath('text-shimmer') },
  );
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'maskPending'))).toBe(true);
  await page.evaluate(() => {
    Reflect.get(window, 'abortMask')();
    Reflect.get(window, 'releaseMask')();
  });
  const result = await page.evaluate(() => Reflect.get(window, 'finishMask')());
  expect(result).toMatchObject({
    state: 'disposed',
    active: 0,
    bitmapWidth: 0,
    fieldReleased: true,
  });
});

test('an older asynchronous mask cannot replace a newer content snapshot', async ({ page }) => {
  await fixture(page);
  await attachWhite(page);
  const previous = await uploadVersion(page);
  await page.evaluate(() => {
    const original = window.createImageBitmap;
    let delayed: ImageBitmap | undefined,
      first = true;
    const gate = new Promise<void>((resolve) => Reflect.set(window, 'releaseOldMask', resolve));
    window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
      const bitmap = await original(...args);
      if (first) {
        first = false;
        delayed = bitmap;
        Reflect.set(window, 'oldMaskPending', true);
        await gate;
      }
      return bitmap;
    }) as typeof createImageBitmap;
    Reflect.set(window, 'restoreMaskCreator', () => {
      window.createImageBitmap = original;
      return delayed!.width;
    });
    document.getElementById('headline')!.textContent = 'Older pending mask';
  });
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'oldMaskPending'))).toBe(true);
  await page.locator('#headline').evaluate((node) => {
    node.textContent = 'Newest visible words';
  });
  const newest = await changedMask(page, previous);
  const pixels = await page.evaluate(async () =>
    Array.from(
      (await (window as unknown as TextWindow).textAttachment.field!.readTap('input:text')).values,
    ),
  );
  await page.evaluate(async () => {
    Reflect.get(window, 'releaseOldMask')();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  expect(await uploadVersion(page)).toBe(newest);
  const final = await page.evaluate(async () => {
    const attachment = (window as unknown as TextWindow).textAttachment;
    const values = Array.from((await attachment.field!.readTap('input:text')).values);
    const bitmapWidth = Reflect.get(window, 'restoreMaskCreator')();
    const errors = [...attachment.field!.session.errors];
    attachment.destroy();
    return { values, bitmapWidth, errors };
  });
  expect(final.values).toEqual(pixels);
  expect(final.bitmapWidth).toBe(0);
  expect(final.errors).toEqual([]);
});

test('an explicit caller poster takes precedence over text-aware fallback and survives preset changes', async ({
  page,
}) => {
  await fixture(page);
  const poster =
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="#79352f"/></svg>',
    );
  await page.evaluate(
    async ({ dom, effect, poster }) => {
      const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
      const { default: definition } = (await import(effect)) as { default: EffectDefinition };
      (window as unknown as TextWindow).textAttachment = await attach(
        document.getElementById('headline')!,
        definition,
        { forceFallback: true, poster },
      );
    },
    { dom, effect: effectPath('text-shimmer'), poster },
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const host = document.getElementById('headline')!,
          image = host.shadowRoot!.querySelector<HTMLImageElement>('.hgpu-poster')!;
        return image.complete && image.naturalWidth > 0 && !image.hidden;
      }),
    )
    .toBe(true);
  const result = await page.evaluate(() => {
    const attachment = (window as unknown as TextWindow).textAttachment,
      host = attachment.host,
      image = host.shadowRoot!.querySelector<HTMLImageElement>('.hgpu-poster')!,
      content = host.shadowRoot!.querySelector<HTMLElement>('.hgpu-content')!;
    const before = image.src;
    attachment.preset('ember');
    const result = {
      before,
      after: image.src,
      gradient: content.style.backgroundImage,
      fill: content.style.getPropertyValue('-webkit-text-fill-color'),
      copy: host.textContent,
      posterVisible: !image.hidden,
    };
    attachment.destroy();
    return result;
  });
  expect(result.before).toBe(poster);
  expect(result.after).toBe(poster);
  expect(result.gradient).toBe('');
  expect(result.fill).toBe('');
  expect(result.posterVisible).toBe(true);
  expect(result.copy).toContain('beautiful');
});

test('returning to the bound layout cancels an older pending bitmap without uploading again', async ({
  page,
}) => {
  await fixture(page);
  await attachWhite(page);
  const initial = await uploadVersion(page);
  const pixels = await page.evaluate(async () =>
    Array.from(
      (await (window as unknown as TextWindow).textAttachment.field!.readTap('input:text')).values,
    ),
  );
  await page.evaluate(() => {
    const host = document.getElementById('headline')!,
      originalContent = host.innerHTML,
      original = window.createImageBitmap;
    let delayed: ImageBitmap | undefined,
      first = true;
    const gate = new Promise<void>((resolve) =>
      Reflect.set(window, 'releaseReturningMask', resolve),
    );
    window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
      const bitmap = await original(...args);
      if (first) {
        first = false;
        delayed = bitmap;
        Reflect.set(window, 'returningMaskPending', true);
        await gate;
      }
      return bitmap;
    }) as typeof createImageBitmap;
    Reflect.set(window, 'restoreOriginalLayout', () => {
      host.innerHTML = originalContent;
    });
    Reflect.set(window, 'restoreReturningCreator', () => {
      window.createImageBitmap = original;
      return delayed!.width;
    });
    host.querySelector('em')!.textContent = 'delightful';
  });
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, 'returningMaskPending')))
    .toBe(true);
  await page.evaluate(async () => {
    Reflect.get(window, 'restoreOriginalLayout')();
    // Let the content observer and canvas-size observer settle before resolving B.
    for (let i = 0; i < 6; i++) await new Promise(requestAnimationFrame);
    Reflect.get(window, 'releaseReturningMask')();
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  });
  expect(await uploadVersion(page)).toBe(initial);
  const result = await page.evaluate(async () => {
    const attachment = (window as unknown as TextWindow).textAttachment;
    const values = Array.from((await attachment.field!.readTap('input:text')).values);
    const bitmapWidth = Reflect.get(window, 'restoreReturningCreator')();
    attachment.destroy();
    return { values, bitmapWidth };
  });
  expect(result.values).toEqual(pixels);
  expect(result.bitmapWidth).toBe(0);
});
