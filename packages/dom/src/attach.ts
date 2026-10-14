import { createEffect, EffectField, ParamStore, WebGPUUnavailableError } from '@mk7s/hologpu-core';
import type {
  EffectDefinition,
  MountOptions,
  ParamSchema,
  ParamValues,
  ValuesOf,
} from '@mk7s/hologpu-core';
import { bindCSSParameters } from './bridges.ts';
import { DomRectsInput } from './dom-rects.ts';
import { bindDOMTextMask } from './text-mask.ts';
import { cardGeometry } from './card-geometry.ts';
import { subscribePagePointer } from './page-pointer.ts';
import { trackPageBudget } from './budget.ts';

export interface AttachOptions extends MountOptions {
  layer?: 'behind' | 'front';
  /** Exterior canvas space in CSS pixels; does not alter layout or pointer hit testing. */
  padding?: number;
  poster?: string;
  forceFallback?: boolean;
  signal?: AbortSignal;
  /** Start settled and animate only for bounded activity; explicit play() pins playback. */
  renderOn?: 'always' | 'interaction';
  /** Milliseconds after the latest interaction before pausing, in [0, 10000]. */
  idleAfter?: number;
}
export interface AttachmentTimings {
  /** Monotonic performance.now() timestamps; unavailable milestones are null. */
  readonly startedAt: number;
  readonly gpuReadyAt: number | null;
  readonly firstFrameSubmittedAt: number | null;
  readonly firstFrameCompletedAt: number | null;
  readonly firstFrameMs: number | null;
  readonly fallbackReadyAt: number | null;
  readonly fallbackMs: number | null;
}
export type AttachmentState = 'building' | 'ready' | 'lost' | 'fallback' | 'disposed';
const roots = new WeakMap<HTMLElement, ShadowRoot>();
const owners = new WeakMap<HTMLElement, object>();

/** A stable parameter handle, including when WebGPU is unavailable. */
export class Attachment<S extends ParamSchema = ParamSchema> {
  readonly host: HTMLElement;
  readonly effect: EffectDefinition<S>;
  readonly canvas: HTMLCanvasElement;
  readonly params: ValuesOf<S>;
  field: EffectField<S> | null = null;
  state: AttachmentState = 'building';
  readonly #store: ParamStore<S>;
  readonly #nodes: HTMLElement[];
  readonly #previousState: string | null;
  readonly #poster: HTMLImageElement;
  #posterOverride: boolean;
  #cleanup: (() => void)[] = [];
  #padding = 0;
  #canvasBounds = '';
  #boundsObserver: ResizeObserver | null = null;
  #backdropCleanup: (() => void)[] = [];
  #quality = '';
  #lastState = '';
  readonly #renderOn: 'always' | 'interaction';
  readonly #idleAfter: number;
  #requestedPlaying: boolean;
  #interactionActive = false;
  #interactionVisible = true;
  #idleTimer: ReturnType<typeof setTimeout> | undefined;
  #bindingsReady = false;
  #framePending = false;
  #frameReady = false;
  #frameEpoch = 0;
  #settledFrameQueued = false;
  #hasBeenReady = false;
  #pollingBeforeFallback: boolean | null = null;
  #resolveInitial: (() => void) | undefined;
  #rejectInitial: ((error: unknown) => void) | undefined;
  #timings: AttachmentTimings = {
    startedAt: performance.now(),
    gpuReadyAt: null,
    firstFrameSubmittedAt: null,
    firstFrameCompletedAt: null,
    firstFrameMs: null,
    fallbackReadyAt: null,
    fallbackMs: null,
  };
  constructor(host: HTMLElement, effect: EffectDefinition<S>, options: AttachOptions) {
    const padding = options.padding ?? 0;
    const idleAfter = options.idleAfter ?? 600;
    if (!Number.isFinite(idleAfter) || idleAfter < 0 || idleAfter > 10000)
      throw new RangeError('idleAfter must be in [0, 10000] milliseconds');
    if (options.renderOn !== undefined && !['always', 'interaction'].includes(options.renderOn))
      throw new TypeError('renderOn must be always or interaction');
    this.#renderOn = options.renderOn ?? 'always';
    this.#idleAfter = idleAfter;
    this.#requestedPlaying = options.playing ?? this.#renderOn === 'always';
    if (!Number.isFinite(padding) || padding < 0 || padding > 256)
      throw new RangeError('padding must be in [0, 256] CSS pixels');
    if (owners.has(host)) throw new Error('Element already has a hologpu attachment');
    const existing = host.shadowRoot;
    if (existing && roots.get(host) !== existing)
      throw new Error('attach() needs an element without an author-owned shadow root');
    this.host = host;
    this.effect = effect;
    this.#posterOverride = options.poster !== undefined;
    this.#previousState = host.getAttribute('data-hgpu-state');
    this.#store = new ParamStore(effect.params, {
      ...effect.presets[options.preset ?? ''],
      ...options.params,
    });
    this.params = new Proxy(this.#store.values, {
      get: (_target, key) => Reflect.get(this.field?.params ?? this.#store.values, key),
      set: (_target, key, value) => {
        this.set({ [String(key)]: value });
        return true;
      },
    });
    const root = existing ?? host.attachShadow({ mode: 'open' });
    roots.set(host, root);
    root.replaceChildren();
    const style = document.createElement('style');
    style.textContent = `:host{display:block}.hgpu-wrap{display:flow-root;position:relative;isolation:isolate;min-width:0;min-height:inherit;height:100%}.hgpu-content{display:block;position:relative;z-index:${options.layer === 'front' ? 0 : 1}}.hgpu-canvas,.hgpu-poster{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:${options.layer === 'front' ? 1 : 0}}.hgpu-poster{object-fit:cover}.hgpu-canvas{display:block}.hgpu-canvas[hidden],.hgpu-poster[hidden]{display:none}`;
    const wrapper = document.createElement('div');
    wrapper.className = 'hgpu-wrap';
    wrapper.style.background = effect.fallback;
    const slot = document.createElement('slot');
    slot.className = 'hgpu-content';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'hgpu-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.#poster = document.createElement('img');
    this.#poster.className = 'hgpu-poster';
    this.#poster.alt = '';
    this.#poster.setAttribute('aria-hidden', 'true');
    const poster =
      options.poster ??
      (effect.textFallback || effect.cardFallback || effect.imageFallback
        ? undefined
        : (effect.presetPosters?.[options.preset ?? ''] ?? effect.poster));
    if (poster) this.#poster.src = poster;
    else this.#poster.hidden = true;
    this.canvas.hidden = true;
    wrapper.append(this.canvas, this.#poster, slot);
    root.append(style, wrapper);
    this.#nodes = [style, wrapper];
    const syncPoster = () => this.#syncFallbackBackground();
    this.#poster.addEventListener('load', syncPoster);
    this.#poster.addEventListener('error', syncPoster);
    this.#cleanup.push(() => {
      this.#poster.removeEventListener('load', syncPoster);
      this.#poster.removeEventListener('error', syncPoster);
    });
    if (effect.textFallback || effect.cardFallback) {
      const refresh = () => {
        if (this.state !== 'ready') this.#syncFallbackBackground();
      };
      const resize = new ResizeObserver(refresh);
      resize.observe(host);
      this.#cleanup.push(() => resize.disconnect());
      const tokens = new MutationObserver(refresh);
      for (let node: HTMLElement | null = host; node; node = node.parentElement)
        tokens.observe(node, { attributes: true, attributeFilter: ['style', 'class'] });
      host.addEventListener('pointerenter', refresh);
      host.addEventListener('pointerleave', refresh);
      host.addEventListener('transitionend', refresh);
      this.#cleanup.push(() => {
        tokens.disconnect();
        host.removeEventListener('pointerenter', refresh);
        host.removeEventListener('pointerleave', refresh);
        host.removeEventListener('transitionend', refresh);
      });
    }
    this.setPadding(options.padding ?? 0);
    owners.set(host, this);
    this.#setState('building');
    const abort = () => this.destroy();
    options.signal?.addEventListener('abort', abort, { once: true });
    this.#cleanup.push(() => options.signal?.removeEventListener('abort', abort));
    if (options.signal?.aborted) this.destroy();
  }
  async initialize(options: AttachOptions) {
    if (this.state === 'disposed') return this;
    try {
      if (options.forceFallback) throw new WebGPUUnavailableError('Fallback requested');
      // Keep the measurable canvas in layout while the poster covers the building field.
      this.canvas.hidden = false;
      const field = await createEffect(this.canvas, this.effect, {
        ...options,
        adaptiveQuality: options.adaptiveQuality ?? true,
        playing: false,
        params: { ...this.#store.values },
        pointerTarget: this.host,
        observeTarget: this.host,
      });
      if (this.state === ('disposed' as AttachmentState)) {
        field.destroy();
        return this;
      }
      this.field = field;
      this.#timings = { ...this.#timings, gpuReadyAt: performance.now() };
      const initialFrame = new Promise<void>((resolve, reject) => {
        this.#resolveInitial = resolve;
        this.#rejectInitial = reject;
      });
      this.#cleanup.push(field.onChange(() => this.#sync()));
      this.#cleanup.push(
        field.onRendered(() => {
          this.#syncQuality();
          if (this.#bindingsReady && !this.#frameReady && !this.#framePending) {
            this.#framePending = true;
            const epoch = this.#frameEpoch;
            // The scheduler submits after render listeners. A microtask observes that submission.
            queueMicrotask(() => {
              void this.#finishReadyFrame(field, epoch);
            });
          }
        }),
      );
      this.#cleanup.push(bindCSSParameters(this.host, field).dispose);
      if (this.effect.inputs.includes('text')) {
        const textMask = await bindDOMTextMask(this.host, field);
        if (this.state === ('disposed' as AttachmentState)) {
          textMask.dispose();
          return this;
        }
        this.#cleanup.push(textMask.dispose);
      }
      if (this.effect.inputs.includes('dom-rects')) {
        field.setFramePolling(true);
        const rects = new DomRectsInput(this.host, {
          coordinateTarget: this.canvas,
          onChange: () => field.invalidate(),
        });
        this.#cleanup.push(() => rects.dispose());
        this.#cleanup.push(field.onBeforeFrame(() => rects.refresh()));
        await field.setInput('obstacles', rects);
      }
      if (this.state === ('disposed' as AttachmentState)) return this;
      if (this.effect.params['pageRect'] && this.effect.params['pagePointer']) {
        field.setFramePolling(true);
        let pointer: readonly [number, number] = [innerWidth / 2, innerHeight / 2];
        const update = () => {
          const rect = this.canvas.getBoundingClientRect();
          field.store.patch({
            pageRect: [rect.left, rect.top, rect.width, rect.height],
            pagePointer: pointer,
          });
        };
        this.#cleanup.push(
          subscribePagePointer((position) => {
            pointer = position;
            update();
          }),
        );
        this.#cleanup.push(field.onBeforeFrame(update));
        update();
      }
      if (this.effect.params['radiiX'] && this.effect.params['radiiY']) {
        field.setFramePolling(true);
        let lastGeometry = '';
        this.#cleanup.push(
          field.store.onChange((name) => {
            if (['rect', 'radius', 'radiiX', 'radiiY'].includes(name)) lastGeometry = '';
          }),
        );
        const update = () => {
          this.#syncCanvasBounds();
          const geometry = cardGeometry(this.host, this.canvas);
          const signature = JSON.stringify(geometry);
          if (signature !== lastGeometry) {
            field.store.patch(geometry);
            lastGeometry = signature;
          }
        };
        this.#cleanup.push(field.onBeforeFrame(update));
        update();
      }
      if (this.effect.inputs.includes('pointer-down')) {
        const press = (event: PointerEvent) => {
          const bounds = this.canvas.getBoundingClientRect();
          field.press([
            (event.clientX - bounds.left) / Math.max(1, bounds.width),
            (event.clientY - bounds.top) / Math.max(1, bounds.height),
          ]);
        };
        const key = (event: KeyboardEvent) => {
          if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
          const target = event.target as HTMLElement | null;
          if (
            !target?.matches(
              'button, a[href], [role="button"], input[type="button"], input[type="submit"]',
            )
          )
            return;
          const bounds = target.getBoundingClientRect(),
            canvas = this.canvas.getBoundingClientRect();
          field.press([
            (bounds.left + bounds.width / 2 - canvas.left) / Math.max(1, canvas.width),
            (bounds.top + bounds.height / 2 - canvas.top) / Math.max(1, canvas.height),
          ]);
        };
        this.host.addEventListener('pointerdown', press);
        this.host.addEventListener('keydown', key);
        this.#cleanup.push(() => {
          this.host.removeEventListener('pointerdown', press);
          this.host.removeEventListener('keydown', key);
        });
      }
      if (this.#renderOn === 'interaction') this.#bindInteraction(field);
      this.#cleanup.push(trackPageBudget(this));
      this.#bindingsReady = true;
      this.#sync();
      field.beforeFrame();
      field.drawAt(this.effect.reducedMotion.time, options.seed ?? field.frame.seed);
      await initialFrame;
    } catch (error) {
      if (this.state === ('disposed' as AttachmentState)) return this;
      if (!(error instanceof WebGPUUnavailableError)) {
        this.destroy();
        throw error;
      }
      this.canvas.hidden = true;
      this.#setState('fallback', error);
    }
    return this;
  }
  /** Frozen snapshots separate GPU first-pixel latency from the native/CSS fallback path. */
  get timings(): AttachmentTimings {
    return Object.freeze({ ...this.#timings });
  }
  async #finishReadyFrame(field: EffectField<S>, epoch: number) {
    if (
      this.state === 'disposed' ||
      this.field !== field ||
      epoch !== this.#frameEpoch ||
      field.state !== 'ready' ||
      field.session.state !== 'ready'
    ) {
      if (epoch === this.#frameEpoch) this.#framePending = false;
      return;
    }
    const generation = field.session.generation;
    const device = field.session.device;
    try {
      field.session.submit();
      const submittedAt = performance.now();
      if (this.#timings.firstFrameCompletedAt === null)
        this.#timings = { ...this.#timings, firstFrameSubmittedAt: submittedAt };
      await device.queue.onSubmittedWorkDone();
      if (
        this.state === ('disposed' as AttachmentState) ||
        this.field !== field ||
        epoch !== this.#frameEpoch ||
        generation !== field.session.generation ||
        field.state !== 'ready'
      )
        return;
      if (this.#timings.firstFrameCompletedAt === null) {
        const completedAt = performance.now();
        this.#timings = {
          ...this.#timings,
          firstFrameCompletedAt: completedAt,
          firstFrameMs: completedAt - this.#timings.startedAt,
        };
      }
      this.#frameReady = true;
      this.#framePending = false;
      this.#sync();
      this.#resolveInitial?.();
      this.#resolveInitial = this.#rejectInitial = undefined;
      this.#syncPlayback();
    } catch (error) {
      if (epoch !== this.#frameEpoch || this.state === ('disposed' as AttachmentState)) return;
      // Queue rejection can precede adapter/device-loss callbacks, including their
      // deferred delivery on software GPUs. Wait a bounded second for recovery ownership.
      const lost = await this.#waitForDeviceLoss(device);
      if (epoch !== this.#frameEpoch || this.state === ('disposed' as AttachmentState)) return;
      this.#framePending = false;
      if (lost || field.session.state !== 'ready' || field.state !== 'ready') return;
      this.#failReadyFrame(error);
    }
  }
  #waitForDeviceLoss(device: GPUDevice): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (lost: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const index = this.#cleanup.indexOf(cancel);
        if (index >= 0) this.#cleanup.splice(index, 1);
        resolve(lost);
      };
      const cancel = () => finish(false);
      this.#cleanup.push(cancel);
      const timer = setTimeout(cancel, 1000);
      void device.lost.then(() => finish(true), cancel);
    });
  }
  #failReadyFrame(error: unknown) {
    if (this.#rejectInitial) {
      const reject = this.#rejectInitial;
      this.#rejectInitial = this.#resolveInitial = undefined;
      reject(error);
    } else {
      this.#suspendFailedField();
      this.canvas.hidden = true;
      if (this.#poster.src) this.#poster.hidden = false;
      this.#setState('fallback', error);
    }
  }
  #suspendFailedField() {
    this.#frameEpoch++;
    this.#frameReady = this.#framePending = false;
    this.#stopInteraction();
    if (this.field) {
      if (this.#pollingBeforeFallback === null) this.#pollingBeforeFallback = this.field.polling;
      this.field.setFramePolling(false);
    }
  }
  #requestSettledFrame() {
    const field = this.field;
    if (
      !field ||
      !this.#bindingsReady ||
      this.#frameReady ||
      this.#framePending ||
      this.#settledFrameQueued ||
      this.state === 'disposed'
    )
      return;
    this.#settledFrameQueued = true;
    const epoch = this.#frameEpoch;
    queueMicrotask(() => {
      this.#settledFrameQueued = false;
      if (
        this.state === 'disposed' ||
        this.field !== field ||
        epoch !== this.#frameEpoch ||
        this.#frameReady ||
        this.#framePending ||
        field.state !== 'ready'
      )
        return;
      try {
        // Readiness includes offscreen/reduced fields, whose scheduler deliberately sleeps.
        field.beforeFrame();
        field.drawAt(this.effect.reducedMotion.time, field.frame.seed);
      } catch (error) {
        this.#failReadyFrame(error);
      }
    });
  }
  #sync() {
    if (!this.field || this.state === 'disposed') return;
    if (this.field.state === 'ready') {
      if (this.#pollingBeforeFallback !== null) {
        const polling = this.#pollingBeforeFallback;
        this.#pollingBeforeFallback = null;
        this.field.setFramePolling(polling);
      }
      this.canvas.hidden = false;
      this.canvas.style.visibility = '';
      if (this.#frameReady) {
        const restored = this.#lastState === 'lost' && this.#hasBeenReady;
        this.#hasBeenReady = true;
        this.#nodes[1]!.style.background = '';
        this.#poster.hidden = true;
        this.#setState('ready', undefined, restored ? 'restored' : 'ready');
      } else {
        this.field.invalidate();
        this.#requestSettledFrame();
      }
    } else if (this.field.state === 'lost' || this.field.state === 'building') {
      if (this.#lastState !== 'lost') {
        this.#frameEpoch++;
        this.#frameReady = this.#framePending = false;
      }
      this.#stopInteraction();
      // Visibility preserves the host size for the first frame after device restoration.
      this.canvas.hidden = false;
      this.canvas.style.visibility = 'hidden';
      if (this.#poster.src) this.#poster.hidden = false;
      this.#setState('lost');
    } else if (this.field.state === 'error') {
      this.#suspendFailedField();
      this.#nodes[1]!.style.background = this.effect.fallback;
      this.canvas.hidden = true;
      if (this.#poster.src) this.#poster.hidden = false;
      this.#setState('fallback');
      this.#resolveInitial?.();
      this.#resolveInitial = this.#rejectInitial = undefined;
    }
    this.#syncQuality();
  }
  #bindInteraction(field: EffectField<S>) {
    const bounds = this.host.getBoundingClientRect();
    this.#interactionVisible =
      bounds.bottom >= -64 &&
      bounds.top <= innerHeight + 64 &&
      bounds.right >= -64 &&
      bounds.left <= innerWidth + 64;
    const activity = () => {
      if (
        this.state !== 'ready' ||
        field.state !== 'ready' ||
        field.session.state !== 'ready' ||
        document.hidden ||
        !this.#interactionVisible ||
        field.reducedMotion
      )
        return;
      this.#interactionActive = true;
      this.#syncPlayback();
      this.#scheduleIdle();
    };
    const leave = () => this.#scheduleIdle();
    for (const name of [
      'pointerenter',
      'pointermove',
      'pointerdown',
      'pointerup',
      'focusin',
      'keydown',
    ] as const) {
      this.host.addEventListener(name, activity, { passive: true });
      this.#cleanup.push(() => this.host.removeEventListener(name, activity));
    }
    for (const name of ['pointerleave', 'pointercancel', 'focusout'] as const) {
      this.host.addEventListener(name, leave, { passive: true });
      this.#cleanup.push(() => this.host.removeEventListener(name, leave));
    }
    const visible = () => {
      if (document.hidden) this.#stopInteraction();
      else this.#syncPlayback();
    };
    document.addEventListener('visibilitychange', visible);
    this.#cleanup.push(() => document.removeEventListener('visibilitychange', visible));
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => {
      if (field.reducedMotion) this.#stopInteraction();
      else this.#syncPlayback();
    };
    motion.addEventListener('change', changed);
    this.#cleanup.push(() => motion.removeEventListener('change', changed));
    const intersection = new IntersectionObserver(
      ([entry]) => {
        if (!entry || this.state === 'disposed') return;
        this.#interactionVisible = entry.isIntersecting;
        if (!entry.isIntersecting) this.#stopInteraction();
        else this.#syncPlayback();
      },
      { rootMargin: '64px' },
    );
    intersection.observe(this.host);
    this.#cleanup.push(() => intersection.disconnect());
    this.#cleanup.push(() => this.#stopInteraction());
  }
  #scheduleIdle() {
    if (this.#idleTimer !== undefined) clearTimeout(this.#idleTimer);
    if (!this.#interactionActive || this.#requestedPlaying) return;
    this.#idleTimer = setTimeout(() => {
      this.#idleTimer = undefined;
      this.#interactionActive = false;
      this.#syncPlayback();
    }, this.#idleAfter);
  }
  #stopInteraction() {
    if (this.#idleTimer !== undefined) clearTimeout(this.#idleTimer);
    this.#idleTimer = undefined;
    this.#interactionActive = false;
    this.field?.pause();
  }
  #syncPlayback() {
    const field = this.field;
    if (!field) return;
    if (
      !this.#frameReady ||
      this.state !== 'ready' ||
      field.state !== 'ready' ||
      field.session.state !== 'ready'
    ) {
      field.pause();
      return;
    }
    if (this.#renderOn === 'always') {
      if (this.#requestedPlaying) field.play();
      else field.pause();
    } else if (
      !field.reducedMotion &&
      !document.hidden &&
      this.#interactionVisible &&
      (this.#requestedPlaying || this.#interactionActive)
    )
      field.play();
    else field.pause();
  }
  #syncQuality() {
    if (!this.field || this.state === 'disposed') return;
    const quality = this.field.quality.state;
    const signature = JSON.stringify(quality);
    if (signature === this.#quality) return;
    this.#quality = signature;
    this.host.dispatchEvent(
      new CustomEvent('hgpu-quality', {
        detail: { attachment: this, quality: { ...quality } },
        bubbles: true,
        composed: true,
      }),
    );
  }
  #setState(state: AttachmentState, error?: unknown, event: string = state) {
    this.#syncFallbackBackground(state);
    if (this.state === state && this.#lastState === state) return;
    if (state === 'fallback' && this.#timings.fallbackReadyAt === null) {
      const fallbackAt = performance.now();
      this.#timings = {
        ...this.#timings,
        fallbackReadyAt: fallbackAt,
        fallbackMs: fallbackAt - this.#timings.startedAt,
      };
    }
    this.state = state;
    this.#lastState = state;
    this.host.dataset['hgpuState'] = state;
    if (state !== 'building' && state !== 'disposed')
      this.host.dispatchEvent(
        new CustomEvent(`hgpu-${event}`, {
          detail: { attachment: this, field: this.field, error, timings: this.timings },
          bubbles: true,
          composed: true,
        }),
      );
  }
  #syncFallbackBackground(state = this.state) {
    const posterReady =
      !this.#poster.hidden && this.#poster.complete && this.#poster.naturalWidth > 0;
    this.#nodes[1]!.style.background = state === 'ready' || posterReady ? '' : this.effect.fallback;
    const content = this.host.shadowRoot!.querySelector<HTMLElement>('.hgpu-content');
    const fallback = this.effect.textFallback;
    const card = this.effect.cardFallback;
    const wrapper = this.#nodes[1]!;
    let shape = wrapper.querySelector<HTMLElement>('.hgpu-card-fallback');
    if (card && !shape) {
      shape = document.createElement('div');
      shape.className = 'hgpu-card-fallback';
      shape.style.cssText = 'position:absolute;pointer-events:none;z-index:0';
      wrapper.prepend(shape);
    }
    if (shape && card) {
      shape.hidden = state === 'ready' || state === 'disposed' || posterReady;
      const style = getComputedStyle(this.host);
      const bounds = this.host.getBoundingClientRect(),
        origin = wrapper.getBoundingClientRect();
      Object.assign(shape.style, {
        left: `${bounds.left - origin.left}px`,
        top: `${bounds.top - origin.top}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
        borderRadius: style.borderRadius,
      });
      const value = (name: string) => {
        const token = style.getPropertyValue(`--hgpu-${name}`).trim();
        const valid =
          this.effect.params[name]?.type === 'color'
            ? CSS.supports('color', token)
            : token !== '' && Number.isFinite(Number(token));
        return valid ? token : String(this.params[name] ?? '');
      };
      if (card.kind === 'glass') {
        const requestedBlur = Number(value('blur'));
        const blur = Number.isFinite(requestedBlur) ? Math.max(0, Math.min(8, requestedBlur)) : 2;
        shape.style.backdropFilter = `blur(${blur}px)`;
        shape.style.setProperty('-webkit-backdrop-filter', `blur(${blur}px)`);
        shape.style.background = `color-mix(in srgb, ${value('brand') || '#e4edff'} 8%, transparent)`;
        shape.style.border = '1px solid rgb(255 255 255 / 12%)';
        shape.style.boxSizing = 'border-box';
      } else if (card.kind === 'shadow') {
        const elevation = Math.max(0, Math.min(1, Number(value('elevation')) || 0));
        const intensity = Math.max(0, Math.min(1, Number(value('intensity')) || 0));
        shape.style.boxShadow = `0 ${3 + elevation * 12}px ${8 + elevation * 14}px color-mix(in srgb, ${value('tint') || '#111827'} ${intensity * 100}%, transparent)`;
      }
    }
    if (!content || !fallback) return;
    content.style.background = '';
    content.style.backgroundClip = '';
    content.style.removeProperty('-webkit-text-fill-color');
    content.style.textShadow = '';
    if (state === 'ready' || state === 'disposed' || posterReady) return;
    const computed = getComputedStyle(this.host);
    const token = (name: string) => {
      const value = computed.getPropertyValue(`--hgpu-${name}`).trim();
      const valid =
        this.effect.params[name]?.type === 'color'
          ? CSS.supports('color', value)
          : value !== '' && Number.isFinite(Number(value));
      // Registered bridge properties do not inherit into the shadow content slot.
      return valid ? value : String(this.#store.values[name]);
    };
    if (fallback.kind === 'gradient') {
      const colors = (fallback.colors ?? []).map(token);
      content.style.background = `linear-gradient(90deg, ${colors.join(', ')})`;
      content.style.backgroundClip = 'text';
      content.style.setProperty('-webkit-text-fill-color', 'transparent');
    } else if (fallback.kind === 'shadow')
      content.style.textShadow = (fallback.shadow ?? '').replace(
        /var\(--hgpu-([\w-]+),[^)]+\)/g,
        (_match, name: string) => token(name),
      );
  }
  set(values: ParamValues) {
    if (this.state === 'disposed') throw new Error('Attachment is disposed');
    this.#store.patch(values);
    this.field?.store.patch(values);
    if (!this.field) this.#syncFallbackBackground();
  }
  preset(name: string) {
    const values = this.effect.presets[name];
    if (!values) throw new RangeError(`Unknown preset: ${name}`);
    this.set(values);
    if (
      !this.#posterOverride &&
      !this.effect.textFallback &&
      !this.effect.cardFallback &&
      !this.effect.imageFallback
    )
      this.#applyPoster(this.effect.presetPosters?.[name] ?? this.effect.poster);
  }
  setPoster(url: string | undefined) {
    this.#posterOverride = true;
    this.#applyPoster(url);
  }
  #applyPoster(url: string | undefined) {
    if (url) this.#poster.src = url;
    else this.#poster.removeAttribute('src');
    this.#poster.hidden = !url || this.state === 'ready';
    this.#syncFallbackBackground();
  }
  setPadding(value: number) {
    if (this.state === 'disposed') throw new Error('Attachment is disposed');
    if (!Number.isFinite(value) || value < 0 || value > 256)
      throw new RangeError('padding must be in [0, 256] CSS pixels');
    this.#padding = value;
    if ((value > 0 || this.effect.params['radiiX']) && !this.#boundsObserver) {
      const observer = new ResizeObserver(() => {
        if (this.state === 'disposed') return;
        this.#syncCanvasBounds();
        this.field?.invalidate();
      });
      this.#boundsObserver = observer;
      observer.observe(this.host);
      this.#cleanup.push(() => {
        observer.disconnect();
        this.#boundsObserver = null;
      });
    }
    this.#syncCanvasBounds();
    this.field?.invalidate();
  }
  #syncCanvasBounds() {
    if (!this.#padding && !this.effect.params['radiiX']) {
      if (this.#canvasBounds === 'none') return;
      this.#canvasBounds = 'none';
      for (const node of [this.canvas, this.#poster])
        for (const property of ['left', 'top', 'width', 'height', 'right', 'bottom'])
          node.style.removeProperty(property);
      return;
    }
    const host = this.host.getBoundingClientRect(),
      wrapper = this.#nodes[1]!.getBoundingClientRect();
    const geometry = {
      left: `${host.left - wrapper.left - this.#padding}px`,
      top: `${host.top - wrapper.top - this.#padding}px`,
      width: `${host.width + 2 * this.#padding}px`,
      height: `${host.height + 2 * this.#padding}px`,
      right: 'auto',
      bottom: 'auto',
    };
    const signature = JSON.stringify(geometry);
    if (signature === this.#canvasBounds) return;
    this.#canvasBounds = signature;
    Object.assign(this.canvas.style, geometry);
    Object.assign(this.#poster.style, geometry);
  }
  /** Borrow a HoloGPU hero. Cards never capture DOM pixels; the source owns motion and lifetime. */
  async bindBackdrop(source: Attachment | EffectField) {
    if (this.state === 'disposed') throw new Error('Attachment is disposed');
    if (this.effect.id !== 'panel-refraction')
      throw new TypeError('bindBackdrop requires panel-refraction');
    const hero = source instanceof Attachment ? source.field : source;
    if (!(hero instanceof EffectField)) {
      if (this.state === 'fallback' && source instanceof Attachment && source.state === 'fallback')
        return;
      throw new TypeError('Backdrop must be a ready HoloGPU field or attachment');
    }
    if (!this.field) {
      if (this.state === 'fallback') return;
      throw new Error('Attachment is not ready');
    }
    const field = this.field;
    await field.bindInput('image', hero);
    if (
      this.state === ('disposed' as AttachmentState) ||
      this.field !== field ||
      !field.dependencies().includes(hero)
    )
      return;
    for (const remove of this.#backdropCleanup.splice(0)) remove();
    const update = () => {
      const card = this.host.getBoundingClientRect(),
        bounds = hero.canvas.getBoundingClientRect();
      field.store.patch({
        sourceRect: [
          (card.left - bounds.left) / Math.max(1, bounds.width),
          (card.top - bounds.top) / Math.max(1, bounds.height),
          card.width / Math.max(1, bounds.width),
          card.height / Math.max(1, bounds.height),
        ],
      });
      if (field.reducedMotion !== hero.reducedMotion) field.setReducedMotion(hero.reducedMotion);
    };
    field.setFramePolling(true);
    this.#backdropCleanup.push(field.onBeforeFrame(update), hero.onChange(update));
    update();
    field.invalidate();
  }
  setLayer(layer: 'behind' | 'front') {
    const content = this.host.shadowRoot?.querySelector<HTMLElement>('.hgpu-content');
    this.canvas.style.zIndex = this.#poster.style.zIndex = layer === 'front' ? '1' : '0';
    if (content) content.style.zIndex = layer === 'front' ? '0' : '1';
  }
  /** Stop playback; interaction mode remains available for the next native activity. */
  pause() {
    this.#requestedPlaying = false;
    this.#stopInteraction();
  }
  /** Pin continuous playback until pause(), respecting reduced motion and visibility. */
  play() {
    this.#requestedPlaying = true;
    if (this.#idleTimer !== undefined) clearTimeout(this.#idleTimer);
    this.#idleTimer = undefined;
    this.#syncPlayback();
  }
  reset(seed?: number) {
    this.field?.reset(seed);
  }
  timeline(progress: number) {
    if (!Number.isFinite(progress) || progress < 0 || progress > 1)
      throw new RangeError('Timeline progress must be in [0, 1]');
    this.field?.timeline(progress);
  }
  setReducedMotion(value: boolean | undefined) {
    this.field?.setReducedMotion(value);
    if (this.field?.reducedMotion && this.#renderOn === 'interaction') this.#stopInteraction();
    this.#syncPlayback();
  }
  setResolutionScale(value: number) {
    this.field?.setResolutionScale(value);
  }
  destroy() {
    if (this.state === 'disposed') return;
    this.state = 'disposed';
    this.#frameEpoch++;
    this.#resolveInitial?.();
    this.#resolveInitial = this.#rejectInitial = undefined;
    this.#stopInteraction();
    for (const remove of this.#backdropCleanup.splice(0)) remove();
    // The field flushes commands before freeing its resources; only then free borrowed DOM inputs.
    this.field?.destroy();
    this.field = null;
    for (const remove of this.#cleanup.splice(0)) remove();
    if (owners.get(this.host) === this) {
      owners.delete(this.host);
      for (const node of this.#nodes) node.remove();
      // A shadow root cannot be detached. Keep a plain slot so authored children stay visible.
      this.host.shadowRoot!.append(document.createElement('slot'));
      if (this.#previousState === null) this.host.removeAttribute('data-hgpu-state');
      else this.host.setAttribute('data-hgpu-state', this.#previousState);
    }
  }
}
export async function attach<S extends ParamSchema>(
  host: HTMLElement,
  effect: EffectDefinition<S>,
  options: AttachOptions = {},
): Promise<Attachment<S>> {
  return new Attachment(host, effect, options).initialize(options);
}
