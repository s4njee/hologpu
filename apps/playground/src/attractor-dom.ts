import { createEffect, WebGPUUnavailableError } from '@mk7s/hologpu';
import type { EffectField } from '@mk7s/hologpu';
import effect, { rectLimit } from './attractor-dom-effect.ts';
import { DomRectsInput } from '@mk7s/hologpu/dom';
import { createLightPresentation } from './dom-light-presentation.ts';
import './attractor-dom.css';

const canvas = document.querySelector<HTMLCanvasElement>('#particles')!;
const status = document.querySelector<HTMLElement>('#status')!;
const pause = document.querySelector<HTMLButtonElement>('#pause')!;
const reset = document.querySelector<HTMLButtonElement>('#reset')!;
const forces = document.querySelector<HTMLInputElement>('#forces')!;
const reverse = document.querySelector<HTMLButtonElement>('#reverse')!;
const boxes = document.querySelector<HTMLButtonElement>('#show-boxes')!;
const preset = document.querySelector<HTMLSelectElement>('#color-preset')!;
const range = document.querySelector<HTMLInputElement>('#brightness')!;
const brightnessLabel = document.querySelector<HTMLOutputElement>('#brightness-value')!;
const outputMode = document.querySelector<HTMLSelectElement>('#output-mode')!;
const outputStatus = document.querySelector<HTMLElement>('#output-status')!;
const hdrDisplay = matchMedia('(dynamic-range: high)');
const card = document.querySelector<HTMLElement>('#floating-card')!;
const handle = document.querySelector<HTMLButtonElement>('#drag-handle')!;
const query = new URLSearchParams(location.search);
let field: EffectField<typeof effect.params> | null = null;
let pulls: DomRectsInput | null = null;
let pushes: DomRectsInput | null = null;
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
const colorPresets = {
  blue: { particles: '#1677ff', accent: '#83b8ff', attraction: '#edba85' },
  violet: { particles: '#9254ff', accent: '#c3a0ff', attraction: '#f1bcdf' },
  mint: { particles: '#21dfad', accent: '#8ce9ce', attraction: '#eed192' },
  ember: { particles: '#ff7524', accent: '#ffb980', attraction: '#f1d6a1' },
  rose: { particles: '#ff338b', accent: '#ff99c5', attraction: '#c8acff' },
} as const;
function applyColorPreset() {
  const colors = colorPresets[preset.value as keyof typeof colorPresets] ?? colorPresets.blue;
  const style = document.documentElement.style;
  style.setProperty('--mint', colors.accent);
  style.setProperty('--accent-border', `${colors.accent}80`);
  style.setProperty('--particle-color', colors.particles);
  style.setProperty('--attraction-accent', colors.attraction);
  style.setProperty('--attraction-border', `${colors.attraction}55`);
  style.setProperty('--attraction-divider', `${colors.attraction}33`);
  field?.store.patch({ tint: colors.particles });
}
preset.addEventListener('change', applyColorPreset);
applyColorPreset();
Object.assign(window, {
  attractorDOM: {
    get field() {
      return field;
    },
    get pulls() {
      return pulls;
    },
    get pushes() {
      return pushes;
    },
    get presentation() {
      return presentation;
    },
  },
});
function syncGeometry() {
  if (!field || !pulls || !pushes) return;
  const patch: Record<string, number | readonly number[]> = {};
  for (const [kind, source] of [
    ['pull', pulls],
    ['push', pushes],
  ] as const) {
    const rects = source.snapshot();
    patch[`${kind}Count`] = rects.length;
    rects.forEach((rect, i) => {
      patch[`${kind}${i}`] = rect;
    });
  }
  field.store.patch(patch);
}

function setStatus(state: string, message: string) {
  document.body.dataset['state'] = status.dataset['state'] = state;
  status.textContent = message;
}
function syncPlayback() {
  const playing = field?.playing && !field.reducedMotion;
  pause.textContent = playing ? 'Pause' : 'Play';
  setStatus('ready', playing ? 'Particles are live' : 'Particles paused');
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
reset.addEventListener('click', () => field?.reset(7));
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
      setStatus('fallback', 'Particles unavailable');
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
forces.addEventListener('change', () => {
  field?.store.patch({ strength: forces.checked ? 1 : 0 });
});
reverse.addEventListener('click', () => {
  const reversed = document.body.classList.toggle('reversed');
  reverse.setAttribute('aria-pressed', String(reversed));
  field?.store.patch({ polarity: reversed ? -1 : 1 });
  document.querySelector('.card-footnote')!.textContent =
    `${reversed ? 'REPELLING' : 'ATTRACTING'} / DRAG TO MOVE`;
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
        tint: colorPresets[preset.value as keyof typeof colorPresets].particles,
        strength: forces.checked ? 1 : 0,
        polarity: document.body.classList.contains('reversed') ? -1 : 1,
      },
    });
    // Firefox batches completion notifications (~100 ms on this Mac). Keep a bounded
    // queue in flight so notification latency does not throttle rendering to 10 fps.
    field.session.scheduler.setSubmissionLimit(8);
    pulls = new DomRectsInput(document.body, {
      coordinateTarget: canvas,
      selector: '[data-pull]',
      maxRects: rectLimit,
    });
    pushes = new DomRectsInput(document.body, {
      coordinateTarget: canvas,
      selector: '[data-push]',
      maxRects: rectLimit,
    });
    cleanup.push(pulls.subscribe(syncGeometry), pushes.subscribe(syncGeometry));
    cleanup.push(
      field.onBeforeFrame(() => {
        if (drag) {
          pulls?.refresh();
          pushes?.refresh();
        }
      }),
    );
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
    field.onChange(() => {
      if (field?.state === 'ready') {
        syncPlayback();
        if (presentationGeneration !== field.session.generation) void rebuildPresentation();
      } else if (field?.state === 'lost' || field?.state === 'building') {
        setStatus('loading', 'Reconnecting particles…');
        void rebuildPresentation();
      } else if (field?.state === 'error') setStatus('fallback', 'Particles unavailable');
    });
    await rebuildPresentation();
    if (!presentation) return;
    pause.disabled = reset.disabled = false;
    range.disabled = outputMode.disabled = false;
    syncPlayback();
  } catch (error) {
    field?.destroy();
    presentation?.dispose();
    cleanup.forEach((dispose) => dispose());
    pulls?.dispose();
    pushes?.dispose();
    field = null;
    pulls = pushes = null;
    setStatus(
      'fallback',
      error instanceof WebGPUUnavailableError ? 'WebGPU unavailable' : 'Particles unavailable',
    );
    forces.disabled = reverse.disabled = range.disabled = outputMode.disabled = true;
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
  pulls?.dispose();
  pushes?.dispose();
});
void start();
