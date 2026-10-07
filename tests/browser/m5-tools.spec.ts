import { test, expect } from '@playwright/test';
import type { HGPUFieldElement } from '../../packages/dom/src/element.ts';
import type {} from './effects.spec.ts';

async function start(page: import('@playwright/test').Page, mode = 'in-page', extra = '') {
  await page.routeWebSocket(/.*/, (socket) => socket.close());
  await page.goto(`/?effect=border-energy&mode=${mode}&playing=false&quality=fixed${extra}`);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
}
test('In page has six accessible custom elements, a shared device, CSS transitions and a real view timeline', async ({
  page,
}) => {
  await start(page);
  await expect(page.locator('#dom-stage hgpu-field')).toHaveCount(6);
  const initial = await page.locator('#dom-stage hgpu-field').evaluateAll((nodes) =>
    nodes.map((node) => {
      const a = (node as HGPUFieldElement).attachment!;
      return {
        state: a.state,
        shadow: !!node.shadowRoot,
        canvasHidden: a.canvas.getAttribute('aria-hidden'),
        clickThrough: getComputedStyle(a.canvas).pointerEvents,
        step: a.field!.frame.index,
        clients: a.field!.session.clients,
      };
    }),
  );
  expect(
    initial.every(
      (x) =>
        x.state === 'ready' &&
        x.shadow &&
        x.canvasHidden === 'true' &&
        x.clickThrough === 'none' &&
        x.clients === 6,
    ),
  ).toBe(true);
  const button = page.locator('#dom-stage hgpu-field').first().getByRole('button');
  await button.click();
  await expect(button).toHaveText('Content remains interactive');
  const image = page.locator('[data-demo-effect="image-hover"]');
  await image.scrollIntoViewIfNeeded();
  await image.getByRole('checkbox', { name: 'HoloCSS image transition' }).check();
  await expect
    .poll(() => image.evaluate((node) => (node as HGPUFieldElement).attachment!.params['progress']))
    .toBe(1);
  const scroll = page.locator('[data-demo-effect="scroll-scene"]');
  await scroll.scrollIntoViewIfNeeded();
  const a = await scroll.evaluate((node) => ({
    p: Number((node as HGPUFieldElement).attachment!.params['progress']),
    css: CSS.supports('animation-timeline', 'view()'),
    animation: getComputedStyle(node).animationTimeline,
  }));
  await page.locator('#dom-stage').evaluate((node) => (node.scrollTop = node.scrollHeight));
  await expect
    .poll(() =>
      scroll.evaluate((node) => Number((node as HGPUFieldElement).attachment!.params['progress'])),
    )
    .not.toBe(a.p);
  if (a.css) expect(a.animation).toContain('view(');
  expect(
    await page
      .locator('#dom-stage hgpu-field')
      .evaluateAll((nodes) =>
        nodes.every((node) => (node as HGPUFieldElement).attachment!.field!.frame.index === 0),
      ),
  ).toBe(true);
  await page.locator('#stage-mode').selectOption('full');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#dom-stage')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.hologpu.field!.session.scheduler.surfaceCount))
    .toBe(1);
});
test('Grid conditions, transport, share links and teardown apply to actual copies', async ({
  page,
}) => {
  await start(page, 'grid', '&copies=12');
  await expect(page.locator('#dom-stage hgpu-field')).toHaveCount(12);
  await page.locator('#quality-tier').selectOption('low');
  expect(
    await page
      .locator('#dom-stage hgpu-field')
      .evaluateAll((nodes) =>
        nodes.every(
          (node) => (node as HGPUFieldElement).attachment!.field!.surface!.resolutionScale === 0.25,
        ),
      ),
  ).toBe(true);
  await page.locator('#seed').fill('13');
  await page.locator('#seed').dispatchEvent('change');
  expect(
    await page
      .locator('#dom-stage hgpu-field')
      .evaluateAll((nodes) =>
        nodes.every((node) => (node as HGPUFieldElement).attachment!.field!.frame.seed === 13),
      ),
  ).toBe(true);
  await page.locator('#play').click();
  await page.locator('#dom-stage').scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      page.locator('#dom-stage hgpu-field').evaluateAll(
        (nodes) =>
          nodes.some((node) => (node as HGPUFieldElement).attachment!.field!.visible) &&
          nodes.every((node) => {
            const f = (node as HGPUFieldElement).attachment!.field!;
            return !f.visible || f.frame.index > 0;
          }),
      ),
    )
    .toBe(true);
  await page.locator('#play').click();
  const url = new URL(page.url());
  expect(url.searchParams.get('copies')).toBe('12');
  expect(url.searchParams.get('tier')).toBe('low');
  await page.locator('#force-fallback').check();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'fallback');
  await expect(page.locator('#dom-stage hgpu-field[data-hgpu-state="fallback"]')).toHaveCount(12);
  const content = page.locator('#dom-stage hgpu-field').first().getByRole('button');
  await content.click();
  await expect(content).toHaveText('Content remains interactive');
  await page.locator('#force-fallback').uncheck();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.locator('#stage-mode').selectOption('full');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await expect.poll(() => page.evaluate(() => window.hologpu.field!.session.clients)).toBe(1);
});
test('Overlay uses one actual GPUCanvasContext with float-only source fields and clipped viewport draws', async ({
  page,
}) => {
  await start(page, 'grid', '&copies=6&overlay=true');
  await expect(page.locator('canvas[data-overlay="research"]')).toHaveCount(1);
  const memory = await page.evaluate(() => Reflect.get(window.hologpu, 'domStage').memory);
  expect(memory.presentationContexts).toBe(1);
  expect(memory.instances).toBe(6);
  expect(memory.overlay.sourceFloatBytes).toBeGreaterThan(0);
  // Source fields own float targets and never request a canvas presentation context.
  expect(
    await page.evaluate(() =>
      Reflect.get(window.hologpu, 'domStage').fields.every(
        (field: import('../../packages/core/src/index.ts').EffectField) =>
          field.surface!.context === null,
      ),
    ),
  ).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window.hologpu, 'domStage').overlay.drawnRects.length),
    )
    .toBeGreaterThan(0);
  // Authored padding changes the source canvas box without changing the host's outer box.
  await page
    .locator('#dom-stage .m5-card')
    .first()
    .evaluate((host: HTMLElement) => {
      host.style.padding = '16px';
      host.style.borderWidth = '3px';
    });
  const aligned = () =>
    page.evaluate(() => {
      const stage = Reflect.get(window.hologpu, 'domStage');
      const canvases = stage.fields.map(
        (field: import('../../packages/core/src/index.ts').EffectField) =>
          field.canvas.getBoundingClientRect(),
      );
      return (
        stage.overlay.drawnRects.length > 0 &&
        stage.overlay.drawnRects.every(
          (drawn: { left: number; top: number; width: number; height: number }) =>
            canvases.some((box: DOMRect) =>
              ['left', 'top', 'width', 'height'].every(
                (key) => Math.abs(Reflect.get(drawn, key) - Reflect.get(box, key)) < 0.01,
              ),
            ),
        )
      );
    });
  await expect.poll(aligned).toBe(true);
  await page.locator('#dom-stage').evaluate((node) => (node.scrollTop = 100));
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window.hologpu, 'domStage').overlay.drawnRects[0]?.top),
    )
    .not.toBeUndefined();
  await expect.poll(aligned).toBe(true);
  expect(await page.evaluate(() => window.hologpu.field!.session.errors)).toEqual([]);
  await page.locator('#stage-mode').selectOption('full');
  await expect(page.locator('canvas[data-overlay="research"]')).toHaveCount(0);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await expect
    .poll(() => page.evaluate(() => window.hologpu.field!.session.scheduler.surfaceCount))
    .toBe(1);
});
