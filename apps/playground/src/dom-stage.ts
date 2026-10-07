import { attach, registerHGPUField, bindTimeline } from '@mk7s/hologpu/dom';
import type { Attachment, HGPUFieldElement } from '@mk7s/hologpu/dom';
import type { EffectDefinition, EffectField, MountOptions } from '@mk7s/hologpu';
import { OverlayRenderer } from './overlay.ts';
import './vendor/holocss/motion.css';
import './vendor/holocss/properties.css';
export type DOMMode = 'in-page' | 'grid';
export interface DOMStageOptions extends MountOptions {
  count?: number;
  forceFallback?: boolean;
  overlay?: boolean;
}
const demoIds = [
  'border-energy',
  'spotlight',
  'image-hover',
  'text-dissolve',
  'audio-spectrum',
  'scroll-scene',
];
export class DOMStage {
  readonly container: HTMLElement;
  readonly catalogue: readonly EffectDefinition[];
  fields: EffectField[] = [];
  attachments: Attachment[] = [];
  hosts: HTMLElement[] = [];
  overlay: OverlayRenderer | null = null;
  #epoch = 0;
  #cleanup: (() => void)[] = [];
  #root: HTMLElement | null = null;
  constructor(container: HTMLElement, catalogue: readonly EffectDefinition[]) {
    this.container = container;
    this.catalogue = catalogue;
    registerHGPUField();
  }
  async mount(effect: EffectDefinition, mode: DOMMode, options: DOMStageOptions = {}) {
    this.destroy();
    const epoch = this.#epoch;
    const root = document.createElement('article');
    root.id = 'dom-stage';
    root.className = `m5-stage ${mode}`;
    const heading = document.createElement('div');
    heading.className = 'm5-article-heading';
    heading.innerHTML =
      '<p class="eyebrow">DOM FIELD STUDY</p><h3>Light, layout and living content</h3><p>Scroll, resize, move the pointer or focus a button. The text and controls stay in the DOM.</p>';
    const cards = document.createElement('div');
    cards.className = 'm5-cards';
    root.append(heading, cards);
    this.container.append(root);
    this.#root = root;
    const count = mode === 'grid' ? Math.min(24, Math.max(1, Math.round(options.count ?? 6))) : 6;
    const definitions =
      mode === 'grid'
        ? Array.from({ length: count }, () => effect)
        : [
            effect,
            ...demoIds
              .filter((id) => id !== effect.id)
              .slice(0, 5)
              .map((id) => this.catalogue.find((e) => e.id === id)!),
          ];
    const hosts: HTMLElement[] = [],
      pending: Promise<Attachment | null>[] = [];
    for (let i = 0; i < definitions.length; i++) {
      const definition = definitions[i]!;
      const host = document.createElement(options.overlay ? 'section' : 'hgpu-field');
      host.className = 'm5-card';
      if (options.overlay) {
        host.style.background = 'transparent';
        host.style.zIndex = '3';
      }
      host.dataset['demoEffect'] = definition.id;
      const label = document.createElement('h4');
      label.textContent = definition.title;
      const paragraph = document.createElement('p');
      paragraph.textContent =
        definition.id === 'text-dissolve'
          ? 'Readable light DOM. GPU particles dissolve the mask; the words remain here.'
          : definition.id === 'fluid-obstacles'
            ? 'The dye respects the boxes around this heading and button.'
            : 'One element, one field, one shared device.';
      const button = document.createElement('button');
      button.textContent = 'Focus or press me';
      button.type = 'button';
      button.onclick = () =>
        (button.textContent =
          button.textContent === 'Focus or press me'
            ? 'Content remains interactive'
            : 'Focus or press me');
      host.append(label, paragraph, button);
      if (definition.id === 'fluid-obstacles') {
        label.setAttribute('data-hgpu-obstacle', '');
        button.setAttribute('data-hgpu-obstacle', '');
      }
      if (definition.id === 'image-hover') {
        host.classList.add('holo-uniform');
        host.style.setProperty('--hcss-number', '0');
        const control = document.createElement('label');
        control.className = 'm5-holo-control';
        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.setAttribute('aria-label', 'HoloCSS image transition');
        control.append(toggle, document.createTextNode(' HoloCSS transition'));
        toggle.onchange = () => {
          host.style.setProperty('--hcss-number', toggle.checked ? '1' : '0');
        };
        host.append(control);
      }
      if (definition.id === 'scroll-scene') host.classList.add('scroll-uniform');
      host.setAttribute('effect', definition.id);
      host.setAttribute('seed', String(options.seed ?? 7));
      host.setAttribute('playing', String(options.playing ?? true));
      if (i === 0) {
        host.setAttribute('params', JSON.stringify(options.params ?? {}));
        if (options.preset) host.setAttribute('preset', options.preset);
      }
      if (options.forceFallback) host.setAttribute('fallback', '');
      if (options.reducedMotion !== undefined)
        host.setAttribute('reduced-motion', String(options.reducedMotion));
      hosts.push(host);
      cards.append(host);
      pending.push(
        options.overlay
          ? attach(host, definition, {
              ...options,
              params: i === 0 ? options.params : undefined,
              preset: i === 0 ? options.preset : undefined,
              present: false,
            })
          : (host as HGPUFieldElement).ready,
      );
    }
    const results = await Promise.all(pending);
    if (epoch !== this.#epoch) {
      for (const a of results) a?.destroy();
      return null;
    }
    this.hosts = hosts;
    this.attachments = results.filter((a): a is Attachment => a !== null);
    this.fields = this.attachments.flatMap((a) => (a.field ? [a.field] : []));
    for (const field of this.fields) {
      field.setAdaptiveQuality(options.adaptiveQuality ?? true);
      if (options.resolutionScale !== undefined) field.setResolutionScale(options.resolutionScale);
      if (options.timeScale !== undefined) field.setTimeScale(options.timeScale);
    }
    if (!CSS.supports('animation-timeline', 'view()')) {
      for (let i = 0; i < this.attachments.length; i++) {
        const attachment = this.attachments[i]!;
        if (attachment.effect.id !== 'scroll-scene' || !attachment.field) continue;
        const field = attachment.field,
          host = attachment.host;
        const driver = bindTimeline(field, () => {
          const r = host.getBoundingClientRect(),
            v = root.getBoundingClientRect();
          const p = field.reducedMotion
            ? 0
            : Math.min(1, Math.max(0, (v.bottom - r.top) / (v.height + r.height)));
          field.params['progress'] = p;
          return p;
        });
        this.#cleanup.push(() => driver.dispose());
      }
    }
    if (options.overlay && this.fields.length) {
      const overlay = await OverlayRenderer.create(
        this.attachments.flatMap((a) =>
          a.field ? [{ host: a.host, field: a.field, clip: root }] : [],
        ),
      );
      if (epoch !== this.#epoch) {
        overlay.destroy();
        return null;
      }
      this.overlay = overlay;
    }
    this.#cleanup.push(
      this.fields[0]?.store.onChange(() => {
        const primary = this.fields[0];
        if (mode !== 'grid' || !primary) return;
        for (const field of this.fields.slice(1)) field.store.patch(primary.store.snapshot());
      }) ?? (() => {}),
    );
    return this.attachments[0]?.field ?? null;
  }
  get memory() {
    return {
      instances: this.fields.length,
      textureBytes: this.fields.reduce((n, f) => n + f.memory().textureBytes, 0),
      bufferBytes: this.fields.reduce((n, f) => n + f.memory().bufferBytes, 0),
      presentationContexts: this.overlay ? 1 : this.fields.length,
      overlay: this.overlay?.memory ?? null,
    };
  }
  destroy() {
    this.#epoch++;
    this.overlay?.destroy();
    this.overlay = null;
    for (const dispose of this.#cleanup) dispose();
    this.#cleanup = [];
    for (const a of this.attachments) a.destroy();
    this.attachments = [];
    this.fields = [];
    this.hosts = [];
    this.#root?.remove();
    this.#root = null;
  }
}
