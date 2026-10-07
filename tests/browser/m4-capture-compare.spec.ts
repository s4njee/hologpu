import { test, expect } from '@playwright/test';
import type {} from './effects.spec.ts';
import { readFile } from 'node:fs/promises';

test('Compare keeps independent parameters and split in share links, rebuilds and disposes', async ({
  page,
}) => {
  await page.goto('/?effect=gradient-oklch&playing=false&mode=compare');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#compare-status')).toContainText('independent right parameters');
  expect(await page.evaluate(() => window.hologpu.field!.session.scheduler.surfaceCount)).toBe(2);
  const original = await page.evaluate(() => window.hologpu.field!.store.snapshot());
  await page.locator('#compare-param-spread').fill('1.4');
  await page.locator('#compare-split').evaluate((input: HTMLInputElement) => {
    input.value = '35';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(await page.evaluate(() => window.hologpu.field!.store.snapshot())).toEqual(original);
  expect(new URL(page.url()).searchParams.get('split')).toBe('35');
  await page.reload();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#compare-split')).toHaveValue('35');
  await expect(page.locator('#compare-param-spread')).toHaveValue('1.4');
  await page.locator('#compare-effect').selectOption('blur');
  await expect(page.locator('#compare-status')).toContainText('independent right parameters');
  await expect(page.locator('#compare-param-algorithm')).toBeVisible();
  expect(await page.evaluate(() => window.hologpu.field!.session.scheduler.surfaceCount)).toBe(2);
  await page.locator('#stage-mode').selectOption('full');
  await expect(page.locator('#compare-canvas')).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => window.hologpu.field!.session.scheduler.surfaceCount))
    .toBe(1);
});
test('PNG download contains exact canvas dimensions and video recording downloads playable frames', async ({
  page,
}, info) => {
  await page.goto('/?effect=gradient-oklch&playing=true');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  const size = await page.evaluate(() => [
    window.hologpu.field!.canvas.width,
    window.hologpu.field!.canvas.height,
  ]);
  const download = page.waitForEvent('download');
  await page.locator('#screenshot').click();
  const file = await download,
    path = await file.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  expect(Array.from(bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(bytes.readUInt32BE(16)).toBe(size[0]);
  expect(bytes.readUInt32BE(20)).toBe(size[1]);
  const supported = await page.evaluate(
    () =>
      typeof MediaRecorder !== 'undefined' &&
      ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/mp4', 'video/webm'].some((type) =>
        MediaRecorder.isTypeSupported(type),
      ),
  );
  test.skip(!supported, 'Engine has no canvas recording codec');
  await page.locator('#record').click();
  await expect(page.locator('#record')).toHaveText('Stop recording');
  const startIndex = await page.evaluate(() => window.hologpu.field!.frame.index);
  await expect
    .poll(() => page.evaluate(() => window.hologpu.field!.frame.index))
    .toBeGreaterThan(startIndex + 40);
  const videoDownload = page.waitForEvent('download');
  await page.locator('#record').click();
  const video = await videoDownload,
    videoPath = await video.path();
  const buffer = await readFile(videoPath!);
  expect(buffer.length).toBeGreaterThan(1000);
  const decoded = await page.evaluate(async (encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)),
      url = URL.createObjectURL(new Blob([bytes]));
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    document.body.append(video);
    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error('Recorded video cannot decode'));
      });
      // loadeddata exposes dimensions before the decoder presents readable pixels.
      await video.play();
      if (video.requestVideoFrameCallback)
        await new Promise<void>((resolve) => video.requestVideoFrameCallback(() => resolve()));
      else {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      }
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(video, 0, 0, 16, 16);
      const values = Array.from(ctx.getImageData(0, 0, 16, 16).data).filter((_, i) => i % 4 !== 3);
      const nonblank = Math.max(...values) - Math.min(...values) > 20;
      return {
        size: [video.videoWidth, video.videoHeight],
        nonblank,
        range: [Math.min(...values), Math.max(...values)],
      };
    } finally {
      video.pause();
      video.remove();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    }
  }, buffer.toString('base64'));
  await info.attach('canvas-recording', {
    path: videoPath!,
    contentType: video.suggestedFilename().endsWith('.mp4') ? 'video/mp4' : 'video/webm',
  });
  expect(decoded.size).toEqual(size);
  expect(decoded.nonblank, JSON.stringify(decoded)).toBe(true);
  await expect(page.locator('#record')).toHaveText('Record video');
});
