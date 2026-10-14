import { createEffect } from '@mk7s/hologpu';
import type { EffectField } from '@mk7s/hologpu';
import ink from '@mk7s/hologpu/effects/ink';
import './ink-paper.css';

const canvas = document.querySelector<HTMLCanvasElement>('#ink')!;
const paper = document.querySelector<HTMLElement>('#paper')!;
const status = document.querySelector<HTMLElement>('#status')!;
const pause = document.querySelector<HTMLButtonElement>('#pause')!;
const replay = document.querySelector<HTMLButtonElement>('#replay')!;
const write = document.querySelector<HTMLButtonElement>('#write')!;
const message = document.querySelector<HTMLInputElement>('#message')!;
const flow = document.querySelector<HTMLInputElement>('#flow')!;
const flowValue = document.querySelector<HTMLOutputElement>('#flow-value')!;
const query = new URLSearchParams(location.search);
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let field: EffectField<typeof ink.params> | null = null;
let disposed = false;
let updating = false;
let mask = document.createElement('canvas');
let removeRendered: (() => void) | undefined;
let removeChanged: (() => void) | undefined;
let resizeTimer: ReturnType<typeof setTimeout> | undefined;

function setStatus(state: string, text: string) {
  document.body.dataset['state'] = status.dataset['state'] = state;
  status.textContent = text;
}

function lines() {
  const text = message.value.trim() || 'Some things / stay with you.';
  const parts = text
    .split('/')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);
  return parts.length ? parts : ['Some things', 'stay with you.'];
}

function createMask() {
  const result = document.createElement('canvas');
  const rect = paper.getBoundingClientRect();
  const scale = Math.min(2, 2048 / Math.max(rect.width, rect.height));
  result.width = Math.round(rect.width * scale);
  result.height = Math.round(rect.height * scale);
  const ctx = result.getContext('2d')!;
  const text = lines();
  let size = Math.min(result.width * (rect.width < 600 ? 0.16 : 0.135), result.height * 0.24);
  const maximum = result.width * 0.79;
  ctx.font = `${size}px Parisienne`;
  const widest = Math.max(...text.map((line) => ctx.measureText(line).width));
  if (widest > maximum) size *= maximum / widest;
  ctx.font = `${size}px Parisienne`;
  ctx.fillStyle = 'white';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const spacing = size * 1.1;
  const center = result.height * 0.47;
  text.forEach((line, i) => {
    ctx.fillText(line, result.width * 0.5, center + (i - (text.length - 1) / 2) * spacing);
  });
  canvas.setAttribute(
    'aria-label',
    `Red ink reveals the hidden cursive message: ${text.join(' ')}`,
  );
  return result;
}

function syncPlayback() {
  if (!field || updating) return;
  const time = field.frame.time;
  const playing = field.playing && !field.reducedMotion;
  pause.textContent = playing
    ? 'Pause'
    : time >= 24
      ? 'Reveal again'
      : time > 0
        ? 'Resume'
        : 'Reveal';
  if (time >= 24) setStatus('settled', 'The words remain.');
  else if (!playing)
    setStatus(
      'paused',
      time === 0 ? 'The paper is ready. Reveal your message.' : 'A moment, held in ink.',
    );
  else if (time < 1.8) setStatus('ready', 'Crimson meets the paper.');
  else if (time < 6) setStatus('ready', 'The wash finds the words.');
  else if (time < 12) setStatus('ready', 'The pigment settles.');
  else setStatus('ready', 'The words remain.');
}

async function resetPaper(play = true) {
  if (!field || updating || disposed) return;
  updating = true;
  write.disabled = replay.disabled = pause.disabled = true;
  try {
    field.pause();
    mask = createMask();
    await field.setInput('resistance', { kind: 'mask', source: mask, channel: 'alpha' });
    if (disposed) return;
    field.store.set('paperFlow', Number(flow.value));
    field.reset(17);
    if (play) {
      field.setReducedMotion(false);
      field.play();
    }
  } finally {
    updating = false;
    if (!disposed) {
      write.disabled = replay.disabled = pause.disabled = false;
      syncPlayback();
    }
  }
}

pause.addEventListener('click', () => {
  if (!field) return;
  if (field.frame.time >= 24) {
    void resetPaper();
    return;
  }
  if (field.playing && !field.reducedMotion) field.pause();
  else {
    field.setReducedMotion(false);
    field.play();
  }
  syncPlayback();
});
replay.addEventListener('click', () => void resetPaper());
document.querySelector<HTMLFormElement>('#message-form')!.addEventListener('submit', (event) => {
  event.preventDefault();
  void resetPaper();
});
flow.addEventListener('input', () => {
  flowValue.value =
    Number(flow.value) < 0.22 ? 'Unhurried' : Number(flow.value) < 0.27 ? 'Easy' : 'Swift';
  field?.store.set('paperFlow', Number(flow.value));
});

const resize = new ResizeObserver(() => {
  if (!field || disposed) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => void resetPaper(field!.playing && !field!.reducedMotion), 160);
});

// The demo exposes the actual simulation and wax mask for inspecting deposition.
Object.assign(window, {
  inkPaper: {
    get field() {
      return field;
    },
    get mask() {
      return mask;
    },
    replay: resetPaper,
  },
});

async function start() {
  try {
    await document.fonts.load('100px Parisienne');
    if (disposed) return;
    field = await createEffect(canvas, ink, {
      seed: 17,
      playing: false,
      adaptiveQuality: false,
      dprCap: 2,
      resolutionScale: 1,
      params: {
        grid: Number(query.get('grid') ?? 288),
        iterations: 8,
        initial: 'rest',
        initialAmount: 0,
        force: 0,
        vorticity: 0,
        viscosity: 0,
        drag: 1,
        source: 1.4,
        feed: 'top',
        feedDuration: 9,
        paperFlow: Number(flow.value),
        absorption: 0.11,
        evaporation: 0.2,
        grain: 0.8,
        opticalDensity: 1.9,
        dyeA: '#fa3b4a',
        dyeB: '#f94150',
        background: '#f4efdf',
      },
    });
    if (disposed) {
      field.destroy();
      return;
    }
    removeRendered = field.onRendered(() => {
      // Stop scheduling GPU work after the finite wash has settled into the paper.
      if (field && field.frame.time >= 24 && field.playing) field.pause();
      syncPlayback();
    });
    removeChanged = field.onChange(syncPlayback);
    await resetPaper(query.get('playing') !== 'false' && !motion.matches);
    resize.observe(paper);
  } catch (error) {
    field?.destroy();
    field = null;
    setStatus('unavailable', 'This ink study needs a browser with WebGPU.');
    console.error('Ink paper could not start:', error);
  }
}

function dispose() {
  if (disposed) return;
  disposed = true;
  clearTimeout(resizeTimer);
  resize.disconnect();
  removeRendered?.();
  removeChanged?.();
  field?.destroy();
  field = null;
}
window.addEventListener('pagehide', (event) => {
  if (!event.persisted) dispose();
});
if (import.meta.hot) import.meta.hot.dispose(dispose);
void start();
