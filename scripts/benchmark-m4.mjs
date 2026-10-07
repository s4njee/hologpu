import { chromium, webkit } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { platform, arch, release } from 'node:os';
import { summarize } from '../packages/core/dist/measure.js';
const name = process.argv[2] ?? 'chrome',
  gate = process.argv.includes('--gate');
const engine = { chrome: chromium, webkit }[name];
if (!engine || process.argv.slice(3).some((x) => x !== '--gate'))
  throw new Error('Usage: node scripts/benchmark-m4.mjs chrome|webkit [--gate]');
const browser = await engine.launch({
  ...(name === 'chrome' ? { channel: 'chrome' } : {}),
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 2200, height: 1400 },
  deviceScaleFactor: 1,
});
const base = process.env.HOLOGPU_URL ?? 'http://127.0.0.1:5176',
  results = [];
const ids = [
  'blur',
  'bloom',
  'color-grade',
  'dither',
  'edges',
  'lens',
  'displace',
  'halftone-ascii',
  'jump-flood',
  'shadows-2d',
  'radiance-cascades',
];
try {
  if (!gate) {
    for (const id of ids) {
      await page.goto(
        `${base}/?${new URLSearchParams({ effect: id, playing: 'false', quality: 'fixed', resolution: '1', timeScale: '1', seed: '7' })}`,
      );
      await page.locator('#status[data-state="ready"]').waitFor({ timeout: 30000 });
      for (let run = 1; run <= 3; run++) {
        const row = await page.evaluate(() =>
          window.hologpu.runBenchmark(window.hologpu.field, 30, 120),
        );
        if (
          row.errors.length ||
          row.frameIndex !== 150 ||
          row.samples !== 120 ||
          row.warmup !== 30 ||
          row.cpuMs.count !== 120 ||
          row.size[0] !== 512 ||
          row.size[1] !== 512 ||
          row.seed !== 7 ||
          (row.gpuMs && row.gpuMs.count !== 120)
        )
          throw new Error(`Incomplete M4 scenario ${id}: ${JSON.stringify(row)}`);
        results.push({ ...row, run, gate: null });
        console.log(
          `${id} ${run}: completion ${row.completionMs.p95.toFixed(3)}ms p95; cadence ${row.rafMs.p50.toFixed(3)}ms median`,
        );
      }
    }
  } else {
    await page.goto(`${base}/?effect=gradient-oklch&playing=false&quality=fixed`);
    await page.locator('#status[data-state="ready"]').waitFor({ timeout: 30000 });
    for (let run = 1; run <= 3; run++) {
      const data = await page.evaluate(async () => {
        window.hologpu.field.destroy();
        const video = document.createElement('video');
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.src = video.canPlayType('video/mp4')
          ? '/media/sample-1080p60.mp4'
          : '/media/sample-1080p60.webm';
        await new Promise((resolve, reject) => {
          video.onloadeddata = resolve;
          video.onerror = () => reject(new Error('Video fixture failed to decode'));
        });
        if (video.videoWidth !== 1920 || video.videoHeight !== 1080)
          throw new Error(
            `Expected actual 1080p decode, got ${video.videoWidth}×${video.videoHeight}`,
          );
        document.body.append(video);
        video.style.cssText =
          'position:fixed;left:1990px;top:0;width:160px;height:90px;z-index:10001';
        await video.play();
        const canvas = document.createElement('canvas');
        canvas.style.cssText =
          'position:fixed;inset:0 auto auto 0;width:1920px;height:1080px;z-index:10000';
        document.body.append(canvas);
        const stages = ['blur', 'lens', 'color-grade', 'dither'].map((id) =>
          window.hologpu.catalogue.find((e) => e.id === id),
        );
        if (stages.some((x) => !x)) throw new Error('Missing gate filters');
        const definition = window.hologpu.chain(...stages);
        const f = await window.hologpu.createEffect(canvas, definition, {
          playing: false,
          adaptiveQuality: false,
          resolutionScale: 1,
          timeScale: 1,
          reducedMotion: false,
          dprCap: 1,
        });
        let callbacks = 0,
          lastVideoMetadata = null,
          callbackHandle;
        const decoded = (_time, metadata) => {
          callbacks++;
          lastVideoMetadata = {
            width: metadata.width,
            height: metadata.height,
            mediaTime: metadata.mediaTime,
            presentedFrames: metadata.presentedFrames,
          };
          callbackHandle = video.requestVideoFrameCallback(decoded);
        };
        callbackHandle = video.requestVideoFrameCallback(decoded);
        try {
          await f.bindInput('image', { kind: 'video', source: video });
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
          // Explicit advance owns each displayed workload; media callbacks must not schedule extra draws.
          f.visible = false;
          if (JSON.stringify(f.surface.size) !== '[1920,1080]')
            throw new Error('Chain presentation is not actual 1080p');
          f.setProfiling(false);
          f.advance(0);
          await f.session.device.queue.onSubmittedWorkDone();
          const idle = [];
          let last;
          for (let i = 0; i < 40; i++) {
            const now = await new Promise(requestAnimationFrame);
            if (last !== undefined) idle.push(now - last);
            last = now;
          }
          f.setProfiling(true);
          await f.session.profiler.settle();
          f.session.profiler.clear();
          f.reset(7);
          f.advance(0);
          await f.session.device.queue.onSubmittedWorkDone();
          await f.session.profiler.settle();
          f.session.profiler.clear();
          const fingerprint = async () => {
            const input = await f.readTap('input:image');
            let hash = 2166136261;
            for (let i = 0; i < input.values.length; i += 997)
              hash = Math.imul(hash ^ Math.round(input.values[i] * 65535), 16777619);
            return hash >>> 0;
          };
          const inputHashBefore = await fingerprint();
          await f.session.profiler.settle();
          f.session.profiler.clear();
          const cpu = [],
            completion = [],
            raf = [],
            gpu = [],
            passes = {};
          const initialCallbacks = callbacks,
            startTime = video.currentTime,
            startMetadata = lastVideoMetadata ? { ...lastVideoMetadata } : null;
          let previous;
          for (let i = 0; i < 150; i++) {
            const now = await new Promise(requestAnimationFrame),
              index = f.session.profiler.latest?.index ?? 0,
              start = performance.now();
            f.advance(1);
            const encode = performance.now() - start;
            await f.session.device.queue.onSubmittedWorkDone();
            const latency = performance.now() - start;
            await f.session.profiler.settle();
            if (
              f.frame.index !== i + 1 ||
              f.adaptiveQuality ||
              f.playing ||
              f.reducedMotion ||
              f.timeScale !== 1 ||
              JSON.stringify(f.surface.size) !== '[1920,1080]'
            )
              throw new Error('Gate scenario changed');
            if (i >= 30) {
              cpu.push(encode);
              completion.push(latency);
              raf.push(now - previous);
              const capture = f.session.profiler.latest;
              if (capture && capture.index > index && !capture.truncated) {
                gpu.push(capture.totalMs);
                for (const [name, pass] of Object.entries(capture.passes))
                  (passes[name] ??= []).push(pass.ms);
              }
            }
            previous = now;
          }
          const endTime = video.currentTime,
            endCallbacks = callbacks,
            endMetadata = lastVideoMetadata ? { ...lastVideoMetadata } : null;
          const inputHashAfter = await fingerprint();
          const taps = Object.fromEntries(
            Object.entries(f.textureTaps).map(([n, t]) => [
              n,
              { width: t.width, height: t.height, format: t.format },
            ]),
          );
          return {
            id: definition.id,
            seed: 7,
            params: f.store.snapshot(),
            size: f.surface.size,
            samples: 120,
            warmup: 30,
            frameIndex: f.frame.index,
            cpu,
            completion,
            raf,
            gpu,
            passes,
            idle,
            taps,
            memory: f.memory(),
            inputMediaPath: f.inputMediaPath,
            capabilities: f.session.capabilities,
            errors: f.session.errors,
            video: {
              source: video.src,
              width: video.videoWidth,
              height: video.videoHeight,
              duration: video.duration,
              startTime,
              endTime,
              decodedCallbacks: endCallbacks - initialCallbacks,
              presentedFramesDelta:
                (endMetadata?.presentedFrames ?? 0) - (startMetadata?.presentedFrames ?? 0),
              startMetadata,
              inputHashBefore,
              inputHashAfter,
              lastMetadata: endMetadata,
            },
            stages: stages.map((s) => ({
              id: s.id,
              params: Object.fromEntries(Object.entries(s.params).map(([n, p]) => [n, p.default])),
            })),
          };
        } finally {
          video.cancelVideoFrameCallback(callbackHandle);
          video.pause();
          video.removeAttribute('src');
          video.load();
          video.remove();
          f.destroy();
          canvas.remove();
        }
      });
      const { cpu, completion, raf, gpu, passes, idle, ...metadata } = data;
      const baseline = summarize(idle),
        deadline = baseline.p50 * 1.1;
      const row = {
        ...metadata,
        run,
        idleRafMs: baseline,
        cpuMs: summarize(cpu),
        completionMs: summarize(completion),
        rafMs: summarize(raf),
        gpuMs: gpu.length ? summarize(gpu) : null,
        passes: Object.fromEntries(Object.entries(passes).map(([n, v]) => [n, summarize(v)])),
        deadlineMs: deadline,
        completedWithinDeadline: completion.filter((v) => v <= deadline).length / 120,
      };
      if (
        data.errors.length ||
        !['external', 'canvas-copy', 'software-copy'].includes(data.inputMediaPath) ||
        data.frameIndex !== 150 ||
        cpu.length !== 120 ||
        row.video.decodedCallbacks < 1 ||
        !row.video.startMetadata ||
        !row.video.lastMetadata ||
        row.video.presentedFramesDelta < 120 ||
        row.video.startTime === row.video.endTime ||
        row.video.inputHashBefore === row.video.inputHashAfter ||
        ['input:image', 's0:output', 's1:output', 's2:output'].some(
          (n) => data.taps[n]?.width !== 1920 || data.taps[n]?.height !== 1080,
        )
      )
        throw new Error(`Incomplete video chain workload: ${JSON.stringify(row)}`);
      const required = ['blur-horizontal', 'blur-vertical', 'lens', 'color-grade', 'dither'];
      if (
        row.capabilities.features.includes('timestamp-query') &&
        (gpu.length !== 120 ||
          required.some(
            (n) =>
              !Object.entries(row.passes).some(([name, p]) => name.includes(n) && p.count === 120),
          ))
      )
        throw new Error(`Incomplete four-filter GPU timestamps: ${JSON.stringify(row.passes)}`);
      row.gate = row.completedWithinDeadline >= 0.95 && row.rafMs.p50 <= deadline;
      results.push(row);
      console.log(
        `1080p video chain ${run}: completion ${row.completionMs.p95.toFixed(3)}ms p95; cadence ${row.rafMs.p50.toFixed(3)}ms median; gate ${row.gate}`,
      );
    }
  }
  await writeFile(
    `docs/benchmarks/m4${gate ? '-gate' : ''}-${name}.json`,
    JSON.stringify(
      {
        recordedOn: new Date().toISOString().slice(0, 10),
        environment: {
          platform: platform(),
          arch: arch(),
          release: release(),
          browser: name,
          browserVersion: browser.version(),
          headless: true,
          dpr: 1,
        },
        scenario: {
          width: gate ? 1920 : 512,
          height: gate ? 1080 : 512,
          seed: 7,
          warmupFrames: 30,
          samples: 120,
          runs: 3,
          params: gate
            ? 'Four filters at defaults: Gaussian radius-8 blur, lens, color-grade, dither; actual 1920×1080 60fps decoded video'
            : 'defaults',
          clock: 'one fixed 1/60 s update per rAF; queue completion and timestamp readback awaited',
          quality: 'fixed physical dimensions, no adaptive scaling, timeScale 1',
          timing:
            'CPU encode, encoding-through-queue-completion wall latency, actual summed per-pass GPU timestamps and observed rAF cadence are separate. Serialized timestamp readback contributes to cadence. Machine load is uncontrolled; allocations are logical sizes, not VRAM.',
          gate: gate
            ? 'Actual 1080p video and physical chain output; 150 updates, 120 measured completions and all four filter pass timestamps when supported; at least 95% completions and median cadence within 110% measured idle rAF period'
            : null,
        },
        results,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await browser.close();
}
