import { test, expect } from '@playwright/test';
import type { EffectField } from '../../packages/core/src/runtime.ts';
import type { DomRectsInput } from '../../packages/dom/src/dom-rects.ts';
import type { createLightPresentation } from '../../apps/playground/src/dom-light-presentation.ts';

type Demo = {
  field: EffectField;
  obstacles: DomRectsInput;
  presentation: Awaited<ReturnType<typeof createLightPresentation>>;
};

test('HDR keeps real fluid highlights above SDR white; light and output controls work while paused', async ({
  page,
}, info) => {
  await page.goto('fluid-dom.html?playing=false&output=hdr');
  await expect(page.locator('#brightness')).toBeEnabled();
  await expect(page.locator('#palette')).toHaveValue('ember');
  await expect(page.locator('#brightness')).toHaveValue('8');
  const measure = () =>
    page.evaluate(async () => {
      const { field, presentation } = Reflect.get(window, 'fluidDOM') as Demo;
      field.beforeFrame();
      field.drawAt(0, 7);
      const encoder = field.session.encoder();
      const output = presentation.draw(
        encoder,
        field.output!,
        Number((document.querySelector('#brightness') as HTMLInputElement).value),
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
        const bytes = buffer.getMappedRange();
        const pixels = presentation.hdr ? new Uint16Array(bytes) : new Uint8Array(bytes);
        const stride = bytesPerRow / (presentation.hdr ? 2 : 1);
        let peak = 0;
        let sum = 0;
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
              const value = presentation.hdr ? decode(bits) : bits / 255;
              peak = Math.max(peak, value);
              sum += value;
            }
        return {
          hdr: presentation.hdr,
          configuration: presentation.configuration,
          peak,
          mean: sum / (output.width * output.height * 3),
          errors: field.session.errors,
        };
      } finally {
        buffer.destroy();
      }
    });
  const bright = await measure();
  await info.attach('presented-fluid-hdr-pixels', {
    body: JSON.stringify(bright, null, 2),
    contentType: 'application/json',
  });
  await page.screenshot({ path: `artifacts/fluid-hdr-${info.project.name}.png` });
  if (info.project.name.startsWith('firefox')) expect(bright.hdr).toBe(false);
  else {
    expect(bright.hdr).toBe(true);
    expect(bright.configuration.format).toBe('rgba16float');
    expect(bright.configuration.toneMapping?.mode).toBe('extended');
    expect(bright.peak).toBeGreaterThan(1.5);
  }
  // Keyboard input exercises native range handling, with the global stirring listener active.
  await page.locator('#brightness').focus();
  await page.keyboard.press('Home');
  await expect(page.locator('#brightness-value')).toHaveText('1×');
  const normal = await measure();
  // SDR's bounded shoulder cannot reproduce the extended HDR brightness ratio.
  expect(bright.mean).toBeGreaterThan(normal.mean * (bright.hdr ? 1.25 : 1.15));
  await expect(page.locator('#pause')).toHaveText('Play');
  const slider = (await page.locator('#brightness').boundingBox())!;
  await page.mouse.move(slider.x + 5, slider.y + slider.height / 2);
  await page.mouse.down();
  await page.mouse.move(slider.x + slider.width - 5, slider.y + slider.height / 2, { steps: 4 });
  await page.mouse.up();
  expect(Number(await page.locator('#brightness').inputValue())).toBeGreaterThan(12);
  await page.locator('#output-mode').selectOption('sdr');
  await expect(page.locator('#output-status')).toHaveText('SDR · tone mapped');
  expect((await measure()).hdr).toBe(false);
  await page.locator('#brightness').focus();
  await page.keyboard.press('End');
  expect((await measure()).mean).toBeGreaterThan(normal.mean);
  await page.locator('#output-mode').selectOption('hdr');
  await expect(page.locator('#output-status')).not.toHaveText('Preparing light…');
  expect((await measure()).errors).toEqual([]);
});

test('HDR presentation restores after device loss and retains brightness', async ({ page }) => {
  await page.goto('fluid-dom.html?playing=false&output=hdr&brightness=12');
  await expect(page.locator('#brightness')).toBeEnabled();
  const generation = await page.evaluate(() => {
    const { field } = Reflect.get(window, 'fluidDOM') as Demo;
    const generation = field.session.generation;
    field.session.device.destroy();
    return generation;
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (Reflect.get(window, 'fluidDOM') as Demo).presentation?.generation ?? 0,
        ),
      { timeout: 60000 },
    )
    .toBeGreaterThan(generation);
  await expect(page.locator('#brightness')).toHaveValue('12');
  await page.evaluate(async () => {
    const { field } = Reflect.get(window, 'fluidDOM') as Demo;
    field.drawAt(0, 7);
    await field.session.device.queue.onSubmittedWorkDone();
  });
  expect(
    await page.evaluate(() => (Reflect.get(window, 'fluidDOM') as Demo).field.session.errors),
  ).toEqual([]);
});

test('Firefox rendering is not serialized behind delayed GPU notifications', async ({
  page,
}, info) => {
  test.skip(
    !info.project.name.startsWith('firefox'),
    'Requires headed Firefox with a hardware adapter',
  );
  await page.goto('fluid-dom.html');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  const result = await page.evaluate(async () => {
    const { field } = Reflect.get(window, 'fluidDOM') as Demo;
    let frames = 0;
    const unsubscribe = field.onRendered(() => frames++);
    const start = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    unsubscribe();
    return {
      fps: (frames * 1000) / (performance.now() - start),
      limit: field.session.scheduler.submissionLimit,
      errors: field.session.errors,
    };
  });
  expect(result.limit).toBe(8);
  expect(result.fps).toBeGreaterThan(30);
  expect(result.errors).toEqual([]);
});

test('GPU walls follow actual DOM boxes through dragging, scroll and resize', async ({ page }) => {
  const errors: string[] = [];
  let phase = 'startup';
  page.on('pageerror', (error) => errors.push(`${phase}: ${error.message}`));
  await page.goto('fluid-dom.html?playing=false&quality=fixed');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  // Reduce compute work for geometry readback; production defaults are checked below.
  expect(
    await page.evaluate(() => (Reflect.get(window, 'fluidDOM') as Demo).field.params['grid']),
  ).toBe(160);
  await page.evaluate(() => {
    (Reflect.get(window, 'fluidDOM') as Demo).field.params['grid'] = 96;
  });
  const inspect = () =>
    page.evaluate(async () => {
      const { field, obstacles } = Reflect.get(window, 'fluidDOM') as Demo;
      // Scroll/resize observers are delivered by the browser around animation frames.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      field.beforeFrame();
      field.drawAt(0, 7);
      const viewport = field.canvas.getBoundingClientRect();
      const boxes = [...document.querySelectorAll<HTMLElement>('[data-hgpu-obstacle]')].map(
        (node) => node.getBoundingClientRect(),
      );
      const mask = await field.readTap('obstacleMask');
      let mismatch = 0,
        solids = 0;
      for (let y = 0; y < mask.height; y++)
        for (let x = 0; x < mask.width; x++) {
          const px = viewport.left + ((x + 0.5) / mask.width) * viewport.width;
          const py = viewport.top + ((y + 0.5) / mask.height) * viewport.height;
          const expected = boxes.some(
            (box) => px >= box.left && px < box.right && py >= box.top && py < box.bottom,
          )
            ? 1
            : 0;
          if (mask.values[y * mask.width + x] !== expected) mismatch++;
          solids += expected;
        }
      return { mismatch, solids, rects: obstacles.snapshot(), errors: field.session.errors };
    });
  const first = await inspect();
  phase = 'drag';
  expect(first.mismatch).toBe(0);
  expect(first.solids).toBeGreaterThan(100);
  const handle = page.locator('#drag-handle');
  const bounds = (await handle.boundingBox())!;
  await page.mouse.move(bounds.x + 60, bounds.y + 15);
  await page.mouse.down();
  await page.mouse.move(bounds.x - 40, bounds.y + 95, { steps: 5 });
  await page.mouse.up();
  const moved = await inspect();
  expect(moved.mismatch).toBe(0);
  expect(moved.rects).not.toEqual(first.rects);
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  expect((await inspect()).rects).not.toEqual(moved.rects);
  phase = 'scroll';
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, 850);
  });
  const scrolled = await inspect();
  expect(scrolled.mismatch).toBe(0);
  expect(scrolled.rects).not.toEqual(moved.rects);
  phase = 'rearrange';
  await page.locator('#rearrange').click();
  expect((await inspect()).mismatch).toBe(0);
  phase = 'resize';
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await inspect()).mismatch).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await inspect()).errors).toEqual([]);
  expect(errors).toEqual([]);
});

test('Boundaries, stirring, palettes and transport control the real field', async ({ page }) => {
  await page.goto('fluid-dom.html?playing=false&quality=fixed');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.evaluate(() => {
    (Reflect.get(window, 'fluidDOM') as Demo).field.params['grid'] = 64;
  });
  await page.locator('#boundaries').uncheck();
  const solids = () =>
    page.evaluate(async () => {
      const { field } = Reflect.get(window, 'fluidDOM') as Demo;
      field.beforeFrame();
      field.drawAt(0);
      return Array.from((await field.readTap('obstacleMask')).values).reduce(
        (sum, v) => sum + v,
        0,
      );
    });
  expect(await solids()).toBe(0);
  await page.locator('#boundaries').check();
  expect(await solids()).toBeGreaterThan(0);
  await page.locator('#show-boxes').click();
  await expect(page.locator('body')).toHaveClass('show-boxes');
  await page.locator('#palette').selectOption('violet');
  expect(
    await page.evaluate(() => (Reflect.get(window, 'fluidDOM') as Demo).field.params['dyeA']),
  ).toBe('#aa86ed');
  const dye = () =>
    page.evaluate(async () =>
      Array.from((await (Reflect.get(window, 'fluidDOM') as Demo).field.readTap('dye')).values),
    );
  const before = await dye();
  await page.mouse.move(620, 150);
  await page.mouse.down();
  await page.mouse.move(680, 180, { steps: 4 });
  await page.evaluate(() => {
    (Reflect.get(window, 'fluidDOM') as Demo).field.advance(3);
  });
  await page.mouse.up();
  expect(await dye()).not.toEqual(before);
  expect(
    await page.evaluate(() => (Reflect.get(window, 'fluidDOM') as Demo).field.frame.buttons),
  ).toBe(0);
  await page.locator('#pause').click();
  await expect(page.locator('#pause')).toHaveText('Pause');
  await page.locator('#pause').click();
  await expect(page.locator('#pause')).toHaveText('Play');
  await page.locator('#reset').click();
  expect(
    await page.evaluate(() => (Reflect.get(window, 'fluidDOM') as Demo).field.session.errors),
  ).toEqual([]);
});

test('Reduced motion and no-WebGPU fallback keep the page usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('fluid-dom.html');
  await expect(page.locator('#status')).toHaveText('Fluid paused');
  await page.locator('#pause').click();
  await expect(page.locator('#status')).toHaveText('Fluid is live');
  await page.goto('fluid-dom.html?fallback');
  await expect(page.locator('#status')).toHaveText('WebGPU unavailable');
  await expect(page.locator('#pause')).toBeDisabled();
  await expect(page.locator('h1')).toHaveText('Flowstate.');
  await page.locator('#show-boxes').click();
  await expect(page.locator('body')).toHaveClass('show-boxes');
  await page.locator('#drag-handle').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#floating-card')).toHaveAttribute('style', /translate/);
});
