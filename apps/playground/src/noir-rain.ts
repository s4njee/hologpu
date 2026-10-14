import { createEffect, filterEffect, type EffectField } from '@mk7s/hologpu';

const rainInk = filterEffect({
  id: 'noir-rain-ink',
  title: 'Rain on newsprint',
  inputs: ['time'],
  params: {},
  wgsl: /* wgsl */ `
fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}
fn red_pattern(p: vec2f, time: f32, style: u32) -> vec3f {
  var tone = 0.0;
  if (style == 0u) {
    let stripe = sin((p.x + p.y * .65) * .48 - time * 1.8);
    tone = smoothstep(-.35, .45, stripe);
  } else if (style == 1u) {
    let dot = fract((p + vec2f(time * 2.0, 0.0)) / 8.0) - .5;
    tone = 1.0 - smoothstep(.15, .36, length(dot));
  } else {
    let flow = sin(p.y * .14 + sin(p.x * .08 + time * .6) * 2.8 - time);
    let grain = hash(floor(p / 2.0));
    tone = clamp(.5 + flow * .4 + grain * .15, 0.0, 1.0);
  }
  return mix(vec3f(.24, .003, .009), vec3f(.9, .035, .06), tone);
}
fn effect(uv: vec2f) -> vec4f {
  let pixel = uv * frame.resolution;
  let tileSize = vec2f(92.0, 130.0);
  let tile = floor(pixel / tileSize);
  let local = fract(pixel / tileSize);
  // Each region has its own cadence and chooses a fresh impact every cycle.
  let clock = frame.time * (.075 + .065 * hash(tile + 17.0)) + hash(tile + 23.0);
  let event = floor(clock);
  let key = tile + vec2f(event * 37.19, event * 91.73);
  let seed = hash(key);
  let center = vec2f(.18 + .64 * hash(key + 3.0), .18 + .64 * hash(key + 9.0));
  let age = fract(clock);
  let arrival = smoothstep(.02, .12, age);
  let drying = 1.0 - smoothstep(.45, .95, age);
  let delta = (local - center) * tileSize;
  let wobble = 1.0 + .14 * sin(atan2(delta.y, delta.x) * 5.0 + seed * 30.0);
  let radius = (12.0 + 15.0 * seed) * wobble;
  let blot = (1.0 - smoothstep(radius * .25, radius, length(delta * vec2f(1.0, .72))))
    * arrival * drying * step(.28, seed);
  // Show each drop only just above its blot, during that blot's arrival.
  let dropWindow = smoothstep(0.0, .015, age)
    * (1.0 - smoothstep(.10, .15, age)) * step(.28, seed);
  let approach = 14.0 * (1.0 - smoothstep(0.0, .12, age));
  let dropShape = length(vec2f(delta.x / 1.2, (delta.y + approach) / 3.2));
  let drop = (1.0 - smoothstep(.3, 1.0, dropShape)) * dropWindow;

  // Invisible drops descend; their wet trails briefly drag the ink downward.
  let fall = fract(frame.time * (.45 + seed * .25) + seed);
  let xDistance = abs((local.x - center.x) * tileSize.x);
  let yDistance = (local.y - fall) * tileSize.y;
  let trail = (1.0 - smoothstep(1.0, 6.0, xDistance))
    * smoothstep(-40.0, -8.0, yDistance) * (1.0 - smoothstep(0.0, 9.0, yDistance))
    * arrival * drying * step(.28, seed);
  let wet = clamp(blot + trail * .45, 0.0, 1.0);
  let texel = 1.0 / frame.resolution;
  let warp = vec2f(sin(delta.y * .13 + seed * 6.0) * .9, -2.6) * wet * texel;
  let p = uv + warp;
  let original = sample_image(p);
  var ink = original.rgb;
  // Most of the page is dry: avoid ten extra bilinear reads there.
  if (wet > .001) {
    let r = texel * (1.0 + wet * 3.2);
    var soft = original * .2;
    soft += sample_image(p + vec2f(r.x, 0.0)) * .12;
    soft += sample_image(p - vec2f(r.x, 0.0)) * .12;
    soft += sample_image(p + vec2f(0.0, r.y)) * .12;
    soft += sample_image(p - vec2f(0.0, r.y)) * .12;
    soft += sample_image(p + r) * .08;
    soft += sample_image(p - r) * .08;
    soft += sample_image(p + vec2f(r.x, -r.y)) * .08;
    soft += sample_image(p + vec2f(-r.x, r.y)) * .08;
    let bleed = sample_image(p - vec2f(0.0, texel.y * 7.0)) * .11
      + sample_image(p + vec2f(texel.x * 5.0, texel.y * 3.0)) * .07;
    ink = mix(original.rgb, soft.rgb * .87 + bleed.rgb, wet * .82);
  }
  // The red initial itself masks the patterns; white type stays unchanged.
  let redMask = smoothstep(.005, .04, ink.r - max(ink.g, ink.b) * 2.0);
  if (redMask > .001) {
    let cycle = frame.time / 4.5;
    let current = u32(floor(cycle)) % 3u;
    let transition = smoothstep(.55, 1.0, fract(cycle));
    let patternedRed = mix(
      red_pattern(pixel, frame.time, current),
      red_pattern(pixel, frame.time, (current + 1u) % 3u),
      transition
    );
    let coverage = clamp(ink.r / .69, 0.0, 1.0);
    ink = mix(ink, patternedRed * coverage, redMask);
  }
  ink += vec3f(drop * .085);
  return vec4f(ink, 1.0);
}`,
});

/** Snapshot this local article once per layout change, then filter its pixels on the GPU.
 * The original HTML remains in place for reading, selection and the no-GPU fallback. */
async function articleBitmap(article: HTMLElement) {
  const clone = article.cloneNode(true) as HTMLElement;
  const originals = [article, ...article.querySelectorAll<HTMLElement>('*')];
  const copies = [clone, ...clone.querySelectorAll<HTMLElement>('*')];
  for (let i = 0; i < originals.length; i++) {
    const style = getComputedStyle(originals[i]!);
    for (const property of style)
      copies[i]!.style.setProperty(property, style.getPropertyValue(property));
  }
  const rect = article.getBoundingClientRect();
  const width = Math.ceil(rect.width);
  const height = Math.ceil(rect.height);
  clone.style.cssText += `;margin:0;position:relative;opacity:1;width:${width}px;max-width:none;background:black;`;
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  const markup = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${markup}</foreignObject></svg>`;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const raster = document.createElement('canvas');
  raster.width = width;
  raster.height = height;
  const context = raster.getContext('2d')!;
  context.fillStyle = 'black';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0);
  return createImageBitmap(raster);
}

export class NoirRain {
  readonly canvas = document.createElement('canvas');
  field: EffectField<typeof rainInk.params> | null = null;
  private disposed = false;
  private revision = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private observer: ResizeObserver | undefined;
  private snapshotSize = '';
  private readonly firefox = /Firefox\//.test(navigator.userAgent);
  private readonly article: HTMLElement;
  private readonly scene: HTMLElement;
  constructor(article: HTMLElement, scene: HTMLElement) {
    this.article = article;
    this.scene = scene;
    this.canvas.className = 'rain-ink-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    scene.append(this.canvas);
  }
  async mount(playing: boolean) {
    await document.fonts.ready;
    await this.refresh();
    if (this.disposed) return;
    this.field = await createEffect(this.canvas, rainInk, {
      playing: false,
      resolutionScale: 1,
      dprCap: 1,
      adaptiveQuality: false,
    });
    if (this.disposed) {
      this.field.destroy();
      return;
    }
    // Firefox batches queue-completion notifications at roughly 100 ms here.
    // Keep at most eight submissions outstanding instead of serializing every frame.
    if (this.firefox) this.field.session.scheduler.setSubmissionLimit(8);
    await this.refresh();
    if (this.disposed) return;
    this.field.drawAt(0);
    this.scene.classList.add('ink-rain-ready');
    if (playing) this.field.play();
    this.field.onChange(() => {
      this.scene.classList.toggle('ink-rain-ready', this.field?.state === 'ready');
    });
    this.observer = new ResizeObserver(() => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        void this.refresh().catch(() => this.scene.classList.remove('ink-rain-ready'));
      }, 120);
    });
    this.observer.observe(this.article);
  }
  private async refresh() {
    const revision = ++this.revision;
    const rect = this.article.getBoundingClientRect();
    const sceneRect = this.scene.getBoundingClientRect();
    Object.assign(this.canvas.style, {
      left: `${rect.left - sceneRect.left}px`,
      top: `${rect.top - sceneRect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    if (!this.field) return;
    const size = `${rect.width}:${rect.height}`;
    if (size === this.snapshotSize) return;
    const bitmap = await articleBitmap(this.article);
    try {
      if (this.disposed || revision !== this.revision) return;
      await this.field.bindInput('image', { kind: 'image', source: bitmap });
      if (this.disposed || revision !== this.revision) return;
      this.snapshotSize = size;
      this.field.invalidate();
    } finally {
      bitmap.close();
    }
  }
  setPlaying(playing: boolean) {
    if (playing) {
      this.field?.setReducedMotion(false);
      this.field?.play();
    } else this.field?.pause();
  }
  reset() {
    this.field?.reset(19);
  }
  destroy() {
    this.disposed = true;
    this.revision++;
    clearTimeout(this.timer);
    this.observer?.disconnect();
    this.field?.destroy();
    this.canvas.remove();
    this.scene.classList.remove('ink-rain-ready');
  }
}
