import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { ParamValues } from '../../packages/core/src/params.ts';
const corePath =
  '/@fs' + fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url));
const effectRoot = '/@fs' + fileURLToPath(new URL('../../packages/effects/src/', import.meta.url));
const ids = [
  'border-energy',
  'spotlight',
  'image-hover',
  'text-dissolve',
  'audio-spectrum',
  'scroll-scene',
];
async function boot(page: Page) {
  await page.route('**/__dom_effects', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>DOM effect GPU references</title><style>body{margin:0;background:#152131}canvas{display:block;width:160px;height:160px}</style><canvas id="reference"></canvas>',
    }),
  );
  await page.goto('/__dom_effects');
}
async function render(
  page: Page,
  id: string,
  params: ParamValues = {},
  inputs: Record<string, { width: number; height: number; data: number[] }> = {},
  width = 32,
  height = 32,
) {
  return page.evaluate(
    async ({ corePath, effectRoot, id, params, inputs, width, height }) => {
      const core = (await import(corePath)) as typeof import('../../packages/core/src/index.ts');
      const definition = (await import(`${effectRoot}${id}/index.ts`))
        .default as import('../../packages/core/src/effect.ts').EffectDefinition;
      const { session, release } = await core.acquireDevice();
      const device = session.device;
      const textures: GPUTexture[] = [];
      const buffers: GPUBuffer[] = [];
      let instance: import('../../packages/core/src/effect.ts').EffectInstance | undefined;
      try {
        const taps: Record<string, import('../../packages/core/src/effect.ts').TextureTap> = {};
        for (const [name, input] of Object.entries(inputs)) {
          const texture = device.createTexture({
            label: `borrowed-${name}`,
            size: [input.width, input.height],
            format: 'rgba32float',
            usage:
              GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
          });
          textures.push(texture);
          device.queue.writeTexture(
            { texture },
            new Float32Array(input.data),
            { bytesPerRow: input.width * 16 },
            [input.width, input.height],
          );
          taps[name] = {
            texture,
            width: input.width,
            height: input.height,
            format: 'rgba32float',
            kind: 'float',
          };
        }
        const store = new core.ParamStore(definition.params, params);
        const uniform = (size: number) => {
          const b = device.createBuffer({
            size,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          });
          buffers.push(b);
          return b;
        };
        const frameBuffer = uniform(64),
          paramsBuffer = uniform(store.layout.byteLength);
        const bytes = new ArrayBuffer(64),
          view = new DataView(bytes);
        view.setFloat32(0, width, true);
        view.setFloat32(4, height, true);
        view.setFloat32(8, 1, true);
        view.setFloat32(16, 0.5, true);
        view.setFloat32(20, 0.5, true);
        view.setUint32(44, 7, true);
        device.queue.writeBuffer(frameBuffer, 0, bytes);
        store.flush(device, paramsBuffer);
        instance = await definition.create({
          session,
          device,
          params: store,
          paramsBuffer,
          frameBuffer,
          format: 'rgba16float',
          qualitySteps: () => 1,
          inputs: { get: (name) => taps[name] },
        });
        const output = core.filterTarget(device, [width, height], 'dom-reference-output');
        textures.push(output.texture);
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
        instance.resize([width, height]);
        instance.reset(7);
        instance.update(frame);
        const encoder = device.createCommandEncoder();
        instance.render(frame, encoder, output.texture.createView());
        session.submitEncoder(encoder);
        const pixels = Array.from((await core.readTextureTap(device, output)).values);
        const diagnostics = instance.diagnostics ?? [];
        instance.dispose();
        instance = undefined;
        // Read borrowed resources AFTER disposal: the effect must never destroy caller-owned inputs.
        const borrowed: Record<string, number[]> = {};
        for (const [name, tap] of Object.entries(taps))
          borrowed[name] = Array.from((await core.readTextureTap(device, tap)).values);
        return {
          pixels,
          borrowed,
          diagnostics,
          errors: [...session.errors],
          references: session.resources.stats().references,
        };
      } finally {
        instance?.dispose();
        textures.forEach((t) => t.destroy());
        buffers.forEach((b) => b.destroy());
        release();
      }
    },
    { corePath, effectRoot, id, params, inputs, width, height },
  );
}
function good(result: Awaited<ReturnType<typeof render>>) {
  expect(result.pixels.every(Number.isFinite)).toBe(true);
  expect(result.errors).toEqual([]);
  expect(result.diagnostics.filter((d) => d.type !== 'info')).toEqual([]);
  expect(result.references).toBe(0);
}
const solid = (rgba: number[], width = 1, height = 1) => ({
  width,
  height,
  data: Array.from({ length: width * height }, () => rgba).flat(),
});
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

test('image-hover samples two actual images: endpoints, linear blend, wipe and borrowed ownership', async ({
  page,
}) => {
  await boot(page);
  const a = solid([0.4, 0.1, 0.05, 0.5]),
    b = solid([0.1, 0.2, 0.3, 0.75]);
  for (const mode of ['wave', 'ripple', 'wipe'])
    for (const progress of [0, 0.5, 1]) {
      const result = await render(
        page,
        'image-hover',
        { mode, progress, amount: 0, feather: 0.12 },
        { image: a, imageB: b },
      );
      good(result);
      expect(result.borrowed.image).toEqual(a.data.map(Math.fround));
      expect(result.borrowed.imageB).toEqual(b.data.map(Math.fround));
      let maximumError = 0;
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++) {
          const uv = (x + 0.5) / 32;
          const t =
            mode === 'wipe' ? 1 - smooth(progress * 1.12 - 0.12, progress * 1.12, uv) : progress;
          for (let c = 0; c < 4; c++)
            maximumError = Math.max(
              maximumError,
              Math.abs(
                result.pixels[(y * 32 + x) * 4 + c]! - (a.data[c]! * (1 - t) + b.data[c]! * t),
              ),
            );
        }
      expect(maximumError).toBeLessThan(0.0006);
    }
});
test('spotlight uses one shared viewport light across translated surfaces against CPU reference', async ({
  page,
}) => {
  await boot(page);
  const pointer = [32, 16];
  for (const left of [0, 32]) {
    const result = await render(page, 'spotlight', {
      pageRect: [left, 0, 32, 32],
      pagePointer: pointer,
      radius: 30,
      softness: 0.5,
      intensity: 1,
      ambient: 0.03,
      tint: '#ffffff',
      background: '#000000',
    });
    good(result);
    let maximumError = 0;
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const px = left + x + 0.5,
          py = y + 0.5;
        const light = 1 - smooth(15, 30, Math.hypot(px - pointer[0]!, py - pointer[1]!));
        const expected = (0.03 + light) * (0.7 + 0.3 * Math.cos(px * 0.065) * Math.cos(py * 0.065));
        for (let c = 0; c < 3; c++)
          maximumError = Math.max(
            maximumError,
            Math.abs(result.pixels[(y * 32 + x) * 4 + c]! - expected),
          );
      }
    expect(maximumError).toBeLessThan(0.001);
  }
});
test('rounded border distance and glow agree with rounded-rectangle CPU geometry', async ({
  page,
}) => {
  await boot(page);
  const result = await render(page, 'border-energy', {
    rect: [0.125, 0.125, 0.75, 0.75],
    radius: 8,
    width: 0.5,
    glow: 5,
    tint: '#ffffff',
    intensity: 0,
  });
  good(result);
  for (const [x, y] of [
    [0, 0],
    [31, 0],
    [0, 31],
    [31, 31],
    [15, 15],
    [16, 16],
  ] as const) {
    const qx = Math.abs(x + 0.5 - 16) - 12 + 8,
      qy = Math.abs(y + 0.5 - 16) - 12 + 8;
    const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 8;
    const alpha = 0.3 * Math.exp(-Math.abs(d) / 5);
    expect(Math.abs(result.pixels[(y! * 32 + x!) * 4 + 3]! - alpha)).toBeLessThan(0.0003);
  }
  // Large corner radii clamp to the legal half-size rather than producing an inverted SDF.
  good(await render(page, 'border-energy', { radius: 200, rect: [0.4, 0.4, 0.1, 0.1] }));
});
test('actual FFT and signed waveform rows drive bars, oscilloscope and a sampled-height terrain', async ({
  page,
}) => {
  await boot(page);
  const audio = {
    width: 32,
    height: 2,
    data: [...solid([0.5, 0, 0, 1], 32).data, ...solid([0.5, 0, 0, 1], 32).data],
  };
  for (const mode of ['spectrum', 'oscilloscope']) {
    const result = await render(
      page,
      'audio-spectrum',
      {
        mode,
        gain: 1,
        gap: 0,
        bars: 32,
        range: 1,
        lineWidth: 1,
        tint: '#ffffff',
        background: '#000000',
      },
      { audio },
    );
    good(result);
    expect(result.borrowed.audio).toEqual(audio.data);
    let maximumError = 0;
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const uv = (y + 0.5) / 32;
        const expected =
          mode === 'spectrum'
            ? Number(uv >= 0.5)
            : 1 - smooth(1, 2, Math.abs(uv - (0.5 - 0.5 * 0.38)) * 32);
        maximumError = Math.max(
          maximumError,
          Math.abs(result.pixels[(y * 32 + x) * 4]! - expected),
        );
      }
    expect(maximumError).toBeLessThan(0.0006);
  }
  const low = await render(
      page,
      'audio-spectrum',
      { mode: 'terrain', gain: 1 },
      { audio: solid([0, 0, 0, 1], 32, 2) },
    ),
    high = await render(page, 'audio-spectrum', { mode: 'terrain', gain: 1 }, { audio });
  good(low);
  good(high);
  expect(high.pixels).not.toEqual(low.pixels);
});
test('text mask gates actual particles, dissolves and exactly reforms without owning the mask', async ({
  page,
}) => {
  await boot(page);
  const text = {
    width: 32,
    height: 16,
    data: Array.from({ length: 512 }, (_, i) => (i % 32 < 16 ? [1, 1, 1, 1] : [0, 0, 0, 0])).flat(),
  };
  const params = { grid: 32, size: 1, progress: 0, opacity: 1 };
  const pose = await render(page, 'text-dissolve', params, { text }),
    scattered = await render(page, 'text-dissolve', { ...params, progress: 0.8 }, { text }),
    reformed = await render(page, 'text-dissolve', params, { text }),
    blank = await render(page, 'text-dissolve', params, { text: solid([0, 0, 0, 0], 32, 16) });
  for (const result of [pose, scattered, reformed, blank]) good(result);
  expect(pose.borrowed.text).toEqual(text.data);
  expect(pose.pixels.some((p, i) => i % 4 === 3 && p > 0.1)).toBe(true);
  expect(scattered.pixels).not.toEqual(pose.pixels);
  expect(reformed.pixels).toEqual(pose.pixels);
  expect(blank.pixels.every((p) => p === 0)).toBe(true);
  for (let y = 0; y < 32; y++)
    for (let x = 17; x < 32; x++) expect(pose.pixels[(y * 32 + x) * 4 + 3]).toBe(0);
});
test('scroll scene is scrubbed by progress, independent of simulation history and reversible', async ({
  page,
}) => {
  await boot(page);
  const start = await render(page, 'scroll-scene', { progress: 0 }),
    middle = await render(page, 'scroll-scene', { progress: 0.5 }),
    end = await render(page, 'scroll-scene', { progress: 1 }),
    reformed = await render(page, 'scroll-scene', { progress: 0 });
  for (const r of [start, middle, end, reformed]) good(r);
  expect(middle.pixels).not.toEqual(start.pixels);
  expect(end.pixels).not.toEqual(start.pixels);
  expect(reformed.pixels).toEqual(start.pixels);
});
for (const id of ids)
  test(`${id}: catalogue defaults, presets, enums, deterministic DPR replay and disposal`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    await boot(page);
    const metadata = await page.evaluate(
      async ({ corePath, effectRoot, id }) => {
        const core = (await import(corePath)) as typeof import('../../packages/core/src/index.ts');
        const definition = (await import(`${effectRoot}${id}/index.ts`))
          .default as import('../../packages/core/src/effect.ts').EffectDefinition;
        const field = await core.createEffect(document.querySelector('canvas')!, definition, {
          playing: false,
          seed: 7,
          reducedMotion: false,
          adaptiveQuality: false,
        });
        Reflect.set(window, '__domField', field);
        field.advance(0);
        return {
          presets: Object.keys(definition.presets),
          params: Object.values(definition.params),
          quality: definition.quality,
          reducedMotion: definition.reducedMotion,
          fallback: definition.fallback,
        };
      },
      { corePath, effectRoot, id },
    );
    expect(metadata.presets).toHaveLength(
      ['text-dissolve', 'spotlight', 'border-energy'].includes(id) ? 3 : 2,
    );
    expect(metadata.quality.resolutionScale).toEqual([0.25, 1]);
    expect(metadata.reducedMotion).toEqual({ time: 0 });
    expect(metadata.fallback).toBeTruthy();
    for (const p of metadata.params) {
      expect(p.group).toBeTruthy();
      expect(p.description).toBeTruthy();
    }
    const pose = async (preset?: string) =>
      page.evaluate(async (preset) => {
        const f = Reflect.get(
          window,
          '__domField',
        ) as import('../../packages/core/src/runtime.ts').EffectField;
        f.store.reset();
        if (preset) f.store.patch(f.effect.presets[preset]!);
        f.reset(7);
        f.advance(8);
        return Array.from((await f.readPixels()).pixels);
      }, preset);
    // Assembly poses have dedicated progress/reduced-motion snapshots in v2-text-assembly.
    for (const preset of [
      undefined,
      ...metadata.presets.filter(
        (name) => !['assemble-and-hold', 'card-spotlight', 'border-trace'].includes(name),
      ),
    ]) {
      const first = await pose(preset);
      expect(first.every(Number.isFinite)).toBe(true);
      expect(new Set(first).size).toBeGreaterThan(2);
      expect(await pose(preset)).toEqual(first);
      if (info.project.name.startsWith('swiftshader'))
        await expect(page.locator('canvas')).toHaveScreenshot(
          `${id}${preset ? '-' + preset : ''}.png`,
          { scale: 'css', maxDiffPixelRatio: 0.001 },
        );
    }
    const result = await page.evaluate(async () => {
      const f = Reflect.get(
        window,
        '__domField',
      ) as import('../../packages/core/src/runtime.ts').EffectField;
      for (const [name, spec] of Object.entries(f.effect.params))
        if (spec.type === 'enum')
          for (const value of spec.options) {
            f.store.set(name, value);
            f.advance(0);
            const p = (await f.readPixels()).pixels;
            if (!p.every(Number.isFinite) || !p.some((v, i) => i % 4 !== 3 && v > 0))
              throw new Error(`Invalid ${name}=${value}`);
          }
      for (const name of Object.keys(f.textureTaps)) {
        const tap = await f.readTap(name);
        if (!tap.values.every(Number.isFinite)) throw new Error(`Invalid tap ${name}`);
        if (name === 'referenceAudio') {
          if (
            Math.abs(tap.values[8 * 4]! - 0.6) > 1e-6 ||
            Math.abs(tap.values[23 * 4]! - 0.25) > 1e-6
          )
            throw new Error('Known DFT peak amplitudes differ');
          for (let i = 0; i < 256; i++) {
            const expected =
              0.6 * Math.sin((2 * Math.PI * 8 * i) / 256) +
              0.25 * Math.sin((2 * Math.PI * 23 * i) / 256);
            if (Math.abs(tap.values[(256 + i) * 4]! - expected) > 1e-6)
              throw new Error('Reference waveform differs');
          }
        }
      }
      f.setReducedMotion(true);
      f.reset(7);
      f.advance(0);
      const pose = Array.from((await f.readPixels()).pixels),
        index = f.frame.index;
      f.advance(10);
      const frozen = Array.from((await f.readPixels()).pixels);
      const errors = [...f.session.errors],
        diagnostics = f.instance?.diagnostics ?? [],
        before = f.memory();
      f.destroy();
      return {
        pose,
        frozen,
        index,
        finalIndex: f.frame.index,
        errors,
        diagnostics,
        before,
        after: f.memory(),
        references: f.session.resources.stats().references,
      };
    });
    expect(result.frozen).toEqual(result.pose);
    expect(result.finalIndex).toBe(result.index);
    expect(result.errors).toEqual([]);
    expect(result.diagnostics.filter((d) => d.type !== 'info')).toEqual([]);
    expect(result.before.textureBytes).toBeGreaterThan(0);
    expect(result.after).toMatchObject({
      textureBytes: 0,
      bufferBytes: 0,
      profilingBytes: 0,
      shared: { references: 0 },
    });
    expect(result.references).toBe(0);
  });
