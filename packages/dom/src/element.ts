import type { EffectDefinition, ParamValues } from '@mk7s/hologpu-core';
import { Attachment, type AttachOptions } from './attach.ts';
export type EffectResolver = (id: string) => Promise<EffectDefinition>;
let resolver: EffectResolver | undefined;
export function configureEffectResolver(resolve: EffectResolver) {
  resolver = resolve;
}
export interface HGPUFieldElement extends HTMLElement {
  readonly attachment: Attachment | null;
  readonly params: ParamValues | undefined;
  readonly ready: Promise<Attachment | null>;
  pause(): void;
  play(): void;
  reset(seed?: number): void;
  timeline(progress: number): void;
}
/** Explicit registration keeps imports safe in SSR and effect loading lazy. */
export function registerHGPUField(options: { resolveEffect?: EffectResolver; name?: string } = {}) {
  if (options.resolveEffect) configureEffectResolver(options.resolveEffect);
  if (typeof customElements === 'undefined' || typeof HTMLElement === 'undefined') return;
  const name = options.name ?? 'hgpu-field';
  if (customElements.get(name)) return customElements.get(name);
  class FieldElement extends HTMLElement implements HGPUFieldElement {
    static get observedAttributes() {
      return [
        'effect',
        'preset',
        'params',
        'poster',
        'layer',
        'padding',
        'seed',
        'playing',
        'reduced-motion',
        'fallback',
        'render-on',
        'idle-after',
      ];
    }
    #attachment: Attachment | null = null;
    #abort: AbortController | null = null;
    #epoch = 0;
    #ready: Promise<Attachment | null> = Promise.resolve(null);
    get attachment() {
      return this.#attachment;
    }
    get params() {
      return this.#attachment?.params;
    }
    get ready() {
      return this.#ready;
    }
    connectedCallback() {
      this.#mount();
    }
    disconnectedCallback() {
      this.#epoch++;
      this.#abort?.abort();
      this.#attachment?.destroy();
      this.#attachment = null;
    }
    attributeChangedCallback(attribute: string, oldValue: string | null, newValue: string | null) {
      if (oldValue === newValue || !this.isConnected) return;
      // Attribute changes during initialization must still cancel and restart that epoch.
      const current = this.#attachment?.state === 'building' ? null : this.#attachment;
      if (current && attribute === 'params') {
        try {
          current.set(this.#parameters());
        } catch (error) {
          this.#failure(error);
        }
      } else if (current && attribute === 'preset') {
        try {
          if (newValue) current.preset(newValue);
        } catch (error) {
          this.#failure(error);
        }
      } else if (current && attribute === 'poster') current.setPoster(newValue ?? undefined);
      else if (current && attribute === 'layer')
        current.setLayer(newValue === 'front' ? 'front' : 'behind');
      else if (current && attribute === 'playing') {
        if (newValue === 'false') current.pause();
        else current.play();
      } else if (current && attribute === 'reduced-motion')
        current.setReducedMotion(newValue === null ? undefined : newValue !== 'false');
      else if (current && attribute === 'padding') {
        try {
          current.setPadding(Number(newValue ?? '0'));
        } catch (error) {
          this.#failure(error);
        }
      } else if (current && attribute === 'seed') current.reset(this.#seed());
      else this.#mount();
    }
    #parameters(): ParamValues {
      const value = JSON.parse(this.getAttribute('params') ?? '{}') as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new TypeError('params must be a JSON object');
      return value as ParamValues;
    }
    #renderOn(): AttachOptions['renderOn'] {
      const value = this.getAttribute('render-on');
      if (value === null) return undefined;
      if (value !== 'always' && value !== 'interaction')
        throw new TypeError('render-on must be always or interaction');
      return value;
    }
    #seed() {
      const value = Number(this.getAttribute('seed') ?? '7');
      if (!Number.isFinite(value)) throw new TypeError('seed must be finite');
      return value;
    }
    #mount() {
      const epoch = ++this.#epoch;
      this.#abort?.abort();
      this.#attachment?.destroy();
      this.#attachment = null;
      const abort = (this.#abort = new AbortController());
      this.#ready = (async () => {
        try {
          const id = this.getAttribute('effect');
          if (!id || !resolver)
            throw new Error(
              id ? 'No lazy effect resolver configured' : 'effect attribute is required',
            );
          const definition = await resolver(id);
          if (epoch !== this.#epoch || !this.isConnected) return null;
          const mountOptions: AttachOptions = {
            signal: abort.signal,
            params: this.#parameters(),
            preset: this.getAttribute('preset') ?? undefined,
            poster: this.getAttribute('poster') ?? undefined,
            padding: Number(this.getAttribute('padding') ?? '0'),
            layer: this.getAttribute('layer') === 'front' ? 'front' : 'behind',
            seed: this.#seed(),
            playing: this.hasAttribute('playing')
              ? this.getAttribute('playing') !== 'false'
              : undefined,
            renderOn: this.#renderOn(),
            idleAfter: this.hasAttribute('idle-after')
              ? Number(this.getAttribute('idle-after'))
              : undefined,
            reducedMotion: this.hasAttribute('reduced-motion')
              ? this.getAttribute('reduced-motion') !== 'false'
              : undefined,
            forceFallback: this.hasAttribute('fallback'),
          };
          const attachment = new Attachment(this, definition, mountOptions);
          // Initial lifecycle listeners can use the same public handles as later events.
          this.#attachment = attachment;
          await attachment.initialize(mountOptions);
          if (epoch !== this.#epoch || !this.isConnected) {
            attachment.destroy();
            return null;
          }
          return attachment;
        } catch (error) {
          if (epoch === this.#epoch && this.isConnected) {
            this.#attachment?.destroy();
            this.#attachment = null;
            this.#failure(error);
          }
          return null;
        }
      })();
    }
    #failure(error: unknown) {
      if (!this.#attachment) this.dataset['hgpuState'] = 'fallback';
      this.dispatchEvent(
        new CustomEvent(this.#attachment ? 'hgpu-error' : 'hgpu-fallback', {
          detail: { error },
          bubbles: true,
          composed: true,
        }),
      );
    }
    pause() {
      this.#attachment?.pause();
    }
    play() {
      this.#attachment?.play();
    }
    reset(seed?: number) {
      this.#attachment?.reset(seed);
    }
    timeline(progress: number) {
      this.#attachment?.timeline(progress);
    }
  }
  customElements.define(name, FieldElement);
  return FieldElement;
}
