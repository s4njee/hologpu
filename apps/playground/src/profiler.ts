import { type EffectField } from '@mk7s/hologpu';
const activeBenchmarks = new WeakSet<EffectField>();
function summarize(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b),
    count = sorted.length;
  return {
    count,
    mean: count ? sorted.reduce((a, b) => a + b, 0) / count : 0,
    p50: sorted[Math.floor((count - 1) * 0.5)] ?? 0,
    p95: sorted[Math.ceil((count - 1) * 0.95)] ?? 0,
    max: sorted.at(-1) ?? 0,
  };
}
export interface BenchmarkRow {
  id: string;
  recordedAt: string;
  seed: number;
  size: readonly number[];
  params: object;
  samples: number;
  warmup: number;
  clock: string;
  cpuMs: ReturnType<typeof summarize>;
  completionMs: ReturnType<typeof summarize>;
  rafMs: ReturnType<typeof summarize>;
  gpuMs: ReturnType<typeof summarize> | null;
  passes: Record<string, ReturnType<typeof summarize>>;
  capabilities: object;
  memory: object;
  errors: readonly string[];
  frameIndex: number;
  buffers: Record<string, { count?: number; stride?: number; bytes: number }>;
  taps: Record<string, { width: number; height: number; format: string }>;
}
export async function runBenchmark(
  field: EffectField,
  warmup = 30,
  samples = 120,
): Promise<BenchmarkRow> {
  if (
    !Number.isInteger(warmup) ||
    warmup < 0 ||
    warmup > 600 ||
    !Number.isInteger(samples) ||
    samples < 1 ||
    samples > 600
  )
    throw new RangeError('Invalid benchmark sample count');
  if (field.state !== 'ready' || activeBenchmarks.has(field))
    throw new Error('Field is not ready or a benchmark is already running');
  activeBenchmarks.add(field);
  const previous = {
    playing: field.requestedPlaying,
    reducedMotion: field.reducedMotionOverride,
    scale: field.quality.maxResolution,
    auto: field.adaptiveQuality,
    timeScale: field.timeScale,
    seed: field.frame.seed,
    profiling: field.session.profiler.enabled,
  };
  const stage = field.canvas.parentElement!,
    width = stage.style.width,
    height = stage.style.height,
    params = field.store.snapshot(),
    serialized = JSON.stringify(params),
    profiler = field.session.profiler;
  const cpu: number[] = [],
    completion: number[] = [],
    raf: number[] = [],
    gpu: number[] = [],
    passes: Record<string, number[]> = {};
  try {
    field.pause();
    field.setReducedMotion(false);
    field.setAdaptiveQuality(false);
    field.setResolutionScale(1);
    field.setTimeScale(1);
    field.setProfiling(true);
    stage.style.width = '514px';
    stage.style.height = '514px';
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    field.reset(7);
    field.advance(0);
    await field.session.device.queue.onSubmittedWorkDone();
    await profiler.settle();
    profiler.clear();
    const instance = field.instance,
      inputRevision = field.inputRevision,
      size = [...field.surface!.size],
      pointer = JSON.stringify([field.frame.pointer, field.frame.velocity, field.frame.buttons]);
    const checkScenario = (index: number) => {
      if (
        field.state !== 'ready' ||
        field.instance !== instance ||
        field.inputRevision !== inputRevision ||
        field.frame.index !== index ||
        field.frame.seed !== 7 ||
        field.playing ||
        field.reducedMotion ||
        field.adaptiveQuality ||
        field.quality.maxResolution !== 1 ||
        field.timeScale !== 1 ||
        !profiler.enabled ||
        JSON.stringify(field.surface?.size) !== JSON.stringify(size) ||
        JSON.stringify(field.store.snapshot()) !== serialized ||
        JSON.stringify([field.frame.pointer, field.frame.velocity, field.frame.buttons]) !== pointer
      )
        throw new Error('Effect or benchmark scenario changed; benchmark cancelled.');
    };
    let previousRAF: number | undefined;
    for (let i = 0; i < warmup + samples; i++) {
      const now = await new Promise<number>(requestAnimationFrame);
      checkScenario(i);
      const index = profiler.latest?.index ?? 0,
        start = performance.now();
      field.advance(1);
      const encoding = performance.now() - start;
      await field.session.device.queue.onSubmittedWorkDone();
      const completed = performance.now() - start;
      await profiler.settle();
      checkScenario(i + 1);
      if (i >= warmup) {
        cpu.push(encoding);
        completion.push(completed);
        if (previousRAF !== undefined) raf.push(now - previousRAF);
        const frame = profiler.latest;
        if (frame && frame.index > index && !frame.truncated) {
          gpu.push(frame.totalMs);
          for (const [name, pass] of Object.entries(frame.passes))
            (passes[name] ??= []).push(pass.ms);
        }
      }
      previousRAF = now;
    }
    return {
      id: field.effect.id,
      recordedAt: new Date().toISOString(),
      seed: 7,
      size: [...field.surface!.size],
      params,
      samples,
      warmup,
      clock: 'one fixed 1/60 s update per rAF; queue completion and timestamp readback awaited',
      cpuMs: summarize(cpu),
      completionMs: summarize(completion),
      rafMs: summarize(raf),
      gpuMs: gpu.length ? summarize(gpu) : null,
      passes: Object.fromEntries(Object.entries(passes).map(([name, v]) => [name, summarize(v)])),
      capabilities: field.session.capabilities,
      memory: field.memory(),
      errors: [...field.session.errors],
      frameIndex: field.frame.index,
      buffers: Object.fromEntries(
        Object.entries(field.bufferTaps).map(([name, b]) => [
          name,
          { count: b.count, stride: b.stride, bytes: b.buffer.size },
        ]),
      ),
      taps: Object.fromEntries(
        Object.entries(field.textureTaps).map(([name, t]) => [
          name,
          { width: t.width, height: t.height, format: t.format },
        ]),
      ),
    };
  } finally {
    activeBenchmarks.delete(field);
    stage.style.width = width;
    stage.style.height = height;
    if (field.state === 'ready') {
      field.setProfiling(previous.profiling);
      field.setResolutionScale(previous.scale);
      field.setAdaptiveQuality(previous.auto);
      field.setTimeScale(previous.timeScale);
      field.setReducedMotion(previous.reducedMotion);
      field.reset(previous.seed);
      if (previous.playing) field.play();
    }
  }
}
export function profilerDrawer(field: EffectField, panel: HTMLElement) {
  panel.replaceChildren();
  const controls = document.createElement('div');
  controls.className = 'editor-toolbar';
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.id = 'profile-enabled';
  toggle.checked = field.session.profiler.enabled;
  const label = document.createElement('label');
  label.append(toggle, 'Capture GPU timestamps');
  const benchmark = document.createElement('button');
  benchmark.id = 'benchmark-run';
  benchmark.textContent = 'Run benchmark';
  const download = document.createElement('button');
  download.id = 'benchmark-export';
  download.textContent = 'Export JSON';
  download.disabled = true;
  controls.append(label, benchmark, download);
  const description = document.createElement('p');
  description.className = 'muted';
  description.textContent =
    'Benchmark: 512² CSS stage, seed 7, fixed quality, current parameters, 30 warm-up + 120 measured updates. GPU totals sum measured passes; CPU and queue-completion latency are separate. Timestamp results may be quantized.';
  const stats = document.createElement('p');
  stats.id = 'profile-summary';
  const status = document.createElement('p');
  status.id = 'benchmark-status';
  status.setAttribute('role', 'status');
  const histogram = document.createElement('canvas');
  histogram.id = 'profile-histogram';
  histogram.width = 480;
  histogram.height = 100;
  histogram.setAttribute('aria-label', 'Frame interval histogram');
  const timings = document.createElement('table');
  timings.id = 'profile-passes';
  const results = document.createElement('table');
  results.id = 'benchmark-results';
  const rows: BenchmarkRow[] = [];
  panel.append(controls, description, stats, histogram, timings, status, results);
  toggle.onchange = () => field.setProfiling(toggle.checked);
  const draw = () => {
    if (field.state === 'disposed' || !panel.contains(stats)) {
      clearInterval(timer);
      return;
    }
    const p = field.session.profiler,
      latest = p.latest,
      m = field.memory(),
      intervals = field.frameTimings.map((f) => f.intervalMs).filter((v) => v > 0),
      cpu = summarize(field.frameTimings.map((f) => f.cpuMs));
    stats.textContent = `CPU encode ${cpu.mean.toFixed(2)} ms mean · ${intervals.length} recent frame intervals · ${latest ? latest.totalMs.toFixed(3) + ' ms summed GPU passes' : p.supported ? 'GPU capture ' + (p.enabled ? 'pending' : 'off') : 'GPU timestamps unavailable; CPU timings remain available'} · ${Math.round((field.surface?.resolutionScale ?? 1) * 100)}% resolution / ${Math.round((field.adaptiveQuality ? field.quality.state.stepScale : 1) * 100)}% work · ${(m.textureBytes / 1048576).toFixed(2)} MiB textures / ${(m.bufferBytes / 1048576).toFixed(2)} MiB buffers / ${(m.profilingBytes / 1024).toFixed(0)} KiB timestamp staging${latest?.truncated ? ' · capture truncated' : ''}`;
    timings.replaceChildren();
    if (latest) {
      const head = timings.createTHead().insertRow();
      for (const text of ['GPU pass', 'Total ms', 'Dispatches/draws']) {
        const th = document.createElement('th');
        th.textContent = text;
        head.append(th);
      }
      const body = timings.createTBody();
      for (const [name, pass] of Object.entries(latest.passes)) {
        const row = body.insertRow();
        for (const text of [name, pass.ms.toFixed(3), String(pass.count)])
          row.insertCell().textContent = text;
      }
    }
    const ctx = histogram.getContext('2d')!;
    ctx.clearRect(0, 0, 480, 100);
    const bins = Array<number>(24).fill(0);
    for (const value of intervals) {
      const i = Math.min(23, Math.floor(value / 2));
      bins[i] = bins[i]! + 1;
    }
    const max = Math.max(1, ...bins);
    ctx.fillStyle = '#a6b6ff';
    bins.forEach((count, i) =>
      ctx.fillRect(i * 20, 80 - (count / max) * 70, 18, (count / max) * 70),
    );
    ctx.fillStyle = '#9ca7bb';
    ctx.font = '10px system-ui';
    ctx.fillText('0 ms', 0, 96);
    ctx.fillText('Frame interval (2 ms bins)', 145, 96);
    ctx.fillText('≥46 ms', 432, 96);
  };
  const timer = setInterval(draw, 500);
  draw();
  benchmark.onclick = async () => {
    benchmark.disabled = true;
    status.textContent = 'Measuring fixed scenario…';
    try {
      const row = await runBenchmark(field);
      rows.push(row);
      download.disabled = false;
      status.textContent = `${row.samples} measured updates · CPU ${row.cpuMs.mean.toFixed(2)} ms mean · completion ${row.completionMs.p95.toFixed(2)} ms p95 · GPU ${row.gpuMs ? row.gpuMs.p95.toFixed(3) + ' ms summed-pass p95' : 'unavailable'}`;
      results.replaceChildren();
      const head = results.createTHead().insertRow();
      for (const t of ['Effect', 'CPU mean ms', 'Completion p95 ms', 'GPU p95 ms']) {
        const th = document.createElement('th');
        th.textContent = t;
        head.append(th);
      }
      const body = results.createTBody();
      for (const r of rows) {
        const tr = body.insertRow();
        for (const t of [
          r.id,
          r.cpuMs.mean.toFixed(3),
          r.completionMs.p95.toFixed(3),
          r.gpuMs?.p95.toFixed(3) ?? 'unavailable',
        ])
          tr.insertCell().textContent = t;
      }
    } catch (e) {
      status.textContent = String(e);
    } finally {
      benchmark.disabled = false;
    }
  };
  download.onclick = () => {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { recordedOn: new Date().toISOString().slice(0, 10), results: rows },
            null,
            2,
          ) + '\n',
        ],
        { type: 'application/json' },
      ),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'm3-playground.json';
    link.click();
    URL.revokeObjectURL(url);
  };
}
