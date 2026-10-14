import './launch.css';
import {
  attach,
  configurePageBudget,
  pageBudgetSnapshot,
  type Attachment,
  type AttachOptions,
} from '@mk7s/hologpu/dom';
import type { EffectDefinition } from '@mk7s/hologpu';
import aurora from '@mk7s/hologpu/effects/aurora-veil';
import grain from '@mk7s/hologpu/effects/grain-overlay';
import shimmer from '@mk7s/hologpu/effects/text-shimmer';
import spotlight from '@mk7s/hologpu/effects/spotlight';
import border from '@mk7s/hologpu/effects/border-energy';
import depth from '@mk7s/hologpu/effects/depth-parallax';
import wave, { waveDividerPath } from '@mk7s/hologpu/effects/wave-divider';
import horizon from '@mk7s/hologpu/effects/grid-horizon';
const query = new URLSearchParams(location.search);
const media = matchMedia('(prefers-reduced-motion: reduce)');
let reduced = query.has('reduce') || media.matches;
const controller = new AbortController();
const attachments: Attachment[] = [];
const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
configurePageBudget({ milliseconds: 4 });
async function mount(host: HTMLElement, effect: EffectDefinition, options: AttachOptions = {}) {
  const item = await attach(host, effect, {
    signal: controller.signal,
    seed: 7,
    reducedMotion: reduced,
    forceFallback: query.has('fallback'),
    adaptiveQuality: false,
    dprCap: 2,
    ...options,
  });
  attachments.push(item);
  return item;
}
function syncMotion() {
  document.body.classList.toggle('reduced', reduced);
  get('motion').setAttribute('aria-pressed', String(reduced));
  get('motion').textContent = reduced ? 'Restore motion' : 'Reduce motion';
  for (const item of attachments) item.setReducedMotion(reduced);
}
get('motion').addEventListener(
  'click',
  () => {
    reduced = !reduced;
    syncMotion();
  },
  { signal: controller.signal },
);
media.addEventListener(
  'change',
  (event) => {
    reduced = event.matches;
    syncMotion();
  },
  { signal: controller.signal },
);
get<HTMLSelectElement>('palette').addEventListener(
  'change',
  (event) => {
    document.body.dataset.palette = (event.target as HTMLSelectElement).value;
    for (const item of attachments) {
      if (item.effect.id === 'aurora-veil') item.preset((event.target as HTMLSelectElement).value);
      item.field?.invalidate();
    }
  },
  { signal: controller.signal },
);
get('fallback').setAttribute('href', query.has('fallback') ? 'launch.html' : '?fallback=1');
get('fallback').textContent = query.has('fallback') ? 'View effects' : 'View fallbacks';
function updateWave() {
  const host = get('wave'),
    r = host.getBoundingClientRect();
  host.querySelector('svg')!.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
  host.querySelector('path')!.setAttribute('d', waveDividerPath(r.width, r.height));
}
const resize = new ResizeObserver(updateWave);
resize.observe(get('wave'));
updateWave();
async function boot() {
  await document.fonts.ready;
  await mount(get('home'), aurora, {
    preset: 'ember',
    resolutionScale: 0.25,
    params: { intensity: 0.22, pointerBias: 0 },
  });
  await mount(get('grain'), grain, { layer: 'front', resolutionScale: 0.5, params: { rate: 12 } });
  await mount(get('headline'), shimmer, {
    layer: 'front',
    renderOn: 'interaction',
    idleAfter: 1200,
  });
  await mount(get('cards'), spotlight, {
    preset: 'card-spotlight',
    layer: 'front',
    playing: false,
    resolutionScale: 0.5,
  });
  for (const host of document.querySelectorAll<HTMLElement>('.card'))
    await mount(host, border, {
      preset: 'border-trace',
      padding: 16,
      renderOn: 'interaction',
      idleAfter: 600,
      resolutionScale: 0.5,
    });
  const image = get('shot').querySelector('img')!;
  const depthImage = new Image();
  depthImage.src = new URL('media/products/console-depth.png', location.href).href;
  await Promise.all([image.decode(), depthImage.decode()]);
  const shot = await mount(get('shot'), depth, {
    playing: false,
    layer: 'front',
    params: { mode: 'progress', progress: 0.5 },
    resolutionScale: 0.5,
  });
  if (shot.field) {
    await shot.field.bindInput('image', { kind: 'image', source: image });
    await shot.field.bindInput('depth', { kind: 'mask', source: depthImage, channel: 'red' });
    shot.field.drawAt(0, 7);
    await shot.field.session.device.queue.onSubmittedWorkDone();
  }
  get<HTMLInputElement>('scrub').addEventListener(
    'input',
    (event) => {
      const value = Number((event.target as HTMLInputElement).value);
      shot.set({ mode: 'progress', progress: value });
      get<HTMLOutputElement>('scrub-value').value = `${Math.round(value * 100)}%`;
    },
    { signal: controller.signal },
  );
  get('shot').addEventListener('pointermove', () => shot.set({ mode: 'pointer' }), {
    signal: controller.signal,
  });
  get('shot').addEventListener('pointerleave', () => shot.set({ mode: 'progress' }), {
    signal: controller.signal,
  });
  await mount(get('wave'), wave, { layer: 'front', poster: '', resolutionScale: 0.5 });
  await mount(get('horizon'), horizon, { resolutionScale: 0.5, params: { speed: 0.025 } });
  syncMotion();
  get('status').textContent = attachments.every((a) => a.state === 'ready')
    ? 'WebGPU surfaces ready'
    : 'Native fallbacks ready';
  Object.assign(window, {
    launchDemo: { attachments, budget: pageBudgetSnapshot, configureBudget: configurePageBudget },
  });
}
void boot().catch((error) => {
  get('status').textContent = 'Surface setup failed';
  console.error(error);
});
window.addEventListener(
  'pagehide',
  () => {
    controller.abort();
    resize.disconnect();
  },
  { once: true },
);
