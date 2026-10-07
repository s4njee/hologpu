import { test, expect } from '@playwright/test';
import type {} from './effects.spec.ts';
import { readFile } from 'node:fs/promises';

test('PNG preserves straight transparent color and composes the actual Compare split', async ({
  page,
}) => {
  await page.goto('/?effect=gradient-oklch&playing=false');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.evaluate(async () => {
    const api = window.hologpu;
    const definition = api.fragmentEffect({
      id: 'transparent-red',
      title: 'Transparent red',
      params: {},
      wgsl: 'fn effect(uv:vec2f)->vec4f{return vec4f(1,0,0,.5);}',
    });
    await api.mount(definition);
  });
  const download = page.waitForEvent('download');
  await page.locator('#screenshot').click();
  const file = await download,
    bytes = await readFile((await file.path())!);
  const pixel = await page.evaluate(async (encoded) => {
    const blob = new Blob([Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))]);
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, 1, 1);
    bitmap.close();
    return Array.from(ctx.getImageData(0, 0, 1, 1).data);
  }, bytes.toString('base64'));
  expect(pixel[0]).toBeGreaterThan(250);
  expect(pixel[1]).toBe(0);
  expect(pixel[2]).toBe(0);
  expect(pixel[3]).toBeGreaterThanOrEqual(127);
  expect(pixel[3]).toBeLessThanOrEqual(128);
  await page.evaluate(async () => {
    const api = window.hologpu;
    const definition = api.fragmentEffect({
      id: 'solid-red',
      title: 'Solid red',
      params: {},
      wgsl: 'fn effect(uv:vec2f)->vec4f{return vec4f(1,0,0,1);}',
    });
    await api.mount(definition);
  });
  await page.locator('#stage-mode').selectOption('compare');
  await page.locator('#compare-effect').selectOption('gradient-oklch');
  await expect(page.locator('#compare-status')).toContainText('independent right parameters');
  await page.evaluate(async () => {
    const right = window.hologpu.compareField!;
    right.store.patch({
      first: '#00ff0080',
      second: '#00ff0080',
      third: '#00ff0080',
      dither: false,
    });
    right.drawAt(0);
  });
  await page.locator('#compare-split').evaluate((input: HTMLInputElement) => {
    input.value = '50';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const secondDownload = page.waitForEvent('download');
  await page.locator('#screenshot').click();
  const second = await secondDownload,
    secondBytes = await readFile((await second.path())!);
  const sides = await page.evaluate(async (encoded) => {
    const bitmap = await createImageBitmap(
      new Blob([Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))]),
    );
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const result = [
      Array.from(
        ctx.getImageData(Math.floor(canvas.width * 0.25), Math.floor(canvas.height * 0.5), 1, 1)
          .data,
      ),
      Array.from(
        ctx.getImageData(Math.floor(canvas.width * 0.75), Math.floor(canvas.height * 0.5), 1, 1)
          .data,
      ),
    ];
    bitmap.close();
    return result;
  }, secondBytes.toString('base64'));
  expect(sides[0]).toEqual([255, 0, 0, 255]);
  expect(sides[1]![0]).toBeLessThan(4);
  expect(sides[1]![1]).toBeGreaterThan(250);
  expect(sides[1]![2]).toBeLessThan(4);
  expect(sides[1]![3]).toBeGreaterThanOrEqual(127);
  expect(sides[1]![3]).toBeLessThanOrEqual(128);
  expect(
    await page.locator('#canvas').evaluate((canvas) => (canvas as HTMLElement).style.clipPath),
  ).toBe('inset(0px 50% 0px 0px)');
});

test('a paused Compare filter shares changing canvas input, and stateful comparisons reset together', async ({
  page,
}) => {
  await page.goto('/?effect=blur&playing=false&mode=compare');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  const result = await page.evaluate(async () => {
    const left = window.hologpu.field!,
      right = window.hologpu.compareField!;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'red';
    ctx.fillRect(0, 0, 16, 16);
    await left.bindInput('image', { kind: 'canvas', source: canvas });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    right.drawAt(0);
    const first = await right.readPixels();
    ctx.fillStyle = 'blue';
    ctx.fillRect(0, 0, 16, 16);
    left.invalidate();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const second = await right.readPixels();
    return {
      first: Array.from(first.pixels.slice(0, 4)),
      second: Array.from(second.pixels.slice(0, 4)),
    };
  });
  expect(result.first[0]).toBeGreaterThan(250);
  expect(result.first[2]).toBeLessThan(5);
  expect(result.second[2]).toBeGreaterThan(250);
  expect(result.second[0]).toBeLessThan(5);
  await page.goto('/?effect=wave&playing=false');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.evaluate(() => window.hologpu.field!.advance(5));
  await page.locator('#stage-mode').selectOption('compare');
  await expect(page.locator('#compare-status')).toContainText('both previews reset');
  const indexes = await page.evaluate(() => [
    window.hologpu.field!.frame.index,
    window.hologpu.compareField!.frame.index,
  ]);
  expect(indexes).toEqual([0, 0]);
});

test('a failed recorder cannot corrupt a new recording or retain capture tracks', async ({
  page,
}) => {
  await page.goto('/?effect=gradient-oklch&playing=false');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves the local source module in this browser regression.
    const { VideoCapture } = await import('/src/capture.ts');
    const native = window.MediaRecorder;
    const nativeCapture = HTMLCanvasElement.prototype.captureStream;
    const records: {
      state: string;
      onstop: (() => void) | null;
      onerror: (() => void) | null;
      ondataavailable: ((e: { data: Blob }) => void) | null;
      stop(): void;
    }[] = [];
    let stoppedTracks = 0;
    class Recorder {
      static isTypeSupported() {
        return true;
      }
      state = 'inactive';
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      constructor() {
        records.push(this);
      }
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
      }
    }
    window.MediaRecorder = Recorder as unknown as typeof MediaRecorder;
    const changes: boolean[] = [];
    const capture = new VideoCapture((recording: boolean) => changes.push(recording));
    HTMLCanvasElement.prototype.captureStream = () =>
      ({
        getTracks: () => [{ stop: () => stoppedTracks++ }],
        getVideoTracks: () => [],
      }) as unknown as MediaStream;
    const field = window.hologpu.field!;
    try {
      await capture.start(field);
      const old = records[0]!,
        oldStop = old.onstop!,
        oldData = old.ondataavailable!;
      old.onerror!();
      await capture.start(field);
      oldData({ data: new Blob(['stale']) });
      oldStop();
      const intact = capture.recorder === records[1] && records[1]!.state === 'recording';
      capture.dispose();
      return {
        intact,
        changes,
        stoppedTracks,
        oldHandlersDetached:
          old.onstop === null && old.onerror === null && old.ondataavailable === null,
      };
    } finally {
      capture.dispose();
      window.MediaRecorder = native;
      HTMLCanvasElement.prototype.captureStream = nativeCapture;
    }
  });
  expect(result.intact).toBe(true);
  expect(result.stoppedTracks).toBe(2);
  expect(result.oldHandlersDetached).toBe(true);
  expect(result.changes).toEqual([true, false, true]);
});

test('stop and dispose cancel pending capture setup before a recorder or stream is created', async ({
  page,
}) => {
  await page.goto('/?effect=gradient-oklch&playing=false');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves the local source module in this browser regression.
    const { VideoCapture } = await import('/src/capture.ts');
    const native = window.MediaRecorder,
      field = window.hologpu.field!,
      ready = field.whenInputsReady;
    let constructed = 0;
    class Recorder extends native {
      static override isTypeSupported() {
        return true;
      }
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        constructed++;
        super(stream, options);
      }
    }
    window.MediaRecorder = Recorder;
    const changes: boolean[] = [];
    const capture = new VideoCapture((recording: boolean) => changes.push(recording));
    try {
      for (const action of ['stop', 'dispose'] as const) {
        let release!: () => void;
        field.whenInputsReady = () =>
          new Promise<void>((resolve) => {
            release = resolve;
          });
        const pending = capture.start(field);
        capture[action]();
        release();
        await pending;
      }
      return { constructed, changes, recorder: capture.recorder };
    } finally {
      capture.dispose();
      field.whenInputsReady = ready;
      window.MediaRecorder = native;
    }
  });
  expect(result.constructed).toBe(0);
  expect(result.recorder).toBeNull();
  expect(result.changes).toEqual([false]);
});
