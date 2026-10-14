import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { EffectDefinition, EffectField } from '../../packages/core/src/index.ts';

const core = '/@fs' + fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url));
const dom = '/@fs' + fileURLToPath(new URL('../../packages/dom/src/index.ts', import.meta.url));
const ids = [
  'aurora-veil',
  'grain-overlay',
  'dot-matrix-field',
  'grid-horizon',
  'topographic-lines',
  'light-sweep',
];
const effectPath = (id: string) =>
  '/@fs' + fileURLToPath(new URL(`../../packages/effects/src/${id}/index.ts`, import.meta.url));

type FixtureWindow = Window & { v2: EffectField; definition: EffectDefinition };
async function fixture(page: Page) {
  await page.route('**/__v2_backgrounds', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><style>body{margin:0;background:#11121b}canvas,#hero{width:192px;height:144px}#hero{color:white}</style><canvas></canvas><div id="hero">Readable launch copy</div>',
    }),
  );
  await page.goto('/__v2_backgrounds');
}

for (const id of ids) {
  test(`${id}: deterministic defaults, presets, settled pose, alpha and cleanup`, async ({
    page,
  }, testInfo) => {
    await fixture(page);
    const initial = await page.evaluate(
      async ({ core, effectPath, id }) => {
        const { createEffect } = (await import(
          core
        )) as typeof import('../../packages/core/src/index.ts');
        const { default: definition } = (await import(effectPath)) as { default: EffectDefinition };
        const field = await createEffect(document.querySelector('canvas')!, definition, {
          playing: false,
          adaptiveQuality: false,
        });
        const w = window as unknown as FixtureWindow;
        w.v2 = field;
        w.definition = definition;
        if (id === 'light-sweep') field.store.set('progress', 0.5);
        field.drawAt(0, 7);
        const first = await field.readPixels();
        field.drawAt(0, 7);
        const second = await field.readPixels();
        const alpha = Array.from(first.pixels).filter((_v, i) => i % 4 === 3);
        let premultiplied = true;
        for (let i = 0; i < first.pixels.length; i += 4)
          if (
            Math.max(first.pixels[i]!, first.pixels[i + 1]!, first.pixels[i + 2]!) >
            first.pixels[i + 3]! + 1
          )
            premultiplied = false;
        return {
          same: first.pixels.every((value, i) => value === second.pixels[i]),
          alphaMax: Math.max(...alpha),
          alphaMin: Math.min(...alpha),
          premultiplied,
          scale: field.surface!.resolutionScale,
          variation: new Set(first.pixels).size,
        };
      },
      { core, effectPath: effectPath(id), id },
    );
    expect(initial.same).toBe(true);
    expect(initial.premultiplied).toBe(true);
    expect(initial.alphaMax).toBeGreaterThan(0);
    expect(initial.variation).toBeGreaterThan(4);
    if (id === 'aurora-veil') expect(initial.scale).toBe(0.25);
    if (['grain-overlay', 'dot-matrix-field', 'grid-horizon', 'light-sweep'].includes(id))
      expect(initial.alphaMin).toBeLessThan(20);
    if (testInfo.project.name.startsWith('swiftshader'))
      await expect(page.locator('canvas')).toHaveScreenshot(`${id}-default.png`, {
        scale: 'css',
        maxDiffPixelRatio: 0.001,
      });
    if (id === 'grain-overlay' && testInfo.project.name.startsWith('swiftshader')) {
      await page.evaluate(() => {
        document.body.style.background = '#faf8f3';
      });
      await expect(page.locator('canvas')).toHaveScreenshot('grain-overlay-light.png', {
        scale: 'css',
        maxDiffPixelRatio: 0.001,
      });
      await page.evaluate(() => {
        document.body.style.background = '#11121b';
      });
    }
    const result = await page.evaluate(
      async ({ id }) => {
        const field = (window as unknown as FixtureWindow).v2;
        const summaries = [];
        for (const preset of Object.values(field.effect.presets)) {
          field.store.reset();
          field.store.patch(preset);
          if (id === 'light-sweep') field.store.set('progress', 0.5);
          field.drawAt(0, 7);
          summaries.push((await field.readPixels()).pixels.reduce((sum, value) => sum + value, 0));
        }
        field.store.reset();
        field.setReducedMotion(true);
        field.drawAt(field.effect.reducedMotion.time, 7);
        const settled = (await field.readPixels()).pixels;
        field.advance(120);
        const later = (await field.readPixels()).pixels;
        const frozen = settled.every((value, i) => value === later[i]);
        const reducedPlaying = field.playing;
        const reducedSweepAlpha =
          id === 'light-sweep'
            ? Math.max(...Array.from(settled).filter((_v, i) => i % 4 === 3))
            : null;
        field.store.set('intensity', 0);
        if ('dither' in field.effect.params) field.store.set('dither', false);
        field.drawAt(0, 7);
        const zero = (await field.readPixels()).pixels;
        const zeroTransparent = zero.every((value) => value === 0);
        const zeroFlat = zero.every((value, i) => value === zero[i % 4]);
        const errors = [...field.session.errors],
          diagnostics = [...field.diagnostics],
          session = field.session;
        field.destroy();
        field.destroy();
        return {
          summaries,
          frozen,
          reducedPlaying,
          reducedSweepAlpha,
          zeroTransparent,
          zeroFlat,
          errors,
          diagnostics,
          state: field.state,
          memory: field.memory(),
          clients: session.clients,
          surfaces: session.scheduler.surfaceCount,
          device: session.state,
        };
      },
      { id },
    );
    expect(new Set(result.summaries).size).toBeGreaterThan(1);
    expect(result.frozen).toBe(true);
    expect(result.reducedPlaying).toBe(false);
    if (id === 'light-sweep') expect(result.reducedSweepAlpha).toBe(0);
    if (['aurora-veil', 'topographic-lines'].includes(id)) expect(result.zeroFlat).toBe(true);
    else expect(result.zeroTransparent).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.state).toBe('disposed');
    expect(result.clients).toBe(0);
    expect(result.surfaces).toBe(0);
    expect(result.device).toBe('closed');
    expect(result.memory.textureBytes).toBe(0);
    expect(result.memory.bufferBytes).toBe(0);
    expect(result.memory.shared.entries).toBe(0);
  });
}

test('dots preserve CSS pitch and radius at DPR 1/2 and half scale, with half pointer boost in reduced motion', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(
    async ({ core, path }) => {
      const { createEffect } = (await import(
        core
      )) as typeof import('../../packages/core/src/index.ts');
      const { default: effect } = (await import(path)) as { default: EffectDefinition };
      const rows = [];
      for (const scale of [1, 0.5]) {
        const field = await createEffect(document.querySelector('canvas')!, effect, {
          playing: false,
          resolutionScale: scale,
          params: { breathing: 0, pointerStrength: 0 },
        });
        field.drawAt(0);
        const read = await field.readPixels(),
          dpr = field.frame.dpr;
        const y = Math.floor(12 * dpr),
          clusters: number[][] = [];
        for (let x = 0; x < read.width; x++) {
          if (read.pixels[(y * read.width + x) * 4 + 3]! <= 2) continue;
          const last = clusters.at(-1);
          if (!last || x > last.at(-1)! + 1) clusters.push([x]);
          else last.push(x);
        }
        const centres = clusters.map(
          (cluster) => ((cluster[0]! + cluster.at(-1)!) / 2 + 0.5) / dpr,
        );
        // Integrated alpha is a robust footprint probe even when a dot is below one target pixel.
        let area = 0;
        for (let yy = 0; yy < 24 * dpr; yy++)
          for (let x = 0; x < 24 * dpr; x++)
            area += read.pixels[(yy * read.width + x) * 4 + 3]! / 255;
        rows.push({ centres, area: area / (dpr * dpr), dpr });
        field.destroy();
      }
      const field = await createEffect(document.querySelector('canvas')!, effect, {
        playing: false,
        params: { breathing: 0, radius: 2, pointerStrength: 0.5, intensity: 0.25 },
      });
      field.frame.pointer = [0.5, 0.5];
      const alphaSum = async () => {
        field.drawAt(0);
        return (await field.readPixels()).pixels.reduce(
          (sum, value, i) => sum + (i % 4 === 3 ? value : 0),
          0,
        );
      };
      const normal = await alphaSum();
      field.setReducedMotion(true);
      const reduced = await alphaSum();
      field.store.set('pointerStrength', 0);
      const rest = await alphaSum();
      const errors = [...field.session.errors];
      field.destroy();
      return { rows, normal, reduced, rest, errors };
    },
    { core, path: effectPath('dot-matrix-field') },
  );
  for (const row of result.rows) {
    expect(row.centres).toHaveLength(8);
    expect(row.centres[0]).toBeCloseTo(12, 1);
    for (let i = 1; i < row.centres.length; i++)
      expect(row.centres[i]! - row.centres[i - 1]!).toBeCloseTo(24, 1);
    expect(row.area).toBeGreaterThan(0.2);
    expect(row.area).toBeLessThan(1.6);
  }
  expect(result.normal).toBeGreaterThan(result.reduced);
  expect(result.reduced).toBeGreaterThan(result.rest);
  expect(result.errors).toEqual([]);
});

test('grain caps scheduled renders at 12/18/24 Hz and weights optional image luminance', async ({
  page,
}, testInfo) => {
  await fixture(page);
  const result = await page.evaluate(
    async ({ core, path }) => {
      const { createEffect } = (await import(
        core
      )) as typeof import('../../packages/core/src/index.ts');
      const { default: effect } = (await import(path)) as { default: EffectDefinition };
      const field = await createEffect(document.querySelector('canvas')!, effect, {
        playing: false,
        adaptiveQuality: false,
      });
      field.drawAt(0);
      await field.readPixels();
      const counts = [];
      const pointerTarget = document.querySelector('canvas')!;
      let pointerX = 0;
      const movingPointer = setInterval(
        () =>
          pointerTarget.dispatchEvent(
            new PointerEvent('pointermove', { clientX: pointerX++ % 160, clientY: 50 }),
          ),
        10,
      );
      for (const rate of [12, 18, 24]) {
        field.store.set('rate', rate);
        field.drawAt(0);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const renderedTimes: number[] = [];
        const remove = field.onRendered(() => renderedTimes.push(field.frame.time)),
          before = field.frame.time;
        field.play();
        await new Promise((resolve) => setTimeout(resolve, 1100));
        field.pause();
        remove();
        counts.push({
          rate,
          renders: renderedTimes.length,
          elapsed: field.frame.time - before,
          renderedTimes,
          buckets: renderedTimes.map((time) => Math.floor(time * rate + 1e-6)),
        });
      }
      clearInterval(movingPointer);
      const mask = document.createElement('canvas');
      mask.width = 192;
      mask.height = 144;
      const painter = mask.getContext('2d')!;
      painter.fillStyle = 'black';
      painter.fillRect(0, 0, 96, 144);
      painter.fillStyle = 'white';
      painter.fillRect(96, 0, 96, 144);
      const bitmap = await createImageBitmap(mask);
      await field.bindInput('image', { kind: 'image', source: bitmap });
      field.store.set('luminanceWeight', 1);
      field.drawAt(0);
      const read = await field.readPixels();
      let left = 0,
        right = 0;
      for (let y = 0; y < read.height; y++)
        for (let x = 0; x < read.width; x++) {
          const alpha = read.pixels[(y * read.width + x) * 4 + 3]!;
          if (x < read.width / 2 - 2) left += alpha;
          else if (x > read.width / 2 + 2) right += alpha;
        }
      const errors = [...field.session.errors];
      field.destroy();
      bitmap.close();
      return { counts, left, right, errors };
    },
    { core, path: effectPath('grain-overlay') },
  );
  for (const count of result.counts) {
    expect(count.elapsed).toBeGreaterThan(0.5);
    expect(count.renders).toBeGreaterThan(0);
    expect(count.renders).toBeLessThanOrEqual(Math.ceil(count.rate * count.elapsed) + 2);
    const seen = new Set<number>();
    const duplicates = count.buckets.filter((bucket) => {
      const duplicate = seen.has(bucket);
      seen.add(bucket);
      return duplicate;
    });
    // Initial dirty work may bypass the cap once. Input-free animation must
    // never redraw a later grain bucket, even while unused pointer events fire.
    expect(duplicates.length).toBeLessThanOrEqual(1);
    expect(duplicates.every((bucket) => bucket === count.buckets[0])).toBe(true);
  }
  await testInfo.attach('grain-rate-observations', {
    body: JSON.stringify(result.counts),
    contentType: 'application/json',
  });
  console.log(
    `${testInfo.project.name} grain: ${result.counts.map((count) => `${count.rate}Hz → ${count.renders} draws / ${count.elapsed.toFixed(3)}s simulated`).join('; ')}`,
  );
  expect(result.left / result.right).toBeGreaterThan(0.25);
  expect(result.left / result.right).toBeLessThan(0.45);
  expect(result.errors).toEqual([]);
});

test('six bundled posters load in forced fallback as a single decorative layer with readable DOM', async ({
  page,
}) => {
  await fixture(page);
  const results = await page.evaluate(
    async ({ dom, paths }) => {
      const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
      const results = [];
      for (const path of paths) {
        const { default: effect } = (await import(path)) as { default: EffectDefinition };
        const host = document.getElementById('hero')!;
        const attachment = await attach(host, effect, { forceFallback: true });
        const poster = host.shadowRoot!.querySelector('img')!;
        await poster.decode();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const wrapper = host.shadowRoot!.querySelector('.hgpu-wrap')!;
        results.push({
          id: effect.id,
          state: attachment.state,
          source: poster.currentSrc,
          loaded: poster.naturalWidth > 0,
          posterVisible: !poster.hidden,
          canvasHidden: attachment.canvas.hidden,
          background: getComputedStyle(wrapper).backgroundImage,
          text: host.textContent,
          aria: attachment.canvas.getAttribute('aria-hidden'),
          tabIndex: attachment.canvas.tabIndex,
        });
        attachment.destroy();
      }
      return results;
    },
    { dom, paths: ids.map(effectPath) },
  );
  for (const result of results) {
    expect(result.state).toBe('fallback');
    expect(result.loaded).toBe(true);
    expect(result.source).toContain('poster.png');
    expect(result.posterVisible).toBe(true);
    expect(result.canvasHidden).toBe(true);
    expect(result.background).toBe('none');
    expect(result.text).toBe('Readable launch copy');
    expect(result.aria).toBe('true');
    expect(result.tabIndex).toBe(-1);
  }
  await expect(page.locator('#hero')).toHaveText('Readable launch copy');
});

test('grid fog keeps moving unresolved horizon lines quiet at 1440×900 CSS pixels', async ({
  page,
}, testInfo) => {
  await fixture(page);
  const observation = await page.evaluate(
    async ({ core, path }) => {
      const { createEffect } = (await import(
        core
      )) as typeof import('../../packages/core/src/index.ts');
      const { default: effect } = (await import(path)) as { default: EffectDefinition };
      const canvas = document.querySelector('canvas')!;
      canvas.style.width = '1440px';
      canvas.style.height = '900px';
      const field = await createEffect(canvas, effect, {
        playing: false,
        adaptiveQuality: false,
        params: { speed: 0.15 },
      });
      let maxAlpha = 0,
        maxFlicker = 0,
        nearAlpha = 0;
      let previous: Uint8Array | null = null;
      for (let frame = 0; frame < 24; frame++) {
        field.drawAt((frame * 1.6) / 23);
        const read = await field.readPixels(),
          dpr = field.frame.dpr;
        const top = Math.ceil(900 * 0.35 * dpr),
          bottom = Math.floor((900 * 0.35 + 20) * dpr);
        const region = new Uint8Array((bottom - top) * read.width);
        let n = 0;
        for (let y = top; y < bottom; y++)
          for (let x = 0; x < read.width; x++) {
            const alpha = read.pixels[(y * read.width + x) * 4 + 3]!;
            region[n] = alpha;
            maxAlpha = Math.max(maxAlpha, alpha);
            if (previous) maxFlicker = Math.max(maxFlicker, Math.abs(alpha - previous[n]!));
            n++;
          }
        previous = region;
        // Ensure the quiet horizon is due to fog, while the nearby plane still has visible lines.
        for (let y = Math.floor(read.height * 0.9); y < read.height; y++)
          for (let x = 0; x < read.width; x++)
            nearAlpha = Math.max(nearAlpha, read.pixels[(y * read.width + x) * 4 + 3]!);
      }
      const errors = [...field.session.errors];
      field.destroy();
      return { maxAlpha, maxFlicker, nearAlpha, samples: 24, cssSize: [1440, 900], errors };
    },
    { core, path: effectPath('grid-horizon') },
  );
  // At twenty CSS pixels below this horizon the ray reaches z≈29: default fog
  // attenuates even full line coverage to about one alpha code value (out of 255).
  expect(observation.maxAlpha).toBeLessThanOrEqual(3);
  expect(observation.maxFlicker).toBeLessThanOrEqual(2);
  expect(observation.nearAlpha).toBeGreaterThan(20);
  expect(observation.errors).toEqual([]);
  await testInfo.attach('horizon-observations', {
    body: JSON.stringify(observation),
    contentType: 'application/json',
  });
  console.log(
    `${testInfo.project.name} horizon: max alpha=${observation.maxAlpha}, max frame delta=${observation.maxFlicker}, near alpha=${observation.nearAlpha}`,
  );
});
