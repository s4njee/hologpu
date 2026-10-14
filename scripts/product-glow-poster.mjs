import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 600, height: 375 } });
  await page.route('**/__product_glow', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><style>body{margin:0}canvas{width:600px;height:375px}</style><canvas></canvas>',
    }),
  );
  await page.goto(`${process.env.HOLOGPU_URL ?? 'http://127.0.0.1:5175'}/__product_glow`);
  const png = await page.evaluate(async (root) => {
    const { createEffect, chain } = await import(`/@fs${root}/packages/core/src/index.ts`);
    const bright = (await import(`/@fs${root}/packages/effects/src/bright-pass/index.ts`)).default;
    const bloom = (await import(`/@fs${root}/packages/effects/src/bloom/index.ts`)).default;
    const image = new Image();
    image.src = '/media/products/screenshot.png';
    await image.decode();
    const field = await createEffect(document.querySelector('canvas'), chain(bright, bloom), {
      playing: false,
      reducedMotion: true,
      resolutionScale: 0.5,
      adaptiveQuality: false,
      seed: 7,
      params: {
        s0_threshold: 0.55,
        s0_intensity: 0.25,
        s1_threshold: 0,
        s1_knee: 0,
        s1_strength: 0.45,
        s1_levels: 4,
      },
    });
    try {
      await field.bindInput('image', { kind: 'image', source: image });
      await field.bindInput('mask', {
        kind: 'mask',
        source: 'M260 207H1142V332H260Z M280 420H1120V608H280Z',
        width: 1200,
        height: 750,
      });
      field.drawAt(0, 7);
      const read = await field.readPixels();
      const pixels = new Uint8ClampedArray(read.pixels);
      for (let i = 0; i < pixels.length; i += 4)
        for (let c = 0; c < 3; c++)
          pixels[i + c] = pixels[i + 3] ? Math.round((pixels[i + c] * 255) / pixels[i + 3]) : 0;
      const canvas = document.createElement('canvas');
      canvas.width = read.width;
      canvas.height = read.height;
      canvas.getContext('2d').putImageData(new ImageData(pixels, read.width, read.height), 0, 0);
      if (field.session.errors.length) throw new Error(field.session.errors.join('\n'));
      return canvas.toDataURL('image/png').split(',')[1];
    } finally {
      field.destroy();
    }
  }, root);
  await writeFile(
    resolve(root, 'apps/playground/public/media/products/glow-overlay.png'),
    Buffer.from(png, 'base64'),
  );
} finally {
  await browser.close();
}
