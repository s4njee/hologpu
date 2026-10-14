import { createEffect, filterEffect, type EffectField } from '@mk7s/hologpu';

const rainfall = filterEffect({
  id: 'lcd-background-rain',
  title: 'Depth-masked street rain',
  inputs: ['time', 'depth'],
  params: { depthSource: { type: 'texture', default: 'depth' } },
  wgsl: /* wgsl */ `
fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn rain(uv: vec2f, columns: f32, rows: f32, speed: f32, seed: f32) -> f32 {
  let p = vec2f((uv.x + uv.y * .045) * columns, uv.y * rows - frame.time * speed);
  let cell = floor(p);
  let q = fract(p);
  let random = hash(cell + seed);
  let x = .15 + .7 * hash(cell + seed + 9.0);
  let length = .18 + .35 * random;
  let aa = columns / frame.resolution.x;
  let line = 1.0 - smoothstep(.014, .014 + aa, abs(q.x - x));
  let trail = smoothstep(0.0, length, q.y) * (1.0 - smoothstep(length, length + .05, q.y));
  return line * trail * step(.58, random);
}
fn effect(uv: vec2f) -> vec4f {
  let distant = rain(uv, 130.0, 24.0, 7.0, 2.0) * .11;
  let middle = rain(uv, 77.0, 15.0, 9.0, 7.0) * .15;
  let nearby = rain(uv, 43.0, 9.0, 10.0, 13.0) * .12;
  let depth = sample_depthSource(uv).r;
  let amount = (distant + middle + nearby) * depth;
  return vec4f(vec3f(.58, .77, .92) * amount, amount);
}`,
});

/** Foreground silhouettes occlude the rain, including the entire physical tablet. */
function depthMask() {
  const mask = document.createElement('canvas');
  mask.width = 1024;
  mask.height = 559;
  const ctx = mask.getContext('2d')!;
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, mask.width, mask.height);
  ctx.scale(mask.width / 2048, mask.height / 1117);
  ctx.fillStyle = 'black';
  ctx.fill(
    new Path2D(
      'M 698 317 L 1422 304 Q 1457 305 1460 341 L 1471 865 Q 1475 901 1433 903 L 689 900 Q 653 898 667 851 L 682 360 Q 682 330 698 317 Z',
    ),
  );
  ctx.fill(
    new Path2D(
      'M 298 1117 L 448 944 Q 500 846 534 701 Q 555 609 600 575 Q 632 548 663 574 L 709 641 Q 728 596 752 587 Q 779 588 783 621 Q 751 704 711 755 Q 704 831 655 920 L 558 1117 Z',
    ),
  );
  ctx.fill(
    new Path2D(
      'M 1333 596 Q 1364 566 1393 606 L 1421 630 Q 1423 555 1482 552 Q 1533 552 1562 625 Q 1579 692 1604 834 L 1771 1117 L 1560 1117 L 1431 893 Q 1410 795 1370 710 Q 1335 660 1333 596 Z',
    ),
  );
  ctx.fill(new Path2D('M 0 0 L 424 0 Q 485 120 458 261 Q 419 394 326 463 L 0 477 Z'));
  // Keep the foreground counter and stools clear; rain recedes into the street.
  const fade = ctx.createLinearGradient(0, 880, 0, 1117);
  fade.addColorStop(0, 'transparent');
  fade.addColorStop(1, 'black');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 880, 2048, 237);
  return mask;
}

export class BackgroundRain {
  field: EffectField<typeof rainfall.params> | undefined;
  readonly canvas = document.createElement('canvas');
  private disposed = false;
  private requestedPlaying = false;
  private readonly scene: HTMLElement;
  constructor(scene: HTMLElement) {
    this.scene = scene;
    this.canvas.className = 'rain-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    scene.append(this.canvas);
  }
  async mount() {
    const field = await createEffect(this.canvas, rainfall, {
      playing: false,
      reducedMotion: false,
      resolutionScale: 0.75,
      dprCap: 1,
    });
    if (this.disposed) {
      field.destroy();
      return;
    }
    this.field = field;
    const bitmap = await createImageBitmap(depthMask());
    try {
      await field.bindInput('depth', { kind: 'image', source: bitmap });
    } finally {
      bitmap.close();
    }
    if (this.disposed) return;
    field.drawAt(0);
    this.sync();
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
