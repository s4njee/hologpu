import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { EffectDefinition } from '../../packages/core/src/index.ts';

const core = '/@fs' + fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url));
const dom = '/@fs' + fileURLToPath(new URL('../../packages/dom/src/index.ts', import.meta.url));
const effectPath =
  '/@fs' +
  fileURLToPath(new URL('../../packages/effects/src/wave-divider/index.ts', import.meta.url));
type WaveModule = typeof import('../../packages/effects/src/wave-divider/index.ts');

async function fixture(page: import('@playwright/test').Page) {
  await page.route('**/__v2_wave_divider', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><style>body{margin:0}canvas,#divider{display:block;width:640px;height:96px}#divider{--section-fill:#234567;--hgpu-fill:var(--section-fill);--hgpu-amplitude:18}#divider svg{display:block;width:100%;height:100%;fill:var(--section-fill)}section{width:640px;background:#234567;color:white}</style><canvas></canvas><div id="divider"><svg aria-hidden="true" preserveAspectRatio="none"><path/></svg></div><section>Readable next section</section>',
    }),
  );
  await page.goto('/__v2_wave_divider');
}

test('SVG wave helper follows the analytic time-zero edge, closes the lower corners and validates authored geometry', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(async (path) => {
    const {
      waveDividerPath,
      waveDividerDefaults,
      default: effect,
    } = (await import(path)) as WaveModule;
    const values = (path: string) =>
      [...path.matchAll(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)].map((match) => Number(match[0]));
    const points = values(waveDividerPath(640, 96));
    let maxVertexError = 0,
      maxInterpolationError = 0;
    const edge = (x: number) =>
      48 +
      18 *
        (Math.sin((x / 640) * Math.PI * 2 * 1.15) +
          0.35 * Math.sin((x / 640) * Math.PI * 4 * 1.15 + 1.3));
    for (let i = 0; i < points.length - 4; i += 2) {
      maxVertexError = Math.max(maxVertexError, Math.abs(points[i + 1]! - edge(points[i]!)));
      if (i + 3 < points.length - 4) {
        const x = (points[i]! + points[i + 2]!) / 2,
          y = (points[i + 1]! + points[i + 3]!) / 2;
        maxInterpolationError = Math.max(maxInterpolationError, Math.abs(y - edge(x)));
      }
    }
    let rejected = 0;
    for (const [width, height] of [
      [0, 96],
      [-1, 96],
      [Infinity, 96],
      [640, NaN],
    ]) {
      try {
        waveDividerPath(width!, height!);
      } catch {
        rejected++;
      }
    }
    for (const params of [
      { amplitude: NaN },
      { baseline: Infinity },
      { cycles: NaN },
      { phase: Infinity },
    ]) {
      try {
        waveDividerPath(640, 96, params);
      } catch {
        rejected++;
      }
    }
    const oversized = values(
      waveDividerPath(320, 32, { amplitude: 64, baseline: 0.25, cycles: 4 }),
    );
    const heights = oversized.filter((_, i) => i % 2 === 1).slice(0, -2);
    return {
      maxVertexError,
      maxInterpolationError,
      rejected,
      corners: points.slice(-4),
      first: points.slice(0, 2),
      closed: waveDividerPath(640, 96).endsWith('Z'),
      shallowMin: Math.min(...heights),
      shallowMax: Math.max(...heights),
      zero: waveDividerPath(640, 96, { amplitude: 0, baseline: 0.25 }),
      clamped:
        waveDividerPath(640, 96, { amplitude: 100, baseline: 1, cycles: 10, phase: 10 }) ===
        waveDividerPath(640, 96, { amplitude: 64, baseline: 0.75, cycles: 4, phase: Math.PI }),
      defaults: waveDividerDefaults,
      tier: effect.tier,
      features: effect.features,
      fallback: effect.fallback,
      css: Object.values(effect.params).every((spec) => spec.css),
      hasIntensity: 'intensity' in effect.params,
    };
  }, effectPath);
  expect(result.maxVertexError).toBeLessThan(0.000001);
  expect(result.maxInterpolationError).toBeLessThanOrEqual(0.010001);
  expect(result.first[0]).toBe(0);
  expect(result.first[1]).toBeCloseTo(48 + 18 * 0.35 * Math.sin(1.3), 6);
  expect(result.corners).toEqual([640, 96, 0, 96]);
  expect(result.closed).toBe(true);
  expect(result.zero).toMatch(/^M0 24L/);
  expect(result.shallowMin).toBeGreaterThanOrEqual(2);
  expect(result.shallowMax).toBeLessThanOrEqual(30);
  expect(result.rejected).toBe(8);
  expect(result.clamped).toBe(true);
  expect(result.tier).toBe('T1');
  expect(result.features).toEqual([]);
  expect(result.fallback).toBe('transparent');
  expect(result.css).toBe(true);
  expect(result.hasIntensity).toBe(false);
});

test('wave geometry stays in CSS pixels across backing scales and joins the adjacent opaque fill without a seam', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(
    async ({ core, effectPath }) => {
      const api = (await import(core)) as typeof import('../../packages/core/src/index.ts');
      const { default: effect } = (await import(effectPath)) as { default: EffectDefinition };
      const canvas = document.querySelector('canvas')!;
      const reports = [];
      for (const [width, height, amplitude, baseline] of [
        [640, 96, 18, 0.5],
        [320, 32, 64, 0.25],
      ]) {
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        const field = await api.createEffect(canvas, effect, {
          playing: false,
          reducedMotion: false,
          adaptiveQuality: false,
          params: { fill: '#234567', amplitude: amplitude!, baseline: baseline! },
        });
        for (const scale of [1, 0.5]) {
          field.setResolutionScale(scale);
          field.drawAt(0);
          const read = await api.readTextureTap(field.session.device, field.output!);
          const dpr = field.surface!.dpr;
          const effectiveAmplitude = Math.min(
            amplitude!,
            Math.max(
              0,
              Math.min(height! * baseline!, height! * (1 - baseline!)) -
                Math.min(2, height! * 0.25),
            ) / 1.35,
          );
          let edgeError = 0;
          for (const fraction of [0.05, 0.173, 0.314, 0.58, 0.942]) {
            const column = Math.min(read.width - 1, Math.floor(read.width * fraction));
            const x = (column + 0.5) / dpr;
            const angle = (x / width!) * Math.PI * 2 * 1.15;
            const expected =
              height! * baseline! +
              effectiveAmplitude * (Math.sin(angle) + 0.35 * Math.sin(angle * 2 + 1.3));
            let measured = NaN;
            for (let row = 1; row < read.height; row++) {
              const before = read.values[((row - 1) * read.width + column) * 4 + 3]!,
                after = read.values[(row * read.width + column) * 4 + 3]!;
              if (before <= 0.5 && after >= 0.5 && after > before) {
                measured = (row - 0.5 + (0.5 - before) / (after - before)) / dpr;
                break;
              }
            }
            if (!Number.isFinite(measured)) throw new Error('Wave edge was clipped or absent');
            edgeError = Math.max(edgeError, Math.abs(measured - expected));
          }
          let bottomOpaque = true,
            topTransparent = true,
            premultiplied = true;
          for (let x = 0; x < read.width; x++) {
            bottomOpaque &&= read.values[((read.height - 1) * read.width + x) * 4 + 3] === 1;
            topTransparent &&= read.values[x * 4 + 3] === 0;
          }
          for (let i = 0; i < read.values.length; i++)
            if (i % 4 !== 3)
              premultiplied &&= read.values[i]! <= read.values[i - (i % 4) + 3]! + 0.00001;
          const encoded = await field.readPixels();
          let seamColourError = 0;
          for (let x = 0; x < encoded.width; x++)
            for (let ch = 0; ch < 4; ch++)
              seamColourError = Math.max(
                seamColourError,
                Math.abs(
                  encoded.pixels[((encoded.height - 1) * encoded.width + x) * 4 + ch]! -
                    [35, 69, 103, 255][ch]!,
                ),
              );
          reports.push({
            width,
            height,
            scale,
            dpr,
            edgeError,
            bottomOpaque,
            topTransparent,
            premultiplied,
            seamColourError,
            errors: [...field.session.errors],
          });
        }
        field.destroy();
      }
      return reports;
    },
    { core, effectPath },
  );
  expect(result).toHaveLength(4);
  for (const report of result) {
    expect(report.edgeError).toBeLessThan(0.4 / report.dpr);
    expect(report.bottomOpaque).toBe(true);
    expect(report.topTransparent).toBe(true);
    expect(report.premultiplied).toBe(true);
    expect(report.seamColourError).toBeLessThanOrEqual(1);
    expect(report.errors).toEqual([]);
  }
  await test.info().attach('wave-css-geometry', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
});

test('reduced wave stays at the time-zero SVG pose during explicit draws while normal motion advances', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(
    async ({ core, effectPath }) => {
      const api = (await import(core)) as typeof import('../../packages/core/src/index.ts');
      const { default: effect } = (await import(effectPath)) as { default: EffectDefinition };
      const field = await api.createEffect(document.querySelector('canvas')!, effect, {
        playing: false,
        reducedMotion: false,
        adaptiveQuality: false,
      });
      const pose = async (time: number) => {
        field.drawAt(time);
        return (await api.readTextureTap(field.session.device, field.output!)).values;
      };
      const first = await pose(0),
        normal = await pose(10);
      field.setReducedMotion(true);
      const reduced = await pose(10),
        later = await pose(120);
      const errors = [...field.session.errors],
        memory = field.memory(),
        expectedTextureBytes = field.surface!.bytes,
        expectedBufferBytes = 64 + field.store.layout.byteLength;
      field.destroy();
      return {
        normalChanged: first.some((value, i) => value !== normal[i]),
        matchesSVG: first.every((value, i) => value === reduced[i]),
        holds: reduced.every((value, i) => value === later[i]),
        errors,
        memory,
        expectedTextureBytes,
        expectedBufferBytes,
        disposed: field.memory(),
      };
    },
    { core, effectPath },
  );
  expect(result.normalChanged).toBe(true);
  expect(result.matchesSVG).toBe(true);
  expect(result.holds).toBe(true);
  expect(result.memory.textureBytes).toBe(result.expectedTextureBytes);
  expect(result.memory.bufferBytes).toBe(result.expectedBufferBytes);
  expect(result.disposed).toEqual({
    textureBytes: 0,
    bufferBytes: 0,
    profilingBytes: 0,
    shared: { entries: 0, references: 0, bytes: 0 },
  });
  expect(result.errors).toEqual([]);
});

test('DOM fill and geometry CSS bridge preserves a matching author SVG fallback on resize', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(
    async ({ core, dom, effectPath }) => {
      const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
      const { default: effect, waveDividerPath } = (await import(effectPath)) as WaveModule;
      const host = document.querySelector<HTMLElement>('#divider')!,
        svg = host.querySelector('svg')!,
        path = svg.querySelector('path')!;
      const sync = () => {
        const b = host.getBoundingClientRect();
        svg.setAttribute('viewBox', `0 0 ${b.width} ${b.height}`);
        path.setAttribute(
          'd',
          waveDividerPath(b.width, b.height, {
            amplitude: Number(getComputedStyle(host).getPropertyValue('--hgpu-amplitude')),
          }),
        );
      };
      sync();
      const attachment = await attach(host, effect, {
        playing: false,
        reducedMotion: true,
        adaptiveQuality: false,
        layer: 'front',
        poster: '',
      });
      const field = attachment.field!;
      const waitFor = async (predicate: () => boolean) => {
        const end = performance.now() + 10000;
        while (!predicate()) {
          if (performance.now() > end) throw new Error('CSS wave bridge did not refresh');
          await new Promise<void>((resolve) => setTimeout(resolve, 20));
        }
      };
      host.style.setProperty('--hgpu-amplitude', '10');
      await waitFor(() => Number(field.params.amplitude) === 10);
      host.style.setProperty('--section-fill', '#ae693c');
      // The bridge is automatic: the next completed rendered pose must use CSS fill.
      let colour: number[] = [];
      const { parseColor } = (await import(
        core
      )) as typeof import('../../packages/core/src/index.ts');
      const expectedFill = parseColor('#ae693c');
      await waitFor(() =>
        parseColor(String(field.params.fill)).every(
          (value, i) => Math.abs(value - expectedFill[i]!) < 1e-8,
        ),
      );
      await waitFor(() => !field.dirty);
      await field.session.device.queue.onSubmittedWorkDone();
      const read = await field.readPixels();
      colour = Array.from(read.pixels.slice(-4));
      attachment.destroy();
      host.style.width = '320px';
      sync();
      const fallback = await attach(host, effect, {
        forceFallback: true,
        layer: 'front',
        poster: '',
      });
      const box = path.getBBox(),
        fallbackState = fallback.field === null;
      const poster = fallback.host.shadowRoot?.querySelector<HTMLImageElement>('.hgpu-poster');
      const appearance = {
        viewBox: svg.getAttribute('viewBox'),
        svgFill: getComputedStyle(path).fill,
        pathEnds: path.getAttribute('d')!.endsWith('L320 96L0 96Z'),
        box: [box.x, box.width, box.y + box.height],
        posterSource: poster?.getAttribute('src') ?? '',
        svgVisible: getComputedStyle(svg).display !== 'none',
      };
      fallback.destroy();
      return { colour, amplitude: 10, fallbackState, appearance };
    },
    { core, dom, effectPath },
  );
  expect(result.colour).toEqual([174, 105, 60, 255]);
  expect(result.fallbackState).toBe(true);
  expect(result.appearance.viewBox).toBe('0 0 320 96');
  expect(result.appearance.svgFill).toBe('rgb(174, 105, 60)');
  expect(result.appearance.pathEnds).toBe(true);
  expect(result.appearance.box[0]).toBe(0);
  expect(result.appearance.box[1]).toBe(320);
  expect(result.appearance.box[2]).toBeCloseTo(96, 5);
  expect(result.appearance.posterSource).toBe('');
  expect(result.appearance.svgVisible).toBe(true);
  await expect(page.getByText('Readable next section')).toBeVisible();
});
