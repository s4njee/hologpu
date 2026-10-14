import { expect, test } from '@playwright/test';
import type { EffectField } from '../../packages/core/src/index.ts';

test('Typography selection and Compare clamp an inherited quarter-resolution preview', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?effect=aurora-veil&playing=false&quality=fixed&resolution=0.25');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  expect(await page.evaluate(() => window.hologpu.field!.effect.id)).toBe('aurora-veil');
  expect(await page.evaluate(() => window.hologpu.field!.effect.id)).toBe('aurora-veil');
  expect(await page.evaluate(() => window.hologpu.field!.surface!.resolutionScale)).toBe(0.25);

  await page.locator('#search').fill('text-shimmer');
  await page.locator('#effects [data-effect="text-shimmer"]').click();
  await expect
    .poll(() => page.evaluate(() => window.hologpu.field?.effect.id))
    .toBe('text-shimmer');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#resolution')).toHaveValue('1');
  expect(await page.evaluate(() => window.hologpu.field!.surface!.resolutionScale)).toBe(1);
  expect(
    await page
      .locator('#resolution')
      .evaluate((node: HTMLSelectElement) =>
        Array.from(node.options, (option) => ({ value: option.value, disabled: option.disabled })),
      ),
  ).toEqual([
    { value: '1', disabled: false },
    { value: '0.75', disabled: true },
    { value: '0.5', disabled: true },
    { value: '0.25', disabled: true },
  ]);
  await page.selectOption('#quality-tier', 'low');
  await expect(page.locator('#resolution')).toHaveValue('1');
  expect(await page.evaluate(() => window.hologpu.field!.surface!.resolutionScale)).toBe(1);

  await page.goto('/?effect=aurora-veil&playing=false&quality=fixed&resolution=0.25');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  expect(await page.evaluate(() => window.hologpu.field!.effect.id)).toBe('aurora-veil');
  await page.selectOption('#stage-mode', 'compare');
  await expect.poll(() => page.evaluate(() => window.hologpu.compareField?.state)).toBe('ready');
  await page.selectOption('#compare-effect', 'heading-reveal');
  await expect
    .poll(() => page.evaluate(() => window.hologpu.compareField?.effect.id))
    .toBe('heading-reveal');
  expect(
    await page.evaluate(() => ({
      primary: window.hologpu.field!.surface!.resolutionScale,
      comparison: window.hologpu.compareField!.surface!.resolutionScale,
      errors: window.hologpu.field!.session.errors,
    })),
  ).toEqual({ primary: 0.25, comparison: 1, errors: [] });
  await expect(page.locator('#compare-status')).toContainText('independent right parameters');
  expect(errors).toEqual([]);
});

test('In-page overlay retains a front heading canvas and aggregates the behind fields', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(
    '/?effect=heading-reveal&mode=in-page&overlay=true&playing=false&quality=fixed&resolution=0.25&params=' +
      encodeURIComponent(JSON.stringify({ progress: 0 })),
  );
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  const host = page.locator('#dom-stage [data-demo-effect="heading-reveal"]');
  await expect(host).toHaveAttribute('layer', 'front');
  await expect(host.locator('canvas')).toBeVisible();
  await expect(page.locator('canvas[data-overlay="research"]')).toBeVisible();
  const result = await page.evaluate(() => {
    const stage = (
      window.hologpu as typeof window.hologpu & {
        domStage: {
          hosts: HTMLElement[];
          fields: EffectField[];
          memory: { instances: number; presentationContexts: number };
          overlay: { sources: readonly { field: EffectField }[] } | null;
        };
      }
    ).domStage;
    const primary = window.hologpu.field!;
    const host = stage.hosts[0]!;
    const canvas = primary.canvas;
    const button = host.querySelector('button')!;
    const content = host.shadowRoot!.querySelector('.hgpu-content')!;
    return {
      instances: stage.memory.instances,
      contexts: stage.memory.presentationContexts,
      primaryIsFront: Boolean(primary.surface?.context),
      nativeCanvas: host.shadowRoot!.querySelector('canvas') === canvas,
      canvasAboveContent:
        Number(getComputedStyle(canvas).zIndex) > Number(getComputedStyle(content).zIndex),
      pointerEvents: getComputedStyle(canvas).pointerEvents,
      page: primary.store.snapshot()['page'],
      cardBackground: getComputedStyle(host).backgroundColor,
      buttonBackground: getComputedStyle(button).backgroundColor,
      scales: stage.fields.map((field) => field.surface!.resolutionScale),
      behindContexts: stage.fields.slice(1).map((field) => Boolean(field.surface?.context)),
      aggregateSources: stage.overlay!.sources.map(({ field }) => field.effect.id),
      errors: [...primary.session.errors],
    };
  });
  expect(result).toMatchObject({
    instances: 6,
    contexts: 2,
    primaryIsFront: true,
    nativeCanvas: true,
    canvasAboveContent: true,
    pointerEvents: 'none',
    page: '#162335',
    cardBackground: 'rgb(22, 35, 53)',
    buttonBackground: 'rgb(22, 35, 53)',
    behindContexts: [false, false, false, false, false],
    errors: [],
  });
  expect(result.scales[0]).toBe(1);
  expect(result.aggregateSources).toHaveLength(5);
  expect(result.aggregateSources).not.toContain('heading-reveal');
  const button = host.getByRole('button', { name: 'Focus or press me', exact: true });
  await button.click();
  await expect(host.getByRole('button')).toHaveText('Content remains interactive');
  await host.getByRole('button').focus();
  await expect(host.getByRole('button')).toBeFocused();
  await host.getByRole('button').press('Enter');
  await expect(host.getByRole('button')).toHaveText('Focus or press me');
  expect(errors).toEqual([]);
});
