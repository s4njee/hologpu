import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const core = '/@fs' + fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url));
const dom = '/@fs' + fileURLToPath(new URL('../../packages/dom/src/index.ts', import.meta.url));
const overlay =
  '/@fs' + fileURLToPath(new URL('../../apps/playground/src/overlay.ts', import.meta.url));

test('overlay presentation respects host borders, elliptical overflow corners and scrolling ancestor clips', async ({
  page,
}) => {
  await page.route('**/__m5_overlay_pixels', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><title>Overlay pixels</title><style>
      body{margin:0;background:#080808}#clip{position:absolute;left:30px;top:30px;width:420px;height:320px;overflow:hidden;background:#111}
      .host{position:absolute;box-sizing:border-box;background:#151515;overflow:hidden}
      #rounded{left:40px;top:50px;width:180px;height:140px;border:6px solid #801010;border-radius:36px 20px 50px 12px / 24px 40px 16px 30px}
      #padded{left:250px;top:50px;width:150px;height:140px;padding:12px;border:6px solid #801010}
      #bleed{left:70px;top:260px;width:80px;height:60px;overflow:visible}
      h4{margin:23px 0 0}button{position:relative;z-index:5}#spacer{height:520px}
    </style><div id="clip"><div id="spacer"></div><section id="rounded" class="host"><h4>Rounded host</h4><button>Action</button></section><section id="padded" class="host"><h4>Padded host</h4></section><section id="bleed" class="host"></section></div>`,
    }),
  );
  await page.goto('/__m5_overlay_pixels');
  const initial = await page.evaluate(
    async ({ core, dom, overlay }) => {
      const { fragmentEffect } = (await import(
        core
      )) as typeof import('../../packages/core/src/index.ts');
      const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
      const { OverlayRenderer } = (await import(
        overlay
      )) as typeof import('../../apps/playground/src/overlay.ts');
      const effect = fragmentEffect({
        id: 'overlay-solid',
        title: 'Solid pixels',
        params: {},
        wgsl: 'fn effect(uv:vec2f)->vec4f{return vec4f(0,1,0,1);}',
      });
      const clip = document.getElementById('clip')!;
      const attachments = [];
      for (const id of ['rounded', 'padded', 'bleed']) {
        const host = document.getElementById(id)!;
        const a = await attach(host, effect, {
          present: false,
          playing: false,
          adaptiveQuality: false,
        });
        if (id !== 'padded')
          a.canvas.style.cssText =
            'left:-24px;top:-16px;width:calc(100% + 48px);height:calc(100% + 32px)';
        attachments.push(a);
      }
      const presentation = await OverlayRenderer.create(
        attachments.map((a) => ({ host: a.host, field: a.field!, clip })),
      );
      const button = document.querySelector('button')!;
      button.onclick = () => {
        button.textContent = 'Clicked';
      };
      Reflect.set(window, '__overlayPixels', { presentation, attachments });
      const padded = attachments[1]!,
        h = padded.host.getBoundingClientRect(),
        c = padded.canvas.getBoundingClientRect();
      return {
        offset: [c.left - h.left, c.top - h.top],
        sourceContexts: attachments.filter((a) => !!a.field!.surface?.context).length,
        overlayContexts: presentation.memory.contexts,
      };
    },
    { core, dom, overlay },
  );
  expect(initial.offset).toEqual([18, 18]);
  expect(initial.sourceContexts).toBe(0);
  expect(initial.overlayContexts).toBe(1);
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, '__overlayPixels').presentation.drawnRects.length),
    )
    .toBe(3);

  const inspect = async () => {
    const png = await page.screenshot({ animations: 'disabled' });
    return page.evaluate(async (encoded) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + encoded;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height).data;
      const scale = image.width / innerWidth;
      const green = (x: number, y: number) => {
        const p = (Math.floor(y * scale) * image.width + Math.floor(x * scale)) * 4;
        return pixels[p + 1]! > 200 && pixels[p]! < 60 && pixels[p + 2]! < 60;
      };
      const r = document.getElementById('rounded')!.getBoundingClientRect(),
        b = document.getElementById('bleed')!.getBoundingClientRect(),
        p = document.getElementById('padded')!.getBoundingClientRect(),
        clip = document.getElementById('clip')!.getBoundingClientRect();
      return {
        corners: [
          [r.left + 8, r.top + 8],
          [r.right - 8, r.top + 8],
          [r.right - 8, r.bottom - 8],
          [r.left + 8, r.bottom - 8],
        ].map(([x, y]) => green(x!, y!)),
        outside: [
          [r.left - 8, r.top + 70],
          [r.right + 8, r.top + 70],
          [r.left + 90, r.top - 8],
          [r.left + 90, r.bottom + 8],
          [r.left + 3, r.top + 70],
        ].map(([x, y]) => green(x!, y!)),
        center: green(r.left + 90, r.top + 90),
        paddedInside: green(p.left + 30, p.top + 90),
        paddedGap: green(p.left + 30, p.top + 12),
        visibleBleed: green(b.left - 12, b.top + 30),
        belowAncestor: green(b.left + 40, clip.bottom + 8),
        rectBufferBytes: Reflect.get(window, '__overlayPixels').presentation.memory.rectBufferBytes,
      };
    }, png.toString('base64'));
  };
  const expected = {
    corners: [false, false, false, false],
    outside: [false, false, false, false, false],
    center: true,
    paddedInside: true,
    paddedGap: false,
    visibleBleed: true,
    belowAncestor: false,
    rectBufferBytes: 192,
  };
  expect(await inspect()).toEqual(expected);
  await page.getByRole('button', { name: 'Action' }).click();
  await expect(page.getByRole('button')).toHaveText('Clicked');
  const before = await page.evaluate(
    () => Reflect.get(window, '__overlayPixels').presentation.drawnRects[0].top,
  );
  await page.locator('#clip').evaluate((node) => {
    node.scrollTop = 35;
  });
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, '__overlayPixels').presentation.drawnRects[0].top),
    )
    .toBe(before - 35);
  expect(await inspect()).toEqual(expected);
  await page.evaluate(() => {
    const state = Reflect.get(window, '__overlayPixels');
    state.presentation.destroy();
    for (const attachment of state.attachments) attachment.destroy();
  });
  await expect(page.locator('canvas[data-overlay]')).toHaveCount(0);
});
