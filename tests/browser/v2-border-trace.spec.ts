import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { EffectDefinition, EffectField } from '../../packages/core/src/index.ts';
import type { Attachment } from '../../packages/dom/src/index.ts';

const source = (path: string) => '/@fs' + fileURLToPath(new URL(path, import.meta.url));
const core = source('../../packages/core/src/index.ts');
const dom = source('../../packages/dom/src/index.ts');
const effect = source('../../packages/effects/src/border-energy/index.ts');
type BorderWindow = Window & { border: EffectField; borderAttachment: Attachment };

async function fixture(page: Page) {
  await page.route('**/__v2_border_trace', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><style>body{margin:40px;background:#080910;color:white}canvas{width:240px;height:180px}#host{position:relative;width:200px;height:140px;border-radius:60px 15px 45px 8px / 20px 40px 35px 8px;--hgpu-intensity:0;transition:--hgpu-intensity 80ms linear}#host:hover{--hgpu-intensity:1}</style><canvas></canvas><div id="host"><button>Launch action</button></div>',
    }),
  );
  await page.goto('/__v2_border_trace');
}

test('four elliptical corners retain CSS-pixel contours across DPR and render scales', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(
    async ({ core, effect }) => {
      const { createEffect } = (await import(
        core
      )) as typeof import('../../packages/core/src/index.ts');
      const { default: definition } = (await import(effect)) as { default: EffectDefinition };
      const rows = [];
      for (const scale of [1, 0.5]) {
        for (const rx of [
          [60, 15, 45, 8],
          [150, 15, 45, 8],
        ]) {
          const ry = [20, 40, 35, 8];
          const field = await createEffect(document.querySelector('canvas')!, definition, {
            playing: false,
            adaptiveQuality: false,
            resolutionScale: scale,
            preset: 'border-trace',
            params: {
              intensity: 1,
              speed: 0,
              width: 2,
              glow: 1,
              rect: [20 / 240, 20 / 180, 200 / 240, 140 / 180],
              radiiX: rx,
              radiiY: ry,
            },
          });
          field.drawAt(0, 7);
          const read = await field.readPixels(),
            dpr = field.frame.dpr;
          const alpha = (x: number, y: number) =>
            read.pixels[
              (Math.max(0, Math.min(read.height - 1, Math.floor(y * dpr))) * read.width +
                Math.max(0, Math.min(read.width - 1, Math.floor(x * dpr)))) *
                4 +
                3
            ]!;
          const peaks = [];
          for (let i = 0; i < 4; i++) {
            const right = i === 1 || i === 2,
              bottom = i >= 2;
            const centreX = right ? 220 - rx[i]! : 20 + rx[i]!,
              centreY = bottom ? 160 - ry[i]! : 20 + ry[i]!;
            // Independent ellipse parameterization specifies the actual CSS border rim.
            const x = centreX + (right ? 1 : -1) * rx[i]! * Math.SQRT1_2,
              y = centreY + (bottom ? 1 : -1) * ry[i]! * Math.SQRT1_2;
            let peak = 0;
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++)
                peak = Math.max(peak, alpha(x + dx / dpr, y + dy / dpr));
            peaks.push(peak);
          }
          const corners = [
            [20, 20],
            [220, 20],
            [220, 160],
            [20, 160],
          ].map(([x, y]) => alpha(x!, y!));
          const diagnostics = [...field.diagnostics],
            errors = [...field.session.errors];
          field.destroy();
          rows.push({ peaks, corners, diagnostics, errors, scale, dpr });
        }
      }
      return rows;
    },
    { core, effect },
  );
  for (const row of result) {
    for (const peak of row.peaks) expect(peak).toBeGreaterThan(8);
    for (const corner of row.corners) expect(corner).toBeLessThan(4);
    expect(row.errors).toEqual([]);
    expect(row.diagnostics).toEqual([]);
  }
});

test('trace is transparent at rest, replayable, static in reduced motion and releases owned resources', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(
    async ({ core, effect }) => {
      const { createEffect } = (await import(
        core
      )) as typeof import('../../packages/core/src/index.ts');
      const { default: definition } = (await import(effect)) as { default: EffectDefinition };
      const field = await createEffect(document.querySelector('canvas')!, definition, {
        playing: false,
        adaptiveQuality: false,
        preset: 'border-trace',
      });
      const draw = async (time: number) => {
        field.drawAt(time, 7);
        return (await field.readPixels()).pixels;
      };
      const rest = await draw(0);
      field.store.set('intensity', 1);
      const lit = await draw(2);
      const replay = await draw(2);
      field.store.set('intensity', 0);
      const faded = await draw(2);
      field.store.set('intensity', 1);
      field.setReducedMotion(true);
      const reduced = await draw(0);
      const later = await draw(100);
      field.store.reset();
      field.store.set('intensity', 0);
      const legacy = await draw(0);
      const errors = [...field.session.errors],
        diagnostics = [...field.diagnostics],
        session = field.session;
      field.destroy();
      field.destroy();
      return {
        rest: rest.every((v) => v === 0),
        faded: faded.every((v) => v === 0),
        lit: lit.reduce((maximum, value) => Math.max(maximum, value), 0),
        replay: lit.every((v, i) => v === replay[i]),
        reduced: reduced.every((v, i) => v === later[i]),
        legacy: legacy.reduce((maximum, value) => Math.max(maximum, value), 0),
        errors,
        diagnostics,
        memory: field.memory(),
        clients: session.clients,
        state: session.state,
      };
    },
    { core, effect },
  );
  expect(result.rest && result.faded && result.replay && result.reduced).toBe(true);
  expect(result.lit).toBeGreaterThan(0);
  expect(result.legacy).toBeGreaterThan(0);
  expect(result.errors).toEqual([]);
  expect(result.diagnostics).toEqual([]);
  expect(result.memory.textureBytes).toBe(0);
  expect(result.memory.bufferBytes).toBe(0);
  expect(result.clients).toBe(0);
  expect(result.state).toBe('closed');
});

test('real CSS hover drives trace opacity and padded DOM geometry without capturing clicks', async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(
    async ({ dom, effect }) => {
      const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
      const { default: definition } = (await import(effect)) as { default: EffectDefinition };
      try {
        CSS.registerProperty({
          name: '--hgpu-intensity',
          syntax: '<number>',
          inherits: false,
          initialValue: '0',
        });
      } catch {}
      const attachment = await attach(document.getElementById('host')!, definition, {
        preset: 'border-trace',
        padding: 24,
        layer: 'front',
        playing: false,
        adaptiveQuality: false,
      });
      (window as unknown as BorderWindow).borderAttachment = attachment;
      attachment.field!.session.scheduler.setHidden(true);
      document
        .querySelector('button')!
        .addEventListener(
          'click',
          () => (document.getElementById('host')!.dataset['clicked'] = 'yes'),
        );
    },
    { dom, effect },
  );
  const sample = () =>
    page.evaluate(async () => {
      const a = (window as unknown as BorderWindow).borderAttachment,
        f = a.field!;
      f.beforeFrame();
      f.drawAt(0, 7);
      const read = await f.readPixels();
      const cssWidth = read.width / f.frame.dpr,
        cssHeight = read.height / f.frame.dpr;
      const rect = f.store.values['rect'] as readonly number[];
      let outside = 0;
      for (let y = 0; y < read.height; y++)
        for (let x = 0; x < read.width; x++) {
          if (
            x / f.frame.dpr >= (rect[0]! + rect[2]!) * cssWidth &&
            Math.abs(y / f.frame.dpr - cssHeight * 0.5) < 4
          )
            outside = Math.max(outside, read.pixels[(y * read.width + x) * 4 + 3]!);
        }
      return {
        intensity: f.store.values['intensity'],
        rect: [...rect],
        radiiX: f.store.values['radiiX'],
        radiiY: f.store.values['radiiY'],
        cssWidth,
        cssHeight,
        zero: read.pixels.every((v) => v === 0),
        outside,
        errors: [...f.session.errors],
      };
    });
  await expect.poll(async () => (await sample()).cssWidth).toBe(248);
  const rest = await sample();
  expect(rest.zero).toBe(true);
  await page.locator('#host').hover();
  await expect.poll(async () => (await sample()).intensity).toBe(1);
  const hovered = await sample();
  expect(hovered.outside).toBeGreaterThan(0);
  expect(hovered.radiiX).toEqual([60, 15, 45, 8]);
  expect(hovered.radiiY).toEqual([20, 40, 35, 8]);
  expect(hovered.errors).toEqual([]);
  expect(hovered.cssHeight).toBe(188);
  expect(hovered.rect[0]! * 248).toBeCloseTo(24, 3);
  expect(hovered.rect[2]! * 248).toBeCloseTo(200, 3);
  await page.getByRole('button', { name: 'Launch action' }).click();
  await expect(page.locator('#host')).toHaveAttribute('data-clicked', 'yes');
  await page.mouse.move(1, 1);
  await expect.poll(async () => (await sample()).intensity).toBe(0);
  expect((await sample()).zero).toBe(true);
  await page.evaluate(() => (window as unknown as BorderWindow).borderAttachment.destroy());
});
