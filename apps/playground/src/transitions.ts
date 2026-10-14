import { attach, type Attachment } from '@mk7s/hologpu/dom';
import sectionWipe from '@mk7s/hologpu/effects/section-wipe';
import waveDivider, { waveDividerPath } from '@mk7s/hologpu/effects/wave-divider';
import progressLine, { progressLinePath } from '@mk7s/hologpu/effects/progress-line';
import type { EffectField, EffectDefinition } from '@mk7s/hologpu';

const query = new URLSearchParams(location.search);
const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const story = get('story'),
  wipe = get('wipe'),
  wave = get('wave'),
  line = get('line');
const slider = get<HTMLInputElement>('progress'),
  output = get<HTMLOutputElement>('progress-value');
const motionMedia = matchMedia('(prefers-reduced-motion: reduce)');
const attachments: Attachment[] = [],
  fields: EffectField[] = [];
let disposed = false,
  pending = 0,
  following = !query.has('progress');
let reduced = query.get('reduce') === '1' || motionMedia.matches;
let showFallback = query.get('fallback') === '1';
let progress = Math.max(0, Math.min(1, Number(query.get('progress') ?? 0) || 0));
const lineParams = {
  pointCount: 6,
  p0: [0.04, 0.65],
  p1: [0.24, 0.65],
  p2: [0.38, 0.32],
  p3: [0.58, 0.32],
  p4: [0.74, 0.65],
  p5: [0.96, 0.65],
  width: 1.5,
  tint: '#596684',
  intensity: 0.7,
};
const waveParams = { fill: '#eae9f2', amplitude: 18, baseline: 0.5, cycles: 1.15, phase: 0 };
type NativeTimeline = { currentTime: { value: number } | null };
const Timeline = (
  window as unknown as {
    ViewTimeline?: new (options: {
      subject: Element;
      axis: string;
      inset: string[];
    }) => NativeTimeline;
  }
).ViewTimeline;
let timeline: NativeTimeline | undefined;
if (Timeline && query.get('timeline') !== 'geometry') {
  try {
    timeline = new Timeline({ subject: story, axis: 'block', inset: ['35%', '35%'] });
  } catch {
    /* Geometry keeps the same scroll range on older engines. */
  }
}

function syncProgress() {
  slider.value = String(progress);
  output.value = `${Math.round(progress * 100)}%`;
  for (const host of [wipe, line]) {
    host.style.setProperty('--progress', String(progress));
    host.style.setProperty('--hgpu-progress', String(progress));
  }
  wipe.style.setProperty('--cut', progress < 0.5 ? '0' : '1');
  wipe.dataset.cut = String(reduced);
  line.dataset.empty = String(progress <= 0);
  for (const item of attachments) if (item.effect.id !== 'wave-divider') item.set({ progress });
  get('scroll-mode').setAttribute('aria-pressed', String(following));
}
function syncMotion() {
  get('motion').setAttribute('aria-pressed', String(reduced));
  get('motion').textContent = reduced ? 'Restore motion' : 'Reduce motion';
  for (const item of attachments) item.setReducedMotion(reduced);
  syncProgress();
}
function syncFallback() {
  get('fallback').setAttribute('aria-pressed', String(showFallback));
  get('fallback').textContent = showFallback ? 'Show effects' : 'Show fallbacks';
  for (const host of [wipe, wave, line]) host.dataset.showFallback = String(showFallback);
  for (const item of attachments) {
    item.canvas.style.visibility =
      showFallback || (item.effect.id === 'section-wipe' && wipe.dataset.inputsReady !== 'true')
        ? 'hidden'
        : '';
    if (item.field) item.field.visible = !showFallback;
  }
}
function updateScroll() {
  pending = 0;
  if (!following || disposed) return;
  const rect = story.getBoundingClientRect();
  const native = timeline?.currentTime?.value;
  progress = Math.max(
    0,
    Math.min(
      1,
      typeof native === 'number' && Number.isFinite(native)
        ? native / 100
        : (innerHeight * 0.65 - rect.top) / Math.max(1, rect.height + innerHeight * 0.3),
    ),
  );
  syncProgress();
}
function scheduleScroll() {
  if (!disposed && following && !pending) pending = requestAnimationFrame(updateScroll);
}
function resizePaths() {
  if (
    disposed ||
    wave.clientWidth <= 0 ||
    wave.clientHeight <= 0 ||
    line.clientWidth <= 0 ||
    line.clientHeight <= 0
  )
    return;
  for (const [host, path] of [
    [wave, waveDividerPath(wave.clientWidth, wave.clientHeight, waveParams)],
    [line, progressLinePath(line.clientWidth, line.clientHeight, lineParams)],
  ] as const) {
    const svg = host.querySelector('svg')!;
    svg.setAttribute('viewBox', `0 0 ${host.clientWidth} ${host.clientHeight}`);
    svg.style.width = `${host.clientWidth}px`;
    svg.style.height = `${host.clientHeight}px`;
    svg.querySelector('path')!.setAttribute('d', path);
  }
  scheduleScroll();
}
const observer = new ResizeObserver(resizePaths);
observer.observe(wave);
observer.observe(line);
observer.observe(story);
slider.addEventListener('input', () => {
  following = false;
  progress = Number(slider.value);
  syncProgress();
});
get('scroll-mode').addEventListener('click', () => {
  following = !following;
  syncProgress();
  scheduleScroll();
});
get('motion').addEventListener('click', () => {
  reduced = !reduced;
  syncMotion();
});
get('fallback').addEventListener('click', () => {
  showFallback = !showFallback;
  syncFallback();
});
get<HTMLSelectElement>('wipe-mode').addEventListener('change', (event) => {
  const mode = (event.target as HTMLSelectElement).value;
  wipe.dataset.mode = mode;
  attachments.find((a) => a.effect.id === 'section-wipe')?.set({ mode });
});
const motionChange = () => {
  reduced = motionMedia.matches;
  syncMotion();
};
motionMedia.addEventListener('change', motionChange);
window.addEventListener('scroll', scheduleScroll, { passive: true });
window.addEventListener('resize', scheduleScroll);
resizePaths();
syncMotion();
syncFallback();
scheduleScroll();

async function boot() {
  for (const [host, effect, params] of [
    [wipe, sectionWipe, { progress, mode: get<HTMLSelectElement>('wipe-mode').value }],
    [wave, waveDivider, waveParams],
    [line, progressLine, { ...lineParams, progress }],
  ] as const) {
    const item = await attach(host, effect as EffectDefinition, {
      layer: 'front',
      poster: '',
      params,
      reducedMotion: reduced,
      playing: effect.id === 'wave-divider',
      adaptiveQuality: false,
      forceFallback: query.get('fallback') === '1',
      seed: 7,
    });
    if (disposed) {
      item.destroy();
      return;
    }
    attachments.push(item);
    if (item.field) fields.push(item.field);
    if (effect.id === 'section-wipe' && item.field) {
      item.canvas.style.visibility = 'hidden';
      const images = [...wipe.querySelectorAll<HTMLImageElement>('img')];
      await Promise.all(images.map((image) => image.decode()));
      if (disposed) return;
      await item.field.bindInput('image', { kind: 'image', source: images[0]! });
      await item.field.bindInput('next', { kind: 'image', source: images[1]! });
      if (disposed) return;
      wipe.dataset.inputsReady = 'true';
      item.canvas.style.visibility = showFallback ? 'hidden' : '';
    }
  }
  if (disposed) return;
  syncMotion();
  syncFallback();
  syncProgress();
  attachments
    .find((a) => a.effect.id === 'section-wipe')
    ?.set({ mode: get<HTMLSelectElement>('wipe-mode').value });
  scheduleScroll();
  get('status').textContent = fields.length
    ? 'WebGPU · authored images · native scroll progress'
    : 'Native image and SVG fallbacks';
  Object.assign(window, {
    transitionsDemo: {
      attachments,
      fields,
      get progress() {
        return progress;
      },
      get following() {
        return following;
      },
      timeline: timeline ? 'view-timeline' : 'geometry',
    },
  });
}
function destroy() {
  for (const item of attachments.splice(0)) item.destroy();
  fields.splice(0);
}
void boot().catch((error) => {
  if (disposed) return;
  destroy();
  get('status').textContent = 'Native image and SVG fallbacks · effect setup unavailable';
  console.error(error);
  Object.assign(window, { transitionsDemo: { attachments, fields } });
});
window.addEventListener(
  'pagehide',
  () => {
    disposed = true;
    cancelAnimationFrame(pending);
    observer.disconnect();
    motionMedia.removeEventListener('change', motionChange);
    window.removeEventListener('scroll', scheduleScroll);
    window.removeEventListener('resize', scheduleScroll);
    destroy();
  },
  { once: true },
);
