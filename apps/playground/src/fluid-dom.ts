import { createEffect, WebGPUUnavailableError } from '@mk7s/hologpu';
import type { EffectField } from '@mk7s/hologpu';
import fluidObstacles from '@mk7s/hologpu/effects/fluid-obstacles';
import { DomRectsInput } from '@mk7s/hologpu/dom';
import { createLightPresentation } from './dom-light-presentation.ts';
import './fluid-dom.css';

const canvas = document.querySelector<HTMLCanvasElement>('#fluid')!;
const status = document.querySelector<HTMLElement>('#status')!;
const pause = document.querySelector<HTMLButtonElement>('#pause')!;
const reset = document.querySelector<HTMLButtonElement>('#reset')!;
const boundaries = document.querySelector<HTMLInputElement>('#boundaries')!;
const palette = document.querySelector<HTMLSelectElement>('#palette')!;
const range = document.querySelector<HTMLInputElement>('#brightness')!;
const brightnessLabel = document.querySelector<HTMLOutputElement>('#brightness-value')!;
const outputMode = document.querySelector<HTMLSelectElement>('#output-mode')!;
const outputStatus = document.querySelector<HTMLElement>('#output-status')!;
const hdrDisplay = matchMedia('(dynamic-range: high)');
const boxes = document.querySelector<HTMLButtonElement>('#show-boxes')!;
const card = document.querySelector<HTMLElement>('#floating-card')!;
const handle = document.querySelector<HTMLButtonElement>('#drag-handle')!;
const query = new URLSearchParams(location.search);
let field: EffectField<typeof fluidObstacles.params> | null = null;
let obstacles: DomRectsInput | null = null;
let emptyObstacles: DomRectsInput | null = null;
let removeRefresh: (() => void) | undefined;
let removeChange: (() => void) | undefined;
let removeRender: (() => void) | undefined;
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
const palettes = {
  lagoon: { dyeA: '#35d6b3', dyeB: '#ef795e' },
  ember: { dyeA: '#ff9e42', dyeB: '#ed496b' },
  violet: { dyeA: '#aa86ed', dyeB: '#53c9ed' },
} as const;

// Expose the actual field and geometry for inspecting the demo's GPU boundaries.
const demo = {
  get field() {
    return field;
  },
  get obstacles() {
    return obstacles;
  },
  get presentation() {
    return presentation;
  },
};
Object.assign(window, { fluidDOM: demo });

function setStatus(state: string, message: string) {
  document.body.dataset['state'] = status.dataset['state'] = state;
  status.textContent = message;
}
function syncPlayback() {
  const playing = field?.playing && !field.reducedMotion;
  pause.textContent = playing ? 'Pause' : 'Play';
  setStatus('ready', playing ? 'Fluid is live' : 'Fluid paused');
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
boundaries.addEventListener('change', () => {
  if (!field || !obstacles || !emptyObstacles) return;
  // An empty live source removes every wall, including the catalogue reference boxes.
  void field.setInput('obstacles', boundaries.checked ? obstacles : emptyObstacles);
  field.invalidate();
});
boxes.addEventListener('click', () => {
  const visible = document.body.classList.toggle('show-boxes');
  boxes.setAttribute('aria-pressed', String(visible));
  boxes.textContent = visible ? 'Hide boxes' : 'Show boxes';
});
palette.addEventListener('change', () => {
  field?.store.patch(palettes[palette.value as keyof typeof palettes]);
  field?.reset(7);
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
      setStatus('fallback', 'Fluid unavailable');
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
    field = await createEffect(canvas, fluidObstacles, {
      seed: 7,
      playing: query.get('playing') !== 'false',
      // Completion notification latency is not GPU execution time in Firefox.
      // Keep this small solver fixed instead of degrading it on delayed callbacks.
      adaptiveQuality: false,
      dprCap: 1,
      resolutionScale: 0.75,
      // The demo owns one HDR/SDR final pass on this canvas instead of the SDR resolve.
      present: false,
      pointerTarget: document.body,
      params: {
        grid: 160,
        iterations: 16,
        initial: 'vortices',
        initialAmount: 2.5,
        source: 1.2,
        force: 0.7,
        vorticity: 1.4,
        dissipation: 0.14,
        background: '#080f14',
        ...palettes.ember,
      },
    });
    // Firefox batches WebGPU completion notifications at about 100 ms on this Mac.
    // Allow a bounded pipeline instead of waiting for every notification before rAF.
    field.session.scheduler.setSubmissionLimit(8);
    obstacles = new DomRectsInput(document.body, { coordinateTarget: canvas });
    emptyObstacles = new DomRectsInput(document.body, {
      coordinateTarget: canvas,
      selector: '[data-no-obstacles]',
    });
    removeChange = obstacles.subscribe(() => field?.invalidate());
    // Observers track scroll, resize and DOM mutations. Only active dragging
    // needs an extra synchronous measurement; a stationary page does no layout polling.
    removeRefresh = field.onBeforeFrame(() => {
      if (drag) obstacles?.refresh();
    });
    await field.setInput('obstacles', obstacles);
    field.reset(7);
    removeRender = field.onRendered(() => {
      if (!presentationLoading && presentation && field?.output)
        presentation.draw(field.session.encoder(), field.output, Number(range.value));
    });
    field.onChange(() => {
      if (field?.state === 'ready') {
        syncPlayback();
        if (presentationGeneration !== field.session.generation) void rebuildPresentation();
      } else if (field?.state === 'lost' || field?.state === 'building') {
        setStatus('loading', 'Reconnecting fluid…');
        void rebuildPresentation();
      } else if (field?.state === 'error') setStatus('fallback', 'Fluid unavailable');
    });
    await rebuildPresentation();
    if (!presentation) return;
    pause.disabled = reset.disabled = false;
    range.disabled = outputMode.disabled = false;
    syncPlayback();
  } catch (error) {
    field?.destroy();
    presentation?.dispose();
    obstacles?.dispose();
    emptyObstacles?.dispose();
    field = null;
    obstacles = null;
    setStatus(
      'fallback',
      error instanceof WebGPUUnavailableError ? 'WebGPU unavailable' : 'Fluid unavailable',
    );
    boundaries.disabled = palette.disabled = range.disabled = outputMode.disabled = true;
    outputStatus.textContent = 'Static background';
    if (!(error instanceof WebGPUUnavailableError)) console.error(error);
  }
}
window.addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  disposed = true;
  presentationVersion++;
  removeRefresh?.();
  removeChange?.();
  removeRender?.();
  presentation?.dispose();
  field?.destroy();
  obstacles?.dispose();
  emptyObstacles?.dispose();
});
void start();
