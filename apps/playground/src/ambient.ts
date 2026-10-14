import { attach, type Attachment } from '@mk7s/hologpu/dom';
import type { EffectDefinition, EffectField } from '@mk7s/hologpu';
import particleDrift from '@mk7s/hologpu/effects/particle-drift';
import constellation from '@mk7s/hologpu/effects/constellation';

const query = new URLSearchParams(location.search);
const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const drift = get('drift'),
  network = get('network');
const slider = get<HTMLInputElement>('intensity');
const palette = get<HTMLSelectElement>('palette');
const motionMedia = matchMedia('(prefers-reduced-motion: reduce)');
const attachments: Attachment[] = [],
  fields: EffectField[] = [];
const listeners = new AbortController();
const colors = {
  ember: ['#e5b98b', '#cba17e'],
  dusk: ['#b8c9e7', '#a4b4d2'],
  paper: ['#716c91', '#646b83'],
} as const;
let disposed = false,
  requestedPlaying = false,
  hovering = false;
let reduced = query.get('reduce') === '1' || motionMedia.matches;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function syncAppearance() {
  const theme = palette.value as keyof typeof colors;
  document.body.dataset.palette = theme;
  const intensity = Number(slider.value);
  get<HTMLOutputElement>('intensity-value').value = `${Math.round(intensity * 100)}%`;
  for (const [index, host] of [drift, network].entries()) {
    const tint = colors[theme][index]!;
    host.style.setProperty('--hgpu-tint', tint);
    host.style.setProperty('--hgpu-intensity', String(intensity));
    attachments[index]?.set({ tint, intensity });
  }
}
function syncMotion() {
  get('motion').textContent = reduced ? 'Restore motion' : 'Reduce motion';
  get('motion').setAttribute('aria-pressed', String(reduced));
  get('play').textContent =
    requestedPlaying && !reduced ? 'Pause ambient motion' : 'Play ambient motion';
  get('play').setAttribute('aria-pressed', String(requestedPlaying && !reduced));
  for (const item of attachments) {
    item.setReducedMotion(reduced);
    if (!reduced && (requestedPlaying || (item.host === drift && hovering))) item.play();
    else item.pause();
  }
}
function stopInteraction() {
  if (idleTimer !== undefined) clearTimeout(idleTimer);
  idleTimer = undefined;
  hovering = false;
  const dust = attachments.find((item) => item.host === drift)?.field;
  if (dust) {
    dust.frame.pointer = [-1, -1];
    dust.frame.velocity = [0, 0];
    dust.invalidate();
  }
  syncMotion();
}
function interact() {
  if (reduced || disposed) return;
  if (idleTimer !== undefined) clearTimeout(idleTimer);
  idleTimer = undefined;
  if (!hovering) {
    hovering = true;
    syncMotion();
  }
}
function settle() {
  if (disposed) return;
  if (idleTimer !== undefined) clearTimeout(idleTimer);
  idleTimer = setTimeout(stopInteraction, 600);
}
get('play').addEventListener(
  'click',
  () => {
    requestedPlaying = !requestedPlaying;
    syncMotion();
  },
  { signal: listeners.signal },
);
get('motion').addEventListener(
  'click',
  () => {
    reduced = !reduced;
    if (reduced) stopInteraction();
    syncMotion();
  },
  { signal: listeners.signal },
);
get('reset').addEventListener(
  'click',
  () => {
    for (const field of fields) field.reset(7);
  },
  { signal: listeners.signal },
);
slider.addEventListener('input', syncAppearance, { signal: listeners.signal });
palette.addEventListener('change', syncAppearance, { signal: listeners.signal });
drift.addEventListener('pointerenter', interact, { signal: listeners.signal });
drift.addEventListener('pointermove', interact, { signal: listeners.signal });
drift.addEventListener('pointerdown', interact, { signal: listeners.signal });
drift.addEventListener('pointerleave', settle, { signal: listeners.signal });
drift.addEventListener(
  'pointerup',
  (event) => {
    if (event.pointerType !== 'mouse') settle();
  },
  { signal: listeners.signal },
);
drift.addEventListener('pointercancel', settle, { signal: listeners.signal });
motionMedia.addEventListener(
  'change',
  () => {
    reduced = query.get('reduce') === '1' || motionMedia.matches;
    if (reduced) stopInteraction();
    syncMotion();
  },
  { signal: listeners.signal },
);
syncAppearance();
syncMotion();
async function boot() {
  for (const [host, effect] of [
    [drift, particleDrift],
    [network, constellation],
  ] as const) {
    const item = await attach(host, effect as EffectDefinition, {
      layer: 'behind',
      playing: false,
      reducedMotion: reduced,
      forceFallback: query.get('fallback') === '1',
      adaptiveQuality: false,
      seed: 7,
      ...(host === drift ? { params: { count: 1024 } } : {}),
    });
    if (disposed) {
      item.destroy();
      return;
    }
    attachments.push(item);
    if (item.field) {
      if (host === drift) item.field.frame.pointer = [-1, -1];
      fields.push(item.field);
    }
  }
  syncAppearance();
  syncMotion();
  for (const field of fields) {
    field.beforeFrame();
    field.drawAt(0, 7);
  }
  get('status').textContent = fields.length
    ? 'WebGPU · move over the dust study or press Play'
    : 'Poster fallbacks · all copy and controls remain available';
  Object.assign(window, { ambientDemo: { attachments, fields } });
}
function destroy() {
  if (idleTimer !== undefined) clearTimeout(idleTimer);
  idleTimer = undefined;
  listeners.abort();
  for (const item of attachments.splice(0)) item.destroy();
  fields.length = 0;
}
void boot().catch((error) => {
  if (disposed) return;
  destroy();
  get('status').textContent = 'Native content · effect setup unavailable';
  console.error(error);
  Object.assign(window, { ambientDemo: { attachments, fields } });
});
window.addEventListener(
  'pagehide',
  () => {
    disposed = true;
    destroy();
  },
  { once: true },
);
