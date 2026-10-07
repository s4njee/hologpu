import { test, expect } from '@playwright/test';
import type { EffectDefinition, EffectField } from '../../packages/core/src/index.ts';
declare global {
  interface Window {
    hologpu: {
      createEffect: typeof import('../../packages/core/src/index.ts').createEffect;
      fragmentEffect: typeof import('../../packages/core/src/index.ts').fragmentEffect;
      catalogue: readonly EffectDefinition[];
      field: EffectField | null;
      mount(effect: EffectDefinition): Promise<void>;
    };
  }
}
const ids = ['gradient-oklch', 'noise-lab', 'voronoi', 'sdf-2d', 'raymarch', 'fractal'];
for (const id of ids)
  test(`${id}: deterministic pixels, two presets, all enum branches and disposal`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/?effect=${id}&playing=false&resolution=0.5`);
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
    await page.locator('#stage').evaluate((node: HTMLElement) => {
      node.style.width = '162px';
      node.style.height = '114px';
    });
    await expect
      .poll(() => page.evaluate(() => window.hologpu.field!.surface!.size[0]))
      .toBe(await page.evaluate(() => 80 * devicePixelRatio));
    const pixels = () =>
      page.evaluate(async () => {
        const field = window.hologpu.field!;
        field.drawAt(1.25, 7);
        const result = await field.readPixels();
        return Array.from(result.pixels);
      });
    const first = await pixels();
    expect(await pixels()).toEqual(first);
    expect(new Set(first.filter((_v, i) => i % 4 !== 3)).size).toBeGreaterThan(20);
    expect(first.filter((_v, i) => i % 4 === 3).every((v) => v === 255)).toBe(true);
    if (testInfo.project.name.startsWith('swiftshader'))
      await expect(page.locator('#canvas')).toHaveScreenshot(`${id}.png`, {
        scale: 'css',
        maxDiffPixelRatio: 0.001,
      });
    const results = await page.evaluate(async () => {
      const field = window.hologpu.field!;
      const summaries: number[] = [];
      for (const preset of Object.values(field.effect.presets)) {
        field.store.reset();
        field.store.patch(preset);
        field.drawAt(1.25, 7);
        const read = await field.readPixels();
        summaries.push(read.pixels.reduce((n, v) => n + v, 0));
      }
      for (const [name, spec] of Object.entries(field.effect.params))
        if (spec.type === 'enum')
          for (const option of spec.options) {
            field.store.set(name, option);
            field.drawAt(1.25, 7);
            await field.readPixels();
          }
      return { summaries, errors: field.session.errors, diagnostics: field.diagnostics };
    });
    expect(results.summaries).toHaveLength(2);
    expect(results.summaries[0]).not.toEqual(results.summaries[1]);
    expect(results.errors).toEqual([]);
    expect(results.diagnostics).toEqual([]);
    if (testInfo.project.name.startsWith('swiftshader'))
      for (const name of await page.evaluate(() =>
        Object.keys(window.hologpu.field!.effect.presets),
      )) {
        await page.evaluate(async (name) => {
          const field = window.hologpu.field!;
          field.store.reset();
          field.store.patch(field.effect.presets[name]!);
          field.drawAt(1.25, 7);
          await field.readPixels();
        }, name);
        await expect(page.locator('#canvas')).toHaveScreenshot(`${id}-${name}.png`, {
          scale: 'css',
          maxDiffPixelRatio: 0.001,
        });
      }
    const disposed = await page.evaluate(() => {
      const field = window.hologpu.field!;
      const session = field.session;
      field.destroy();
      field.destroy();
      return {
        state: field.state,
        memory: field.memory(),
        clients: session.clients,
        scheduled: session.scheduler.surfaceCount,
        stateDevice: session.state,
      };
    });
    expect(disposed.state).toBe('disposed');
    expect(disposed.memory.textureBytes).toBe(0);
    expect(disposed.memory.bufferBytes).toBe(0);
    expect(disposed.memory.shared.entries).toBe(0);
    expect(disposed.clients).toBe(0);
    expect(disposed.scheduled).toBe(0);
    expect(disposed.stateDevice).toBe('closed');
  });
test('generated inspector, URL reload, source, capabilities, search and reduced motion', async ({
  page,
}) => {
  await page.goto('/?effect=noise-lab&playing=false');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.locator('#param-scale').fill('9');
  await page.locator('#param-kind').selectOption('worley');
  await page.locator('#seed').fill('42');
  await page.locator('#seed').dispatchEvent('change');
  await page.locator('#motion').check();
  const url = page.url();
  await page.reload();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#param-scale')).toHaveValue('9');
  await expect(page.locator('#param-kind')).toHaveValue('worley');
  await expect(page.locator('#seed')).toHaveValue('42');
  expect(new URL(page.url()).searchParams.get('params')).toBe(
    new URL(url).searchParams.get('params'),
  );
  expect(
    await page.evaluate(() => ({
      playing: window.hologpu.field!.playing,
      time: window.hologpu.field!.frame.time,
    })),
  ).toEqual({ playing: false, time: 0 });
  await page.getByRole('tab', { name: 'Source', exact: true }).click();
  await expect(page.locator('#source')).toContainText('// --- noise ---');
  await page.getByRole('tab', { name: 'Capabilities', exact: true }).click();
  await expect(page.locator('#capabilities')).toContainText('maxTextureDimension2D');
  await page.locator('#search').fill('raymarch');
  await expect(page.locator('#effects button')).toHaveCount(1);
  await page.locator('#effects button').click();
  await expect(page.locator('#title')).toHaveText('Sphere-traced sculpture');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
});
test('multiple fields share a device and pipeline, resize and release independently', async ({
  page,
}) => {
  await page.goto('/?effect=gradient-oklch&playing=false');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  const result = await page.evaluate(async () => {
    const { createEffect } = window.hologpu;
    const first = window.hologpu.field!;
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:40px;height:32px';
    document.body.append(canvas);
    const second = await createEffect(canvas, first.effect, { playing: false });
    const shared = first.session === second.session;
    const before = first.session.resources.stats();
    second.drawAt(0);
    await second.readPixels();
    second.destroy();
    canvas.remove();
    const after = first.session.resources.stats();
    first.drawAt(2);
    await first.readPixels();
    return {
      shared,
      clients: first.session.clients,
      surfaces: first.session.scheduler.surfaceCount,
      before,
      after,
      errors: first.session.errors,
    };
  });
  expect(result.shared).toBe(true);
  expect(result.clients).toBe(1);
  expect(result.surfaces).toBe(1);
  expect(result.before.references).toBeGreaterThan(result.after.references);
  expect(result.before.entries).toBe(result.after.entries);
  expect(result.errors).toEqual([]);
});
test('no WebGPU retains a readable CSS fallback', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }));
  await page.goto('/?effect=gradient-oklch');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#fallback')).toBeVisible();
  await expect(page.locator('#fallback')).toContainText('CSS fallback');
  await expect(page.locator('#canvas')).toBeHidden();
});

test('fragment helper binds unused uniforms and resolves straight linear alpha correctly', async ({
  page,
}) => {
  await page.goto('/?playing=false');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  const result = await page.evaluate(async () => {
    const { fragmentEffect, createEffect } = window.hologpu;
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:8px;height:8px';
    document.body.append(canvas);
    const definition = fragmentEffect({
      id: 'alpha-test',
      title: 'Alpha',
      params: {
        color: { type: 'color', default: '#80808080' },
        unused: { type: 'u32', default: 1 },
      },
      wgsl: 'fn effect(uv: vec2f) -> vec4f { return params.color; }',
    });
    const field = await createEffect(canvas, definition, { playing: false });
    field.drawAt(0);
    const read = await field.readPixels();
    field.destroy();
    canvas.remove();
    return Array.from(read.pixels.slice(0, 4));
  });
  // The CSS color is decoded to linear, the helper premultiplies, and resolve re-encodes to sRGB.
  expect(result).toEqual([64, 64, 64, 128]);
});

test('double-single operations retain residuals lost by ordinary f32', async ({ page }) => {
  await page.goto('/?effect=fractal&playing=false');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  const result = await page.evaluate(async () => {
    const { fragmentEffect, createEffect } = window.hologpu;
    const source = window.hologpu.field!.sources['fragment']!.code;
    const helpers = source.split('// --- effect:fractal ---')[1]!.split('fn effect(')[0]!;
    const definition = fragmentEffect({
      id: 'precision-test',
      title: 'Residual probe',
      params: {},
      wgsl:
        helpers +
        `fn effect(uv: vec2f) -> vec4f {let base=frame.time;let pair=ds_add(vec2f(base,0),vec2f(0.00000001,0));let different=bitcast<u32>(base+0.00000001)!=bitcast<u32>(base);let product=ds_mul(vec2f(base,0.00000001),vec2f(base,0.00000001));return vec4f(pair.y*100000000.0,select(0.0,1.0,different),product.y*50000000.0,1);}`,
    });
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:8px;height:8px';
    document.body.append(canvas);
    const field = await createEffect(canvas, definition, { playing: false });
    field.drawAt(1);
    const read = await field.readPixels();
    field.destroy();
    canvas.remove();
    return Array.from(read.pixels.slice(0, 4));
  });
  expect(result).toEqual([255, 0, 255, 255]);
});

test('paired arithmetic agrees with a CPU f64 reference for bounded values and cancellation', async ({
  page,
}) => {
  await page.goto('/?effect=fractal&playing=false');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  const errors = await page.evaluate(async () => {
    const device = window.hologpu.field!.session.device;
    const helpers = window.hologpu
      .field!.sources['fragment']!.code.split('// --- effect:fractal ---')[1]!
      .split('fn effect(')[0]!;
    const input = new Float32Array(64 * 4);
    let seed = 7;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 64; i++) {
      const a = Math.fround((random() - 0.5) * 16);
      input.set(
        [a, (random() - 0.5) * 1e-7, i < 16 ? -a : (random() - 0.5) * 16, (random() - 0.5) * 1e-7],
        i * 4,
      );
    }
    const source =
      helpers +
      `@group(0) @binding(0) var<storage,read> input: array<vec4f>; @group(0) @binding(1) var<storage,read_write> output: array<vec4f>; @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u) {let p=input[id.x];output[id.x]=vec4f(ds_add(p.xy,p.zw),ds_mul(p.xy,p.zw));}`;
    const module = device.createShaderModule({ code: source });
    const info = await module.getCompilationInfo();
    if (info.messages.length) throw new Error(info.messages.map((m) => m.message).join('\n'));
    const pipeline = await device.createComputePipelineAsync({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });
    const inputBuffer = device.createBuffer({
      size: input.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const output = device.createBuffer({
      size: input.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const staging = device.createBuffer({
      size: input.byteLength,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    try {
      device.queue.writeBuffer(inputBuffer, 0, input);
      const group = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: inputBuffer } },
          { binding: 1, resource: { buffer: output } },
        ],
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(1);
      pass.end();
      encoder.copyBufferToBuffer(output, 0, staging, 0, input.byteLength);
      device.queue.submit([encoder.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const values = new Float32Array(staging.getMappedRange());
      let add = 0,
        mul = 0;
      for (let i = 0; i < 64; i++) {
        const a = input[i * 4]! + input[i * 4 + 1]!,
          b = input[i * 4 + 2]! + input[i * 4 + 3]!;
        add = Math.max(add, Math.abs(values[i * 4]! + values[i * 4 + 1]! - (a + b)));
        mul = Math.max(mul, Math.abs(values[i * 4 + 2]! + values[i * 4 + 3]! - a * b));
      }
      return { add, mul };
    } finally {
      inputBuffer.destroy();
      output.destroy();
      staging.destroy();
    }
  });
  expect(errors.add).toBeLessThan(1e-10);
  expect(errors.mul).toBeLessThan(1e-10);
});
