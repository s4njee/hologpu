import { SpikeSession } from '@mk7s/hologpu/spikes';
import type { TargetMode } from '@mk7s/hologpu/spikes';
import './m0.css';

declare global {
  interface Window {
    m0?: SpikeSession;
  }
}
const query = new URLSearchParams(location.search);
const count = query.get('count') === '1' ? 1 : 6;
const mode: TargetMode = query.get('mode') === 'direct' ? 'direct' : 'float';
const status = document.querySelector<HTMLElement>('#status')!;
const report = document.querySelector<HTMLElement>('#report')!;
const animate = document.querySelector<HTMLButtonElement>('#animate')!;
const step = document.querySelector<HTMLButtonElement>('#step')!;
const verify = document.querySelector<HTMLButtonElement>('#verify')!;
const verification = document.querySelector<HTMLElement>('#verification')!;
const measure = document.querySelector<HTMLButtonElement>('#benchmark')!;
const save = document.querySelector<HTMLButtonElement>('#export')!;
const form = document.querySelector<HTMLFormElement>('#configuration')!;
(form.elements.namedItem('count') as HTMLSelectElement).value = String(count);
(form.elements.namedItem('mode') as HTMLSelectElement).value = mode;
const surfaces = document.querySelector('#surfaces')!;
for (let index = 0; index < count; index++) {
  const figure = document.createElement('figure');
  figure.className = 'card';
  const stage = document.createElement('div');
  stage.className = 'stage';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  stage.append(canvas);
  const caption = document.createElement('figcaption');
  caption.textContent = `0${index + 1} / 50% alpha → opaque / shared compute buffer`;
  figure.append(stage, caption);
  surfaces.append(figure);
}
let session: SpikeSession | undefined;
let running = false;
let measurement: unknown;
function operationError(error: unknown) {
  status.dataset['state'] = 'error';
  status.textContent = error instanceof Error ? error.message : String(error);
}
function fail(error: unknown) {
  status.dataset['state'] = 'fallback';
  status.textContent = String(error instanceof Error ? error.message : error);
  report.textContent = 'The page content remains available. No GPU renderer is active.';
}
try {
  session = await SpikeSession.create([...document.querySelectorAll('canvas')], { mode });
  window.m0 = session;
  const canvasProbe = await session.probeCanvas();
  status.dataset['state'] = 'ready';
  status.textContent = `${count} canvas${count === 1 ? '' : 'es'} ready · one shared device · ${mode === 'float' ? 'float + resolve' : 'direct'} · paused`;
  report.textContent = JSON.stringify(
    { capabilities: session.report, canvasProbe, memory: session.memory() },
    null,
    2,
  );
  for (const button of [animate, step, measure, verify]) button.disabled = false;
  animate.onclick = () => {
    running = !running;
    if (running) session!.start();
    else session!.stop();
    animate.textContent = running ? 'Pause' : 'Run';
  };
  step.onclick = () => {
    session!.stop();
    running = false;
    animate.textContent = 'Run';
    session!.render(session!.step + 1);
  };
  verify.onclick = async () => {
    running = false;
    animate.textContent = 'Run';
    for (const button of [animate, step, measure, verify]) button.disabled = true;
    try {
      const result = await session!.verify();
      status.dataset['state'] = result.passed ? 'ready' : 'error';
      const size = result.sizes[0]!;
      verification.textContent = `${result.passed ? 'PASS' : 'FAIL'} · compute reference · ${result.checkedPixels} pixels · max error ${result.pixelMaxError ?? 'n/a'}/255 · repeatable ${result.repeatable ?? 'n/a'} · ${size.width}×${size.height} physical pixels · DPR ${result.dpr}`;
      report.textContent = JSON.stringify(
        { verification: result, capabilities: session!.report },
        null,
        2,
      );
    } catch (error) {
      operationError(error);
    } finally {
      for (const button of [animate, step, measure, verify]) button.disabled = false;
    }
  };
  measure.onclick = async () => {
    running = false;
    animate.textContent = 'Run';
    for (const button of [animate, step, measure, verify, save, form.querySelector('button')!])
      button.disabled = true;
    status.textContent = 'Measuring after 30 warm-up frames…';
    try {
      measurement = await session!.benchmark(180, 30, true);
      report.textContent = JSON.stringify(measurement, null, 2);
      status.textContent = 'Measurements ready. Export to keep a benchmark record.';
      status.dataset['state'] = 'ready';
      save.disabled = false;
    } catch (error) {
      operationError(error);
    } finally {
      for (const button of [animate, step, measure, verify, form.querySelector('button')!])
        button.disabled = false;
    }
  };
  save.onclick = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(measurement, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    const browser = /Firefox/.test(navigator.userAgent)
      ? 'firefox-native'
      : /Version.*Safari/.test(navigator.userAgent)
        ? 'safari-native'
        : 'browser';
    link.download = `hologpu-m0-${browser}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
} catch (error) {
  session?.dispose();
  fail(error);
}
window.addEventListener('pagehide', () => session?.dispose(), { once: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) session?.stop();
  else if (running) session?.start();
});
