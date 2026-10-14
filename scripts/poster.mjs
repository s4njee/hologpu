import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [id, preset = 'default', dimensions = '640x400', destination] = process.argv.slice(2);
const match = /^(\d+)x(\d+)$/.exec(dimensions);
if (
  !id ||
  !/^[a-z][a-z0-9-]*$/.test(id) ||
  !match ||
  Math.max(Number(match[1]), Number(match[2])) > 4096 ||
  Math.min(Number(match[1]), Number(match[2])) < 1
)
  throw new Error(
    'Usage: node scripts/poster.mjs <effect> [preset|default] [640x400] [output.png|output.webp] (requires pnpm dev)',
  );
const root = path.resolve(import.meta.dirname, '..');
const output = path.resolve(
  root,
  destination ??
    `packages/effects/src/${id}/${preset === 'default' ? 'poster' : `poster-${preset}`}.png`,
);
const extension = path.extname(output).toLowerCase();
if (!['.png', '.webp'].includes(extension)) throw new Error('Poster output must be PNG or WebP');
const mime = extension === '.webp' ? 'image/webp' : 'image/png';
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader'],
});
try {
  const page = await browser.newPage({
    viewport: { width: Number(match[1]), height: Number(match[2]) },
    deviceScaleFactor: 1,
  });
  const base = process.env.HOLOGPU_URL ?? 'http://127.0.0.1:5175';
  await page.route('**/__poster', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><style>body{margin:0}canvas{width:100vw;height:100vh}</style><canvas></canvas>',
    }),
  );
  await page.goto(`${base}/__poster`);
  const encoded = await page.evaluate(
    async ({ id, preset, root, mime }) => {
      const core = await import(`/@fs${root}/packages/core/src/index.ts`);
      const { default: effect } = await import(`/@fs${root}/packages/effects/src/${id}/index.ts`);
      if (preset !== 'default' && !effect.presets[preset])
        throw new Error('Unknown preset: ' + preset);
      const field = await core.createEffect(document.querySelector('canvas'), effect, {
        playing: false,
        reducedMotion: true,
        adaptiveQuality: false,
        resolutionScale: 1,
        seed: 7,
        preset: preset === 'default' ? undefined : preset,
      });
      try {
        field.drawAt(effect.reducedMotion.time, 7);
        const read = await field.readPixels();
        const pixels = new Uint8ClampedArray(read.pixels);
        for (let i = 0; i < pixels.length; i += 4) {
          const alpha = pixels[i + 3];
          for (let c = 0; c < 3; c++)
            pixels[i + c] = alpha ? Math.round((pixels[i + c] * 255) / alpha) : 0;
        }
        const canvas = document.createElement('canvas');
        canvas.width = read.width;
        canvas.height = read.height;
        canvas.getContext('2d').putImageData(new ImageData(pixels, read.width, read.height), 0, 0);
        if (field.session.errors.length) throw new Error(field.session.errors.join('\n'));
        const url = canvas.toDataURL(mime, 0.9);
        if (!url.startsWith(`data:${mime};`)) throw new Error('Browser cannot encode ' + mime);
        return url.split(',')[1];
      } finally {
        field.destroy();
      }
    },
    { id, preset, root, mime },
  );
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, Buffer.from(encoded, 'base64'));
  console.log(pathToFileURL(output).href);
} finally {
  await browser.close();
}
