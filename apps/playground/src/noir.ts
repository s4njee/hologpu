import { WebGPUUnavailableError } from '@mk7s/hologpu';
import './noir.css';
import { NoirRain } from './noir-rain.ts';

const scene = document.querySelector<HTMLElement>('#scene')!;
const status = document.querySelector<HTMLElement>('#status')!;
const pause = document.querySelector<HTMLButtonElement>('#pause')!;
const reset = document.querySelector<HTMLButtonElement>('#reset')!;
const query = new URLSearchParams(location.search);
const rain = new NoirRain(document.querySelector<HTMLElement>('.newspaper')!, scene);
let removeChange: (() => void) | undefined;

Object.assign(window, {
  noirDemo: {
    get field() {
      return rain.field;
    },
    get rain() {
      return rain.field;
    },
  },
});

function syncPlayback() {
  const field = rain.field;
  const playing = Boolean(field?.playing && !field.reducedMotion);
  document.body.dataset['paused'] = String(!playing);
  pause.innerHTML = playing ? 'PAUSE <span>Ⅱ</span>' : 'PLAY <span>▷</span>';
  pause.setAttribute('aria-label', playing ? 'Pause scene' : 'Play scene');
  document.body.dataset['state'] = field?.state ?? 'loading';
  status.textContent =
    field?.state === 'ready'
      ? playing
        ? 'LIVE / RAIN & INK'
        : 'STILL / RAIN & INK'
      : field?.state === 'error'
        ? 'STILL / RAIN UNAVAILABLE'
        : 'SETTING THE TYPE';
}

pause.addEventListener('click', () => {
  const field = rain.field;
  if (!field) return;
  rain.setPlaying(!field.playing || field.reducedMotion);
  syncPlayback();
});
reset.addEventListener('click', () => rain.reset());

async function start() {
  try {
    if (query.has('fallback')) throw new WebGPUUnavailableError('Fallback requested');
    await rain.mount(query.get('playing') !== 'false');
    if (!rain.field) return;
    removeChange = rain.field.onChange(syncPlayback);
    pause.disabled = reset.disabled = false;
    syncPlayback();
  } catch (error) {
    rain.destroy();
    document.body.dataset['state'] = 'fallback';
    document.body.dataset['paused'] = 'true';
    status.textContent = 'STILL / WEBGPU UNAVAILABLE';
    if (!(error instanceof WebGPUUnavailableError)) console.error(error);
  }
}
window.addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  removeChange?.();
  rain.destroy();
});
void start();
