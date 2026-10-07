import { chromium, webkit } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { platform, arch, release } from 'node:os';
import { catalogue } from '../packages/effects/dist/index.js';
import { ParamStore } from '../packages/core/dist/params.js';

const name = process.argv[2] ?? 'chrome';
const engine = { chrome: chromium, webkit }[name];
if (!engine || process.argv.length > 3)
  throw new Error('Usage: node scripts/benchmark-m5.mjs chrome|webkit');
const ids = [
  'border-energy',
  'spotlight',
  'image-hover',
  'text-dissolve',
  'audio-spectrum',
  'scroll-scene',
  'fluid-obstacles',
];
const definitions = ids.map((id) => {
  const matches = catalogue.filter((effect) => effect.id === id);
  if (matches.length !== 1 || !matches[0].core)
    throw new Error(`Expected one typed core definition for ${id}`);
  const definition = matches[0];
  // Validate defaults through the same typed parameter schema used by the runtime.
  const defaults = Object.fromEntries(
    Object.entries(definition.params).map(([key, spec]) => [key, spec.default]),
  );
  const values = new ParamStore(definition.params, defaults).snapshot();
  if (JSON.stringify(values) !== JSON.stringify(defaults))
    throw new Error(`Defaults did not round-trip through ParamStore: ${id}`);
  return { id, defaults, tier: definition.tier, family: definition.family };
});
const fixtures = {
  'border-energy': 'Analytic rounded rectangle at schema defaults; no DOM geometry bridge.',
  spotlight: 'Schema-default shared viewport rectangle and page pointer; no pointer movement.',
  'image-hover':
    'Two independent owned 64-square linear HDR cards; progress remains its schema default.',
  'text-dissolve':
    'One-time 512x256 GPU text coverage mask; mask-gated instanced quads at schema defaults.',
  'audio-spectrum':
    'Owned 256x2 two-sine waveform and its actual one-time DFT; no microphone or live analyser.',
  'scroll-scene':
    'Schema-default progress; no CSS scroll timeline or computed-style bridge in this single-field measurement.',
  'fluid-obstacles':
    'Two owned default normalized obstacle rectangles; actual default grid and pressure iterations.',
};
const canonical = (value) =>
  JSON.stringify(value, (_key, nested) =>
    nested && !Array.isArray(nested) && typeof nested === 'object'
      ? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => a.localeCompare(b)))
      : nested,
  );
const requiredPasses = {
  'border-energy': ['hgpu-border-energy'],
  spotlight: ['hgpu-spotlight'],
  'image-hover': ['image-hover'],
  'text-dissolve': ['text-dissolve-particles'],
  'audio-spectrum': ['audio-spectrum'],
  'scroll-scene': ['hgpu-scroll-scene'],
  'fluid-obstacles': ['hgpu-fluid-pressure', 'hgpu-fluid-project', 'hgpu-fluid-display'],
};
const requiredTaps = {
  'image-hover': { defaultImage: [64, 64, 'rgba32float'], secondImage: [64, 64, 'rgba32float'] },
  'text-dissolve': { textMask: [512, 256, 'r8unorm'] },
  'audio-spectrum': {
    defaultImage: [64, 64, 'rgba32float'],
    referenceAudio: [256, 2, 'rgba32float'],
  },
  'fluid-obstacles': {
    velocity: [256, 256, 'rgba16float'],
    dye: [256, 256, 'rgba16float'],
    pressure: [256, 256, 'r32float'],
    curl: [256, 256, 'r32float'],
    divergence: [256, 256, 'r32float'],
    projectedDivergence: [256, 256, 'r32float'],
    diffusionRhs: [256, 256, 'rgba16float'],
    obstacleMask: [256, 256, 'r32float'],
  },
};
const checkStats = (stats, label) => {
  if (
    stats.count !== 120 ||
    !['mean', 'p50', 'p95', 'max'].every((key) => Number.isFinite(stats[key]) && stats[key] >= 0) ||
    stats.p50 > stats.p95 ||
    stats.p95 > stats.max ||
    stats.mean > stats.max
  )
    throw new Error(`Incomplete or invalid ${label}: ${JSON.stringify(stats)}`);
};
const browser = await engine.launch({
  ...(name === 'chrome' ? { channel: 'chrome' } : {}),
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1400, height: 1200 },
  deviceScaleFactor: 1,
});
const base = process.env.HOLOGPU_URL ?? 'http://127.0.0.1:5176';
const results = [];
try {
  for (const { id, defaults, tier, family } of definitions) {
    await page.goto(
      `${base}/?${new URLSearchParams({ effect: id, mode: 'full', playing: 'false', quality: 'fixed', resolution: '1', timeScale: '1', seed: '7', params: '{}' })}`,
    );
    await page.locator('#status[data-state="ready"]').waitFor({ timeout: 30000 });
    const fixtureAudit = await page.evaluate(
      async ({ id, defaults }) => {
        const f = window.hologpu.field;
        if (
          !f ||
          f.effect.id !== id ||
          window.hologpu.domStage.fields.length ||
          window.hologpu.compareField
        )
          throw new Error('Expected one plain full-stage field without attachments or Compare');
        const actualDefaults = Object.fromEntries(
          Object.entries(f.effect.params).map(([key, spec]) => [key, spec.default]),
        );
        if (
          JSON.stringify(actualDefaults) !== JSON.stringify(defaults) ||
          JSON.stringify(f.store.snapshot()) !== JSON.stringify(defaults)
        )
          throw new Error(
            'Production catalogue or field parameters differ from current typed defaults',
          );
        if (
          f.playing ||
          f.adaptiveQuality ||
          f.timeScale !== 1 ||
          f.surface.resolutionScale !== 1 ||
          devicePixelRatio !== 1
        )
          throw new Error('Expected paused DPR1 full-resolution fixed-quality field');
        const stage = f.canvas.parentElement;
        stage.style.width = '514px';
        stage.style.height = '514px';
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (JSON.stringify(f.surface.size) !== '[512,512]')
          throw new Error('Default fixture presentation is not physical 512 square');
        f.setReducedMotion(false);
        f.reset(7);
        f.advance(0);
        await f.session.device.queue.onSubmittedWorkDone();
        const taps = {};
        for (const [name, tap] of Object.entries(f.textureTaps)) {
          const read = await f.readTap(name);
          let hash = 2166136261,
            nonzero = 0,
            min = Infinity,
            max = -Infinity;
          for (let i = 0; i < read.values.length; i++) {
            const value = read.values[i];
            if (!Number.isFinite(value)) throw new Error(`Nonfinite default input ${name}`);
            min = Math.min(min, value);
            max = Math.max(max, value);
            if (value !== 0) nonzero++;
            hash = Math.imul(hash ^ Math.round(value * 65535), 16777619);
          }
          taps[name] = {
            width: tap.width,
            height: tap.height,
            format: tap.format,
            channels: read.channels,
            count: read.values.length,
            nonzero,
            min,
            max,
            hash: hash >>> 0,
          };
          if (name === 'referenceAudio') {
            if (
              Math.abs(read.values[8 * 4] - 0.6) > 1e-6 ||
              Math.abs(read.values[23 * 4] - 0.25) > 1e-6
            )
              throw new Error('Default DFT amplitudes are incorrect');
            for (let i = 0; i < 256; i++)
              if (
                Math.abs(
                  read.values[(256 + i) * 4] -
                    (0.6 * Math.sin((2 * Math.PI * 8 * i) / 256) +
                      0.25 * Math.sin((2 * Math.PI * 23 * i) / 256)),
                ) > 1e-6
              )
                throw new Error('Default signed waveform differs from the actual two-sine signal');
          }
          if (name === 'textMask' && (!nonzero || nonzero === read.values.length))
            throw new Error('Text fixture has no meaningful coverage');
          if (name === 'obstacleMask' && (min !== 0 || max !== 1 || !nonzero))
            throw new Error('Default obstacles are not rasterized into the actual grid');
        }
        let obstacleBuffer = null;
        if (id === 'fluid-obstacles') {
          const tap = f.bufferTaps.obstacles;
          if (!tap || tap.buffer.size !== 48)
            throw new Error('Expected count header and two default rectangles');
          const device = f.session.device,
            readback = device.createBuffer({
              size: 48,
              usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            });
          try {
            const encoder = device.createCommandEncoder();
            encoder.copyBufferToBuffer(tap.buffer, 0, readback, 0, 48);
            device.queue.submit([encoder.finish()]);
            await readback.mapAsync(GPUMapMode.READ);
            const bytes = readback.getMappedRange();
            const count = new Uint32Array(bytes)[0],
              boxes = Array.from(new Float32Array(bytes).slice(4));
            if (
              count !== 2 ||
              boxes.some(
                (value, i) =>
                  Math.abs(value - [0.24, 0.3, 0.76, 0.41, 0.35, 0.58, 0.65, 0.69][i]) > 1e-6,
              )
            )
              throw new Error('Default obstacle geometry does not match its actual GPU buffer');
            obstacleBuffer = { bytes: 48, rectangles: count, boxes };
          } finally {
            readback.destroy();
          }
        }
        const diagnostics = f.instance.diagnostics ?? [];
        if (diagnostics.some((d) => d.type !== 'info') || f.session.errors.length)
          throw new Error('Default fixture has GPU diagnostics or validation errors');
        return {
          taps,
          obstacleBuffer,
          diagnostics,
          inputMediaPath: f.inputMediaPath,
          actualMediaBound: false,
          inputBindings: Object.keys(f.textureTaps).filter((name) => name.startsWith('input:')),
        };
      },
      { id, defaults },
    );
    if (
      fixtureAudit.inputBindings.length ||
      !['external', 'canvas-copy', 'software-copy'].includes(fixtureAudit.inputMediaPath)
    )
      throw new Error(`Unexpected media or external input bindings: ${id}`);
    let previousMemory;
    for (let run = 1; run <= 3; run++) {
      const row = await page.evaluate(() =>
        window.hologpu.runBenchmark(window.hologpu.field, 30, 120),
      );
      if (
        row.id !== id ||
        row.errors.length ||
        row.frameIndex !== 150 ||
        row.samples !== 120 ||
        row.warmup !== 30 ||
        canonical(row.params) !== canonical(defaults) ||
        canonical(row.size) !== '[512,512]' ||
        row.seed !== 7
      )
        throw new Error(`Incomplete M5 defaults workload ${id}: ${JSON.stringify(row)}`);
      checkStats(row.cpuMs, `${id} CPU`);
      checkStats(row.completionMs, `${id} completion`);
      checkStats(row.rafMs, `${id} cadence`);
      const timestamps = row.capabilities.enabledFeatures.includes('timestamp-query');
      if (timestamps !== Boolean(row.gpuMs))
        throw new Error(`Timestamp capability and measured samples disagree: ${id}`);
      if (row.gpuMs) {
        checkStats(row.gpuMs, `${id} summed GPU`);
        for (const [label, stats] of Object.entries(row.passes))
          checkStats(stats, `${id}/${label}`);
        for (const required of requiredPasses[id])
          if (
            !Object.entries(row.passes).some(
              ([label, stats]) => label.includes(required) && stats.count === 120,
            )
          )
            throw new Error(`Required default pass absent: ${id}/${required}`);
      } else if (Object.keys(row.passes).length)
        throw new Error(`Unexpected timestamps without capability: ${id}`);
      for (const [label, tap] of Object.entries(row.taps))
        if (
          !Number.isInteger(tap.width) ||
          tap.width < 1 ||
          !Number.isInteger(tap.height) ||
          tap.height < 1 ||
          !tap.format
        )
          throw new Error(`Invalid tap ${id}/${label}`);
      for (const [label, [width, height, format]] of Object.entries(requiredTaps[id] ?? {}))
        if (canonical(row.taps[label]) !== canonical({ width, height, format }))
          throw new Error(`Default tap differs: ${id}/${label}`);
      if (
        id === 'fluid-obstacles' &&
        (row.params.grid !== 256 ||
          row.params.iterations !== 32 ||
          row.buffers.obstacles?.bytes !== 48 ||
          row.buffers.obstacles?.stride !== 16 ||
          row.buffers.obstacles?.count !== 3)
      )
        throw new Error('Actual default fluid grid, iterations or obstacle allocation differ');
      if (
        !Number.isInteger(row.memory.textureBytes) ||
        row.memory.textureBytes < 512 * 512 * 8 ||
        !Number.isInteger(row.memory.bufferBytes) ||
        row.memory.bufferBytes < 64 ||
        !Number.isInteger(row.memory.profilingBytes) ||
        row.memory.profilingBytes < 0
      )
        throw new Error(`Invalid logical memory accounting ${id}`);
      const memory = {
        textureBytes: row.memory.textureBytes,
        bufferBytes: row.memory.bufferBytes,
        profilingBytes: row.memory.profilingBytes,
      };
      if (previousMemory && canonical(memory) !== canonical(previousMemory))
        throw new Error(`Default allocations grew between runs: ${id}`);
      previousMemory = memory;
      results.push({ ...row, run, gate: null, tier, family, fixture: fixtures[id], fixtureAudit });
      console.log(
        `${id} ${run}: CPU ${row.cpuMs.mean.toFixed(3)}ms mean; completion ${row.completionMs.p95.toFixed(3)}ms p95; summed GPU ${row.gpuMs ? row.gpuMs.p95.toFixed(3) + 'ms p95' : 'unavailable'}; cadence ${row.rafMs.p50.toFixed(3)}ms median`,
      );
    }
  }
  if (
    results.length !== 21 ||
    ids.some((id) => results.filter((row) => row.id === id).length !== 3)
  )
    throw new Error('Missing M5 default records');
  await writeFile(
    `docs/benchmarks/m5-${name}.json`,
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
          width: 512,
          height: 512,
          seed: 7,
          warmupFrames: 30,
          samples: 120,
          runs: 3,
          effects: ids,
          params: 'All seven current typed catalogue defaults; no preset or schema overrides.',
          inputs:
            'Owned documented standalone fixtures; no live media, CSS bridge, pointer updates or DOM attachment. The separate M5 attached-field gate measures those DOM costs.',
          clock:
            'one fixed 1/60 s update per rAF; 150 actual updates, queue completion and timestamp readback awaited',
          quality:
            'DPR 1, physical 512-square presentation, resolution scale 1, adaptive quality disabled, timeScale 1',
          timing:
            'CPU encode, encoding-through-queue-completion wall latency, summed actual per-pass GPU timestamps and observed rAF cadence measure separate boundaries. Serialized timestamp readback contributes to cadence. Logical allocation sizes are not VRAM; machine load is uncontrolled.',
          gate: null,
        },
        definitions,
        results,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await browser.close();
}
