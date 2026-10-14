import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { EffectDefinition } from '../../packages/core/src/index.ts';

const core = '/@fs' + fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url));
const dom = '/@fs' + fileURLToPath(new URL('../../packages/dom/src/index.ts', import.meta.url));
const effectPath = (id: string) =>
  '/@fs' + fileURLToPath(new URL(`../../packages/effects/src/${id}/index.ts`, import.meta.url));
async function fixture(page: Page) {
  await page.route('**/__v2_assembly', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><style>body{margin:0;background:#07111e;color:white}canvas,#hero{width:256px;height:128px}#hero{font:bold 48px sans-serif;--hgpu-progress:0}</style><canvas></canvas><div id="hero">Launch</div>',
    }),
  );
  await page.goto('/__v2_assembly');
}

for (const id of ['text-dissolve', 'morph-particles']) {
  test(`${id}: bounded reversible assembly, stable hold, reduced-motion final pose and preserved old presets`, async ({
    page,
  }, testInfo) => {
    await fixture(page);
    const result = await page.evaluate(
      async ({ core, path, id }) => {
        const { createEffect } = (await import(
          core
        )) as typeof import('../../packages/core/src/index.ts');
        const { default: effect } = (await import(path)) as { default: EffectDefinition };
        const preset = effect.presets['assemble-and-hold']!;
        const field = await createEffect(document.querySelector('canvas')!, effect, {
          preset: 'assemble-and-hold',
          playing: false,
          adaptiveQuality: false,
          reducedMotion: false,
        });
        const pose = async (progress: number) => {
          field.store.set('progress', progress);
          field.drawAt(0, 7);
          return (await field.readPixels()).pixels;
        };
        const scattered = await pose(0),
          middle = await pose(0.5),
          assembled = await pose(1);
        const same = (a: Uint8Array, b: Uint8Array) => a.every((value, i) => value === b[i]);
        const read = await field.readPixels();
        const outerAlpha = (pixels: Uint8Array) => {
          let total = 0;
          for (let y = 0; y < read.height; y++)
            for (let x = 0; x < read.width; x++)
              if (
                x < read.width * 0.1 ||
                x > read.width * 0.9 ||
                y < read.height * 0.1 ||
                y > read.height * 0.9
              )
                total += pixels[(y * read.width + x) * 4 + 3]!;
          return total;
        };
        await pose(0.5);
        const scrubBack = same(assembled, await pose(1));
        field.advance(90);
        const held = same(assembled, (await field.readPixels()).pixels);
        field.setReducedMotion(true);
        const reduced = same(assembled, await pose(0));
        const count =
          id === 'text-dissolve'
            ? Number(preset.grid) * Math.floor(Number(preset.grid) / 2)
            : field.bufferTaps.particles!.count!;
        const ownTextureBytes = field.instance!.memory!().textureBytes;
        field.setReducedMotion(false);
        await pose(1);
        field.play();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        let draws = 0;
        const remove = field.onRendered(() => draws++);
        await new Promise((resolve) => setTimeout(resolve, 180));
        field.pause();
        remove();
        const errors = [...field.session.errors],
          diagnostics = [...field.diagnostics];
        // Existing presets remain byte-for-byte parameter compatible. New behavior is opt-in.
        const oldPresets =
          id === 'text-dissolve'
            ? { drift: effect.presets.drift, burst: effect.presets.burst }
            : { image: effect.presets.image, soft: effect.presets.soft };
        const defaults = {
          assembly: effect.params.assembly!.default,
          count: effect.params.count?.default,
          intensity: effect.params.intensity!.default,
        };
        const poster = effect.presetPosters?.['assemble-and-hold'];
        Reflect.set(window, '__assemblyField', field);
        return {
          differentMiddle: !same(scattered, middle) && !same(middle, assembled),
          outerScatter: outerAlpha(scattered),
          outerAssembled: outerAlpha(assembled),
          assembledAlpha: assembled.reduce((sum, value, i) => sum + (i % 4 === 3 ? value : 0), 0),
          scrubBack,
          held,
          reduced,
          count,
          ownTextureBytes,
          draws,
          errors,
          diagnostics,
          oldPresets,
          defaults,
          intensity: preset.intensity,
          cssProgress: effect.params.progress!.css,
          cssTint: effect.params.tint!.css,
          poster,
        };
      },
      { core, path: effectPath(id), id },
    );
    expect(result.differentMiddle).toBe(true);
    expect(result.outerScatter).toBeGreaterThan(50);
    expect(result.outerAssembled).toBe(0);
    expect(result.assembledAlpha).toBeGreaterThan(1000);
    expect(result.scrubBack).toBe(true);
    expect(result.held).toBe(true);
    expect(result.reduced).toBe(true);
    expect(result.count).toBeLessThanOrEqual(8192);
    expect(result.count).toBeGreaterThan(0);
    expect(result.draws).toBe(0);
    expect(result.intensity).toBeLessThanOrEqual(0.3);
    expect(result.defaults.assembly).toBe(false);
    expect(result.defaults.intensity).toBe(1);
    expect(result.cssProgress).toBe(true);
    expect(result.cssTint).toBe(true);
    expect(result.poster).toContain('poster-assemble-and-hold.png');
    if (id === 'morph-particles') {
      expect(result.defaults.count).toBe(32768);
      expect(result.ownTextureBytes).toBeLessThanOrEqual(16);
      expect(result.oldPresets).toEqual({
        image: { mask: 'image', spring: 12, damping: 3, trail: 0.85, tint: '#edb68c' },
        soft: { word: 'HELLO', spring: 5, damping: 2, scatter: 5, trail: 0.97, tint: '#b8a6ef' },
      });
    } else {
      expect(result.oldPresets).toEqual({
        drift: { progress: 0.55, spread: 0.45, curl: 0.15, tint: '#f4b99a' },
        burst: { progress: 0.85, spread: 0.8, curl: 0.5, tint: '#a5e4de' },
      });
    }
    expect(result.errors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    if (testInfo.project.name.startsWith('swiftshader'))
      await expect(page.locator('canvas')).toHaveScreenshot(`${id}-assembled.png`, {
        scale: 'css',
        maxDiffPixelRatio: 0.001,
      });
    const cleaned = await page.evaluate(() => {
      const field = Reflect.get(
        window,
        '__assemblyField',
      ) as import('../../packages/core/src/runtime.ts').EffectField;
      const session = field.session;
      field.destroy();
      field.destroy();
      return {
        clients: session.clients,
        fields: session.scheduler.surfaceCount,
        memory: field.memory(),
        state: session.state,
      };
    });
    expect(cleaned.clients).toBe(0);
    expect(cleaned.fields).toBe(0);
    expect(cleaned.state).toBe('closed');
    expect(cleaned.memory.textureBytes).toBe(0);
    expect(cleaned.memory.bufferBytes).toBe(0);
  });

  test(`${id}: CSS progress drives real DOM attachment and custom text remains readable`, async ({
    page,
  }) => {
    await fixture(page);
    const result = await page.evaluate(
      async ({ dom, path }) => {
        const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
        const { default: effect } = (await import(path)) as { default: EffectDefinition };
        const host = document.getElementById('hero')!;
        const attachment = await attach(host, effect, {
          preset: 'assemble-and-hold',
          playing: false,
          reducedMotion: false,
          adaptiveQuality: false,
        });
        const field = attachment.field!;
        const frames = () =>
          new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const waitProgress = async (expected: number) => {
          const deadline = performance.now() + 5000;
          while (Number(field.params.progress) !== expected) {
            if (performance.now() >= deadline) {
              throw new Error(
                `CSS progress bridge timed out: expected ${expected}, received ${field.params.progress}`,
              );
            }
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        };
        await frames();
        field.drawAt(0);
        const scattered = (await field.readPixels()).pixels;
        host.style.setProperty('--hgpu-progress', '0.5');
        await waitProgress(0.5);
        const middleProgress = Number(field.params.progress),
          middle = (await field.readPixels()).pixels;
        host.style.setProperty('--hgpu-progress', '1');
        await waitProgress(1);
        const finalProgress = Number(field.params.progress),
          assembled = (await field.readPixels()).pixels;
        await frames();
        const hold = (await field.readPixels()).pixels;
        const errors = [...field.session.errors];
        const same = (a: Uint8Array, b: Uint8Array) => a.every((value, i) => value === b[i]);
        const before = host.textContent,
          canvasAria = attachment.canvas.getAttribute('aria-hidden');
        attachment.destroy();
        return {
          middleProgress,
          finalProgress,
          midChanged: !same(scattered, middle),
          finalChanged: !same(middle, assembled),
          held: same(assembled, hold),
          before,
          after: host.textContent,
          canvasAria,
          errors,
        };
      },
      { dom, path: effectPath(id) },
    );
    expect(result.middleProgress).toBe(0.5);
    expect(result.finalProgress).toBe(1);
    expect(result.midChanged).toBe(true);
    expect(result.finalChanged).toBe(true);
    expect(result.held).toBe(true);
    expect(result.before).toBe('Launch');
    expect(result.after).toBe('Launch');
    expect(result.canvasAria).toBe('true');
    expect(result.errors).toEqual([]);
  });
}

test('morph assembly supports old local text/image inputs and toggles back to the spring path', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(
    async ({ core, path }) => {
      const { createEffect } = (await import(
        core
      )) as typeof import('../../packages/core/src/index.ts');
      const { default: effect } = (await import(path)) as { default: EffectDefinition };
      const field = await createEffect(document.querySelector('canvas')!, effect, {
        preset: 'assemble-and-hold',
        playing: false,
        params: { progress: 1 },
      });
      field.drawAt(0);
      const first = (await field.readPixels()).pixels;
      await field.setInput('text', 'HELLO');
      field.drawAt(0);
      const text = (await field.readPixels()).pixels;
      const mask = document.createElement('canvas');
      mask.width = 64;
      mask.height = 32;
      const painter = mask.getContext('2d')!;
      painter.fillStyle = 'white';
      painter.fillRect(0, 0, 32, 32);
      field.store.set('mask', 'image');
      await field.setInput('image', mask);
      field.drawAt(0);
      const image = (await field.readPixels()).pixels;
      const read = await field.readPixels();
      let rightAlpha = 0;
      for (let y = 0; y < read.height; y++)
        for (let x = Math.ceil(read.width * 0.55); x < read.width; x++)
          rightAlpha += read.pixels[(y * read.width + x) * 4 + 3]!;
      field.store.set('assembly', false);
      field.reset(7);
      field.advance(2);
      const springHasHistory = Boolean(field.textureTaps.hdr),
        springPixels = (await field.readPixels()).pixels;
      field.store.set('assembly', true);
      field.store.set('progress', 1);
      field.drawAt(0);
      const restored = (await field.readPixels()).pixels;
      const same = (a: Uint8Array, b: Uint8Array) => a.every((value, i) => value === b[i]);
      const errors = [...field.session.errors];
      field.destroy();
      return {
        textChanged: !same(first, text),
        imageChanged: !same(text, image),
        rightAlpha,
        springHasHistory,
        springChanged: !same(image, springPixels),
        restored: same(image, restored),
        errors,
      };
    },
    { core, path: effectPath('morph-particles') },
  );
  expect(result.textChanged).toBe(true);
  expect(result.imageChanged).toBe(true);
  expect(result.rightAlpha).toBe(0);
  expect(result.springHasHistory).toBe(true);
  expect(result.springChanged).toBe(true);
  expect(result.restored).toBe(true);
  expect(result.errors).toEqual([]);
});
