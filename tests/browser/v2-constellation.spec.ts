import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const path = (value: string) => '/@fs' + fileURLToPath(new URL(value, import.meta.url));
const modules = {
  core: path('../../packages/core/src/index.ts'),
  constellation: path('../../packages/effects/src/constellation/index.ts'),
};
async function fixture(page: Page) {
  await page.route('**/__v2_constellation', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><style>body{margin:0;background:#11121b}canvas{display:block;width:240px;height:144px}</style><canvas></canvas>',
    }),
  );
  await page.goto('/__v2_constellation');
}

test('Constellation is deterministic, seed-dependent, bounded and complete without a pointer', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(async ({ core, constellation }) => {
    const { createEffect } = (await import(
      core
    )) as typeof import('../../packages/core/src/index.ts');
    const { default: effect } = (await import(
      constellation
    )) as typeof import('../../packages/effects/src/constellation/index.ts');
    const field = await createEffect(document.querySelector('canvas')!, effect, {
      playing: false,
      adaptiveQuality: false,
      resolutionScale: 1,
    });
    field.session.scheduler.setHidden(true);
    const read = async (time: number, seed = 7) => {
      field.drawAt(time, seed);
      return (await field.readPixels()).pixels;
    };
    const first = await read(0),
      repeat = await read(0),
      otherSeed = await read(0, 21),
      later = await read(30);
    let maximum = 0,
      nonzero = 0,
      premultiplied = true;
    for (let i = 0; i < first.length; i += 4) {
      maximum = Math.max(maximum, first[i + 3]!);
      if (first[i + 3]! > 0) nonzero++;
      if (Math.max(first[i]!, first[i + 1]!, first[i + 2]!) > first[i + 3]! + 1)
        premultiplied = false;
    }
    const presets = [];
    for (const preset of Object.values(effect.presets)) {
      field.store.reset();
      field.store.patch(preset);
      presets.push((await read(0)).reduce((sum, value) => sum + value, 0));
    }
    field.store.set('intensity', 0);
    const empty = await read(0);
    const errors = [...field.session.errors],
      diagnostics = [...field.diagnostics],
      session = field.session;
    field.destroy();
    field.destroy();
    return {
      repeat: first.every((value, i) => value === repeat[i]),
      seedChanges: first.some((value, i) => value !== otherSeed[i]),
      timeChanges: first.some((value, i) => value !== later[i]),
      maximum,
      nonzero,
      premultiplied,
      presets,
      empty: empty.every((value) => value === 0),
      inputs: effect.inputs,
      features: effect.features,
      tier: effect.tier,
      errors,
      diagnostics,
      clients: session.clients,
      surfaces: session.scheduler.surfaceCount,
      memory: field.memory(),
      state: field.state,
    };
  }, modules);
  expect(result.repeat).toBe(true);
  expect(result.seedChanges).toBe(true);
  expect(result.timeChanges).toBe(true);
  expect(result.maximum).toBeGreaterThan(20);
  expect(result.maximum).toBeLessThanOrEqual(57);
  expect(result.nonzero).toBeGreaterThan(100);
  expect(result.premultiplied).toBe(true);
  expect(new Set(result.presets).size).toBe(3);
  expect(result.empty).toBe(true);
  expect(result.inputs).not.toContain('pointer');
  expect(result.features).toEqual([]);
  expect(result.tier).toBe('T1');
  expect(result.errors).toEqual([]);
  expect(result.diagnostics).toEqual([]);
  expect(result.clients).toBe(0);
  expect(result.surfaces).toBe(0);
  expect(result.state).toBe('disposed');
  expect(result.memory.textureBytes).toBe(0);
  expect(result.memory.bufferBytes).toBe(0);
  expect(result.memory.shared.entries).toBe(0);
});

test('Point pitch, radius and line width use CSS pixels at DPR1/2 and links cross cell boundaries', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(async ({ core, constellation }) => {
    const { createEffect } = (await import(
      core
    )) as typeof import('../../packages/core/src/index.ts');
    const { default: effect } = (await import(
      constellation
    )) as typeof import('../../packages/effects/src/constellation/index.ts');
    const field = await createEffect(document.querySelector('canvas')!, effect, {
      playing: false,
      adaptiveQuality: false,
      resolutionScale: 1,
      params: {
        pitch: 48,
        radius: 2,
        width: 2,
        jitter: 0,
        drift: 0,
        twinkle: 0,
        lineOpacity: 0,
        intensity: 1,
        tint: '#ffffff',
        linkDistance: 2,
      },
    });
    field.session.scheduler.setHidden(true);
    field.drawAt(0, 7);
    const dots = await field.readPixels(),
      dpr = field.frame.dpr;
    const alpha = (read: typeof dots, x: number, y: number) =>
      read.pixels[(Math.floor(y * dpr) * read.width + Math.floor(x * dpr)) * 4 + 3]!;
    const clusters: number[][] = [];
    for (let x = 0; x < dots.width; x++) {
      if (dots.pixels[(Math.floor(24 * dpr) * dots.width + x) * 4 + 3]! <= 10) continue;
      const previous = clusters.at(-1);
      if (!previous || x > previous.at(-1)! + 1) clusters.push([x]);
      else previous.push(x);
    }
    const centres = clusters.map((cluster) => ((cluster[0]! + cluster.at(-1)!) / 2 + 0.5) / dpr);
    let area = 0;
    for (let y = 0; y < 48 * dpr; y++)
      for (let x = 0; x < 48 * dpr; x++)
        area += dots.pixels[(y * dots.width + x) * 4 + 3]! / 255 / (dpr * dpr);
    field.store.set('lineOpacity', 1);
    field.drawAt(0, 7);
    const lines = await field.readPixels();
    // Probe horizontal and vertical joins on both sides of a cell boundary.
    const joins = [
      [47, 24],
      [48, 24],
      [49, 24],
      [24, 47],
      [24, 48],
      [24, 49],
    ].map(([x, y]) => alpha(lines, x!, y!));
    let lineArea = 0;
    for (let y = Math.floor(18 * dpr); y < 30 * dpr; y++)
      lineArea += lines.pixels[(y * lines.width + Math.floor(48 * dpr)) * 4 + 3]! / 255 / dpr;
    const errors = [...field.session.errors];
    field.destroy();
    return { centres, area, joins, lineArea, errors };
  }, modules);
  expect(result.centres).toHaveLength(5);
  expect(result.centres[0]).toBeCloseTo(24, 1);
  for (let i = 1; i < result.centres.length; i++)
    expect(result.centres[i]! - result.centres[i - 1]!).toBeCloseTo(48, 1);
  expect(result.area).toBeGreaterThan(10);
  expect(result.area).toBeLessThan(14);
  expect(result.joins.every((alpha) => alpha >= 125)).toBe(true);
  expect(result.lineArea).toBeGreaterThan(1.8);
  expect(result.lineArea).toBeLessThan(2.2);
  expect(result.errors).toEqual([]);
});

test('Reduced motion and disabled motion retain a settled scatter and stop scheduled draws', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(async ({ core, constellation }) => {
    const { createEffect } = (await import(
      core
    )) as typeof import('../../packages/core/src/index.ts');
    const { default: effect } = (await import(
      constellation
    )) as typeof import('../../packages/effects/src/constellation/index.ts');
    const field = await createEffect(document.querySelector('canvas')!, effect, {
      playing: false,
      adaptiveQuality: false,
    });
    field.setReducedMotion(true);
    field.drawAt(0, 7);
    const defaultRead = await field.readPixels();
    const settled = defaultRead.pixels;
    const defaultTarget = {
      size: [defaultRead.width, defaultRead.height],
      scale: field.surface!.resolutionScale,
      dpr: field.frame.dpr,
      deviceDpr: Math.min(window.devicePixelRatio, 2),
    };
    field.drawAt(120, 7);
    const future = (await field.readPixels()).pixels;
    await new Promise((resolve) => setTimeout(resolve, 150));
    let reducedDraws = 0;
    const removeReduced = field.onRendered(() => reducedDraws++);
    await new Promise((resolve) => setTimeout(resolve, 250));
    removeReduced();
    const reducedPlaying = field.playing;
    field.setReducedMotion(false);
    field.store.patch({ drift: 0, twinkle: 0 });
    field.drawAt(0, 7);
    const stationary = (await field.readPixels()).pixels;
    field.drawAt(300, 7);
    const stationaryLater = (await field.readPixels()).pixels;
    field.play();
    await new Promise((resolve) => setTimeout(resolve, 150));
    let stoppedDraws = 0;
    const removeStopped = field.onRendered(() => stoppedDraws++);
    await new Promise((resolve) => setTimeout(resolve, 250));
    removeStopped();
    const errors = [...field.session.errors];
    field.destroy();
    return {
      frozen: settled.every((value, i) => value === future[i]),
      stationary: stationary.every((value, i) => value === stationaryLater[i]),
      visible: settled.some((value, i) => i % 4 === 3 && value > 0),
      reducedDraws,
      stoppedDraws,
      reducedPlaying,
      defaultTarget,
      errors,
    };
  }, modules);
  expect(result.frozen).toBe(true);
  expect(result.stationary).toBe(true);
  expect(result.visible).toBe(true);
  expect(result.reducedDraws).toBe(0);
  expect(result.stoppedDraws).toBe(0);
  expect(result.reducedPlaying).toBe(false);
  expect(result.defaultTarget.scale).toBe(0.5);
  expect(result.defaultTarget.dpr).toBe(result.defaultTarget.deviceDpr * 0.5);
  expect(result.defaultTarget.size).toEqual([
    Math.round(240 * result.defaultTarget.deviceDpr * 0.5),
    Math.round(144 * result.defaultTarget.deviceDpr * 0.5),
  ]);
  expect(result.errors).toEqual([]);
});
