import { attach, type Attachment } from '@mk7s/hologpu/dom';
import type { EffectDefinition } from '@mk7s/hologpu';
import aurora from '@mk7s/hologpu/effects/aurora-veil';
import grain from '@mk7s/hologpu/effects/grain-overlay';
import dots from '@mk7s/hologpu/effects/dot-matrix-field';
import grid from '@mk7s/hologpu/effects/grid-horizon';
import sweep from '@mk7s/hologpu/effects/light-sweep';
import shimmer from '@mk7s/hologpu/effects/text-shimmer';
import wave, { waveDividerPath } from '@mk7s/hologpu/effects/wave-divider';
import depth from '@mk7s/hologpu/effects/depth-parallax';
import spotlight from '@mk7s/hologpu/effects/spotlight';
import border from '@mk7s/hologpu/effects/border-energy';
const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const mounted: Attachment[] = [];
const definitions = [aurora, grain, dots, grid, sweep, shimmer, wave, depth, spotlight, border];
const controller = new AbortController();
let report: Record<string, unknown> | undefined;
let clicks = 0;
get('native').onclick = () => {
  get<HTMLOutputElement>('clicks').value = String(++clicks);
};
get<HTMLInputElement>('progress').oninput = (event) => {
  get<HTMLOutputElement>('value').value = (event.target as HTMLInputElement).value;
};
get('save').onclick = () => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'hologpu-device-check.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
get('run').onclick = async () => {
  get<HTMLButtonElement>('run').disabled = true;
  for (const item of mounted.splice(0)) item.destroy();
  get('surfaces').replaceChildren();
  const rows: Record<string, unknown>[] = [];
  const errors: string[] = [];
  const forceFallback = new URLSearchParams(location.search).has('fallback');
  try {
    await document.fonts.ready;
    for (const effect of definitions) {
      get('status').textContent = `Checking ${effect.id}…`;
      const host = document.createElement('section');
      host.className = 'sample';
      host.setAttribute('aria-label', effect.title);
      get('surfaces').append(host);
      if (effect === shimmer) host.innerHTML = '<h2>Good ideas need room.</h2>';
      if (effect === wave)
        host.innerHTML = `<svg viewBox="0 0 300 180" preserveAspectRatio="none"><path fill="#866c56" d="${waveDividerPath(300, 180)}"/></svg>`;
      let image: HTMLImageElement | undefined, mask: HTMLImageElement | undefined;
      if (effect === depth) {
        image = new Image();
        image.src = new URL('media/products/console.png', location.href).href;
        image.alt = 'Signal console';
        host.append(image);
        mask = new Image();
        mask.src = new URL('media/products/console-depth.png', location.href).href;
        await Promise.all([image.decode(), mask.decode()]);
      }
      const preset =
        effect === spotlight ? 'card-spotlight' : effect === border ? 'border-trace' : undefined;
      const item = await attach(host, effect as EffectDefinition, {
        reducedMotion: true,
        playing: false,
        forceFallback,
        adaptiveQuality: false,
        resolutionScale: Math.max(effect.quality.resolutionScale[0], 0.5),
        seed: 7,
        preset,
        params:
          effect === border ? { intensity: 0.2 } : effect === spotlight ? { ambient: 0.02 } : {},
        layer: effect === depth || effect === shimmer || effect === wave ? 'front' : 'behind',
        padding: effect === border ? 16 : 0,
        ...(effect === wave ? { poster: '' } : {}),
        signal: controller.signal,
      });
      mounted.push(item);
      const field = item.field;
      if (!field) {
        rows.push({
          id: effect.id,
          state: item.state,
          timings: item.timings,
          nativeFallback: host.textContent || image?.alt || 'decorative background',
        });
        continue;
      }
      if (image && mask) {
        await field.bindInput('image', { kind: 'image', source: image });
        await field.bindInput('depth', { kind: 'mask', source: mask, channel: 'red' });
      }
      // Appending a responsive grid cell changes column widths. Let observers
      // settle before comparing two draws at the same framebuffer geometry.
      await new Promise((resolve) => setTimeout(resolve, 250));
      field.drawAt(effect.reducedMotion.time, 7);
      const first = await field.readPixels();
      let recurring = 0;
      const stop = field.onRendered(() => recurring++);
      // Media/resize/input work settles before the unchanged-pose observation window.
      await new Promise((resolve) => setTimeout(resolve, 250));
      recurring = 0;
      await new Promise((resolve) => setTimeout(resolve, 500));
      stop();
      field.drawAt(effect.reducedMotion.time, 7);
      const second = await field.readPixels();
      const same =
        first.width === second.width &&
        first.height === second.height &&
        first.pixels.every((n, i) => n === second.pixels[i]);
      rows.push({
        id: effect.id,
        state: item.state,
        size: [second.width, second.height],
        timings: item.timings,
        poseStable: same,
        unchangedScheduledFrames: recurring,
        hasOutput: second.pixels.some((n, i) => i % 4 === 3 && n > 0),
        gpuErrors: [...field.session.errors],
        adapter: field.session.device.adapterInfo,
      });
    }
    for (const item of mounted.splice(0)) item.destroy();
    const cleanup = Array.from(get('surfaces').children).every(
      (host) => !host.querySelector('canvas') && !host.shadowRoot?.querySelector('canvas'),
    );
    get('surfaces').replaceChildren();
    report = {
      capturedAt: new Date().toISOString(),
      device: get<HTMLInputElement>('device').value,
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      viewport: [innerWidth, innerHeight],
      dpr: devicePixelRatio,
      forceFallback,
      rows,
      errors,
      cleanup,
      nativeInteraction: { clicks, slider: get<HTMLInputElement>('progress').value },
      note: 'GPU completion timing bounds first-frame readiness; browser compositor presentation is not observable. Appearance and native control checks need a human visual pass.',
    };
    get<HTMLTextAreaElement>('report').value = JSON.stringify(report, null, 2);
    get('status').textContent =
      report.cleanup &&
      rows.every((row) =>
        forceFallback
          ? row.state === 'fallback'
          : row.state === 'ready' &&
            row.poseStable &&
            (row.hasOutput || row.id === 'light-sweep') &&
            row.unchangedScheduledFrames === 0 &&
            (row.gpuErrors as string[]).length === 0,
      )
        ? 'Checks passed. Review appearance on the launch page and download the report.'
        : 'Checks finished with failures or unavailable GPU. See report.';
    get<HTMLButtonElement>('save').disabled = false;
  } catch (error) {
    errors.push(String(error));
    get('status').textContent = 'Checks failed: ' + error;
    report = { capturedAt: new Date().toISOString(), rows, errors, userAgent: navigator.userAgent };
    get<HTMLTextAreaElement>('report').value = JSON.stringify(report, null, 2);
    get<HTMLButtonElement>('save').disabled = false;
  } finally {
    get<HTMLButtonElement>('run').disabled = false;
  }
};
window.addEventListener(
  'pagehide',
  () => {
    controller.abort();
    for (const item of mounted) item.destroy();
  },
  { once: true },
);
