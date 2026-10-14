import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { EffectDefinition } from '../../packages/core/src/index.ts';

const path = (relative: string) => '/@fs' + fileURLToPath(new URL(relative, import.meta.url));
const core = path('../../packages/core/src/index.ts');
const dom = path('../../packages/dom/src/index.ts');
const ids = ['glass', 'instances', 'material-ball', 'terrain'];
const effectPath = (id: string) => path(`../../packages/effects/src/${id}/index.ts`);
async function fixture(page: Page) {
  await page.route('**/__v2_geometry_reduced', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><style>body{margin:0;background:#11121b;color:white}canvas,#host{display:block;width:160px;height:120px}#host{position:relative}</style><canvas></canvas><section id="host"><h2>Real product copy</h2><button>Explore product</button></section>',
    }),
  );
  await page.goto('/__v2_geometry_reduced');
}

for (const id of ids) {
  test(`${id}: reduced pose remains visible, frozen and idle while edits still redraw`, async ({
    page,
  }) => {
    await fixture(page);
    const result = await page.evaluate(
      async ({ core, effectPath, id }) => {
        const { createEffect } = (await import(
          core
        )) as typeof import('../../packages/core/src/index.ts');
        const { default: effect } = (await import(effectPath)) as { default: EffectDefinition };
        const canvas = document.querySelector('canvas')!;
        const field = await createEffect(canvas, effect, {
          playing: true,
          reducedMotion: true,
          adaptiveQuality: false,
          resolutionScale: 1,
          seed: 7,
          params: {
            msaa: 'off',
            ...(id === 'instances' ? { count: 256, occlusion: false } : {}),
            ...(id === 'terrain' ? { segments: 32 } : {}),
          },
        });
        const read = async (time: number) => {
          field.drawAt(time, 7);
          return (await field.readPixels()).pixels;
        };
        const settled = await read(effect.reducedMotion.time);
        const future = await read(120);
        field.play();
        await new Promise((resolve) => setTimeout(resolve, 150));
        let renders = 0;
        const remove = field.onRendered(() => renders++);
        // Decorative fields with no pointer input must remain idle around moving page pointers.
        const pointer = setInterval(
          () => canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 40, clientY: 30 })),
          20,
        );
        await new Promise((resolve) => setTimeout(resolve, 250));
        clearInterval(pointer);
        remove();
        const playing = field.playing;
        field.params.tint = '#d8a575';
        const edited = await read(120);
        const editedLater = await read(400);
        field.setReducedMotion(false);
        const activeStart = await read(0),
          activeLater = await read(4);
        const errors = [...field.session.errors],
          diagnostics = [...field.diagnostics],
          session = field.session;
        field.destroy();
        field.destroy();
        return {
          pose: effect.reducedMotion.time,
          frozen: settled.every((value, i) => value === future[i]),
          variation: new Set(settled).size,
          opaque: settled.filter((_value, i) => i % 4 === 3).every((value) => value === 255),
          renders,
          playing,
          editChanges: settled.some((value, i) => value !== edited[i]),
          editFrozen: edited.every((value, i) => value === editedLater[i]),
          motionReturns: activeStart.some((value, i) => value !== activeLater[i]),
          errors,
          diagnostics,
          clients: session.clients,
          surfaces: session.scheduler.surfaceCount,
          state: field.state,
          memory: field.memory(),
        };
      },
      { core, effectPath: effectPath(id), id },
    );
    expect(result.pose).toBe(0);
    expect(result.frozen).toBe(true);
    expect(result.variation).toBeGreaterThan(32);
    expect(result.opaque).toBe(true);
    expect(result.renders).toBe(0);
    expect(result.playing).toBe(false);
    expect(result.editChanges).toBe(true);
    expect(result.editFrozen).toBe(true);
    expect(result.motionReturns).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.clients).toBe(0);
    expect(result.surfaces).toBe(0);
    expect(result.state).toBe('disposed');
    expect(result.memory.textureBytes).toBe(0);
    expect(result.memory.bufferBytes).toBe(0);
    expect(result.memory.shared.entries).toBe(0);
  });

  test(`${id}: bundled poster fallback keeps authored copy and controls in the light DOM`, async ({
    page,
  }) => {
    await fixture(page);
    const result = await page.evaluate(
      async ({ dom, effectPath }) => {
        const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
        const { default: effect } = (await import(effectPath)) as { default: EffectDefinition };
        const host = document.getElementById('host')!;
        const heading = host.querySelector('h2')!,
          button = host.querySelector('button')!;
        let clicks = 0;
        button.addEventListener('click', () => clicks++);
        const attachment = await attach(host, effect, { forceFallback: true, reducedMotion: true });
        const poster = host.shadowRoot!.querySelector<HTMLImageElement>('.hgpu-poster')!;
        await poster.decode();
        await new Promise(requestAnimationFrame);
        button.focus();
        button.click();
        const wrapper = host.shadowRoot!.querySelector('.hgpu-wrap')!;
        const observation = {
          source: poster.currentSrc,
          loaded: poster.naturalWidth > 0,
          visible: !poster.hidden,
          posterAria: poster.getAttribute('aria-hidden'),
          posterAlt: poster.alt,
          posterPointerEvents: getComputedStyle(poster).pointerEvents,
          canvasAria: attachment.canvas.getAttribute('aria-hidden'),
          canvasHidden: attachment.canvas.hidden,
          canvasPointerEvents: getComputedStyle(attachment.canvas).pointerEvents,
          background: getComputedStyle(wrapper).backgroundImage,
          nativeHeading: heading === host.querySelector('h2'),
          nativeButton: button === host.querySelector('button'),
          focused: document.activeElement === button,
          copy: heading.textContent,
          clicks,
          state: attachment.state,
        };
        attachment.destroy();
        return {
          ...observation,
          retained: heading.parentElement === host && button.parentElement === host,
        };
      },
      { dom, effectPath: effectPath(id) },
    );
    expect(result.source).toContain(`/${id}/poster.png`);
    expect(result.loaded).toBe(true);
    expect(result.visible).toBe(true);
    expect(result.posterAria).toBe('true');
    expect(result.posterAlt).toBe('');
    expect(result.posterPointerEvents).toBe('none');
    expect(result.canvasAria).toBe('true');
    expect(result.canvasHidden).toBe(true);
    expect(result.canvasPointerEvents).toBe('none');
    expect(result.background).toBe('none');
    expect(result.nativeHeading).toBe(true);
    expect(result.nativeButton).toBe(true);
    expect(result.focused).toBe(true);
    expect(result.copy).toBe('Real product copy');
    expect(result.clicks).toBe(1);
    expect(result.state).toBe('fallback');
    expect(result.retained).toBe(true);
  });
}

test('Stationary material and terrain cameras settle without repeated scheduled frames', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(
    async ({ core, paths }) => {
      const { createEffect } = (await import(
        core
      )) as typeof import('../../packages/core/src/index.ts');
      const observations = [];
      for (const path of paths) {
        const { default: effect } = (await import(path)) as { default: EffectDefinition };
        const field = await createEffect(document.querySelector('canvas')!, effect, {
          playing: true,
          reducedMotion: false,
          adaptiveQuality: false,
          params: { speed: 0, msaa: 'off', ...(effect.id === 'terrain' ? { segments: 32 } : {}) },
        });
        field.drawAt(0, 7);
        const initial = (await field.readPixels()).pixels;
        field.play();
        await new Promise((resolve) => setTimeout(resolve, 150));
        let draws = 0;
        const remove = field.onRendered(() => draws++);
        await new Promise((resolve) => setTimeout(resolve, 250));
        remove();
        field.drawAt(120, 7);
        const later = (await field.readPixels()).pixels;
        observations.push({
          draws,
          same: initial.every((value, i) => value === later[i]),
          errors: [...field.session.errors],
        });
        field.destroy();
      }
      return observations;
    },
    { core, paths: ['material-ball', 'terrain'].map(effectPath) },
  );
  for (const observation of result) {
    expect(observation.draws).toBe(0);
    expect(observation.same).toBe(true);
    expect(observation.errors).toEqual([]);
  }
});
