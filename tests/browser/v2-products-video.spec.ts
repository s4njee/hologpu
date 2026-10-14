import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const core = '/@fs' + fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url));
const inputs =
  '/@fs' + fileURLToPath(new URL('../../packages/core/src/inputs.ts', import.meta.url));
const recipes =
  '/@fs' + fileURLToPath(new URL('../../packages/hologpu/src/recipes.ts', import.meta.url));

test('hidden native 720p video refreshes a paused field when frame callbacks stop, without duplicate uploads or callback chains', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.route('**/__v2_products_video', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><style>body{margin:0}canvas,video{width:1280px;height:720px}video{position:absolute;inset:0;visibility:hidden}</style><canvas></canvas><video muted playsinline></video>',
    }),
  );
  await page.goto('/__v2_products_video');
  const result = await page.evaluate(
    async ({ core, inputs, recipes }) => {
      const api = (await import(core)) as typeof import('../../packages/core/src/index.ts');
      const { inputSRGBToLinear } = (await import(
        inputs
      )) as typeof import('../../packages/core/src/inputs.ts');
      const { heroVideoGrade } = (await import(
        recipes
      )) as typeof import('../../packages/hologpu/src/recipes.ts');
      const video = document.querySelector('video')!;
      const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
      const until = async (predicate: () => boolean, message: string) => {
        const end = performance.now() + 15_000;
        while (!predicate()) {
          if (performance.now() > end) throw new Error(message);
          await sleep(10);
        }
      };
      let registrations = 0,
        cancellations = 0;
      let withheld!: VideoFrameRequestCallback;
      Object.defineProperty(video, 'requestVideoFrameCallback', {
        value: (callback: VideoFrameRequestCallback) => {
          registrations++;
          withheld = callback;
          return 73;
        },
      });
      Object.defineProperty(video, 'cancelVideoFrameCallback', {
        value: (id: number) => {
          if (id !== 73) throw new Error('Cancelled a different callback chain');
          cancellations++;
        },
      });
      const listeners = new Set<EventListenerOrEventListenerObject>();
      const add = video.addEventListener.bind(video),
        remove = video.removeEventListener.bind(video);
      video.addEventListener = ((
        name: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ) => {
        if (name === 'timeupdate') listeners.add(listener);
        add(name, listener, options);
      }) as typeof video.addEventListener;
      video.removeEventListener = ((
        name: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions,
      ) => {
        if (name === 'timeupdate') listeners.delete(listener);
        remove(name, listener, options);
      }) as typeof video.removeEventListener;
      video.src = '/media/products/hero-720p.mp4';
      video.preload = 'auto';
      await until(() => video.readyState >= 2 || video.error !== null, '720p video did not decode');
      if (video.error) throw new Error(`720p video decode failed: ${video.error.message}`);
      if (video.videoWidth !== 1280 || video.videoHeight !== 720)
        throw new Error('Expected the native 720p fixture');
      const field = await api.createEffect(document.querySelector('canvas')!, heroVideoGrade, {
        playing: false,
        reducedMotion: false,
        adaptiveQuality: false,
        dprCap: 1,
        params: { s0_exposure: 0, s1_intensity: 0 },
      });
      let renders = 0;
      field.onRendered(() => renders++);
      const version = () => field.textureTaps['input:image']?.version ?? 0;
      const reference = document.createElement('canvas');
      reference.width = 1280;
      reference.height = 720;
      const context = reference.getContext('2d')!;
      let finalReference: Uint8ClampedArray | undefined,
        finalVersion = 0,
        finalTime = 0;
      // Registered before the manager's backup, so the final native event freezes
      // one decoded frame before both Canvas2D and GPU normalization consume it.
      const freeze = () => {
        if (video.currentTime < 1 || finalReference) return;
        video.pause();
        finalTime = video.currentTime;
        finalVersion = version();
        context.drawImage(video, 0, 0);
        finalReference = context.getImageData(0, 0, 1280, 720).data;
      };
      video.addEventListener('timeupdate', freeze);
      try {
        await field.bindInput('image', { kind: 'video', source: video });
        await until(() => version() > 0 && !field.dirty, 'Initial paused field did not render');
        await field.session.device.queue.onSubmittedWorkDone();
        const initialVersion = version(),
          initial = await api.readTextureTap(field.session.device, field.output!);
        const started = performance.now();
        await video.play();
        await until(
          () => finalReference !== undefined,
          'Native timeupdate did not advance the hidden clip',
        );
        await until(
          () => version() > finalVersion && !field.dirty,
          'Stalled VFC did not refresh the paused field automatically',
        );
        await field.session.device.queue.onSubmittedWorkDone();
        // Firefox may finish exposing an already-decoded frame after pause().
        // Wait for the paused Canvas pixels to settle before comparing output.
        const immediateReference = finalReference!;
        let stable = 0;
        await until(() => {
          context.drawImage(video, 0, 0);
          const next = context.getImageData(0, 0, 1280, 720).data;
          let same = true;
          for (let i = 0; i < next.length; i += 17)
            if (next[i] !== finalReference![i]) {
              same = false;
              break;
            }
          stable = same ? stable + 1 : 0;
          finalReference = next;
          return stable >= 3;
        }, 'Paused decoded Canvas frame did not settle');
        const current = await api.readTextureTap(field.session.device, field.output!);
        if (current.width !== 1280 || current.height !== 720)
          throw new Error('Output must match decoded Canvas2D reference dimensions');
        let fullFrameMaxError = 0,
          changed = 0,
          count = 0;
        let worst: { pixel: number; channel: number; gpu: number; encoded: number } | undefined;
        for (let pixel = 0; pixel < 1280 * 720; pixel += 17) {
          for (let channel = 0; channel < 3; channel++) {
            const offset = pixel * 4 + channel;
            const error = Math.abs(
              current.values[offset]! - inputSRGBToLinear(finalReference![offset]! / 255),
            );
            if (error > fullFrameMaxError) {
              fullFrameMaxError = error;
              worst = {
                pixel,
                channel,
                gpu: current.values[offset]!,
                encoded: finalReference![offset]!,
              };
            }
            changed += Math.abs(current.values[offset]! - initial.values[offset]!);
            count++;
          }
        }
        const refreshedVersion = version(),
          elapsed = performance.now() - started;
        let maxError = 0,
          patchRange = 0;
        const interior = [
          [100, 400],
          [400, 250],
          [800, 400],
          [850, 250],
        ].map(([x, y]) => {
          const offset = (y! * 1280 + x!) * 4;
          for (let channel = 0; channel < 3; channel++) {
            let low = 255,
              high = 0;
            for (let dy = -2; dy <= 2; dy++)
              for (let dx = -2; dx <= 2; dx++) {
                const i = ((y! + dy) * 1280 + x! + dx) * 4 + channel;
                low = Math.min(low, finalReference![i]!);
                high = Math.max(high, finalReference![i]!);
                maxError = Math.max(
                  maxError,
                  Math.abs(current.values[i]! - inputSRGBToLinear(finalReference![i]! / 255)),
                );
              }
            patchRange = Math.max(patchRange, high - low);
          }
          return {
            x,
            y,
            gpu: Array.from(current.values.slice(offset, offset + 4)),
            encoded: Array.from(finalReference!.slice(offset, offset + 4)),
          };
        });
        let referenceChange = 0;
        for (let i = 0; i < finalReference!.length; i += 17)
          referenceChange = Math.max(
            referenceChange,
            Math.abs(immediateReference[i]! - finalReference![i]!),
          );
        const mediaPath = field.inputMediaPath;
        // These events carry exactly the same paused decoded frame. Waiting past
        // the rate bound must not turn them into redundant uploads.
        for (let i = 0; i < 5; i++) {
          await sleep(120);
          video.dispatchEvent(new Event('timeupdate'));
        }
        await field.session.device.queue.onSubmittedWorkDone();
        const unchangedVersion = version(),
          listenersBeforeDestroy = listeners.size;
        await video.play();
        const beforeDestroy = renders;
        field.destroy();
        const callerPlaying = !video.paused;
        // A callback already queued by the browser must be harmless after cleanup.
        withheld(performance.now(), {} as VideoFrameCallbackMetadata);
        video.dispatchEvent(new Event('timeupdate'));
        await sleep(150);
        return {
          finalTime,
          initialVersion,
          refreshedVersion,
          unchangedVersion,
          elapsed,
          maxError,
          fullFrameMaxError,
          patchRange,
          meanChange: changed / count,
          worst,
          interior,
          referenceChange,
          mediaPath,
          registrations,
          cancellations,
          listenersBeforeDestroy,
          listenersAfterDestroy: listeners.size,
          callerPlaying,
          rendersAfterDestroy: renders - beforeDestroy,
          playing: field.playing,
          frameTime: field.frame.time,
          errors: [...field.session.errors],
        };
      } finally {
        field.destroy();
        video.removeEventListener('timeupdate', freeze);
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    },
    { core, inputs, recipes },
  );
  await test.info().attach('video-refresh-measurements', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  expect(result.finalTime).toBeGreaterThanOrEqual(1);
  expect(result.refreshedVersion - result.initialVersion).toBeGreaterThanOrEqual(2);
  expect(result.refreshedVersion - result.initialVersion).toBeLessThanOrEqual(
    Math.ceil(result.elapsed / 100) + 1,
  );
  expect(result.unchangedVersion).toBe(result.refreshedVersion);
  expect(result.maxError).toBeLessThan(0.035);
  // Fixed authored card/background patches must remain uniform interiors.
  // Text-edge chroma reconstruction and out-of-range SDR overshoot are diagnostic.
  expect(result.patchRange).toBeLessThanOrEqual(3);
  expect(result.meanChange).toBeGreaterThan(0.0001);
  expect(result.registrations).toBe(1);
  expect(result.cancellations).toBe(1);
  expect(result.listenersBeforeDestroy).toBe(2);
  expect(result.listenersAfterDestroy).toBe(1);
  expect(result.callerPlaying).toBe(true);
  expect(result.rendersAfterDestroy).toBe(0);
  expect(result.playing).toBe(false);
  expect(result.frameTime).toBe(0);
  expect(result.errors).toEqual([]);
});
