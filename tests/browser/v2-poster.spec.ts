import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const dom = '/@fs' + fileURLToPath(new URL('../../packages/dom/src/index.ts', import.meta.url));
const dots =
  '/@fs' +
  fileURLToPath(new URL('../../packages/effects/src/dot-matrix-field/index.ts', import.meta.url));

test('poster replacement and failure preserve one fallback layer and authored controls', async ({
  page,
}) => {
  await page.route('**/__v2_poster', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><div id="hero" style="width:192px;height:144px"><button>Try the product</button></div>',
    }),
  );
  await page.route('**/missing-poster.png', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto('/__v2_poster');
  const result = await page.evaluate(
    async ({ dom, dots }) => {
      const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
      const { default: effect } = (await import(
        dots
      )) as typeof import('../../packages/effects/src/dot-matrix-field/index.ts');
      const host = document.getElementById('hero')!;
      const attached = await attach(host, effect, { forceFallback: true });
      const img = host.shadowRoot!.querySelector('img')!;
      const wrapper = host.shadowRoot!.querySelector('.hgpu-wrap')!;
      await img.decode();
      await new Promise(requestAnimationFrame);
      const initial = getComputedStyle(wrapper).backgroundImage;
      const failedLoad = new Promise<void>((resolve) =>
        img.addEventListener('error', () => resolve(), { once: true }),
      );
      attached.setPoster('/missing-poster.png');
      await failedLoad;
      await new Promise(requestAnimationFrame);
      const failed = getComputedStyle(wrapper).backgroundImage;
      const restoredLoad = new Promise<void>((resolve) =>
        img.addEventListener('load', () => resolve(), { once: true }),
      );
      attached.setPoster(effect.poster);
      await restoredLoad;
      await new Promise(requestAnimationFrame);
      const restored = getComputedStyle(wrapper).backgroundImage;
      attached.setPoster(undefined);
      const removed = getComputedStyle(wrapper).backgroundImage;
      const hidden = img.hidden;
      attached.destroy();
      return { initial, failed, restored, removed, hidden, text: host.textContent };
    },
    { dom, dots },
  );
  expect(result.initial).toBe('none');
  expect(result.failed).toContain('radial-gradient');
  expect(result.restored).toBe('none');
  expect(result.removed).toContain('radial-gradient');
  expect(result.hidden).toBe(true);
  expect(result.text).toBe('Try the product');
  await page.getByRole('button', { name: 'Try the product' }).focus();
  await expect(page.getByRole('button')).toBeFocused();
});
