import { chain, createEffect, filterEffect, type EffectField } from '@mk7s/hologpu';
import bloom from '@mk7s/hologpu/effects/bloom';

// Extract bright fixtures from three small regions, rather than blooming the photo.
const fixtures = filterEffect({
  id: 'lcd-street-lights',
  title: 'Flickering street fixtures',
  params: {},
  wgsl: /* wgsl */ `
fn pool(p: vec2f, center: vec2f, radius: vec2f) -> f32 {
  let q = (p - center) / radius;
  return 1.0 - smoothstep(.65, 1.0, dot(q, q));
}
fn flicker(t: f32, phase: f32) -> f32 {
  let hum = .92 + .06 * sin(t * 7.3 + phase) + .02 * sin(t * 19.0 + phase * 3.0);
  let dip = pow(max(0.0, sin(t * 1.7 + phase) * sin(t * 3.1 + phase * 2.0)), 16.0);
  return hum * (1.0 - .82 * dip);
}
fn effect(uv: vec2f) -> vec4f {
  let c = sample_image(uv);
  let p = uv * vec2f(2048.0, 1117.0);
  let a = pool(p, vec2f(1653, 44), vec2f(61, 67));
  let b = pool(p, vec2f(1880, 112), vec2f(62, 63));
  let d = pool(p, vec2f(1744, 204), vec2f(94, 65));
  let brightness = max(c.r, max(c.g, c.b));
  let bright = smoothstep(.4, .85, brightness);
  let area = max(a, max(b, d)) * bright;
  let power = (a * flicker(frame.time, .2) + b * flicker(frame.time, 2.1) + d * flicker(frame.time, 4.5)) * bright;
  return vec4f(c.rgb * power * 1.8, area);
}`,
});

export class StreetLights {
  field: EffectField | undefined;
  readonly canvas = document.createElement('canvas');
  private disposed = false;
  private requestedPlaying = true;
  private readonly scene: HTMLElement;
  constructor(scene: HTMLElement) {
    this.scene = scene;
    this.canvas.className = 'light-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    scene.append(this.canvas);
  }
  async mount(photo: HTMLImageElement) {
    const field = await createEffect(this.canvas, chain(fixtures, bloom), {
      playing: false,
      // The viewer explicitly requested light flicker; the button can pause it.
      reducedMotion: false,
      resolutionScale: 0.5,
      dprCap: 1,
      params: { s1_threshold: 0.7, s1_knee: 0.3, s1_strength: 0.55, s1_levels: 4 },
    });
    if (this.disposed) {
      field.destroy();
      return;
    }
    this.field = field;
    await field.bindInput('image', { kind: 'image', source: photo });
    if (this.disposed) return;
    field.drawAt(0);
    // Start motion after the remaining scene pipelines have finished compiling.
  }
  setPlaying(playing: boolean) {
    this.requestedPlaying = playing;
    this.sync();
  }
  sync() {
    const visible = !this.scene.classList.contains('show-original');
    if (this.requestedPlaying && visible) this.field?.play();
    else this.field?.pause();
  }
  destroy() {
    this.disposed = true;
    this.field?.destroy();
    this.canvas.remove();
  }
}
