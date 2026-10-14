import { chain, createEffect, filterEffect, fragmentEffect, type EffectField } from '@mk7s/hologpu';
import displace from '@mk7s/hologpu/effects/displace';
import './lcd.css';
import { mountBillboards } from './lcd-billboards.ts';
import { StreetLights } from './lcd-lights.ts';
import { BackgroundRain } from './lcd-rain.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const photo = $<HTMLImageElement>('photo');
const canvas = $<HTMLCanvasElement>('lcd-canvas');
const status = $('status');
let field: EffectField | undefined;
let mapField: EffectField<typeof pointerMap.params> | undefined;
const mapCanvas = document.createElement('canvas');
mapCanvas.className = 'map-canvas';
mapCanvas.setAttribute('aria-hidden', 'true');
$('scene').prepend(mapCanvas);
let disposed = false;
let removeBillboards = () => {};
let lights: StreetLights | undefined;
let rain: BackgroundRain | undefined;

// Composite the catalogue's actual displace filter over its original input.
// A separate mask keeps the photograph, bezel and foreground fingers stationary.
const composite = filterEffect({
  id: 'lcd-composite',
  title: 'LCD surface mask',
  inputs: ['image', 'mask'],
  params: {
    sceneSource: { type: 'texture', default: 'original' },
    maskSource: { type: 'texture', default: 'mask' },
    blend: { type: 'f32', default: 1, min: 0, max: 1 },
  },
  wgsl: /* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
  let original = sample_sceneSource(uv);
  let surface = sample_maskSource(uv).r * params.blend;
  return mix(original, sample_image(uv), surface);
}`,
});

/** Traced in the 2048 × 1117 reference space; scaled with the full photograph. */
function surfaceMask(): HTMLCanvasElement {
  const mask = document.createElement('canvas');
  mask.width = 1024;
  mask.height = 559;
  const ctx = mask.getContext('2d')!;
  ctx.scale(mask.width / 2048, mask.height / 1117);
  ctx.fillStyle = 'white';
  ctx.fill(
    new Path2D(
      'M 732 350 L 1387 341 Q 1408 343 1409 364 L 1428 830 Q 1428 850 1408 853 L 709 847 Q 687 846 690 823 L 716 368 Q 717 352 732 350 Z',
    ),
  );
  ctx.globalCompositeOperation = 'destination-out';
  // Left thumb and the hand's inner silhouette.
  ctx.fill(
    new Path2D(
      'M 0 540 L 650 540 L 670 676 Q 695 636 728 602 Q 746 579 763 596 Q 786 612 765 648 Q 755 668 740 691 Q 711 732 704 781 Q 700 830 673 872 L 650 1117 L 0 1117 Z',
    ),
  );
  // Right thumb crosses the display before joining the palm outside the bezel.
  ctx.fill(
    new Path2D(
      'M 1500 520 L 2048 520 L 2048 1117 L 1430 1117 L 1430 810 Q 1414 751 1379 704 Q 1351 673 1339 639 Q 1326 610 1348 590 Q 1364 577 1382 598 Q 1403 620 1418 641 L 1455 530 Z',
    ),
  );
  ctx.globalCompositeOperation = 'source-over';
  // Feather the edge by a few source pixels so it follows the glass naturally.
  const feathered = document.createElement('canvas');
  feathered.width = mask.width;
  feathered.height = mask.height;
  const feather = feathered.getContext('2d')!;
  feather.fillStyle = 'black';
  feather.fillRect(0, 0, mask.width, mask.height);
  feather.filter = 'blur(2px)';
  feather.drawImage(mask, 0, 0);
  return feathered;
}

// Render vectors directly into a linear float texture: normal and signed flow
// encodings must bypass the image uploader's sRGB transfer. Every surface mode
// receives a local lens around the pointer; Glass also uses its height gradient.
const pointerMap = fragmentEffect({
  id: 'lcd-pointer-map',
  title: 'Pointer-driven LCD normal / flow map',
  params: {
    center: { type: 'vec2', default: [0.52, 0.55] },
    encoding: { type: 'enum', default: 'normal', options: ['normal', 'flow'] },
  },
  wgsl: /* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
  let q = (uv - params.center) * vec2f(1.833333, 1.0);
  let lens = exp(-dot(q, q) * 140.0);
  let grain = vec2f(
    sin(uv.y * 37.0 + uv.x * 11.0) * .12 + cos(uv.x * 29.0 - uv.y * 8.0) * .06,
    cos(uv.x * 33.0 + uv.y * 9.0) * .12 + sin(uv.y * 27.0 - uv.x * 13.0) * .06
  );
  let slope = grain + (q * 12.0 + vec2f(-q.y, q.x) * 5.0) * lens;
  let height = .5 + .2 * sin(uv.x * 31.0 + uv.y * 23.0) + .48 * lens;
  let vector = select(slope * .5 + .5, slope, params.encoding == 1u);
  return vec4f(vector, height, 1.0);
}`,
});

function updateIntensity() {
  const amount = Number($<HTMLInputElement>('amount').value);
  $('amount-value').textContent = `${amount}%`;
  field?.store.set('s0_amount', (amount / 100) * 0.028);
}
$('amount').addEventListener('input', updateIntensity);
$('billboard-motion').onclick = () => {
  const playing = $('billboard-motion').getAttribute('aria-pressed') !== 'true';
  $('billboard-motion').setAttribute('aria-pressed', String(playing));
  $('billboard-motion').textContent = playing ? 'Pause signs' : 'Play signs';
  $('billboards').dataset['hcssMotion'] = playing ? 'full' : 'none';
};
$('light-motion').onclick = () => {
  const playing = $('light-motion').getAttribute('aria-pressed') !== 'true';
  $('light-motion').setAttribute('aria-pressed', String(playing));
  $('light-motion').textContent = playing ? 'Pause lights' : 'Play lights';
  lights?.setPlaying(playing);
};
$('rain-motion').onclick = () => {
  const playing = $('rain-motion').getAttribute('aria-pressed') !== 'true';
  $('rain-motion').setAttribute('aria-pressed', String(playing));
  $('rain-motion').textContent = playing ? 'Pause rain' : 'Play rain';
  rain?.setPlaying(playing);
};
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
  button.onclick = () => {
    field?.store.set('s0_mode', button.dataset['mode']!);
    for (const mode of document.querySelectorAll('[data-mode]'))
      mode.setAttribute('aria-pressed', String(mode === button));
  };
}
$('encoding').onchange = () => {
  const encoding = $<HTMLSelectElement>('encoding').value;
  mapField?.store.set('encoding', encoding);
  field?.store.set('s0_encoding', encoding);
};
$('original').onclick = () => {
  if (!field) return;
  const original = $('original').getAttribute('aria-pressed') !== 'true';
  field.store.set('s1_blend', original ? 0 : 1);
  $('original').setAttribute('aria-pressed', String(original));
  $('scene').classList.toggle('show-original', original);
  lights?.sync();
  rain?.sync();
  $('original').textContent = original ? 'View effect' : 'View original';
  $('hint').textContent = original
    ? 'Original photograph'
    : 'Move across the glass to steer the ripples';
};
function showError(error: unknown) {
  status.dataset['state'] = 'error';
  status.textContent = `Surface unavailable: ${error instanceof Error ? error.message : String(error)}`;
  canvas.classList.remove('ready');
  $('hint').textContent = 'Original photograph / WebGPU surface unavailable';
}

async function start() {
  try {
    await photo.decode();
    if (disposed) return;
    removeBillboards = mountBillboards($('scene'), photo);
    const mounted = await createEffect(canvas, chain(displace, composite), {
      playing: false,
      dprCap: 1.5,
      params: {
        s0_mode: document
          .querySelector('[data-mode][aria-pressed=true]')!
          .getAttribute('data-mode')!,
        s0_encoding: $<HTMLSelectElement>('encoding').value,
        s0_amount: 0.0028,
        s0_frequency: 54,
        s0_speed: 0,
        s0_decay: 7,
        s0_glass: 5,
        s1_sceneSource: 'original',
        s1_maskSource: 'mask',
      },
    });
    if (disposed) {
      mounted.destroy();
      return;
    }
    field = mounted;
    await field.bindInput('image', { kind: 'image', source: photo });
    await field.bindInput('original', { kind: 'image', source: photo });
    const maskBitmap = await createImageBitmap(surfaceMask());
    try {
      await field.bindInput('mask', { kind: 'image', source: maskBitmap });
    } finally {
      maskBitmap.close();
    }
    field.session.submit();
    const mountedMap = await createEffect(mapCanvas, pointerMap, {
      playing: false,
      present: false,
      dprCap: 1,
      observeTarget: canvas,
      params: { encoding: $<HTMLSelectElement>('encoding').value },
    });
    if (disposed) {
      mountedMap.destroy();
      return;
    }
    mapField = mountedMap;
    mapField.drawAt(0);
    await field.bindInput('map', mapField);
    if (disposed) return;
    updateIntensity();
    field.frame.pointer = [0.52, 0.55];
    mapField.onBeforeFrame(() => {
      if (!field || !mapField) return;
      mapField.store.set('center', field.frame.pointer);
    });
    field.onChange(() => {
      if (field?.state === 'error') showError('WebGPU device recovery failed');
      else if (field?.state === 'lost') status.textContent = 'Reconnecting surface…';
      else if (field?.state === 'ready') status.textContent = 'WEBGPU / CONNECTED';
    });
    field.drawAt(0);
    lights = new StreetLights($('scene'));
    await lights.mount(photo);
    rain = new BackgroundRain($('scene'));
    await rain.mount();
    if (disposed) return;
    $('billboards').dataset['hcssMotion'] =
      $('billboard-motion').getAttribute('aria-pressed') === 'true' ? 'full' : 'none';
    lights.setPlaying($('light-motion').getAttribute('aria-pressed') === 'true');
    rain.setPlaying($('rain-motion').getAttribute('aria-pressed') === 'true');
    canvas.classList.add('ready');
    status.dataset['state'] = 'ready';
    status.textContent = 'WEBGPU / CONNECTED';
    $('original').removeAttribute('disabled');
  } catch (error) {
    field?.destroy();
    mapField?.destroy();
    lights?.destroy();
    rain?.destroy();
    field = undefined;
    mapField = undefined;
    if (!disposed) showError(error);
  }
}
window.addEventListener('pagehide', () => {
  disposed = true;
  field?.destroy();
  mapField?.destroy();
  removeBillboards();
  lights?.destroy();
  rain?.destroy();
});
// Uses the public runtime for browser verification and repeatable pixel comparisons.
Object.defineProperty(window, 'lcdDemo', {
  value: {
    get field() {
      return field;
    },
    get mapField() {
      return mapField;
    },
    get lightField() {
      return lights?.field;
    },
    get rainField() {
      return rain?.field;
    },
  },
});
void start();
