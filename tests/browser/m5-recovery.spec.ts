import { test, expect } from '@playwright/test';
import type { EffectField } from '../../packages/core/src/index.ts';
import type {} from './effects.spec.ts';
interface DOMStage {
  fields: EffectField[];
  hosts: HTMLElement[];
  overlay: { drawnRects: readonly unknown[] } | null;
}

for (const overlay of [false, true])
  test(`Page conditions recover all six actual fields after device loss${overlay ? ' with one overlay' : ''}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/?effect=border-energy&mode=in-page&playing=false&overlay=${overlay}`);
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
    const oldGeneration = await page.evaluate(() => {
      const stage = Reflect.get(window.hologpu, 'domStage') as DOMStage;
      const session = stage.fields[0]!.session;
      for (const host of stage.hosts) {
        host.dataset['lostCount'] = '0';
        host.dataset['restoredCount'] = '0';
        host.addEventListener('hgpu-lost', () => {
          host.dataset['lostCount'] = String(Number(host.dataset['lostCount']) + 1);
        });
        host.addEventListener('hgpu-restored', () => {
          host.dataset['restoredCount'] = String(Number(host.dataset['restoredCount']) + 1);
        });
      }
      return session.generation;
    });
    await page.locator('#device-loss').click();
    await expect
      .poll(() =>
        page.evaluate((old) => {
          const stage = Reflect.get(window.hologpu, 'domStage') as DOMStage;
          return (
            stage.fields.length === 6 &&
            stage.fields.every(
              (field) =>
                field.state === 'ready' &&
                field.session.generation > old &&
                field.session.device === stage.fields[0]!.session.device &&
                field.frame.index === 0,
            ) &&
            stage.hosts.every(
              (host) => host.dataset['lostCount'] === '1' && host.dataset['restoredCount'] === '1',
            )
          );
        }, oldGeneration),
      )
      .toBe(true);
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
    const button = page.locator('#dom-stage .m5-card').first().getByRole('button');
    await button.click();
    await expect(button).toHaveText('Content remains interactive');
    if (overlay)
      await expect
        .poll(() =>
          page.evaluate(() => {
            const stage = Reflect.get(window.hologpu, 'domStage') as DOMStage;
            return (
              !!stage.overlay?.drawnRects.length &&
              stage.fields.every((field) => field.surface!.context === null)
            );
          }),
        )
        .toBe(true);
    expect(await page.evaluate(() => window.hologpu.field!.session.errors)).toEqual([]);
    expect(errors).toEqual([]);
  });

test('Fallback Grid links retain copy count, seed and simulated quality on reload', async ({
  page,
}) => {
  await page.goto(
    '/?effect=border-energy&mode=grid&copies=12&seed=13&playing=false&resolution=0.25&tier=low',
  );
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.locator('#force-fallback').check();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'fallback');
  const url = new URL(page.url());
  expect(url.searchParams.get('copies')).toBe('12');
  expect(url.searchParams.get('seed')).toBe('13');
  expect(url.searchParams.get('tier')).toBe('low');
  expect(url.searchParams.get('resolution')).toBe('0.25');
  await page.reload();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'fallback');
  await expect(page.locator('#dom-stage hgpu-field[data-hgpu-state="fallback"]')).toHaveCount(12);
  await page.locator('#force-fallback').uncheck();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  expect(
    await page.evaluate(() => {
      const stage = Reflect.get(window.hologpu, 'domStage') as DOMStage;
      return stage.fields.every(
        (field) => field.frame.seed === 13 && field.surface!.resolutionScale === 0.25,
      );
    }),
  ).toBe(true);
});

test('Leaving an audio page cancels a pending audio resume without starting or stopping an unstarted oscillator', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const audit = { started: 0, stopped: 0, closed: 0, resume: () => {} };
    Reflect.set(window, 'audioAudit', audit);
    class FakeAudioContext {
      destination = {};
      createOscillator() {
        return {
          frequency: { value: 0 },
          connect() {},
          disconnect() {},
          start() {
            audit.started++;
          },
          stop() {
            audit.stopped++;
            throw new Error('Unstarted oscillator stopped');
          },
        };
      }
      createAnalyser() {
        return { fftSize: 0, connect() {}, disconnect() {} };
      }
      createGain() {
        return { gain: { value: 1 }, connect() {}, disconnect() {} };
      }
      resume() {
        return new Promise<void>((resolve) => {
          audit.resume = resolve;
        });
      }
      close() {
        audit.closed++;
        return Promise.resolve();
      }
    }
    Reflect.set(window, 'AudioContext', FakeAudioContext);
  });
  await page.goto('/?effect=audio-spectrum&playing=false');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.locator('#dom-audio').click();
  await page.locator('[data-effect="border-energy"]').click();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.evaluate(() => Reflect.get(window, 'audioAudit').resume());
  expect(
    await page.evaluate(() => {
      const { started, stopped, closed } = Reflect.get(window, 'audioAudit');
      return { started, stopped, closed };
    }),
  ).toEqual({ started: 0, stopped: 0, closed: 1 });
  expect(errors).toEqual([]);
  expect(await page.locator('#m5-stage-status').textContent()).toBe(
    'Full stage uses the selected effect.',
  );
});

test('Simulated reduced motion settles native CSS scroll animation and removes the HoloCSS transition', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/?effect=border-energy&mode=in-page&playing=true');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.locator('#motion').check();
  await expect(page.locator('#stage')).toHaveAttribute('data-reduced-motion', 'true');
  const scroll = page.locator('[data-demo-effect="scroll-scene"]');
  await scroll.scrollIntoViewIfNeeded();
  await expect
    .poll(() => scroll.evaluate((host) => getComputedStyle(host).animationName))
    .toBe('none');
  const settled = () =>
    page.evaluate(() => {
      const stage = Reflect.get(window.hologpu, 'domStage') as DOMStage;
      const scene = stage.fields.find((field) => field.effect.id === 'scroll-scene')!;
      return (
        scene.params['progress'] === 0 &&
        stage.fields.every(
          (field) =>
            field.reducedMotion &&
            !field.playing &&
            field.frame.time === field.effect.reducedMotion.time,
        )
      );
    });
  await expect.poll(settled).toBe(true);
  await page.locator('#dom-stage').evaluate((node) => {
    node.scrollTop = 0;
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(await settled()).toBe(true);
  const image = page.locator('[data-demo-effect="image-hover"]');
  expect(await image.evaluate((host) => getComputedStyle(host).transitionDuration)).toBe('0s');
  await page.locator('#motion').uncheck();
  expect(await image.evaluate((host) => getComputedStyle(host).transitionDuration)).not.toBe('0s');
});
