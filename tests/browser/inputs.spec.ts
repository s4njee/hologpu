import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const corePath =
  '/@fs' + fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url));
const inputsPath =
  '/@fs' + fileURLToPath(new URL('../../packages/core/src/inputs.ts', import.meta.url));
const readPath =
  '/@fs' + fileURLToPath(new URL('../../packages/core/src/texture-readback.ts', import.meta.url));
async function harness(page: Page) {
  await page.route('**/__inputs_harness', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Texture inputs</title><button>Activate media</button>',
    }),
  );
  await page.goto('/__inputs_harness');
}
for (const scenario of ['image', 'canvas', 'text', 'audio', 'texture', 'video', 'data'] as const) {
  test(`Texture input ${scenario} normalizes actual GPU data and preserves caller ownership`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await harness(page);
    const result = await page.evaluate(
      async ({ corePath, inputsPath, readPath, scenario }) => {
        const { acquireDevice } = (await import(
          corePath
        )) as typeof import('../../packages/core/src/index.ts');
        const { InputManager, inputTextureBytes, inputSRGBToLinear } = (await import(
          inputsPath
        )) as typeof import('../../packages/core/src/inputs.ts');
        const { readTextureTap } = (await import(
          readPath
        )) as typeof import('../../packages/core/src/texture-readback.ts');
        const { session, release } = await acquireDevice();
        const device = session.device;
        let changes = 0;
        const manager = new InputManager(session, () => changes++);
        const frame = {} as import('../../packages/core/src/effect.ts').FrameInfo;
        const prepare = async () => {
          const e = device.createCommandEncoder();
          manager.prepare(frame, e);
          session.submitEncoder(e);
          await device.queue.onSubmittedWorkDone();
          if (session.errors.length) throw new Error(session.errors.join('\n'));
        };
        const read = async (name = 'source') =>
          Array.from((await readTextureTap(device, manager.get(name)!)).values);
        const check = (actual: number[], expected: number[], epsilon = 0.002) => {
          if (actual.length !== expected.length) throw new Error('Length mismatch');
          actual.forEach((v, i) => {
            if (!Number.isFinite(v) || Math.abs(v - expected[i]!) > epsilon)
              throw new Error(`channel ${i}: ${v} != ${expected[i]}`);
          });
        };
        const canvas = (w: number, h: number) => new OffscreenCanvas(w, h);
        let cases = 0;
        try {
          if (scenario === 'image') {
            const c = canvas(2, 2),
              ctx = c.getContext('2d')!;
            ctx.putImageData(
              new ImageData(
                new Uint8ClampedArray([
                  128, 64, 255, 128, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 0,
                ]),
                2,
                2,
              ),
              0,
              0,
            );
            const bytes = ctx.getImageData(0, 0, 2, 2).data;
            const expected = Array.from(bytes).map((v, i) =>
              i % 4 === 3 ? v / 255 : inputSRGBToLinear(v / 255) * (bytes[(i >> 2) * 4 + 3]! / 255),
            );
            const bitmap = await createImageBitmap(c);
            await manager.set('source', { kind: 'image', source: bitmap });
            bitmap.close();
            await prepare();
            check(await read(), expected);
            cases++;
            const mip = manager.taps()['source:mip-1']!;
            const values = Array.from((await readTextureTap(device, mip)).values);
            check(
              values,
              [0, 1, 2, 3].map(
                (i) => [0, 1, 2, 3].reduce((sum, p) => sum + expected[p * 4 + i]!, 0) / 4,
              ),
            );
            cases++;
            // Static snapshots retain exact pixels after caller disposal and after GPU resource rebuilding.
            await manager.restore();
            await prepare();
            check(await read(), expected);
            cases++;
            const image = new Image();
            image.src = '/media/sample.svg';
            await image.decode();
            await manager.set('asset', { kind: 'image', source: image });
            await prepare();
            if (manager.get('asset')?.width !== 960) throw new Error('SVG fixture was not decoded');
            cases++;
          }
          if (scenario === 'canvas') {
            const c = canvas(2, 1),
              ctx = c.getContext('2d')!;
            ctx.fillStyle = '#808080';
            ctx.fillRect(0, 0, 2, 1);
            await manager.set('source', { kind: 'canvas', source: c });
            await prepare();
            check(await read(), [
              inputSRGBToLinear(128 / 255),
              inputSRGBToLinear(128 / 255),
              inputSRGBToLinear(128 / 255),
              1,
              ...[
                inputSRGBToLinear(128 / 255),
                inputSRGBToLinear(128 / 255),
                inputSRGBToLinear(128 / 255),
                1,
              ],
            ]);
            cases++;
            ctx.fillStyle = 'red';
            ctx.fillRect(0, 0, 2, 1);
            await prepare();
            check(await read(), [1, 0, 0, 1, 1, 0, 0, 1]);
            cases++;
            c.width = 3;
            c.height = 2;
            ctx.fillStyle = 'lime';
            ctx.fillRect(0, 0, 3, 2);
            await prepare();
            check(await read(), Array.from({ length: 6 }, () => [0, 1, 0, 1]).flat());
            if (manager.memory().textureBytes !== inputTextureBytes(3, 2) + 3 * 2 * 4)
              throw new Error('Resize memory mismatch');
            cases++;
            await manager.set('source', null);
            if (manager.get('source') || manager.memory().textureBytes !== 0)
              throw new Error('Input deletion retained allocations');
            ctx.fillRect(0, 0, 3, 2);
            cases++;
          }
          if (scenario === 'text') {
            await manager.set('source', {
              kind: 'text',
              text: 'GPU',
              width: 128,
              height: 48,
              font: 'bold 32px sans-serif',
            });
            await prepare();
            const a = await read();
            if (
              !a.some((v, i) => i % 4 === 3 && v > 0.5) ||
              !a.some((v, i) => i % 4 === 3 && v === 0)
            )
              throw new Error('Text lacks opaque/transparent mask');
            a.forEach((v, i) => {
              if (i % 4 !== 3 && v !== a[(i >> 2) * 4 + 3])
                throw new Error('Text is not premultiplied white');
            });
            cases++;
            await manager.set('source', {
              kind: 'text',
              text: 'I',
              width: 128,
              height: 48,
              font: 'bold 32px sans-serif',
            });
            await prepare();
            if (JSON.stringify(a) === JSON.stringify(await read()))
              throw new Error('Text replacement unchanged');
            cases++;
          }
          if (scenario === 'audio') {
            const fft = new Float32Array([0, 0.25, 0.5, 1]),
              waveform = new Float32Array([-1, -0.5, 0.5, 1]);
            await manager.set('source', { kind: 'audio', fft, waveform });
            await prepare();
            check(
              await read(),
              [...fft, ...waveform].flatMap((v) => [v, 0, 0, 1]),
            );
            cases++;
            fft[1] = 0.75;
            await prepare();
            if (Math.abs((await read())[4]! - 0.75) > 0.001)
              throw new Error('Audio samples did not update');
            cases++;
            const context = new AudioContext();
            const analyser = context.createAnalyser();
            analyser.fftSize = 32;
            await manager.set('source', { kind: 'audio', analyser });
            await prepare();
            if (manager.get('source')?.width !== analyser.fftSize)
              throw new Error('Analyser waveform was truncated to FFT bin count');
            const silence = await read();
            if (silence.some((v, i) => i % 4 === 0 && Math.abs(v) > 0.001))
              throw new Error('Silent analyser has nonzero signal');
            // Populate actual analyser methods with deterministic full-length samples; padded FFT bins stay zero.
            analyser.getFloatFrequencyData = (values) => values.fill(-6.0205999);
            analyser.getFloatTimeDomainData = (values) => {
              for (let i = 0; i < values.length; i++)
                values[i] = (i / Math.max(1, values.length - 1)) * 2 - 1;
            };
            await prepare();
            const signals = await read();
            for (let i = 0; i < analyser.fftSize; i++) {
              const f = signals[i * 4]!,
                w = signals[(analyser.fftSize + i) * 4]!;
              if (
                Math.abs(f - (i < analyser.frequencyBinCount ? 0.5 : 0)) > 0.002 ||
                Math.abs(w - ((i / (analyser.fftSize - 1)) * 2 - 1)) > 0.002
              )
                throw new Error('FFT padding or full waveform upload differs');
            }
            cases++;
            manager.dispose();
            if (context.state === 'closed') throw new Error('Caller audio context was closed');
            analyser.disconnect();
            await context.close();
            cases++;
            const data = await (await fetch('/media/sample.wav')).arrayBuffer();
            const offline = new OfflineAudioContext(1, 16000, 16000);
            const decoded = await offline.decodeAudioData(data);
            if (
              decoded.duration < 0.99 ||
              !decoded.getChannelData(0).some((v) => Math.abs(v) > 0.05)
            )
              throw new Error('Audio fixture was not decoded');
            cases++;
          }
          if (scenario === 'texture') {
            const texture = device.createTexture({
              size: [2, 1],
              format: 'rgba32float',
              usage:
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.COPY_SRC |
                GPUTextureUsage.TEXTURE_BINDING,
            });
            const raw = new Float32Array([0.2, 0.1, 0.05, 0.5, 0.4, 0.3, 0.2, 1]);
            device.queue.writeTexture({ texture }, raw, { bytesPerRow: 32 }, [2, 1]);
            const tap = {
              texture,
              format: 'rgba32float' as const,
              width: 2,
              height: 1,
              kind: 'float' as const,
            };
            let provided: typeof tap | undefined = tap;
            await manager.set('source', { kind: 'texture', source: () => provided, session });
            await prepare();
            check(await read(), Array.from(raw));
            cases++;
            provided = undefined;
            if (manager.get('source') || manager.taps()['source'])
              throw new Error('Unavailable provider exposes a stale prepared copy');
            await prepare();
            provided = tap;
            await prepare();
            check(await read(), Array.from(raw));
            cases++;
            let rejected = false;
            try {
              await manager.set('wrong', {
                kind: 'texture',
                source: tap,
                session: {
                  device: {},
                } as import('../../packages/core/src/device.ts').DeviceSession,
              });
            } catch {
              rejected = true;
            }
            if (!rejected) throw new Error('Foreign-device texture accepted');
            cases++;
            for (const invalid of [
              { depthSlice: 0 },
              { width: 0 },
              { height: 2 },
              { mipLevel: 1 },
              { arrayLayer: 1 },
              { format: 'rgba32uint' as GPUTextureFormat },
            ]) {
              let rejected = false;
              try {
                await manager.set('invalid', {
                  kind: 'texture',
                  source: { ...tap, ...invalid },
                  session,
                });
              } catch {
                rejected = true;
              }
              if (!rejected) throw new Error('Invalid texture subresource was accepted');
            }
            cases++;
            manager.dispose();
            check(Array.from((await readTextureTap(device, tap)).values), Array.from(raw));
            texture.destroy();
            cases++;
          }
          if (scenario === 'data') {
            const data = new Float32Array([0.2, 0.1, 0, 0.5, 0.4, 0.3, 0.2, 1]);
            await manager.set('source', { kind: 'data', data, width: 2, height: 1 });
            data.fill(0);
            await prepare();
            check(await read(), [0.2, 0.1, 0, 0.5, 0.4, 0.3, 0.2, 1]);
            cases++;
            let rejected = 0;
            for (const invalid of [
              new Float32Array(2),
              new Float32Array([NaN, 0, 0, 1]),
              new Float32Array([Infinity, 0, 0, 1]),
            ]) {
              try {
                await manager.set('source', { kind: 'data', data: invalid, width: 1, height: 1 });
              } catch {
                rejected++;
              }
            }
            if (rejected !== 3) throw new Error('Invalid data upload accepted');
            await prepare();
            check(await read(), [0.2, 0.1, 0, 0.5, 0.4, 0.3, 0.2, 1]);
            cases++;
          }
          if (scenario === 'video') {
            const video = document.createElement('video');
            video.muted = true;
            video.playsInline = true;
            video.loop = true;
            video.src = video.canPlayType('video/mp4; codecs="avc1.42E01E"')
              ? '/media/sample-1080p60.mp4'
              : '/media/sample-1080p60.webm';
            document.body.append(video);
            await new Promise<void>((resolve, reject) => {
              video.onloadeddata = () => resolve();
              video.onerror = () => reject(new Error('Video fixture decode failed'));
            });
            await manager.set('source', { kind: 'video', source: video });
            await video.play();
            await new Promise<void>((resolve) => video.requestVideoFrameCallback(() => resolve()));
            await prepare();
            const initial = await read();
            if (
              manager.get('source')?.width !== 1920 ||
              manager.get('source')?.height !== 1080 ||
              !initial.some((v, i) => i % 4 !== 3 && v > 0.5)
            )
              throw new Error('Decoded video input is missing');
            cases++;
            const copy = canvas(1920, 1080),
              ctx = copy.getContext('2d')!;
            video.pause();
            // Two renders in the same decoded-frame task must encode normalization+mips only once.
            await manager.set('source', { kind: 'video', source: video });
            const repeat = device.createCommandEncoder(),
              begin = repeat.beginComputePass.bind(repeat);
            let passes = 0;
            repeat.beginComputePass = (descriptor) => {
              passes++;
              return begin(descriptor);
            };
            manager.prepare(frame, repeat);
            const firstPasses = passes;
            manager.prepare(frame, repeat);
            if (firstPasses < 1 || passes !== firstPasses)
              throw new Error('A repeated video frame was uploaded twice');
            session.submitEncoder(repeat);
            await device.queue.onSubmittedWorkDone();
            cases++;
            ctx.drawImage(video, 0, 0, 1920, 1080);
            await prepare();
            const gpu = await read();
            const cpu = ctx.getImageData(0, 0, 1920, 1080).data;
            for (const pixel of [1920 * 100 + 200, 1920 * 100 + 1100, 1920 * 100 + 1600])
              for (let ch = 0; ch < 3; ch++) {
                const offset = pixel * 4 + ch;
                if (
                  Math.abs(
                    Math.max(0, Math.min(1, gpu[offset]!)) - inputSRGBToLinear(cpu[offset]! / 255),
                  ) > 0.03
                )
                  throw new Error(
                    `Video external texture transfer mismatch pixel ${pixel}, channel ${ch}: gpu ${gpu[offset]}, encoded ${cpu[offset]}, linear ${inputSRGBToLinear(cpu[offset]! / 255)}`,
                  );
              }
            cases++;
            const before = changes;
            await video.play();
            await new Promise<void>((resolve) => video.requestVideoFrameCallback(() => resolve()));
            await prepare();
            if (changes <= before) throw new Error('Video frame callback did not invalidate');
            if (JSON.stringify(initial) === JSON.stringify(await read()))
              throw new Error('Decoded video did not advance');
            cases++;
            manager.dispose();
            if (video.paused) throw new Error('Caller video was paused');
            video.pause();
            video.removeAttribute('src');
            video.load();
            video.remove();
            cases++;
          }
          manager.dispose();
          manager.dispose();
          if (manager.memory().textureBytes || manager.memory().bufferBytes)
            throw new Error('Disposed manager retains allocations');
          await device.queue.onSubmittedWorkDone();
          return { cases, errors: session.errors, changes };
        } finally {
          manager.dispose();
          release();
        }
      },
      { corePath, inputsPath, readPath, scenario },
    );
    expect(result.errors).toEqual([]);
    expect(result.cases).toBeGreaterThanOrEqual(2);
    expect(result.changes).toBeGreaterThan(0);
  });
}
for (const action of ['dispose', 'restore'] as const)
  test(`Input pipeline ${action} during asynchronous compilation cannot publish stale allocations`, async ({
    page,
  }) => {
    await harness(page);
    const result = await page.evaluate(
      async ({ corePath, inputsPath, action }) => {
        const { acquireDevice } = (await import(
          corePath
        )) as typeof import('../../packages/core/src/index.ts');
        const { InputManager } = (await import(
          inputsPath
        )) as typeof import('../../packages/core/src/inputs.ts');
        const { session, release } = await acquireDevice(),
          device = session.device,
          manager = new InputManager(session);
        const create = device.createComputePipelineAsync.bind(device);
        let unlock!: () => void, entered!: () => void;
        const gated = new Promise<void>((resolve) => (entered = resolve)),
          gate = new Promise<void>((resolve) => (unlock = resolve));
        let first = true;
        device.createComputePipelineAsync = async (descriptor) => {
          if (first) {
            first = false;
            entered();
            await gate;
          }
          return create(descriptor);
        };
        try {
          const pending = manager.set('pending', {
            kind: 'data',
            data: new Float32Array([0.2, 0.3, 0.4, 1]),
            width: 1,
            height: 1,
          });
          await gated;
          if (action === 'dispose') manager.dispose();
          else await manager.restore();
          unlock();
          await pending.catch(() => {});
          if (
            manager.get('pending') ||
            manager.memory().textureBytes ||
            manager.memory().bufferBytes ||
            session.resources.stats().references
          )
            throw new Error('Stale async build retained GPU state');
          if (action === 'restore') {
            await manager.set('valid', {
              kind: 'data',
              data: new Float32Array([1, 0, 0, 1]),
              width: 1,
              height: 1,
            });
            const encoder = device.createCommandEncoder();
            manager.prepare({} as import('../../packages/core/src/effect.ts').FrameInfo, encoder);
            session.submitEncoder(encoder);
            await device.queue.onSubmittedWorkDone();
            if (!manager.get('valid')) throw new Error('Stale build poisoned the restored manager');
          }
          manager.dispose();
          return { errors: session.errors, references: session.resources.stats().references };
        } finally {
          unlock();
          device.createComputePipelineAsync = create;
          manager.dispose();
          release();
        }
      },
      { corePath, inputsPath, action },
    );
    expect(result.errors).toEqual([]);
    expect(result.references).toBe(0);
  });
