import './cards.css';
import { attach, type Attachment } from '@mk7s/hologpu/dom';
import aurora from '@mk7s/hologpu/effects/aurora-veil';
import glass from '@mk7s/hologpu/effects/panel-refraction';
import spotlight from '@mk7s/hologpu/effects/spotlight';
import border from '@mk7s/hologpu/effects/border-energy';
import shadow from '@mk7s/hologpu/effects/hover-lift-shadow';
import ripple from '@mk7s/hologpu/effects/press-ripple';
const query = new URLSearchParams(location.search);
const forceFallback = query.has('fallback');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let reduced = query.has('reduce') || motion.matches;
const attachments: Attachment[] = [];
const get = (id: string) => document.getElementById(id)!;
const options = {
  forceFallback,
  reducedMotion: reduced,
  adaptiveQuality: false,
  resolutionScale: 1,
  seed: 7,
};
async function mount(
  host: HTMLElement,
  effect: Parameters<typeof attach>[1],
  extra: Parameters<typeof attach>[2] = {},
) {
  const item = await attach(host, effect, { ...options, ...extra });
  attachments.push(item);
  return item;
}
function drag(host: HTMLElement) {
  const handle = host.querySelector<HTMLButtonElement>('.drag')!;
  let x = 0,
    y = 0,
    startX = 0,
    startY = 0,
    id: number | null = null;
  const move = (dx: number, dy: number) => {
    x = Math.max(-120, Math.min(120, dx));
    y = Math.max(-65, Math.min(65, dy));
    host.style.transform = `translate(${x}px,${y}px)`;
    for (const item of attachments) item.field?.invalidate();
  };
  handle.addEventListener('pointerdown', (e) => {
    id = e.pointerId;
    startX = e.clientX - x;
    startY = e.clientY - y;
    handle.setPointerCapture(id);
    host.style.zIndex = '3';
  });
  handle.addEventListener('pointermove', (e) => {
    if (e.pointerId === id) move(e.clientX - startX, e.clientY - startY);
  });
  const stop = () => {
    id = null;
    host.style.zIndex = '';
  };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
  handle.addEventListener('keydown', (e) => {
    const d: Record<string, [number, number]> = {
      ArrowLeft: [-4, 0],
      ArrowRight: [4, 0],
      ArrowUp: [0, -4],
      ArrowDown: [0, 4],
    };
    if (d[e.key]) {
      e.preventDefault();
      move(x + d[e.key]![0], y + d[e.key]![1]);
    }
  });
}
function syncMotion() {
  document.body.classList.toggle('reduced', reduced);
  get('motion').setAttribute('aria-pressed', String(reduced));
  get('motion').textContent = reduced ? 'Motion reduced' : 'Reduce motion';
  for (const item of attachments) item.setReducedMotion(reduced);
}
get('motion').addEventListener('click', () => {
  reduced = !reduced;
  syncMotion();
});
motion.addEventListener('change', (e) => {
  reduced = e.matches;
  syncMotion();
});
get('fallback').setAttribute('href', forceFallback ? '?' : '?fallback=1');
get('fallback').textContent = forceFallback ? 'GPU preview' : 'CSS preview';
let count = 0;
get('action').addEventListener('click', () => {
  get('count').textContent = `Action ${++count} received.`;
});
async function boot() {
  const hero = await mount(get('hero'), aurora, { preset: 'dusk', resolutionScale: 0.5 });
  for (const [i, host] of [...document.querySelectorAll<HTMLElement>('.glass')].entries()) {
    const panel = await mount(host, glass, { preset: i === 1 ? 'frost' : 'clear' });
    await panel.bindBackdrop(hero);
    drag(host);
  }
  await mount(get('grid'), spotlight, { preset: 'card-spotlight' });
  for (const host of document.querySelectorAll<HTMLElement>('.lift'))
    await mount(host, shadow, { padding: 40 });
  for (const host of document.querySelectorAll<HTMLElement>('.trace'))
    await mount(host, border, { preset: 'border-trace', padding: 16 });
  await mount(get('press'), ripple, { layer: 'front' });
  syncMotion();
  get('status').textContent = attachments.every((a) => a.state === 'ready')
    ? 'WebGPU · 1 shared device'
    : 'CSS fallbacks · native interactions';
  Object.assign(window, { cardsDemo: { attachments, hero } });
}
void boot().catch((error) => {
  get('status').textContent = 'Surface setup failed';
  console.error(error);
});
window.addEventListener(
  'pagehide',
  () => {
    for (const item of attachments) item.destroy();
  },
  { once: true },
);
