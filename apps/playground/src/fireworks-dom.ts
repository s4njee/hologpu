import { createEffect, WebGPUUnavailableError } from '@mk7s/hologpu';
import type { EffectField } from '@mk7s/hologpu';
import effect from '@mk7s/hologpu/effects/emitters';
import { createLightPresentation } from './dom-light-presentation.ts';
import './fireworks-dom.css';

const canvas = document.querySelector<HTMLCanvasElement>('#particles')!;
const status = document.querySelector<HTMLElement>('#status')!;
const pause = document.querySelector<HTMLButtonElement>('#pause')!;
const reset = document.querySelector<HTMLButtonElement>('#reset')!;
const shape = document.querySelector<HTMLSelectElement>('#burst-shape')!;
const boxes = document.querySelector<HTMLButtonElement>('#show-boxes')!;
const range = document.querySelector<HTMLInputElement>('#brightness')!;
const brightnessLabel = document.querySelector<HTMLOutputElement>('#brightness-value')!;
const outputMode = document.querySelector<HTMLSelectElement>('#output-mode')!;
const outputStatus = document.querySelector<HTMLElement>('#output-status')!;
const hdrDisplay = matchMedia('(dynamic-range: high)');
const card = document.querySelector<HTMLElement>('#floating-card')!;
const handle = document.querySelector<HTMLButtonElement>('#drag-handle')!;
const query = new URLSearchParams(location.search);
let field: EffectField<typeof effect.params> | null = null;
const cleanup: (() => void)[] = [];
let presentation: Awaited<ReturnType<typeof createLightPresentation>> | null = null;
let presentationWork = Promise.resolve();
let presentationVersion = 0;
let presentationLoading = false;
let presentationGeneration = -1;
let disposed = false;
const requestedMode = query.get('output');
if (requestedMode === 'hdr' || requestedMode === 'sdr') outputMode.value = requestedMode;
const requestedBrightness = Number(query.get('brightness') ?? 8);
range.value = String(
  Number.isFinite(requestedBrightness) ? Math.max(1, Math.min(16, requestedBrightness)) : 8,
);
brightnessLabel.value = `${range.value}×`;
// The canvas stays below real opaque HTML. Only birth locations track the DOM;
// existing sparks keep their world positions while the page scrolls or cards move.
function syncGeometry() {
  if (!field) return;
  const candidates = [...document.querySelectorAll<HTMLElement>('[data-launch]')]
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => rect.top < innerHeight * 0.8 && rect.bottom > innerHeight * 0.15);
  if (!candidates.length) return;
  const sequence = Math.floor((field.frame.time + 0.12) / Number(field.params['burstInterval']));
  const rect = candidates[sequence % candidates.length]!;
  const center = (box: DOMRect, fraction = 0.55) => [
    Math.max(-0.9, Math.min(0.9, ((box.left + box.width * fraction) / innerWidth) * 2 - 1)),
    Math.max(-0.9, Math.min(0.9, 1 - ((box.top + box.height * 0.48) / innerHeight) * 2)),
  ];
  // Pick a distant foreground element so both shells have space to open up.
  const distance = (box: DOMRect) =>
    Math.hypot(
      box.left + box.width / 2 - rect.left - rect.width / 2,
      box.top + box.height / 2 - rect.top - rect.height / 2,
    );
  const second = candidates.reduce(
    (best, box) => (distance(box) > distance(best) ? box : best),
    rect,
  );
  field.store.patch({
    origin: center(rect, second === rect ? 0.28 : 0.55),
    secondOrigin: center(second, second === rect ? 0.72 : 0.55),
  });
}
Object.assign(window, {
  fireworksDOM: {
    get field() {
      return field;
    },
    get presentation() {
      return presentation;
    },
    syncGeometry,
  },
});

function setStatus(state: string, message: string) {
  document.body.dataset['state'] = status.dataset['state'] = state;
  status.textContent = message;
}
function syncPlayback() {
  const playing = field?.playing && !field.reducedMotion;
  pause.textContent = playing ? 'Pause' : 'Play';
  setStatus('ready', playing ? 'Fireworks are live' : 'Fireworks paused');
}
pause.addEventListener('click', () => {
  if (!field) return;
  if (field.playing && !field.reducedMotion) field.pause();
  else {
    field.setReducedMotion(false);
    field.play();
  }
  syncPlayback();
});
reset.addEventListener('click', () => {
  field?.reset(7);
  syncGeometry();
});
range.addEventListener('input', () => {
  brightnessLabel.value = `${range.value}×`;
  field?.invalidate();
});
function updateOutputStatus() {
  const hdr = presentation?.hdr ?? false;
  document.body.dataset['output'] = hdr ? 'hdr' : 'sdr';
  outputStatus.textContent = hdr
    ? hdrDisplay.matches
      ? 'HDR · extended brightness'
      : 'HDR · SDR display detected'
    : outputMode.value === 'sdr'
      ? 'SDR · tone mapped'
      : 'SDR · HDR unavailable';
}
function rebuildPresentation() {
  const version = ++presentationVersion;
  presentationGeneration = field?.state === 'ready' ? field.session.generation : -1;
  presentationLoading = true;
  outputStatus.textContent = 'Preparing light…';
  presentationWork = presentationWork.then(async () => {
    if (disposed || version !== presentationVersion) return;
    presentation?.dispose();
    presentation = null;
    if (!field || field.state !== 'ready') return;
    const current = field;
    const generation = current.session.generation;
    try {
      const next = await createLightPresentation(
        current.session,
        canvas,
        outputMode.value === 'hdr' || (outputMode.value === 'auto' && hdrDisplay.matches),
        'particles',
      );
      if (
        disposed ||
        version !== presentationVersion ||
        current.session.generation !== generation ||
        current.state !== 'ready'
      ) {
        next.dispose();
        return;
      }
      presentation = next;
      presentationLoading = false;
      updateOutputStatus();
      current.invalidate();
    } catch (error) {
      if (disposed || version !== presentationVersion || current.state !== 'ready') return;
      setStatus('fallback', 'Fireworks unavailable');
      outputStatus.textContent = 'Light unavailable';
      console.error(error);
    }
  });
  return presentationWork;
}
outputMode.addEventListener('change', () => void rebuildPresentation());
hdrDisplay.addEventListener('change', () => {
  if (outputMode.value === 'auto') void rebuildPresentation();
  else updateOutputStatus();
});
shape.addEventListener('change', () => {
  field?.store.patch({ shape: shape.value });
  field?.reset(7);
  syncGeometry();
});
boxes.addEventListener('click', () => {
  const visible = document.body.classList.toggle('show-boxes');
  boxes.setAttribute('aria-pressed', String(visible));
  boxes.textContent = visible ? 'Hide boxes' : 'Show boxes';
});
document.querySelector('#rearrange')!.addEventListener('click', () => {
  document.querySelector('.notes')!.classList.toggle('rearranged');
});

let offset = { x: 0, y: 0 };
let drag: { id: number; x: number; y: number; left: number; top: number } | null = null;
function moveCard(x: number, y: number) {
  const rect = card.getBoundingClientRect();
  // Keep the handle reachable inside its section, including after a mobile resize.
  const section = card.parentElement!.getBoundingClientRect();
  const baseLeft = rect.left - offset.x;
  const baseTop = rect.top - offset.y;
  offset = {
    x: Math.max(
      section.left + 12 - baseLeft,
      Math.min(section.right - rect.width - 12 - baseLeft, x),
    ),
    y: Math.max(
      section.top + 12 - baseTop,
      Math.min(section.bottom - rect.height - 140 - baseTop, y),
    ),
  };
  card.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
  syncGeometry();
}
handle.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  handle.focus({ preventScroll: true });
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: offset.x, top: offset.y };
  handle.setPointerCapture(event.pointerId);
});
handle.addEventListener('pointermove', (event) => {
  if (drag?.id === event.pointerId)
    moveCard(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
});
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
  handle.addEventListener(event, () => {
    drag = null;
  });
}
handle.addEventListener('keydown', (event) => {
  const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
    event.key
  ];
  if (!delta) return;
  event.preventDefault();
  const step = event.shiftKey ? 40 : 16;
  moveCard(offset.x + delta[0]! * step, offset.y + delta[1]! * step);
});
window.addEventListener('resize', () => moveCard(offset.x, offset.y));

async function start() {
  try {
    if (query.has('fallback')) throw new WebGPUUnavailableError('Fallback requested');
    field = await createEffect(canvas, effect, {
      seed: 7,
      playing: query.get('playing') !== 'false',
      adaptiveQuality: false,
      dprCap: 1.5,
      present: false,
      params: {
        count: 4096,
        kind: 'fireworks',
        burstInterval: 3.6,
        burstSize: 1536,
        bursts: 2,
        shape: 'mixed',
        palette: 'vivid',
        wander: 0,
        lifetime: 2.6,
        speed: 0.85,
        gravity: 0.16,
        drag: 0.5,
        trail: 0.95,
        size: 2.2,
        exposure: 1.4,
        background: '#080f14',
      },
    });
    // Firefox batches completion notifications (~100 ms on this Mac). Keep a bounded
    // queue in flight so notification latency does not throttle rendering to 10 fps.
    field.session.scheduler.setSubmissionLimit(8);
    cleanup.push(field.onBeforeFrame(syncGeometry));
    syncGeometry();
    field.reset(7);
    cleanup.push(
      field.onRendered(() => {
        const trail = field?.textureTaps['hdr'];
        if (!presentationLoading && presentation && field && trail)
          presentation.draw(
            field.session.encoder(),
            trail,
            Number(range.value),
            Number(field.params['exposure']),
          );
      }),
    );
    cleanup.push(
      field.onChange(() => {
        if (field?.state === 'ready') {
          syncPlayback();
          if (presentationGeneration !== field.session.generation) void rebuildPresentation();
        } else if (field?.state === 'lost' || field?.state === 'building') {
          setStatus('loading', 'Reconnecting fireworks…');
          void rebuildPresentation();
        } else if (field?.state === 'error') setStatus('fallback', 'Fireworks unavailable');
      }),
    );
    await rebuildPresentation();
    if (!presentation) return;
    pause.disabled = reset.disabled = shape.disabled = false;
    range.disabled = outputMode.disabled = false;
    syncPlayback();
  } catch (error) {
    field?.destroy();
    presentation?.dispose();
    cleanup.forEach((dispose) => dispose());
    field = null;
    setStatus(
      'fallback',
      error instanceof WebGPUUnavailableError ? 'WebGPU unavailable' : 'Fireworks unavailable',
    );
    range.disabled = outputMode.disabled = true;
    outputStatus.textContent = 'Static background';
    if (!(error instanceof WebGPUUnavailableError)) console.error(error);
  }
}
window.addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  disposed = true;
  presentationVersion++;
  cleanup.forEach((dispose) => dispose());
  presentation?.dispose();
  field?.destroy();
});
void start();
