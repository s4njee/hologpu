import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { EffectDefinition, EffectField } from '../../packages/core/src/index.ts';

const core = '/@fs' + fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url));
const dom = '/@fs' + fileURLToPath(new URL('../../packages/dom/src/index.ts', import.meta.url));
const effectPath = (id: string) =>
  '/@fs' + fileURLToPath(new URL(`../../packages/effects/src/${id}/index.ts`, import.meta.url));

async function fixture(page: Page) {
  await page.route('**/__v2_card_interactions', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><style>body{margin:0;background:#edf0f8;color:#172849}canvas{width:240px;height:120px}#card{position:relative;box-sizing:border-box;margin:48px;width:240px;height:120px;border:0;padding:0;background:#fff;border-radius:48px 8px 20px 0 / 24px 12px 40px 0;font:600 20px Arial;--hgpu-elevation:.15}#activate{width:240px;height:120px;border:0;padding:0;border-radius:inherit;background:transparent;color:inherit;font:inherit}</style><canvas></canvas><div id="card"><button id="activate">Launch product</button></div>',
    }),
  );
  await page.goto('/__v2_card_interactions');
}

test('card fallbacks preserve authored copy and theme a single CSS shadow without fixture posters', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(
    async ({ dom, shadow, ripple }) => {
      const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
      const host = document.getElementById('card')!;
      const rows = [];
      for (const path of [shadow, ripple]) {
        const { default: effect } = (await import(path)) as { default: EffectDefinition };
        const attachment = await attach(host, effect, { forceFallback: true, padding: 32 });
        const shape = host.shadowRoot!.querySelector<HTMLElement>('.hgpu-card-fallback')!;
        const firstShadow = getComputedStyle(shape).boxShadow;
        host.style.setProperty('--hgpu-elevation', '.65');
        await new Promise((resolve) => setTimeout(resolve, 30));
        const nextShadow = getComputedStyle(shape).boxShadow;
        rows.push({
          id: effect.id,
          state: attachment.state,
          field: Boolean(attachment.field),
          firstShadow,
          nextShadow,
          radius: shape.style.borderRadius,
          posterHidden: host.shadowRoot!.querySelector<HTMLImageElement>('img')!.hidden,
          canvasHidden: attachment.canvas.hidden,
          copy: host.textContent,
          shadowCount: host.shadowRoot!.querySelectorAll('.hgpu-card-fallback').length,
        });
        attachment.destroy();
        host.style.setProperty('--hgpu-elevation', '.15');
      }
      return rows;
    },
    { dom, shadow: effectPath('hover-lift-shadow'), ripple: effectPath('press-ripple') },
  );
  for (const row of result) {
    expect(row.state).toBe('fallback');
    expect(row.field).toBe(false);
    expect(row.posterHidden).toBe(true);
    expect(row.canvasHidden).toBe(true);
    expect(row.copy).toBe('Launch product');
    expect(row.shadowCount).toBe(1);
  }
  expect(result[0]!.firstShadow).not.toBe('none');
  expect(result[0]!.nextShadow).not.toBe(result[0]!.firstShadow);
  expect(result[0]!.radius).toContain('48px');
  expect(result[1]!.firstShadow).toBe('none');
  expect(result[1]!.nextShadow).toBe('none');
});

test('ripple has bounded four-event storage, transparent endpoints, quiet idle and reset cleanup', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(
    async ({ core, path }) => {
      const { createEffect } = (await import(
        core
      )) as typeof import('../../packages/core/src/index.ts');
      const { default: effect } = (await import(path)) as { default: EffectDefinition };
      const field = await createEffect(document.querySelector('canvas')!, effect, {
        playing: false,
        reducedMotion: false,
        adaptiveQuality: false,
      });
      const alpha = (pixels: Uint8Array) =>
        pixels.reduce((sum, v, i) => sum + (i % 4 === 3 ? v : 0), 0);
      const readEvents = async () => {
        const tap = field.bufferTaps.ripples!;
        const device = field.session.device;
        const readback = device.createBuffer({
          size: 64,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        try {
          const encoder = device.createCommandEncoder();
          encoder.copyBufferToBuffer(tap.buffer, 0, readback, 0, 64);
          device.queue.submit([encoder.finish()]);
          await readback.mapAsync(GPUMapMode.READ);
          return Array.from(new Float32Array(readback.getMappedRange()));
        } finally {
          readback.destroy();
        }
      };
      field.drawAt(0);
      const initial = alpha((await field.readPixels()).pixels);
      field.play();
      const settleDeadline = performance.now() + 5000;
      let settledChecks = 0;
      while (settledChecks < 2) {
        await new Promise(requestAnimationFrame);
        await field.session.device.queue.onSubmittedWorkDone();
        const bounds = field.canvas.getBoundingClientRect();
        const settled =
          !field.dirty &&
          !field.session.scheduler.submissionPending &&
          bounds.width === 240 &&
          bounds.height === 120 &&
          field.surface!.size[0] === 240 * field.surface!.dpr &&
          field.surface!.size[1] === 120 * field.surface!.dpr;
        settledChecks = settled ? settledChecks + 1 : 0;
        if (performance.now() > settleDeadline) throw new Error('Idle ripple setup did not settle');
      }
      let idleDraws = 0;
      const remove = field.onRendered(() => idleDraws++);
      await new Promise((resolve) => setTimeout(resolve, 150));
      field.pause();
      remove();
      field.drawAt(0);
      field.press([0.25, 0.4]);
      field.drawAt(0.12);
      const activeRead = await field.readPixels(),
        active = alpha(activeRead.pixels);
      const centre =
        activeRead.pixels[
          (Math.floor(activeRead.height * 0.4) * activeRead.width +
            Math.floor(activeRead.width * 0.25)) *
            4 +
            3
        ]!;
      field.reset();
      for (let i = 0; i < 5; i++) {
        field.drawAt(i * 0.05);
        field.press([(i + 1) / 10, 0.5]);
        field.drawAt(i * 0.05);
      }
      const events = await readEvents();
      field.drawAt(0.81);
      const final = alpha((await field.readPixels()).pixels),
        settled = !field.shouldRender();
      field.press([0.5, 0.5]);
      field.reset();
      field.drawAt(0);
      const reset = alpha((await field.readPixels()).pixels),
        resetEvents = await readEvents();
      field.press([0.5, 0.5]);
      field.drawAt(0.2);
      field.store.set('intensity', 0);
      field.drawAt(0.2);
      const zero = alpha((await field.readPixels()).pixels),
        memory = field.instance!.memory!();
      const errors = [...field.session.errors],
        diagnostics = [...field.diagnostics];
      const instance = field.instance!;
      field.destroy();
      return {
        initial,
        active,
        centre,
        idleDraws,
        events,
        final,
        settled,
        reset,
        resetEvents,
        zero,
        memory,
        disposed: instance.memory!(),
        errors,
        diagnostics,
        intensity: effect.params.intensity!.default,
        cssTint: effect.params.tint!.css,
        cssIntensity: effect.params.intensity!.css,
        tier: effect.tier,
        features: effect.features,
      };
    },
    { core, path: effectPath('press-ripple') },
  );
  expect(result.initial).toBe(0);
  expect(result.active).toBeGreaterThan(1000);
  expect(result.centre).toBe(0);
  expect(result.idleDraws).toBe(0);
  expect(result.events.filter((_, i) => i % 4 === 3)).toEqual([1, 1, 1, 1]);
  expect(result.events.filter((_, i) => i % 4 === 0)).toEqual([
    expect.closeTo(0.2, 5),
    expect.closeTo(0.3, 5),
    expect.closeTo(0.4, 5),
    expect.closeTo(0.5, 5),
  ]);
  expect(result.final).toBe(0);
  expect(result.settled).toBe(true);
  expect(result.reset).toBe(0);
  expect(result.resetEvents).toEqual(Array(16).fill(0));
  expect(result.zero).toBe(0);
  expect(result.memory).toEqual({ textureBytes: 0, bufferBytes: 80 });
  expect(result.disposed).toEqual({ textureBytes: 0, bufferBytes: 0 });
  expect(result.intensity).toBeLessThanOrEqual(0.3);
  expect(result.cssTint).toBe(true);
  expect(result.cssIntensity).toBe(true);
  expect(result.tier).toBe('T1');
  expect(result.features).toEqual([]);
  expect(result.errors).toEqual([]);
  expect(result.diagnostics).toEqual([]);
});

test('reduced ripple is one uniform fade and expires while procedural playback stays frozen', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(
    async ({ core, path }) => {
      const { createEffect } = (await import(
        core
      )) as typeof import('../../packages/core/src/index.ts');
      const { default: effect } = (await import(path)) as { default: EffectDefinition };
      const field = await createEffect(document.querySelector('canvas')!, effect, {
        playing: false,
        reducedMotion: true,
        adaptiveQuality: false,
      });
      field.drawAt(0);
      field.press([0.2, 0.3]);
      field.drawAt(0.3);
      const middle = (await field.readPixels()).pixels;
      const alphas = Array.from(middle).filter((_, i) => i % 4 === 3);
      field.drawAt(0.4);
      field.press([0.8, 0.7]);
      field.drawAt(0.7);
      const latest = (await field.readPixels()).pixels;
      const same = middle.every((value, i) => value === latest[i]);
      field.drawAt(1.01);
      const final = (await field.readPixels()).pixels.every((value) => value === 0);
      field.reset();
      field.drawAt(0);
      field.press([0.5, 0.5]);
      await new Promise((resolve) => setTimeout(resolve, 900));
      const automaticFinal = (await field.readPixels()).pixels.every((value) => value === 0),
        time = field.frame.time,
        playing = field.playing,
        settled = !field.shouldRender();
      field.press([0.5, 0.5]);
      field.setReducedMotion(false);
      field.drawAt(0);
      const toggledClear = (await field.readPixels()).pixels.every((value) => value === 0);
      field.play();
      const toggleDeadline = performance.now() + 5000;
      let stableChecks = 0;
      while (stableChecks < 2) {
        await new Promise(requestAnimationFrame);
        await field.session.device.queue.onSubmittedWorkDone();
        stableChecks =
          !field.dirty && !field.session.scheduler.submissionPending ? stableChecks + 1 : 0;
        if (performance.now() > toggleDeadline) throw new Error('Motion toggle did not settle');
      }
      let toggledIdleDraws = 0;
      const remove = field.onRendered(() => toggledIdleDraws++);
      await new Promise((resolve) => setTimeout(resolve, 150));
      remove();
      field.drawAt(0);
      field.press([0.5, 0.5]);
      field.drawAt(0.12);
      const newPressWorks = (await field.readPixels()).pixels.some(
        (value, i) => i % 4 === 3 && value > 0,
      );
      const errors = [...field.session.errors];
      field.destroy();
      return {
        minimum: alphas.reduce((minimum, value) => Math.min(minimum, value), 255),
        maximum: alphas.reduce((maximum, value) => Math.max(maximum, value), 0),
        same,
        final,
        automaticFinal,
        time,
        playing,
        settled,
        toggledClear,
        toggledIdleDraws,
        newPressWorks,
        errors,
      };
    },
    { core, path: effectPath('press-ripple') },
  );
  expect(result.minimum).toBeGreaterThan(0);
  expect(result.minimum).toBe(result.maximum);
  expect(result.same).toBe(true);
  expect(result.final).toBe(true);
  expect(result.automaticFinal).toBe(true);
  expect(result.time).toBe(0);
  expect(result.playing).toBe(false);
  expect(result.settled).toBe(true);
  expect(result.toggledClear).toBe(true);
  expect(result.toggledIdleDraws).toBe(0);
  expect(result.newPressWorks).toBe(true);
  expect(result.errors).toEqual([]);
});

test('DOM pointer and keyboard presses use padded canvas coordinates and detach their listeners', async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(
    async ({ dom, path }) => {
      const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
      const { default: effect } = (await import(path)) as { default: EffectDefinition };
      const host = document.getElementById('card')!;
      const attachment = await attach(host, effect, {
        layer: 'front',
        padding: 32,
        playing: false,
        reducedMotion: false,
        adaptiveQuality: false,
      });
      const field = attachment.field!;
      const events: number[][] = [];
      const actualPointer: number[][] = [];
      host.addEventListener(
        'pointerdown',
        (event) => {
          const canvas = attachment.canvas.getBoundingClientRect();
          const button = document.getElementById('activate')!.getBoundingClientRect();
          actualPointer.push([
            event.clientX,
            event.clientY,
            canvas.left,
            canvas.top,
            canvas.width,
            canvas.height,
            button.left,
            button.top,
          ]);
        },
        { capture: true, once: true },
      );
      const original = field.instance!.onPointerDown!;
      field.instance!.onPointerDown = (position, frame) => {
        events.push([...position]);
        return original(position, frame);
      };
      Reflect.set(window, '__cardTest', {
        attachment,
        field,
        events,
        actualPointer,
        copy: host.textContent,
      });
    },
    { dom, path: effectPath('press-ripple') },
  );
  await page.locator('#activate').click({ position: { x: 60, y: 36 } });
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, '__cardTest').events.length))
    .toBe(1);
  await page.locator('#activate').focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, '__cardTest').events.length))
    .toBe(2);
  const result = await page.evaluate(async () => {
    const state = Reflect.get(window, '__cardTest');
    const field = state.field as EffectField;
    const canvas = state.attachment.canvas,
      rect = canvas.getBoundingClientRect();
    const host = document.getElementById('card')!,
      button = document.getElementById('activate')!;
    const waitBounds = async (width: number, height: number) => {
      const deadline = performance.now() + 5000;
      while (true) {
        const bounds = canvas.getBoundingClientRect(),
          surface = field.surface!;
        if (
          bounds.width === width &&
          bounds.height === height &&
          surface.size[0] === width * surface.dpr &&
          surface.size[1] === height * surface.dpr
        ) {
          const target = button.getBoundingClientRect();
          return {
            bounds: [bounds.width, bounds.height],
            size: [...surface.size],
            dpr: surface.dpr,
            events: state.events.length as number,
            focused: document.activeElement === button,
            nativeClickTarget:
              document.elementFromPoint(
                target.left + target.width / 2,
                target.top + target.height / 2,
              ) === button,
          };
        }
        if (performance.now() > deadline)
          throw new Error(`Padded ripple did not resize to ${width}×${height}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };
    host.style.width = button.style.width = '320px';
    host.style.height = button.style.height = '160px';
    const resizeChecks = [await waitBounds(384, 224)];
    state.attachment.setPadding(0);
    resizeChecks.push(await waitBounds(320, 160));
    state.attachment.setPadding(16);
    resizeChecks.push(await waitBounds(352, 192));
    await new Promise((resolve) => setTimeout(resolve, 900));
    const pixels = (await field.readPixels()).pixels;
    const errors = [...field.session.errors],
      canvasAria = canvas.getAttribute('aria-hidden'),
      events = state.events;
    state.attachment.destroy();
    document
      .getElementById('card')!
      .dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }),
      );
    document.getElementById('activate')!.click();
    return {
      events,
      actualPointer: state.actualPointer[0] as number[],
      afterCount: state.events.length,
      width: rect.width,
      height: rect.height,
      resizeChecks,
      final: pixels.every((v) => v === 0),
      errors,
      canvasAria,
      copy: document.getElementById('card')!.textContent,
      canvasConnected: canvas.isConnected,
    };
  });
  const [clientX, clientY, left, top, width, height, buttonLeft, buttonTop] = result.actualPointer;
  expect(result.events[0]![0]).toBeCloseTo((clientX! - left!) / width!, 6);
  expect(result.events[0]![1]).toBeCloseTo((clientY! - top!) / height!, 6);
  expect(clientX! - buttonLeft!).toBeCloseTo(60, 0);
  expect(Math.abs(clientY! - buttonTop! - 36)).toBeLessThanOrEqual(1);
  expect(result.events[1]).toEqual([0.5, 0.5]);
  expect(result.afterCount).toBe(2);
  expect(result.width).toBe(304);
  expect(result.height).toBe(184);
  expect(result.resizeChecks.map((row) => row.bounds)).toEqual([
    [384, 224],
    [320, 160],
    [352, 192],
  ]);
  for (const row of result.resizeChecks) {
    expect(row.size).toEqual(row.bounds.map((value) => value * row.dpr));
    expect(row.events).toBe(2);
    expect(row.focused).toBe(true);
    expect(row.nativeClickTarget).toBe(true);
  }
  expect(result.final).toBe(true);
  expect(result.errors).toEqual([]);
  expect(result.canvasAria).toBe('true');
  expect(result.copy).toBe('Launch product');
  expect(result.canvasConnected).toBe(false);
});

test('shadow follows true padded border box, elliptical corners and CSS elevation in CSS pixels', async ({
  page,
}, testInfo) => {
  await fixture(page);
  const result = await page.evaluate(
    async ({ dom, path }) => {
      const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
      const { default: effect } = (await import(path)) as { default: EffectDefinition };
      const host = document.getElementById('card')!;
      const attachment = await attach(host, effect, {
        layer: 'behind',
        padding: 32,
        playing: false,
        reducedMotion: false,
        adaptiveQuality: false,
      });
      const field = attachment.field!;
      const wait = async (value: number) => {
        const end = performance.now() + 5000;
        while (Number(field.params.elevation) !== value) {
          if (performance.now() > end) throw new Error('CSS elevation did not reach field');
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      };
      await wait(0.15);
      const expectedRect = [32 / 304, 32 / 184, 240 / 304, 120 / 184];
      const geometryDeadline = performance.now() + 5000;
      while (
        !Array.from(field.params.rect as readonly number[]).every(
          (value, index) => Math.abs(value - expectedRect[index]!) < 0.000001,
        ) ||
        field.surface!.size[0] !== 304 * field.surface!.dpr ||
        field.surface!.size[1] !== 184 * field.surface!.dpr
      ) {
        if (performance.now() > geometryDeadline)
          throw new Error('Padded card geometry did not settle');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      field.drawAt(0);
      const rest = await field.readPixels();
      const at = (read: typeof rest, x: number, y: number) =>
        read.pixels[
          (Math.floor((y * read.height) / 184) * read.width + Math.floor((x * read.width) / 304)) *
            4 +
            3
        ]!;
      const sum = (read: typeof rest) =>
        read.pixels.reduce((s, v, i) => s + (i % 4 === 3 ? v : 0), 0);
      const geometry = {
        rect: field.params.rect,
        radiiX: field.params.radiiX,
        radiiY: field.params.radiiY,
      };
      const restBelow = at(rest, 152, 160),
        restAbove = at(rest, 152, 24),
        interior = at(rest, 152, 92),
        squareCorner = at(rest, 33, 150),
        ellipseCorner = at(rest, 33, 33);
      host.style.setProperty('--hgpu-elevation', '.65');
      await wait(0.65);
      const lifted = await field.readPixels();
      field.setReducedMotion(true);
      field.drawAt(10);
      const reduced = (await field.readPixels()).pixels,
        sameReduced = lifted.pixels.every((v, i) => v === reduced[i]);
      host.style.setProperty('--hgpu-intensity', '0');
      const end = performance.now() + 5000;
      while (Number(field.params.intensity) !== 0) {
        if (performance.now() > end) throw new Error('CSS intensity did not reach field');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const zero = (await field.readPixels()).pixels.every((v) => v === 0);
      host.style.setProperty('--hgpu-intensity', '.2');
      while (Number(field.params.intensity) !== 0.2) {
        if (performance.now() > end + 5000) throw new Error('CSS intensity restore timed out');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      field.drawAt(0);
      Reflect.set(window, '__shadowAttachment', attachment);
      return {
        geometry,
        restBelow,
        restAbove,
        interior,
        squareCorner,
        ellipseCorner,
        restAlpha: sum(rest),
        liftedAlpha: sum(lifted),
        liftedBelow: at(lifted, 152, 160),
        sameReduced,
        zero,
        errors: [...field.session.errors],
        diagnostics: [...field.diagnostics],
        size: [...field.surface!.size],
        dpr: field.frame.dpr,
        intensity: effect.params.intensity!.default,
        cssElevation: effect.params.elevation!.css,
      };
    },
    { dom, path: effectPath('hover-lift-shadow') },
  );
  expect(result.geometry.rect).toEqual([
    expect.closeTo(32 / 304, 5),
    expect.closeTo(32 / 184, 5),
    expect.closeTo(240 / 304, 5),
    expect.closeTo(120 / 184, 5),
  ]);
  expect(result.geometry.radiiX).toEqual([48, 8, 20, 0]);
  expect(result.geometry.radiiY).toEqual([24, 12, 40, 0]);
  expect(result.interior).toBe(0);
  expect(result.squareCorner).toBe(0);
  expect(result.ellipseCorner).toBeGreaterThan(result.squareCorner);
  expect(result.restBelow).toBeGreaterThan(result.restAbove);
  // The same point, eight CSS pixels below the card, retains its opacity at both DPRs.
  expect(result.restBelow).toBeGreaterThanOrEqual(20);
  expect(result.restBelow).toBeLessThanOrEqual(34);
  expect(result.liftedBelow).toBeGreaterThan(result.restBelow);
  expect(result.liftedBelow).toBeGreaterThanOrEqual(40);
  expect(result.liftedBelow).toBeLessThanOrEqual(49);
  expect(result.liftedAlpha).toBeGreaterThan(result.restAlpha);
  expect(result.sameReduced).toBe(true);
  expect(result.zero).toBe(true);
  expect(result.errors).toEqual([]);
  expect(result.diagnostics).toEqual([]);
  expect(result.intensity).toBeLessThanOrEqual(0.3);
  expect(result.cssElevation).toBe(true);
  expect(result.size).toEqual([304 * result.dpr, 184 * result.dpr]);
  if (testInfo.project.name.startsWith('swiftshader'))
    await expect(page.locator('#card').locator('canvas')).toHaveScreenshot(
      `lift-shadow-${testInfo.project.name}.png`,
    );
  await page.evaluate(() => Reflect.get(window, '__shadowAttachment').destroy());
});
