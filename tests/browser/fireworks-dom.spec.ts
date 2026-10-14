import { test, expect } from '@playwright/test';
import type { EffectField } from '../../packages/core/src/runtime.ts';
import type { createLightPresentation } from '../../apps/playground/src/dom-light-presentation.ts';

type Demo = {
  field: EffectField;
  presentation: Awaited<ReturnType<typeof createLightPresentation>>;
  syncGeometry(): void;
};

test('paired fireworks have quiet gaps and cycle through seven colors', async ({ page }) => {
  await page.goto('/fireworks-dom.html?playing=false&output=sdr');
  await expect(page.locator('#pause')).toBeEnabled();
  const result = await page.evaluate(async () => {
    const { field } = Reflect.get(window, 'fireworksDOM') as Demo;
    async function particles() {
      const tap = field.bufferTaps['particles']!;
      const buffer = field.session.device.createBuffer({
        size: tap.buffer.size,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoder = field.session.encoder();
      encoder.copyBufferToBuffer(tap.buffer, 0, buffer, 0, buffer.size);
      field.session.submit();
      await buffer.mapAsync(GPUMapMode.READ);
      const data = new Float32Array(buffer.getMappedRange());
      const colors = Array<number>(7).fill(0);
      for (let i = 0; i < data.length; i += 8) if (data[i + 3]! > 0) colors[data[i + 7]! % 8]!++;
      buffer.destroy();
      return colors;
    }
    field.reset(7);
    field.advance(1);
    const bursts = [await particles()];
    field.advance(180);
    const gap = await particles();
    field.advance(35);
    bursts.push(await particles());
    for (let i = 0; i < 6; i++) {
      field.advance(216);
      bursts.push(await particles());
    }
    return { bursts, gap, errors: field.session.errors };
  });
  expect(result.gap).toEqual(Array(7).fill(0));
  result.bursts.forEach((burst, i) => {
    const expected = Array<number>(7).fill(0);
    expected[(i * 2) % 7] = 1536;
    expected[(i * 2 + 3) % 7] = 1536;
    expect(burst).toEqual(expected);
  });
  expect(result.errors).toEqual([]);
});

test('raw fireworks present above SDR white and output switches safely while paused', async ({
  page,
}) => {
  await page.goto('/fireworks-dom.html?playing=false&output=hdr');
  await expect(page.locator('#pause')).toBeEnabled();
  const result = await page.evaluate(async () => {
    const { field, presentation } = Reflect.get(window, 'fireworksDOM') as Demo;
    field.advance(1);
    const encoder = field.session.encoder();
    const texture = presentation.draw(encoder, field.textureTaps['hdr']!, 8, 1.4);
    const bytesPerRow = Math.ceil((texture.width * 8) / 256) * 256;
    const buffer = field.session.device.createBuffer({
      size: bytesPerRow * texture.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [
      texture.width,
      texture.height,
    ]);
    field.session.submit();
    await buffer.mapAsync(GPUMapMode.READ);
    const data = new Uint16Array(buffer.getMappedRange());
    let peak = 0;
    for (let y = 0; y < texture.height; y++)
      for (let x = 0; x < texture.width; x++) {
        const bits = data[(y * bytesPerRow) / 2 + x * 4]!;
        const exponent = (bits >>> 10) & 31;
        const fraction = bits & 1023;
        peak = Math.max(
          peak,
          exponent === 0
            ? (2 ** -14 * fraction) / 1024
            : 2 ** (exponent - 15) * (1 + fraction / 1024),
        );
      }
    buffer.destroy();
    return {
      peak,
      hdr: presentation.hdr,
      configuration: presentation.configuration,
      errors: field.session.errors,
    };
  });
  expect(result.hdr).toBe(true);
  expect(result.configuration.toneMapping?.mode).toBe('extended');
  expect(result.peak).toBeGreaterThan(1.5);
  expect(result.errors).toEqual([]);
  await page.locator('#brightness').focus();
  await page.keyboard.press('Home');
  await expect(page.locator('#brightness-value')).toHaveText('1×');
  await page.locator('#output-mode').selectOption('sdr');
  await expect(page.locator('#output-status')).toHaveText('SDR · tone mapped');
  await expect(page.locator('#pause')).toHaveText('Play');
  await page.locator('#pause').click();
  await expect(page.locator('#pause')).toHaveText('Pause');
  await page.locator('#pause').click();
  await page.locator('#reset').click();
  expect(
    await page.evaluate(() => (Reflect.get(window, 'fireworksDOM') as Demo).field.frame.index),
  ).toBe(0);
});

test('elevated HTML occludes the canvas and origins follow moved cards and mobile layout', async ({
  page,
}) => {
  await page.goto('/fireworks-dom.html?playing=false&output=sdr');
  await expect(page.locator('#pause')).toBeEnabled();
  const origin = () =>
    page.evaluate(() => {
      const demo = Reflect.get(window, 'fireworksDOM') as Demo;
      demo.field.drawAt(Number(demo.field.params['burstInterval']) * 2, 7);
      demo.syncGeometry();
      const rect = document.querySelector('#floating-card')!.getBoundingClientRect();
      return {
        origin: demo.field.params['origin'] as number[],
        expected: [
          ((rect.left + rect.width * 0.55) / innerWidth) * 2 - 1,
          1 - ((rect.top + rect.height * 0.48) / innerHeight) * 2,
        ],
        foreground:
          document
            .elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
            ?.closest('#floating-card') !== null,
        background: getComputedStyle(document.querySelector('#floating-card')!).backgroundColor,
      };
    });
  const before = await origin();
  expect(before.origin[0]).toBeCloseTo(before.expected[0]!, 4);
  expect(before.origin[1]).toBeCloseTo(before.expected[1]!, 4);
  expect(before.foreground).toBe(true);
  expect(before.background).toBe('rgb(233, 232, 223)');
  await page.locator('#drag-handle').focus();
  await page.keyboard.press('ArrowLeft');
  const after = await origin();
  expect(after.origin[0]).toBeLessThan(before.origin[0]!);
  await page.locator('#show-boxes').click();
  await expect(page.locator('#show-boxes')).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.locator('#rearrange').click();
  await expect(page.locator('.notes')).toHaveClass('notes rearranged');
});

test('reduced motion starts paused and fallback preserves the interactive page', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/fireworks-dom.html');
  await expect(page.locator('#pause')).toHaveText('Play');
  expect(
    await page.evaluate(() => (Reflect.get(window, 'fireworksDOM') as Demo).field.frame.index),
  ).toBe(0);
  await page.goto('/fireworks-dom.html?fallback');
  await expect(page.locator('#status')).toHaveText('WebGPU unavailable');
  await expect(page.locator('#particles')).toBeHidden();
  await expect(page.locator('#pause')).toBeDisabled();
  await page.locator('#drag-handle').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#floating-card')).toHaveAttribute('style', /translate/);
  await page.locator('#rearrange').click();
  await expect(page.locator('.notes')).toHaveClass('notes rearranged');
});

test('shape controls produce distinct GPU shells at two separate origins', async ({ page }) => {
  await page.goto('/fireworks-dom.html?playing=false&output=sdr');
  await expect(page.locator('#burst-shape')).toBeEnabled();
  const measurements = [];
  for (const shape of ['round', 'ring', 'willow']) {
    await page.locator('#burst-shape').selectOption(shape);
    measurements.push(
      await page.evaluate(async () => {
        const { field } = Reflect.get(window, 'fireworksDOM') as Demo;
        field.drawAt(0, 7);
        const tap = field.bufferTaps['particles']!;
        const buffer = field.session.device.createBuffer({
          size: tap.buffer.size,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        field.session.encoder().copyBufferToBuffer(tap.buffer, 0, buffer, 0, buffer.size);
        field.session.submit();
        await buffer.mapAsync(GPUMapMode.READ);
        const data = new Float32Array(buffer.getMappedRange());
        const shapes = new Set<number>();
        const speeds: number[] = [];
        const origins: number[][] = [];
        for (let lane = 0; lane < 2; lane++) {
          const offset = lane * 1536 * 8;
          origins.push([
            data[offset]! - data[offset + 4]! * 0.35,
            data[offset + 1]! - data[offset + 5]! * 0.35,
          ]);
        }
        for (let i = 0; i < 1536 * 8; i += 8) {
          shapes.add(Math.floor(data[i + 7]! / 8));
          speeds.push(Math.hypot((data[i + 4]! * innerWidth) / innerHeight, data[i + 5]!));
        }
        buffer.destroy();
        return {
          shapes: [...shapes],
          spread: Math.max(...speeds) - Math.min(...speeds),
          origins,
          errors: field.session.errors,
        };
      }),
    );
  }
  measurements.forEach((m, i) => {
    expect(m.shapes).toEqual([i]);
    expect(
      Math.hypot(m.origins[0]![0]! - m.origins[1]![0]!, m.origins[0]![1]! - m.origins[1]![1]!),
    ).toBeGreaterThan(0.4);
    expect(m.errors).toEqual([]);
  });
  expect(measurements[1]!.spread).toBeLessThan(0.04);
  expect(measurements[0]!.spread).toBeGreaterThan(0.3);
  expect(measurements[2]!.spread).toBeGreaterThan(0.4);
  await page.locator('#burst-shape').selectOption('mixed');
  await expect(page.locator('#burst-shape')).toHaveValue('mixed');
});
