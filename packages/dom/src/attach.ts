import { createEffect, ParamStore, WebGPUUnavailableError } from '@mk7s/hologpu-core';
import type {
  EffectDefinition,
  EffectField,
  MountOptions,
  ParamSchema,
  ParamValues,
  ValuesOf,
} from '@mk7s/hologpu-core';
import { bindCSSParameters } from './bridges.ts';
import { DomRectsInput } from './dom-rects.ts';

export interface AttachOptions extends MountOptions {
  layer?: 'behind' | 'front';
  poster?: string;
  forceFallback?: boolean;
  signal?: AbortSignal;
}
export type AttachmentState = 'building' | 'ready' | 'lost' | 'fallback' | 'disposed';
const roots = new WeakMap<HTMLElement, ShadowRoot>();
const owners = new WeakMap<HTMLElement, Attachment>();

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
  #cleanup: (() => void)[] = [];
  #quality = '';
  #lastState = '';
  constructor(host: HTMLElement, effect: EffectDefinition<S>, options: AttachOptions) {
    if (owners.has(host)) throw new Error('Element already has a hologpu attachment');
    const existing = host.shadowRoot;
    if (existing && roots.get(host) !== existing)
      throw new Error('attach() needs an element without an author-owned shadow root');
    this.host = host;
    this.effect = effect;
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
    if (options.poster) this.#poster.src = options.poster;
    else this.#poster.hidden = true;
    this.canvas.hidden = true;
    wrapper.append(this.canvas, this.#poster, slot);
    root.append(style, wrapper);
    this.#nodes = [style, wrapper];
    owners.set(host, this as Attachment);
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
      const field = await createEffect(this.canvas, this.effect, {
        ...options,
        adaptiveQuality: options.adaptiveQuality ?? true,
        params: { ...this.#store.values },
        pointerTarget: this.host,
        observeTarget: this.host,
      });
      if (this.state === ('disposed' as AttachmentState)) {
        field.destroy();
        return this;
      }
      this.field = field;
      this.#cleanup.push(field.onChange(() => this.#sync()));
      this.#cleanup.push(field.onRendered(() => this.#syncQuality()));
      this.#cleanup.push(bindCSSParameters(this.host, field).dispose);
      if (this.effect.inputs.includes('text')) {
        const update = () => {
          const style = getComputedStyle(this.host);
          return field.bindInput('text', {
            kind: 'text',
            text: this.host.textContent ?? '',
            font: style.font || 'bold 120px sans-serif',
            width: Math.max(1, Math.ceil(this.host.clientWidth)),
            height: Math.max(1, Math.ceil(this.host.clientHeight)),
          });
        };
        const refresh = () => {
          void update().catch((error: unknown) => {
            if (this.state !== 'disposed' && field.state === 'ready')
              this.host.dispatchEvent(
                new CustomEvent('hgpu-error', {
                  detail: { attachment: this, error },
                  bubbles: true,
                  composed: true,
                }),
              );
          });
        };
        const text = new MutationObserver(refresh);
        text.observe(this.host, { childList: true, subtree: true, characterData: true });
        const size = new ResizeObserver(refresh);
        size.observe(this.host);
        this.#cleanup.push(
          () => text.disconnect(),
          () => size.disconnect(),
        );
        await update();
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
        let pointer = [innerWidth / 2, innerHeight / 2];
        const update = () => {
          const rect = this.host.getBoundingClientRect();
          field.store.patch({
            pageRect: [rect.left, rect.top, rect.width, rect.height],
            pagePointer: pointer,
          });
        };
        const move = (event: PointerEvent) => {
          pointer = [event.clientX, event.clientY];
          update();
          field.invalidate();
        };
        document.addEventListener('pointermove', move, { passive: true });
        this.#cleanup.push(() => document.removeEventListener('pointermove', move));
        this.#cleanup.push(field.onBeforeFrame(update));
        update();
      }
      if (this.effect.id === 'border-energy') {
        field.setFramePolling(true);
        const update = () => {
          const corner = getComputedStyle(this.host).borderTopLeftRadius.trim().split(/\s+/);
          const bounds = this.host.getBoundingClientRect();
          const side = (value: string, size: number) => {
            const parsed = Number.parseFloat(value);
            return Number.isFinite(parsed) ? parsed * (value.endsWith('%') ? size / 100 : 1) : 0;
          };
          const radius = Math.min(
            side(corner[0] ?? '0', bounds.width),
            side(corner[1] ?? corner[0] ?? '0', bounds.height),
          );
          field.store.patch({ rect: [0, 0, 1, 1], radius });
        };
        this.#cleanup.push(field.onBeforeFrame(update));
        update();
      }
      this.#sync();
    } catch (error) {
      if (this.state === ('disposed' as AttachmentState)) return this;
      if (!(error instanceof WebGPUUnavailableError)) {
        this.destroy();
        throw error;
      }
      this.#setState('fallback', error);
    }
    return this;
  }
  #sync() {
    if (!this.field || this.state === 'disposed') return;
    if (this.field.state === 'ready') {
      const restored = this.#lastState === 'lost';
      this.canvas.hidden = false;
      this.#nodes[1]!.style.background = '';
      this.#poster.hidden = true;
      this.#setState('ready', undefined, restored ? 'restored' : 'ready');
    } else if (this.field.state === 'lost' || this.field.state === 'building') {
      this.#setState('lost');
      if (this.#poster.src) this.#poster.hidden = false;
    } else if (this.field.state === 'error') {
      this.#nodes[1]!.style.background = this.effect.fallback;
      this.canvas.hidden = true;
      if (this.#poster.src) this.#poster.hidden = false;
      this.#setState('fallback');
    }
    this.#syncQuality();
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
    if (this.state === state && this.#lastState === state) return;
    this.state = state;
    this.#lastState = state;
    this.host.dataset['hgpuState'] = state;
    if (state !== 'building' && state !== 'disposed')
      this.host.dispatchEvent(
        new CustomEvent(`hgpu-${event}`, {
          detail: { attachment: this, field: this.field, error },
          bubbles: true,
          composed: true,
        }),
      );
  }
  set(values: ParamValues) {
    if (this.state === 'disposed') throw new Error('Attachment is disposed');
    this.#store.patch(values);
    this.field?.store.patch(values);
  }
  preset(name: string) {
    const values = this.effect.presets[name];
    if (!values) throw new RangeError(`Unknown preset: ${name}`);
    this.set(values);
  }
  setPoster(url: string | undefined) {
    if (url) this.#poster.src = url;
    else this.#poster.removeAttribute('src');
    this.#poster.hidden = !url || this.state === 'ready';
  }
  setLayer(layer: 'behind' | 'front') {
    const content = this.host.shadowRoot?.querySelector<HTMLElement>('.hgpu-content');
    this.canvas.style.zIndex = this.#poster.style.zIndex = layer === 'front' ? '1' : '0';
    if (content) content.style.zIndex = layer === 'front' ? '0' : '1';
  }
  pause() {
    this.field?.pause();
  }
  play() {
    this.field?.play();
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
  }
  setResolutionScale(value: number) {
    this.field?.setResolutionScale(value);
  }
  destroy() {
    if (this.state === 'disposed') return;
    this.state = 'disposed';
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
