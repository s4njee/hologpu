import './products.css';
import { attach, type Attachment } from '@mk7s/hologpu/dom';
import {
  chain,
  createEffect,
  defineEffect,
  type EffectDefinition,
  type EffectField,
} from '@mk7s/hologpu';
import { heroVideoGrade } from '@mk7s/hologpu/recipes';
import depth from '@mk7s/hologpu/effects/depth-parallax';
import sheen from '@mk7s/hologpu/effects/product-sheen';
import bright from '@mk7s/hologpu/effects/bright-pass';
import bloom from '@mk7s/hologpu/effects/bloom';
import pointerMap from '@mk7s/hologpu/effects/pointer-map';
import displace from '@mk7s/hologpu/effects/displace';
import composite from '@mk7s/hologpu/effects/masked-composite';

const query = new URLSearchParams(location.search);
const mediaMotion = matchMedia('(prefers-reduced-motion: reduce)');
let reduced = query.has('reduce') || mediaMotion.matches;
let original = false,
  showDepth = false,
  requestedVideo = false,
  disposed = false;
const forceFallback = query.has('fallback');
const attachments: Attachment[] = [];
const fields: EffectField[] = [];
const interactions = new AbortController();
const get = (id: string) => document.getElementById(id)!;
const progressInput = get('progress') as HTMLInputElement;
const video = get('video').querySelector('video')!;
const options = {
  playing: false,
  reducedMotion: reduced,
  forceFallback,
  adaptiveQuality: false,
  resolutionScale: 1,
  seed: 7,
};

async function mount(id: string, effect: EffectDefinition, extra = {}) {
  const attachment = await attach(get(id), effect, { ...options, layer: 'front', ...extra });
  if (disposed) {
    attachment.destroy();
    throw new Error('Product demo disposed');
  }
  attachments.push(attachment);
  if (attachment.field) fields.push(attachment.field);
  return attachment;
}
function sync() {
  document.body.classList.toggle('show-original', original);
  document.body.classList.toggle('show-depth', showDepth);
  for (const attachment of attachments) {
    const visibility =
      original || (showDepth && attachment.host.classList.contains('depth')) ? 'hidden' : '';
    attachment.canvas.style.visibility = visibility;
    const poster = attachment.host.shadowRoot!.querySelector<HTMLImageElement>('.hgpu-poster');
    if (poster) poster.style.visibility = visibility;
    if (attachment.field) attachment.field.setReducedMotion(reduced);
  }
  for (const field of fields) field.setReducedMotion(reduced);
  for (const image of document.querySelectorAll<HTMLImageElement>('.depth-map'))
    image.hidden = !showDepth;
  get('motion').setAttribute('aria-pressed', String(reduced));
  get('motion').textContent = reduced ? 'Restore motion' : 'Reduce motion';
  get('original').setAttribute('aria-pressed', String(original));
  get('original').textContent = original ? 'Show effects' : 'Show originals';
  get('depth-maps').setAttribute('aria-pressed', String(showDepth));
  get('video-play').setAttribute('aria-pressed', String(requestedVideo && !reduced));
  get('video-play').textContent = requestedVideo && !reduced ? 'Pause video' : 'Play video';
  const videoField = attachments.find((item) => item.host.id === 'video')?.field;
  if (requestedVideo && !reduced) {
    void video
      .play()
      .then(() => {
        if (disposed || reduced || !requestedVideo) video.pause();
      })
      .catch(() => {
        requestedVideo = false;
        sync();
      });
    videoField?.play();
  } else {
    video.pause();
    videoField?.pause();
  }
}
get('original').onclick = () => {
  original = !original;
  sync();
};
get('depth-maps').onclick = () => {
  showDepth = !showDepth;
  sync();
};
get('motion').onclick = () => {
  reduced = !reduced;
  sync();
};
get('video-play').onclick = () => {
  requestedVideo = !requestedVideo;
  sync();
};
const motionChange = () => {
  reduced = query.has('reduce') || mediaMotion.matches;
  sync();
};
mediaMotion.addEventListener('change', motionChange);
function applyImageProgress() {
  const progress = Number(progressInput.value);
  for (const item of attachments) {
    if (item.effect.id === 'depth-parallax') item.set({ progress, mode: 'progress' });
    else if (item.effect.id === 'product-sheen') item.set({ progress });
  }
}
progressInput.addEventListener('input', applyImageProgress, { signal: interactions.signal });

async function boot() {
  await Promise.all([...document.querySelectorAll('img')].map((image) => image.decode()));
  for (const id of ['console', 'modules']) {
    const item = await mount(id, depth, {
      params: { mode: 'progress', progress: Number(progressInput.value) },
    });
    // Pointer control is local to the image. Leaving it restores the authored scrub pose,
    // rather than adding the last pointer position to (and saturating) the slider range.
    item.host.addEventListener('pointermove', () => item.set({ mode: 'pointer' }), {
      signal: interactions.signal,
    });
    item.host.addEventListener('pointerleave', () => item.set({ mode: 'progress' }), {
      signal: interactions.signal,
    });
    if (item.field) {
      await item.field.bindInput('image', {
        kind: 'image',
        source: item.host.querySelector<HTMLImageElement>('.original')!,
      });
      await item.field.bindInput('depth', {
        kind: 'mask',
        source: item.host.querySelector<HTMLImageElement>('.depth-map')!,
        channel: 'red',
      });
    }
  }
  const light = await mount('sheen', sheen, {
    preset: 'warm',
    params: { progress: Number(progressInput.value) },
  });
  if (light.field)
    await light.field.bindInput('image', {
      kind: 'image',
      source: light.host.querySelector('img')!,
    });
  const glow = await mount('glow', chain(bright, bloom), {
    resolutionScale: 0.5,
    poster: '/media/products/glow-overlay.png',
    params: {
      s0_threshold: 0.55,
      s0_intensity: 0.25,
      s1_threshold: 0,
      s1_knee: 0,
      s1_strength: 0.45,
      s1_levels: 4,
    },
  });
  glow.canvas.style.mixBlendMode = 'screen';
  const glowPoster = glow.host.shadowRoot!.querySelector<HTMLImageElement>('.hgpu-poster')!;
  glowPoster.style.mixBlendMode = 'screen';
  if (glow.field) {
    await glow.field.bindInput('image', { kind: 'image', source: glow.host.querySelector('img')! });
    await glow.field.bindInput('mask', {
      kind: 'mask',
      source: 'M260 207H1142V332H260Z M280 420H1120V608H280Z',
      width: 1200,
      height: 750,
    });
  }
  const lens = await mount(
    'lens',
    defineEffect({
      ...chain(displace, composite),
      imageFallback: true,
      fallback: 'transparent',
      fieldInputSampling: 'base',
    }),
    {
      params: { s0_mode: 'glass', s0_amount: 0.012, s0_glass: 0.5, s1_blend: 1 },
    },
  );
  if (lens.field) {
    const mapCanvas = document.createElement('canvas');
    mapCanvas.setAttribute('aria-hidden', 'true');
    mapCanvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;visibility:hidden;pointer-events:none';
    lens.host.append(mapCanvas);
    const map = await createEffect(mapCanvas, pointerMap as EffectDefinition, {
      ...options,
      present: false,
      pointerTarget: lens.host,
      observeTarget: lens.host,
      params: { center: [-1, -1], intensity: 0.25 },
    });
    if (disposed) {
      map.destroy();
      mapCanvas.remove();
      return;
    }
    fields.push(map);
    const image = lens.host.querySelector('img')!;
    await lens.field.bindInput('image', { kind: 'image', source: image });
    await lens.field.bindInput('original', { kind: 'image', source: image });
    await lens.field.bindInput('map', map);
    await lens.field.bindInput('mask', {
      kind: 'mask',
      source: 'M260 360H1142V662H260Z',
      width: 1200,
      height: 750,
    });
  }
  const graded = await mount('video', heroVideoGrade, { preset: 'warm' });
  if (graded.field) {
    if (video.readyState < 2)
      await new Promise<void>((resolve, reject) => {
        const sources = [...video.querySelectorAll('source')];
        const cleanup = () => {
          video.removeEventListener('loadeddata', loaded);
          video.removeEventListener('error', failed);
          for (const source of sources) source.removeEventListener('error', failed);
          window.removeEventListener('pagehide', failed);
        };
        const loaded = () => {
          cleanup();
          resolve();
        };
        const failed = () => {
          cleanup();
          reject(new Error('Video fixture could not decode'));
        };
        video.addEventListener('loadeddata', loaded, { once: true });
        video.addEventListener('error', failed, { once: true });
        for (const source of sources) source.addEventListener('error', failed, { once: true });
        window.addEventListener('pagehide', failed, { once: true });
        if (video.error || video.networkState === video.NETWORK_NO_SOURCE) failed();
        else if (video.readyState >= 2) loaded();
      });
    await graded.field.bindInput('image', { kind: 'video', source: video });
  }
  applyImageProgress();
  for (const field of fields) {
    field.beforeFrame();
    field.drawAt(0, 7);
  }
  sync();
  get('status').textContent = fields.length
    ? 'WebGPU · shared device · authored image and depth assets'
    : 'Native image and video fallbacks';
  Object.assign(window, { productsDemo: { attachments, fields, video } });
}
void boot().catch((error) => {
  if (disposed) return;
  destroyFields();
  get('status').textContent = 'Native media fallbacks · effect setup unavailable';
  Object.assign(window, { productsDemo: { attachments, fields, video } });
  console.error(error);
});
function destroyFields() {
  interactions.abort();
  video.pause();
  for (const item of attachments.splice(0)) item.destroy();
  for (const field of fields.splice(0)) field.destroy();
}
window.addEventListener(
  'pagehide',
  () => {
    disposed = true;
    mediaMotion.removeEventListener('change', motionChange);
    // Consumers go first; their borrowed map is owned by the demo.
    destroyFields();
  },
  { once: true },
);
