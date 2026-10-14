import { test, expect } from '@playwright/test';
import type { EffectField } from '../../packages/core/src/runtime.ts';
import type { DomRectsInput } from '../../packages/dom/src/dom-rects.ts';
import type { createLightPresentation } from '../../apps/playground/src/dom-light-presentation.ts';
type Demo = {
  field: EffectField;
  pulls: DomRectsInput;
  pushes: DomRectsInput;
  presentation: Awaited<ReturnType<typeof createLightPresentation>>;
};

test('Particle HDR presents raw trails above white and brightness scrubs without advancing them', async ({
  page,
}, info) => {
  await page.goto('/attractor-dom.html?playing=false&output=hdr');
  await expect(page.locator('#brightness')).toBeEnabled();
  await expect(page.locator('#brightness')).toHaveValue('8');
  await page.evaluate(() => {
    const { field } = Reflect.get(window, 'attractorDOM') as Demo;
    field.store.patch({ count: 64, size: 4, strength: 0 });
    field.reset(7);
    field.drawAt(0, 7);
    // A real additive particle highlight, with known overlapping particles.
    const data = new Float32Array(64 * 8);
    for (let i = 0; i < 64; i++) data.set([0.5, 0.5, 0, 0.5, 0, 0, 0, 0], i * 8);
    field.session.device.queue.writeBuffer(field.bufferTaps['particles']!.buffer, 0, data);
    field.advance(1);
  });
  const measure = () =>
    page.evaluate(async () => {
      const { field, presentation } = Reflect.get(window, 'attractorDOM') as Demo;
      field.drawAt(field.frame.time, 7);
      const encoder = field.session.encoder();
      const output = presentation.draw(
        encoder,
        field.textureTaps['hdr']!,
        Number((document.querySelector('#brightness') as HTMLInputElement).value),
        Number(field.params['exposure']),
      );
      const bytesPerPixel = presentation.hdr ? 8 : 4;
      const bytesPerRow = Math.ceil((output.width * bytesPerPixel) / 256) * 256;
      const buffer = field.session.device.createBuffer({
        size: bytesPerRow * output.height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      encoder.copyTextureToBuffer({ texture: output }, { buffer, bytesPerRow }, [
        output.width,
        output.height,
      ]);
      field.session.submit();
      try {
        await buffer.mapAsync(GPUMapMode.READ);
        const pixels = presentation.hdr
          ? new Uint16Array(buffer.getMappedRange())
          : new Uint8Array(buffer.getMappedRange());
        const stride = bytesPerRow / (presentation.hdr ? 2 : 1);
        let peak = 0;
        const decode = (bits: number) => {
          const exponent = (bits >>> 10) & 31,
            fraction = bits & 1023;
          return exponent === 0
            ? (2 ** -14 * fraction) / 1024
            : 2 ** (exponent - 15) * (1 + fraction / 1024);
        };
        for (let y = 0; y < output.height; y++)
          for (let x = 0; x < output.width; x++)
            for (let c = 0; c < 3; c++) {
              const bits = pixels[y * stride + x * 4 + c]!;
              peak = Math.max(peak, presentation.hdr ? decode(bits) : bits / 255);
            }
        return {
          hdr: presentation.hdr,
          configuration: presentation.configuration,
          peak,
          index: field.frame.index,
          errors: field.session.errors,
        };
      } finally {
        buffer.destroy();
      }
    });
  const bright = await measure();
  if (info.project.name === 'firefox-hardware') expect(bright.hdr).toBe(false);
  else {
    expect(bright.hdr).toBe(true);
    expect(bright.configuration.format).toBe('rgba16float');
    expect(bright.configuration.toneMapping?.mode).toBe('extended');
    expect(bright.peak).toBeGreaterThan(2);
  }
  await page.locator('#brightness').focus();
  await page.keyboard.press('Home');
  await expect(page.locator('#brightness-value')).toHaveText('1×');
  const normal = await measure();
  expect(normal.index).toBe(bright.index);
  expect(bright.peak).toBeGreaterThan(normal.peak);
  const slider = (await page.locator('#brightness').boundingBox())!;
  await page.mouse.move(slider.x + 5, slider.y + slider.height / 2);
  await page.mouse.down();
  await page.mouse.move(slider.x + slider.width - 5, slider.y + slider.height / 2, { steps: 4 });
  await page.mouse.up();
  expect(Number(await page.locator('#brightness').inputValue())).toBeGreaterThan(12);
  await page.locator('#output-mode').selectOption('sdr');
  await expect(page.locator('#output-status')).toHaveText('SDR · tone mapped');
  const sdr = await measure();
  expect(sdr.hdr).toBe(false);
  expect(sdr.peak).toBeLessThanOrEqual(1);
  expect(sdr.index).toBe(bright.index);
  await page.locator('#output-mode').selectOption('hdr');
  await expect(page.locator('#output-status')).not.toHaveText('Preparing light…');
  expect((await measure()).errors).toEqual([]);
});

test('Particle HDR restores after device loss and retains its brightness', async ({ page }) => {
  await page.goto('/attractor-dom.html?playing=false&output=hdr&brightness=12');
  await expect(page.locator('#brightness')).toBeEnabled();
  const generation = await page.evaluate(() => {
    const { field } = Reflect.get(window, 'attractorDOM') as Demo;
    const generation = field.session.generation;
    field.session.device.destroy();
    return generation;
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (Reflect.get(window, 'attractorDOM') as Demo).presentation?.generation ?? 0,
        ),
      { timeout: 60000 },
    )
    .toBeGreaterThan(generation);
  await expect(page.locator('#brightness')).toHaveValue('12');
  await page.evaluate(async () => {
    const { field } = Reflect.get(window, 'attractorDOM') as Demo;
    field.drawAt(0, 7);
    await field.session.device.queue.onSubmittedWorkDone();
  });
  expect(
    await page.evaluate(() => (Reflect.get(window, 'attractorDOM') as Demo).field.session.errors),
  ).toEqual([]);
});

test('Default luminous particles and mobile HDR controls stay visible', async ({ page }, info) => {
  await page.goto('/attractor-dom.html?playing=false');
  await expect(page.locator('#brightness')).toBeEnabled();
  await page.evaluate(() => (Reflect.get(window, 'attractorDOM') as Demo).field.advance(90));
  await page.screenshot({ path: `artifacts/attractor-hdr-${info.project.name}.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#brightness')).toBeInViewport();
  await expect(page.locator('#output-mode')).toBeInViewport();
  await page.locator('#brightness').focus();
  await page.keyboard.press('End');
  await expect(page.locator('#brightness-value')).toHaveText('16×');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `artifacts/attractor-hdr-mobile-${info.project.name}.png` });
});

test('DOM forces follow dragging, scrolling, rearranging and mobile layout', async ({ page }) => {
  await page.goto('/attractor-dom.html?playing=false');
  await expect(page.locator('#status')).toHaveText('Particles paused');
  const inspect = () =>
    page.evaluate(() => {
      const d = Reflect.get(window, 'attractorDOM') as Demo;
      const errors: number[] = [];
      for (const kind of ['pull', 'push'] as const) {
        const rects = (kind === 'pull' ? d.pulls : d.pushes).refresh();
        const canvas = d.field.canvas.getBoundingClientRect();
        const expected = [...document.querySelectorAll(`[data-${kind}]`)]
          .map((n) => n.getBoundingClientRect())
          .filter(
            (r) => r.right > 0 && r.left < canvas.width && r.bottom > 0 && r.top < canvas.height,
          )
          .map((r) => [
            Math.max(0, r.left / canvas.width),
            Math.max(0, r.top / canvas.height),
            Math.min(1, r.right / canvas.width),
            Math.min(1, r.bottom / canvas.height),
          ]);
        errors.push(Math.abs(rects.length - expected.length));
        expected.forEach((r, i) =>
          r.forEach((v, j) =>
            errors.push(Math.abs(v - (d.field.params[`${kind}${i}`] as number[])[j]!)),
          ),
        );
      }
      return {
        errors,
        pulls: d.pulls.snapshot(),
        pushes: d.pushes.snapshot(),
        gpuErrors: d.field.session.errors,
      };
    });
  const first = await inspect();
  expect(Math.max(...first.errors)).toBeLessThan(1e-6);
  await page.locator('#drag-handle').focus();
  await page.keyboard.press('ArrowLeft');
  expect((await inspect()).pulls).not.toEqual(first.pulls);
  const handle = (await page.locator('#drag-handle').boundingBox())!;
  await page.mouse.move(handle.x + 40, handle.y + 15);
  await page.mouse.down();
  await page.mouse.move(handle.x - 40, handle.y + 60, { steps: 4 });
  await page.mouse.up();
  expect(Math.max(...(await inspect()).errors)).toBeLessThan(1e-6);
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    scrollTo(0, 850);
  });
  await page.locator('#rearrange').click();
  expect(Math.max(...(await inspect()).errors)).toBeLessThan(1e-6);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => Math.max(...(await inspect()).errors)).toBeLessThan(1e-6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await inspect()).gpuErrors).toEqual([]);
});

test('Actual GPU particles move toward and away from the DOM force, with finite HDR', async ({
  page,
}) => {
  await page.goto('/attractor-dom.html?playing=false');
  await expect(page.locator('#status')).toHaveText('Particles paused');
  const result = await page.evaluate(async () => {
    const { field: f } = Reflect.get(window, 'attractorDOM') as Demo;
    f.store.patch({ count: 64, pullCount: 1, pushCount: 0, pull0: [0.4, 0.4, 0.6, 0.6] });
    const samples: number[] = [];
    for (const polarity of [1, -1, 0]) {
      f.store.patch({ polarity: polarity || 1, strength: polarity === 0 ? 0 : 1 });
      f.reset(7);
      f.drawAt(0, 7);
      const data = new Float32Array(64 * 8);
      for (let i = 0; i < 64; i++) data.set([0.5, 0, 0, 0.5, 0, 0, 0, 0], i * 8); // Right of the box, at y=.5.
      f.session.device.queue.writeBuffer(f.bufferTaps['particles']!.buffer, 0, data);
      f.advance(1);
      const device = f.session.device;
      const staging = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(f.bufferTaps['particles']!.buffer, 0, staging, 0, 32);
      device.queue.submit([encoder.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      samples.push(new Float32Array(staging.getMappedRange())[4]!);
      staging.unmap();
      staging.destroy();
    }
    f.advance(120);
    const hdr = Array.from((await f.readTap('hdr')).values);
    return {
      samples,
      finite: hdr.every(Number.isFinite),
      lit: hdr.some((v, i) => i % 4 !== 3 && v > 0),
      errors: f.session.errors,
    };
  });
  expect(result.samples[0]).toBeLessThan(result.samples[2]!);
  expect(result.samples[1]).toBeGreaterThan(result.samples[2]!);
  expect(result.finite && result.lit).toBe(true);
  expect(result.errors).toEqual([]);
});

test('Controls, reduced motion and fallback preserve usable HTML', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/attractor-dom.html');
  await expect(page.locator('#status')).toHaveText('Particles paused');
  await page.locator('#reverse').click();
  await expect(page.locator('#reverse')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#forces').uncheck();
  expect(
    await page.evaluate(
      () => (Reflect.get(window, 'attractorDOM') as Demo).field.params['strength'],
    ),
  ).toBe(0);
  await page.locator('#pause').click();
  await expect(page.locator('#status')).toHaveText('Particles are live');
  await page.locator('#pause').click();
  await expect(page.locator('#status')).toHaveText('Particles paused');
  await page.locator('#reset').click();
  await page.goto('/attractor-dom.html?fallback');
  await expect(page.locator('#status')).toHaveText('WebGPU unavailable');
  await expect(page.locator('#pause')).toBeDisabled();
  await expect(page.locator('h1')).toHaveText('Strangepull.');
  await page.locator('#show-boxes').click();
  await expect(page.locator('body')).toHaveClass('show-boxes');
  await page.locator('#drag-handle').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#floating-card')).toHaveAttribute('style', /translate/);
});

test('Firefox keeps rendering while GPU completion notifications are delayed', async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== 'firefox-hardware',
    'Requires headed Firefox with a hardware adapter',
  );
  await page.goto('/attractor-dom.html');
  await expect(page.locator('#status')).toHaveText('Particles are live');
  const result = await page.evaluate(async () => {
    const { field } = Reflect.get(window, 'attractorDOM') as Demo;
    let frames = 0;
    const unsubscribe = field.onRendered(() => frames++);
    const start = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    unsubscribe();
    return {
      fps: (frames * 1000) / (performance.now() - start),
      limit: field.session.scheduler.submissionLimit,
      tint: field.params['tint'],
      errors: field.session.errors,
    };
  });
  expect(result.limit).toBe(8);
  expect(result.fps).toBeGreaterThan(30);
  expect(result.tint).toBe('#1677ff');
  expect(result.errors).toEqual([]);
});

test('Color presets update paused GPU particles and page accents, and work in fallback', async ({
  page,
}) => {
  await page.goto('/attractor-dom.html?playing=false');
  await expect(page.locator('#status')).toHaveText('Particles paused');
  await page.evaluate(() => {
    const { field } = Reflect.get(window, 'attractorDOM') as Demo;
    field.store.patch({ count: 128 });
    field.advance(4);
  });
  const inspect = () =>
    page.evaluate(async () => {
      const { field } = Reflect.get(window, 'attractorDOM') as Demo;
      field.advance(0);
      const tap = await field.readTap('hdr');
      const energy = [0, 0, 0];
      for (let i = 0; i < tap.values.length; i += 4)
        for (let channel = 0; channel < 3; channel++) energy[channel]! += tap.values[i + channel]!;
      return {
        energy,
        index: field.frame.index,
        playing: field.playing,
        accent: getComputedStyle(document.documentElement).getPropertyValue('--mint').trim(),
        errors: field.session.errors,
      };
    });
  const blue = await inspect();
  expect(blue.energy[2]).toBeGreaterThan(blue.energy[0]!);
  await page.getByLabel('Preset').selectOption('ember');
  const ember = await inspect();
  expect(ember.energy[0]).toBeGreaterThan(ember.energy[2]!);
  expect(ember.accent).toBe('#ffb980');
  expect(ember.index).toBe(blue.index);
  expect(ember.playing).toBe(false);
  await page.getByLabel('Preset').selectOption('violet');
  const violet = await inspect();
  expect(violet.energy[2]).toBeGreaterThan(violet.energy[0]!);
  expect(violet.accent).toBe('#c3a0ff');
  expect(violet.index).toBe(blue.index);
  expect(violet.errors).toEqual([]);
  await page.locator('#reset').click();
  await expect(page.getByLabel('Preset')).toHaveValue('violet');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const controls = await page.locator('.toolbar-controls').boundingBox();
  expect(controls!.x).toBeGreaterThanOrEqual(0);
  expect(controls!.x + controls!.width).toBeLessThanOrEqual(390);
  await page.goto('/attractor-dom.html?fallback');
  await page.getByLabel('Preset').selectOption('rose');
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--mint').trim(),
    ),
  ).toBe('#ff99c5');
  await expect(page.locator('#status')).toHaveText('WebGPU unavailable');
});
