import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
async function start(page: Page, id = 'gradient-oklch') {
  await page.goto(
    `/?effect=${id}&playing=false&quality=fixed&params=${encodeURIComponent(JSON.stringify(id === 'reaction-diffusion' ? { grid: 32 } : id === 'morph-particles' ? { count: 256 } : {}))}`,
  );
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.locator('#stage').evaluate((node: HTMLElement) => {
    node.style.width = '162px';
    node.style.height = '162px';
  });
  await expect
    .poll(() => page.evaluate(() => window.hologpu.field!.surface!.size[0]))
    .toBe(160 * (await page.evaluate(() => devicePixelRatio)));
}
test('WGSL editor retains the last good pipeline on syntax and layout errors, compiles and restores a stage', async ({
  page,
}) => {
  await start(page);
  await page.getByRole('tab', { name: 'Source', exact: true }).click();
  const original = await page.locator('#shader-editor').inputValue();
  const before = await page.evaluate(async () => {
    const f = window.hologpu.field!;
    f.drawAt(0, 7);
    return Array.from((await f.readPixels()).pixels);
  });
  await page.locator('#shader-editor').fill(original + '\ninvalid wgsl syntax');
  await page.locator('#shader-apply').click();
  await expect(page.locator('#shader-diagnostics')).toHaveAttribute('data-state', 'error');
  const failed = await page.evaluate(async () => {
    const f = window.hologpu.field!;
    f.drawAt(0, 7);
    return {
      state: f.state,
      pixels: Array.from((await f.readPixels()).pixels),
      errors: f.session.errors,
    };
  });
  expect(failed.state).toBe('ready');
  expect(failed.pixels).toEqual(before);
  expect(failed.errors).toEqual([]);
  // Valid WGSL with an incompatible generated uniform binding must also roll back.
  await page.locator('#shader-editor').fill(original.replace('@binding(1)', '@binding(3)'));
  await page.locator('#shader-apply').click();
  await expect(page.locator('#shader-diagnostics')).toHaveAttribute('data-state', 'error');
  expect(await page.evaluate(() => window.hologpu.field!.state)).toBe('ready');
  expect(await page.evaluate(() => window.hologpu.field!.session.errors)).toEqual([]);
  const edited = original.replace('let c=effect(in.uv);', 'let c=vec4f(1,0,0,1);');
  expect(edited).not.toBe(original);
  await page.locator('#shader-editor').fill(edited);
  await page.locator('#shader-apply').click();
  await expect(page.locator('#shader-diagnostics')).toContainText('Compiled.');
  const red = await page.evaluate(async () => {
    const f = window.hologpu.field!;
    f.drawAt(0, 7);
    return Array.from((await f.readPixels()).pixels);
  });
  expect(red.every((v, i) => v === (i % 4 === 0 || i % 4 === 3 ? 255 : 0))).toBe(true);
  const exported = page.waitForEvent('download');
  await page.locator('#shader-export').click();
  const patch = JSON.parse(await readFile((await (await exported).path())!, 'utf8'));
  expect(patch.effect).toBe('gradient-oklch');
  expect(patch.overrides.fragment).toBe(edited);
  await page.locator('#shader-revert').click();
  await expect(page.locator('#shader-diagnostics')).toContainText('Compiled.');
  const restored = await page.evaluate(async () => {
    const f = window.hologpu.field!;
    f.drawAt(0, 7);
    return Array.from((await f.readPixels()).pixels);
  });
  expect(restored).toEqual(before);
});
test('Editing a compute stage changes simulation state and reset replay, without changing another field', async ({
  page,
}) => {
  await start(page, 'reaction-diffusion');
  const result = await page.evaluate(async () => {
    const f = window.hologpu.field!,
      effect = window.hologpu.catalogue.find((e) => e.id === 'reaction-diffusion')!;
    const canvas = document.createElement('canvas');
    canvas.style.width = '64px';
    canvas.style.height = '64px';
    document.body.append(canvas);
    const other = await window.hologpu.createEffect(canvas, effect, {
      params: { grid: 32 },
      playing: false,
    });
    try {
      f.reset(7);
      f.advance(0);
      const initial = Array.from((await f.readTap('state')).values),
        original = f.sources.step!.code;
      f.advance(8);
      const moving = Array.from((await f.readTap('state')).values);
      await f.editSource('step', original.replaceAll('params.dt', '0.0'));
      f.advance(8);
      const frozen = Array.from((await f.readTap('state')).values);
      other.reset(7);
      other.advance(8);
      const independent = Array.from((await other.readTap('state')).values);
      await f.editSource('step', original);
      f.advance(8);
      const restored = Array.from((await f.readTap('state')).values);
      return { initial, moving, frozen, independent, restored, errors: f.session.errors };
    } finally {
      other.destroy();
      canvas.remove();
    }
  });
  expect(result.moving).not.toEqual(result.initial);
  expect(result.frozen).toEqual(result.initial);
  expect(result.independent).toEqual(result.moving);
  expect(result.restored).toEqual(result.moving);
  expect(result.errors).toEqual([]);
});
test('Profiler captures bounded pass timings or graceful fallback and exports a fixed benchmark with restored controls', async ({
  page,
}) => {
  await start(page);
  await page.locator('#seed').fill('42');
  await page.locator('#seed').dispatchEvent('change');
  await page.locator('#resolution').selectOption('0.5');
  await page.locator('#time-scale').selectOption('0.5');
  await page.locator('#adaptive-quality').check();
  await page.locator('#motion').check();
  await page.getByRole('tab', { name: 'Profiler', exact: true }).click();
  await page.locator('#profile-enabled').check();
  await page.locator('#step').click();
  await expect(page.locator('#profile-summary')).toContainText('CPU encode');
  await page.locator('#benchmark-run').click();
  await expect(page.locator('#benchmark-status')).toContainText('120 measured updates', {
    timeout: 20000,
  });
  await expect(page.locator('#benchmark-results tbody tr')).toHaveCount(1);
  const exported = page.waitForEvent('download');
  await page.locator('#benchmark-export').click();
  const download = await exported;
  const data = JSON.parse(await readFile((await download.path())!, 'utf8')),
    row = data.results[0];
  expect(row.id).toBe('gradient-oklch');
  expect(row.seed).toBe(7);
  expect(row.samples).toBe(120);
  expect(row.frameIndex).toBe(150);
  expect(row.size).toEqual([
    512 * (await page.evaluate(() => devicePixelRatio)),
    512 * (await page.evaluate(() => devicePixelRatio)),
  ]);
  expect(row.cpuMs.count).toBe(120);
  expect(row.errors).toEqual([]);
  const state = await page.evaluate(() => {
    const f = window.hologpu.field!,
      p = f.session.profiler;
    return {
      supported: p.supported,
      bytes: p.bytes,
      history: p.history.length,
      seed: f.frame.seed,
      scale: f.quality.maxResolution,
      timeScale: f.timeScale,
      auto: f.adaptiveQuality,
      playing: f.playing,
      reducedMotion: f.reducedMotion,
      motionOverride: f.reducedMotionOverride,
      errors: f.session.errors,
    };
  });
  if (state.supported) {
    expect(row.gpuMs.count).toBe(120);
    expect(Object.keys(row.passes).length).toBeGreaterThan(0);
    expect(Number.isFinite(row.gpuMs.p95)).toBe(true);
    expect(state.bytes).toBeLessThanOrEqual(49152);
  } else expect(row.gpuMs).toBeNull();
  expect(state.history).toBeLessThanOrEqual(240);
  expect(state.seed).toBe(42);
  expect(state.scale).toBe(0.5);
  expect(state.timeScale).toBe(0.5);
  expect(state.auto).toBe(true);
  expect(state.playing).toBe(false);
  expect(state.reducedMotion).toBe(true);
  expect(state.motionOverride).toBe(true);
  expect(state.errors).toEqual([]);
});
test('Morph accepts custom text and decoded image targets while retaining fixed particle count', async ({
  page,
}) => {
  await start(page, 'morph-particles');
  const targets = () =>
    page.evaluate(async () => {
      const f = window.hologpu.field!;
      f.advance(0);
      const tap = f.bufferTaps.targets!,
        device = f.session.device,
        b = device.createBuffer({
          size: tap.buffer.size,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
      const e = device.createCommandEncoder();
      e.copyBufferToBuffer(tap.buffer, 0, b, 0, b.size);
      device.queue.submit([e.finish()]);
      await b.mapAsync(GPUMapMode.READ);
      const values = Array.from(new Float32Array(b.getMappedRange()));
      b.destroy();
      return values;
    });
  const original = await targets();
  await page.locator('#morph-text').fill('HELLO');
  await page.locator('#morph-text-apply').click();
  await expect(page.locator('#morph-input-status')).toContainText('Text target updated');
  const text = await targets();
  expect(text).not.toEqual(original);
  await page.evaluate(async () => {
    const f = window.hologpu.field!;
    await f.editSource('toneMap', f.sources.toneMap!.code + '\n// replay custom text');
  });
  expect(await targets()).toEqual(text);
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d')!;
    x.fillStyle = 'black';
    x.fillRect(0, 0, 64, 64);
    x.fillStyle = 'white';
    x.fillRect(8, 8, 16, 48);
    return c.toDataURL('image/png').split(',')[1]!;
  });
  await page.locator('#morph-image').setInputFiles({
    name: 'target.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  await expect(page.locator('#morph-input-status')).toContainText('Image target updated');
  const image = await targets();
  expect(image).not.toEqual(text);
  expect(image).toHaveLength(256 * 4);
  expect(image.every(Number.isFinite)).toBe(true);
  await page.evaluate(async () => {
    const f = window.hologpu.field!;
    await f.editSource('toneMap', f.sources.toneMap!.code + '\n// replay closed image upload');
  });
  expect(await targets()).toEqual(image);
  expect(await page.evaluate(() => window.hologpu.field!.session.errors)).toEqual([]);
});
test('Benchmark rejects mid-run transport, quality and source changes rather than exporting mixed work', async ({
  page,
}) => {
  await start(page);
  const result = await page.evaluate(async () => {
    const f = window.hologpu.field!;
    const cancelled: string[] = [];
    for (const change of [
      'reset',
      'play',
      'resolution',
      'adaptive',
      'timeScale',
      'motion',
      'source',
    ]) {
      const mutation = new Promise<void>((resolve, reject) => {
        const poll = () => {
          if (f.frame.index < 3) {
            requestAnimationFrame(poll);
            return;
          }
          void (async () => {
            if (change === 'reset') f.reset(99);
            if (change === 'play') f.play();
            if (change === 'resolution') f.setResolutionScale(0.5);
            if (change === 'adaptive') f.setAdaptiveQuality(true);
            if (change === 'timeScale') f.setTimeScale(0.5);
            if (change === 'motion') f.setReducedMotion(true);
            if (change === 'source')
              await f.editSource(
                'fragment',
                f.sources.fragment!.code + '\n// changed during benchmark',
              );
          })().then(resolve, reject);
        };
        requestAnimationFrame(poll);
      });
      try {
        await window.hologpu.runBenchmark(f, 0, 30);
      } catch (error) {
        cancelled.push(String(error));
      }
      await mutation;
    }
    let bounded = false;
    try {
      await window.hologpu.runBenchmark(f, 601, 1);
    } catch (error) {
      bounded = error instanceof RangeError;
    }
    return { cancelled, bounded, errors: f.session.errors };
  });
  expect(result.cancelled).toHaveLength(7);
  expect(result.cancelled.every((message) => message.includes('benchmark cancelled'))).toBe(true);
  expect(result.bounded).toBe(true);
  expect(result.errors).toEqual([]);
});
test('Benchmark rejects custom input changes and preserves inherited motion preferences', async ({
  page,
}) => {
  await start(page, 'morph-particles');
  const result = await page.evaluate(async () => {
    const f = window.hologpu.field!;
    const mutation = new Promise<void>((resolve, reject) => {
      const poll = () => {
        if (f.frame.index < 3) {
          requestAnimationFrame(poll);
          return;
        }
        f.setInput('text', 'CHANGED').then(resolve, reject);
      };
      requestAnimationFrame(poll);
    });
    let message = '';
    try {
      await window.hologpu.runBenchmark(f, 0, 30);
    } catch (error) {
      message = String(error);
    }
    await mutation;
    return { message, override: f.reducedMotionOverride, errors: f.session.errors };
  });
  expect(result.message).toContain('benchmark cancelled');
  expect(result.override).toBeUndefined();
  expect(result.errors).toEqual([]);
});
test('Paused particle presentation responds to draw parameters and freezes repeated renders', async ({
  page,
}) => {
  await start(page, 'flow-particles');
  const result = await page.evaluate(async () => {
    const f = window.hologpu.field!;
    f.store.set('count', 256);
    f.store.set('draw', 'quad');
    f.reset(7);
    f.advance(1);
    const before = Array.from((await f.readPixels()).pixels);
    f.store.set('tint', '#ff0000');
    f.advance(0);
    const changed = Array.from((await f.readPixels()).pixels);
    f.advance(0);
    const repeated = Array.from((await f.readPixels()).pixels);
    return { before, changed, repeated, index: f.frame.index, errors: f.session.errors };
  });
  expect(result.changed).not.toEqual(result.before);
  expect(result.repeated).toEqual(result.changed);
  expect(result.index).toBe(1);
  expect(result.errors).toEqual([]);
});
