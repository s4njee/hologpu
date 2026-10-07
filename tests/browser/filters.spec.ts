import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { ParamValues } from '../../packages/core/src/params.ts';
const corePath =
  '/@fs' + fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url));
const effectRoot = '/@fs' + fileURLToPath(new URL('../../packages/effects/src/', import.meta.url));
async function initialize(page: Page) {
  await page.route('**/__filter_harness', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>GPU filter correctness</title>',
    }),
  );
  await page.goto('/__filter_harness');
}
async function render(
  page: Page,
  id: string,
  params: ParamValues,
  pixels: number[],
  width: number,
  height: number,
  map?: number[],
  chain?: string[],
  inputSize?: readonly [number, number],
) {
  return page.evaluate(
    async ({ corePath, effectRoot, id, params, pixels, width, height, map, chain, inputSize }) => {
      const core = (await import(corePath)) as typeof import('../../packages/core/src/index.ts');
      const { session, release } = await core.acquireDevice();
      const device = session.device,
        owned: GPUTexture[] = [],
        buffers: GPUBuffer[] = [];
      let instance: import('../../packages/core/src/effect.ts').EffectInstance | undefined;
      const tex = (data: number[], w: number, h: number) => {
        const texture = device.createTexture({
          size: [w, h],
          format: 'rgba32float',
          usage:
            GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
        });
        device.queue.writeTexture(
          { texture },
          new Float32Array(data),
          { bytesPerRow: w * 16 },
          { width: w, height: h },
        );
        owned.push(texture);
        return {
          texture,
          width: w,
          height: h,
          format: 'rgba32float' as const,
          kind: 'float' as const,
        };
      };
      try {
        let definition: import('../../packages/core/src/effect.ts').EffectDefinition =
          id === 'schema-luts'
            ? core.filterEffect({
                id: 'schema-luts',
                title: 'LUT endpoint test',
                params: {
                  line: { type: 'curve', default: [0, 0.25, 0.5, 0.75, 1] },
                  ramp: {
                    type: 'gradient',
                    default: [
                      { offset: 0, color: '#00000080' },
                      { offset: 1, color: '#ffffff80' },
                    ],
                  },
                },
                wgsl: `fn effect(uv:vec2f)->vec4f {let x=(uv.x*frame.resolution.x-.5)/(frame.resolution.x-1.0);let c=sample_line(vec2f(x,.5));let g=sample_ramp(vec2f(x,.5));return vec4f(c.r,g.r,g.a,1);}`,
              })
            : (await import(`${effectRoot}${id}/index.ts`)).default;
        if (chain) {
          const stages = await Promise.all(
            chain.map(
              async (id) =>
                (await import(`${effectRoot}${id}/index.ts`))
                  .default as import('../../packages/core/src/effect.ts').EffectDefinition,
            ),
          );
          definition = core.chain(...stages);
        }
        const store = new core.ParamStore(definition.params, params),
          input = tex(pixels, inputSize?.[0] ?? width, inputSize?.[1] ?? height),
          mapInput = map ? tex(map, width, height) : input;
        const schemaTaps: Record<string, import('../../packages/core/src/effect.ts').TextureTap> =
          {};
        for (const [name, spec] of Object.entries(definition.params)) {
          if (spec.type === 'curve') {
            const values = store.values[name] as readonly number[];
            const data: number[] = [];
            for (let i = 0; i < 256; i++) {
              const q = (i / 255) * (values.length - 1),
                b = Math.floor(q),
                t = q - b;
              const value = values[b]! * (1 - t) + values[Math.min(b + 1, values.length - 1)]! * t;
              data.push(value, 0, 0, 1);
            }
            schemaTaps[name] = tex(data, 256, 1);
          } else if (spec.type === 'gradient') {
            const stops = store.values[name] as readonly { offset: number; color: string }[];
            const data: number[] = [];
            for (let i = 0; i < 256; i++) {
              const q = i / 255;
              let a = stops[0]!,
                b = stops.at(-1)!;
              for (let j = 1; j < stops.length; j++)
                if (q <= stops[j]!.offset) {
                  a = stops[j - 1]!;
                  b = stops[j]!;
                  break;
                }
              const t = Math.max(
                  0,
                  Math.min(1, (q - a.offset) / Math.max(b.offset - a.offset, 0.00001)),
                ),
                ca = core.parseColor(a.color),
                cb = core.parseColor(b.color);
              const alpha = ca[3]! * (1 - t) + cb[3]! * t;
              data.push(
                ...ca.slice(0, 3).map((c, k) => c * ca[3]! * (1 - t) + cb[k]! * cb[3]! * t),
                alpha,
              );
            }
            schemaTaps[name] = tex(data, 256, 1);
          }
        }
        const uniform = (size: number) => {
          const buffer = device.createBuffer({
            size,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          });
          buffers.push(buffer);
          return buffer;
        };
        const frameBuffer = uniform(64),
          paramsBuffer = uniform(store.layout.byteLength);
        const bytes = new ArrayBuffer(64),
          frameData = new DataView(bytes);
        frameData.setFloat32(0, width, true);
        frameData.setFloat32(4, height, true);
        frameData.setFloat32(8, 1, true);
        frameData.setFloat32(16, 0.5, true);
        frameData.setFloat32(20, 0.5, true);
        frameData.setUint32(44, 7, true);
        device.queue.writeBuffer(frameBuffer, 0, bytes);
        store.flush(device, paramsBuffer);
        const context = {
          session,
          device,
          params: store,
          paramsBuffer,
          frameBuffer,
          format: 'rgba16float' as const,
          qualitySteps: () => 1,
          inputs: {
            get(name: string) {
              const spec = definition.params[name];
              if (spec?.type === 'texture')
                return String(store.values[name]) === 'map' ? mapInput : input;
              return schemaTaps[name] ?? (name === 'map' ? mapInput : input);
            },
          },
        };
        instance = await definition.create(context);
        instance.resize([width, height]);
        instance.reset(7);
        const frame: import('../../packages/core/src/effect.ts').FrameInfo = {
          resolution: [width, height],
          dpr: 1,
          time: 0,
          delta: 0,
          index: 0,
          pointer: [0.5, 0.5],
          velocity: [0, 0],
          buttons: 0,
          pressure: 0,
          scroll: 0,
          visibility: 1,
          seed: 7,
        };
        instance.update(frame);
        const output = core.filterTarget(device, [width, height], 'filter-numerical-output');
        owned.push(output.texture);
        const encoder = device.createCommandEncoder();
        instance.render(frame, encoder, output.texture.createView());
        session.submitEncoder(encoder);
        const result = Array.from((await core.readTextureTap(device, output)).values);
        const diagnostics = instance.diagnostics ?? [];
        const sourceKeys = Object.keys(instance.sources ?? {}),
          tapKeys = Object.keys(instance.textureTaps?.() ?? {});
        const planeTap = instance.textureTaps?.().lutSlice8;
        const lutPlane =
          id === 'color-grade' &&
          params.look === 'identity' &&
          params.toneMap === 'linear' &&
          planeTap
            ? Array.from((await core.readTextureTap(device, planeTap)).values)
            : [];
        instance.dispose();
        instance = undefined;
        const refs = session.resources.stats().references;
        await device.queue.onSubmittedWorkDone();
        return {
          pixels: result,
          lutPlane,
          diagnostics,
          errors: [...session.errors],
          refs,
          sourceKeys,
          tapKeys,
        };
      } finally {
        instance?.dispose();
        owned.forEach((t) => t.destroy());
        buffers.forEach((b) => b.destroy());
        release();
      }
    },
    { corePath, effectRoot, id, params, pixels, width, height, map, chain, inputSize },
  );
}
const constant = (w: number, h: number, value: readonly number[]) =>
  Array.from({ length: w * h }, () => value).flat();
const close = (a: number[], b: number[], tolerance = 0.002) => {
  expect(a).toHaveLength(b.length);
  expect(Math.max(...a.map((x, i) => Math.abs(x - b[i]!)))).toBeLessThan(tolerance);
};
const clean = (r: Awaited<ReturnType<typeof render>>) => {
  expect(r.errors).toEqual([]);
  expect(r.diagnostics.filter((d) => d.type !== 'info')).toEqual([]);
  expect(r.refs).toBe(0);
  expect(r.pixels.every(Number.isFinite)).toBe(true);
};
test.beforeEach(async ({ page }) => initialize(page));
for (const algorithm of ['gaussian', 'box', 'dual-kawase'])
  test(`Blur ${algorithm} preserves constant HDR premultiplied RGBA across odd sizes`, async ({
    page,
  }) => {
    const input = constant(19, 13, [0.2, 0.4, 0.8, 0.5]);
    const r = await render(page, 'blur', { algorithm, radius: 4, passes: 3 }, input, 19, 13);
    close(r.pixels, input);
    clean(r);
  });
for (const algorithm of ['gaussian', 'box'])
  test(`Blur ${algorithm} impulse kernel agrees with normalized separable CPU and conserves energy`, async ({
    page,
  }) => {
    const size = 17,
      radius = 3,
      pixels = constant(size, size, [0, 0, 0, 1]);
    pixels[(8 * size + 8) * 4] = 1;
    const r = await render(page, 'blur', { algorithm, radius }, pixels, size, size);
    const kernel = Array.from({ length: 2 * radius + 1 }, (_, i) =>
        algorithm === 'box' ? 1 : Math.exp(-((i - radius) ** 2) / 2),
      ),
      sum = kernel.reduce((a, b) => a + b, 0),
      expected = constant(size, size, [0, 0, 0, 1]);
    for (let y = -radius; y <= radius; y++)
      for (let x = -radius; x <= radius; x++)
        expected[((8 + y) * size + 8 + x) * 4] =
          (kernel[y + radius]! * kernel[x + radius]!) / (sum * sum);
    close(r.pixels, expected, 0.00015);
    // Two positive RGBA16 stores permit at most one half-precision relative ULP each.
    // Add a conservative minimum-half ULP for every potential subnormal kernel pixel.
    // Preserve the stricter per-pixel CPU agreement above, and bound summed quantization.
    const energy = r.pixels.filter((_, i) => i % 4 === 0).reduce((a, b) => a + b, 0);
    expect(Math.abs(energy - 1)).toBeLessThan(2 ** -9 + 2 ** -20 + kernel.length ** 2 * 2 ** -24);
    clean(r);
  });
test('Gaussian boundary clamp follows CPU convolution, without wrapping or dark borders', async ({
  page,
}) => {
  const w = 9,
    h = 5,
    pixels = constant(w, h, [0, 0, 0, 1]);
  for (let y = 0; y < h; y++) pixels[y * w * 4] = 1;
  const radius = 2,
    k = Array.from({ length: 5 }, (_, i) => Math.exp(-((i - 2) ** 2) / (2 * (2 / 3) ** 2))),
    sum = k.reduce((a, b) => a + b, 0),
    expected = constant(w, h, [0, 0, 0, 1]);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let dx = -2; dx <= 2; dx++)
        v += ((Math.max(0, Math.min(w - 1, x + dx)) === 0 ? 1 : 0) * k[dx + 2]!) / sum;
      expected[(y * w + x) * 4] = v;
    }
  const r = await render(page, 'blur', { algorithm: 'gaussian', radius }, pixels, w, h);
  close(r.pixels, expected, 0.0004);
  clean(r);
});
test('3D LUT identity, warm matrix and independent tone operators agree with CPU', async ({
  page,
}) => {
  const input = constant(7, 5, [0.15, 0.3, 0.4, 0.5]);
  for (const look of ['identity', 'warm'])
    for (const toneMap of ['linear', 'reinhard', 'aces', 'filmic']) {
      const r = await render(page, 'color-grade', { look, toneMap, curveAmount: 0 }, input, 7, 5);
      if (look === 'identity' && toneMap === 'linear') {
        expect(r.tapKeys.filter((name) => name.startsWith('lutSlice'))).toHaveLength(17);
        close(
          r.lutPlane,
          Array.from({ length: 17 * 17 }, (_, i) => [
            (i % 17) / 16,
            Math.floor(i / 17) / 16,
            0.5,
            1,
          ]).flat(),
          1e-7,
        );
      }
      let c = [0.3, 0.6, 0.8];
      c = c.map((x) =>
        toneMap === 'reinhard'
          ? x / (1 + x)
          : toneMap === 'aces'
            ? Math.min(1, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14))
            : toneMap === 'filmic'
              ? (Math.max(0, x - 0.004) * (6.2 * Math.max(0, x - 0.004) + 0.5)) /
                (Math.max(0, x - 0.004) * (6.2 * Math.max(0, x - 0.004) + 1.7) + 0.06)
              : x,
      );
      if (look === 'warm')
        c = [c[0]! * 1.04 + c[1]! * 0.04, c[1]! * 0.98, c[2]! * 0.88 + c[0]! * 0.025];
      close(r.pixels, constant(7, 5, [...c.map((x) => x * 0.5), 0.5]), 0.001);
      clean(r);
    }
});
test('Tone-curve LUT is actually sampled and lift gamma gain preserve source alpha', async ({
  page,
}) => {
  const input = constant(7, 5, [0.1, 0.2, 0.4, 0.5]);
  const r = await render(
    page,
    'color-grade',
    { toneMap: 'linear', lutAmount: 0, toneCurve: [0, 0, 1], curveAmount: 1 },
    input,
    7,
    5,
  );
  close(r.pixels, constant(7, 5, [0, 0, 0.3, 0.5]), 0.003);
  clean(r);
  const g = await render(
    page,
    'color-grade',
    {
      toneMap: 'linear',
      lutAmount: 0,
      lift: [0.1, 0.1, 0.1],
      gamma: [2, 2, 2],
      gain: [0.8, 0.8, 0.8],
    },
    input,
    7,
    5,
  );
  close(
    g.pixels,
    constant(7, 5, [Math.sqrt(0.3) * 0.4, Math.sqrt(0.5) * 0.4, Math.sqrt(0.9) * 0.4, 0.5]),
    0.001,
  );
  clean(g);
});
test('Bloom threshold suppresses dim fields, zero strength is identity and pyramid spreads isolated HDR energy', async ({
  page,
}) => {
  const dim = constant(33, 25, [0.15, 0.2, 0.1, 0.5]);
  const r = await render(
    page,
    'bloom',
    { threshold: 1, knee: 0, strength: 1, levels: 3 },
    dim,
    33,
    25,
  );
  close(r.pixels, dim);
  clean(r);
  const black = constant(33, 25, [0, 0, 0, 0.3]);
  const noCoverage = await render(
    page,
    'bloom',
    { threshold: 0, knee: 0.3, strength: 1, levels: 3 },
    black,
    33,
    25,
  );
  close(noCoverage.pixels, black);
  clean(noCoverage);
  const bright = constant(33, 25, [0, 0, 0, 1]);
  bright[(12 * 33 + 16) * 4] = 4;
  const zero = await render(page, 'bloom', { strength: 0 }, bright, 33, 25);
  close(zero.pixels, bright);
  clean(zero);
  const spread = await render(
    page,
    'bloom',
    { threshold: 1, knee: 0, strength: 0.4, levels: 3 },
    bright,
    33,
    25,
  );
  expect(spread.pixels[(12 * 33 + 17) * 4]).toBeGreaterThan(0.01);
  expect(spread.sourceKeys).toHaveLength(4);
  expect(spread.tapKeys.length).toBe(8);
  clean(spread);
});
test('Displacement normal and signed flow inputs select actual borrowed map coordinates; zero amplitude is identity', async ({
  page,
}) => {
  const w = 16,
    h = 8,
    pixels = Array.from({ length: w * h }, (_, i) => [
      (i % w) / (w - 1),
      Math.floor(i / w) / (h - 1),
      0.2,
      1,
    ]).flat(),
    map = constant(w, h, [1, 0.5, 0, 1]);
  const r = await render(
    page,
    'displace',
    { mode: 'refraction', encoding: 'normal', amount: 1 / w },
    pixels,
    w,
    h,
    map,
  );
  const expected = Array.from({ length: w * h }, (_, i) => [
    Math.min(w - 1, (i % w) + 1) / (w - 1),
    Math.floor(i / w) / (h - 1),
    0.2,
    1,
  ]).flat();
  close(r.pixels, expected, 0.001);
  clean(r);
  const signed = await render(
    page,
    'displace',
    { mode: 'refraction', encoding: 'flow', amount: 1 / w },
    pixels,
    w,
    h,
    constant(w, h, [1, 0, 0, 1]),
  );
  close(signed.pixels, expected, 0.001);
  clean(signed);
  const neutral = await render(page, 'displace', { amount: 0 }, pixels, w, h, map);
  close(neutral.pixels, pixels, 0.001);
  clean(neutral);
});
test('Sobel detects a step, toon quantizes flat fields and both Kuwahara modes preserve constant colour', async ({
  page,
}) => {
  const w = 9,
    h = 7,
    step = Array.from({ length: w * h }, (_, i) => [i % w >= 4 ? 1 : 0, 0, 0, 1]).flat();
  const r = await render(page, 'edges', { mode: 'sobel', strength: 1 }, step, w, h);
  expect(r.pixels[(3 * w + 3) * 4]).toBeCloseTo(0.8504, 2);
  expect(r.pixels[(3 * w + 1) * 4]).toBe(0);
  clean(r);
  for (const mode of ['toon', 'kuwahara', 'anisotropic-kuwahara']) {
    const input = constant(w, h, [0.13, 0.31, 0.43, 0.5]),
      out = await render(page, 'edges', { mode, levels: 5 }, input, w, h);
    close(out.pixels, mode === 'toon' ? constant(w, h, [0.125, 0.25, 0.375, 0.5]) : input, 0.001);
    clean(out);
  }
});
test('Generated Bayer and blue-noise thresholds conserve a binary gray mean; palette uses baked gradient', async ({
  page,
}) => {
  for (const mode of ['bayer', 'blue-noise']) {
    const r = await render(
      page,
      'dither',
      { mode, levels: 2, amount: 1 },
      constant(32, 32, [0.5, 0.5, 0.5, 1]),
      32,
      32,
    );
    const values = r.pixels.filter((_, i) => i % 4 === 0);
    expect(new Set(values)).toEqual(new Set([0, 1]));
    expect(values.reduce((a, b) => a + b, 0) / values.length).toBeCloseTo(0.5, 2);
    clean(r);
  }
  const palette = await render(
    page,
    'dither',
    {
      mode: 'palette',
      amount: 0,
      paletteGradient: [
        { offset: 0, color: '#000000' },
        { offset: 1, color: '#ffffff' },
      ],
    },
    constant(8, 8, [0.95, 0.95, 0.95, 0.5]),
    8,
    8,
  );
  close(palette.pixels, constant(8, 8, [0.5, 0.5, 0.5, 0.5]));
  clean(palette);
  const translucent = await render(
    page,
    'dither',
    {
      mode: 'palette',
      amount: 0,
      paletteGradient: [
        { offset: 0, color: '#00000080' },
        { offset: 1, color: '#ffffff80' },
      ],
    },
    constant(8, 8, [0.45, 0.45, 0.45, 0.5]),
    8,
    8,
  );
  close(translucent.pixels, constant(8, 8, [0.5, 0.5, 0.5, 0.5]));
  clean(translucent);
});
test('ASCII actually samples glyph coverage and halftone radius follows luminance', async ({
  page,
}) => {
  const r = await render(
    page,
    'halftone-ascii',
    { mode: 'ascii', cell: 16, coloured: false, ink: '#ffffff', paper: '#000000' },
    constant(32, 32, [0.4, 0.4, 0.4, 1]),
    32,
    32,
  );
  const values = r.pixels.filter((_, i) => i % 4 === 0);
  expect(new Set(values).size).toBeGreaterThan(4);
  expect(r.tapKeys).toContain('glyphAtlas');
  clean(r);
  const black = await render(
    page,
    'halftone-ascii',
    { mode: 'halftone', cell: 16, coloured: false, ink: '#ffffff', paper: '#000000' },
    constant(32, 32, [0, 0, 0, 1]),
    32,
    32,
  );
  expect(black.pixels.filter((_, i) => i % 4 !== 3).every((v) => v === 0)).toBe(true);
  clean(black);
  const dark = await render(
      page,
      'halftone-ascii',
      { mode: 'halftone', cell: 16, coloured: false, ink: '#ffffff', paper: '#000000' },
      constant(32, 32, [0.1, 0.1, 0.1, 1]),
      32,
      32,
    ),
    light = await render(
      page,
      'halftone-ascii',
      { mode: 'halftone', cell: 16, coloured: false, ink: '#ffffff', paper: '#000000' },
      constant(32, 32, [0.8, 0.8, 0.8, 1]),
      32,
      32,
    );
  expect(light.pixels.reduce((a, b) => a + b, 0)).toBeGreaterThan(
    dark.pixels.reduce((a, b) => a + b, 0),
  );
  clean(dark);
  clean(light);
});
test('Four-filter chain uses independent prefixed uniforms and premultiplied HDR intermediates', async ({
  page,
}) => {
  const input = constant(17, 13, [0.2, 0.3, 0.4, 0.5]);
  const r = await render(
    page,
    'lens',
    {
      s0_barrel: 0,
      s0_aberration: 0,
      s0_vignette: 0,
      s0_grain: 0,
      s1_algorithm: 'gaussian',
      s1_radius: 2,
      s2_toneMap: 'linear',
      s2_lutAmount: 0,
      s3_amount: 0,
    },
    input,
    17,
    13,
    undefined,
    ['lens', 'blur', 'color-grade', 'displace'],
  );
  close(r.pixels, input, 0.002);
  expect(r.sourceKeys.some((s) => s.startsWith('s0:'))).toBe(true);
  expect(r.sourceKeys.some((s) => s.startsWith('s3:'))).toBe(true);
  expect(r.tapKeys).toContain('s2:output');
  clean(r);
});

test('Generated curve and gradient samplers retain normalized endpoints and midpoint premultiplied values', async ({
  page,
}) => {
  const r = await render(page, 'schema-luts', {}, constant(5, 3, [0, 0, 0, 1]), 5, 3);
  const alpha = 128 / 255;
  const expected = Array.from({ length: 15 }, (_, i) => [
    (i % 5) / 4,
    ((i % 5) / 4) * alpha,
    alpha,
    1,
  ]).flat();
  close(r.pixels, expected, 0.0006);
  clean(r);
});

test('Gaussian and box stay isotropic when a smaller input is resized to a larger output', async ({
  page,
}) => {
  const input = constant(17, 17, [0, 0, 0, 1]);
  input[(8 * 17 + 8) * 4] = 1;
  for (const algorithm of ['gaussian', 'box']) {
    const r = await render(
      page,
      'blur',
      { algorithm, radius: 3 },
      input,
      33,
      33,
      undefined,
      undefined,
      [17, 17],
    );
    let energy = 0,
      momentX = 0,
      momentY = 0;
    for (let y = 0; y < 33; y++)
      for (let x = 0; x < 33; x++) {
        const value = r.pixels[(y * 33 + x) * 4]!;
        energy += value;
        momentX += value * (x - 16) ** 2;
        momentY += value * (y - 16) ** 2;
      }
    expect(momentX / energy).toBeGreaterThan(0.5);
    expect(Math.abs((momentX - momentY) / energy)).toBeLessThan(0.01);
    clean(r);
  }
});
