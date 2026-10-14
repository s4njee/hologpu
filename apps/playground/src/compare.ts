import { createEffect, type EffectDefinition, type EffectField } from '@mk7s/hologpu';
import { schemaControls } from './param-controls.ts';

export interface CompareState {
  effect: string;
  params: Record<string, unknown>;
  split: number;
}
export class CompareStage {
  field: EffectField | null = null;
  split = 50;
  #generation = 0;
  #removeControls = () => {};
  #removePrimary = () => {};
  #initial: CompareState | undefined;
  #primaryCanvas: HTMLCanvasElement | null = null;
  #previousClip = '';
  readonly canvas: HTMLCanvasElement;
  readonly handle: HTMLInputElement;
  readonly select: HTMLSelectElement;
  readonly status: HTMLElement;
  readonly presets: HTMLSelectElement;
  readonly controls: HTMLElement;
  readonly stage: HTMLElement;
  readonly panel: HTMLElement;
  readonly catalogue: readonly EffectDefinition[];
  readonly changed: () => void;
  constructor(
    stage: HTMLElement,
    panel: HTMLElement,
    catalogue: readonly EffectDefinition[],
    changed: () => void,
    initial?: CompareState,
  ) {
    this.stage = stage;
    this.panel = panel;
    this.catalogue = catalogue;
    this.changed = changed;
    this.#initial = initial;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'compare-canvas';
    this.canvas.setAttribute('aria-label', 'Comparison preview');
    this.canvas.hidden = true;
    this.handle = document.createElement('input');
    this.handle.id = 'compare-split';
    this.handle.type = 'range';
    this.handle.min = '0';
    this.handle.max = '100';
    this.handle.value = String(initial?.split ?? 50);
    this.handle.setAttribute('aria-label', 'Comparison split');
    this.handle.hidden = true;
    this.handle.oninput = () => {
      this.split = Number(this.handle.value);
      this.#split();
      changed();
    };
    stage.append(this.canvas, this.handle);
    this.select = document.createElement('select');
    this.select.id = 'compare-effect';
    catalogue.forEach((effect) => this.select.add(new Option(effect.title, effect.id)));
    const label = document.createElement('label');
    label.textContent = 'Right effect';
    label.append(this.select);
    this.presets = document.createElement('select');
    this.presets.id = 'compare-presets';
    const presetLabel = document.createElement('label');
    presetLabel.textContent = 'Right preset';
    presetLabel.append(this.presets);
    this.controls = document.createElement('div');
    this.controls.id = 'compare-controls';
    this.status = document.createElement('p');
    this.status.id = 'compare-status';
    this.status.className = 'muted';
    this.status.setAttribute('role', 'status');
    panel.replaceChildren(label, presetLabel, this.status, this.controls);
    panel.hidden = true;
    this.presets.onchange = () => {
      const field = this.field;
      if (!field) return;
      field.store.reset();
      if (this.presets.value) field.store.patch(field.effect.presets[this.presets.value]!);
      changed();
    };
  }
  #split() {
    if (this.#primaryCanvas)
      this.#primaryCanvas.style.clipPath = `inset(0 ${100 - this.split}% 0 0)`;
    this.canvas.style.clipPath = `inset(0 0 0 ${this.split}%)`;
    this.stage.style.setProperty('--compare-split', `${this.split}%`);
    this.handle.value = String(this.split);
  }
  snapshot(): CompareState | undefined {
    return this.field
      ? { effect: this.field.effect.id, params: this.field.store.snapshot(), split: this.split }
      : undefined;
  }
  async enable(primary: EffectField) {
    this.disable();
    const token = ++this.#generation;
    this.canvas.hidden = false;
    this.handle.hidden = false;
    this.panel.hidden = false;
    this.stage.classList.add('compare-mode');
    this.#primaryCanvas = primary.canvas;
    this.#previousClip = primary.canvas.style.clipPath;
    this.select.querySelectorAll('option[data-local]').forEach((option) => option.remove());
    if (!this.catalogue.some((effect) => effect.id === primary.effect.id)) {
      const option = new Option(primary.effect.title, primary.effect.id);
      option.dataset['local'] = 'true';
      this.select.add(option);
    }
    this.select.value = this.#initial?.effect ?? primary.effect.id;
    if (!this.catalogue.some((e) => e.id === this.select.value))
      this.select.value = primary.effect.id;
    this.split = this.#initial?.split ?? this.split;
    this.#split();
    const build = async (initial = false) => {
      const revision = ++this.#generation;
      this.field?.destroy();
      this.field = null;
      this.#removeControls();
      this.#removePrimary();
      this.status.textContent = 'Compiling comparison…';
      const effect = this.catalogue.find((e) => e.id === this.select.value) ?? primary.effect;
      try {
        const field = await createEffect(this.canvas, effect, {
          params:
            initial && this.#initial
              ? (this.#initial.params as import('@mk7s/hologpu').ParamValues)
              : effect.id === primary.effect.id
                ? primary.store.snapshot()
                : undefined,
          seed: primary.frame.seed,
          playing: primary.requestedPlaying,
          resolutionScale: Math.max(
            effect.quality.resolutionScale[0],
            Math.min(effect.quality.resolutionScale[1], primary.surface?.resolutionScale ?? 1),
          ),
          timeScale: primary.timeScale,
          reducedMotion: primary.reducedMotionOverride,
        });
        if (revision !== this.#generation || primary.state === 'disposed') {
          field.destroy();
          return;
        }
        this.field = field;
        primary.reset();
        field.reset(primary.frame.seed);
        field.drawAt(primary.frame.time, primary.frame.seed);
        if (primary.playing) field.play();
        if (effect.inputs.includes('image'))
          await field.bindInput('image', {
            kind: 'texture',
            source: () => primary.inputTexture('image'),
            session: primary.session,
          });
        const removeChange = primary.onChange(() => field.invalidate()),
          removeFrame = primary.onRendered(() => field.invalidate());
        this.#removePrimary = () => {
          removeChange();
          removeFrame();
        };
        this.presets.replaceChildren(new Option('Defaults', ''));
        Object.keys(effect.presets).forEach((name) => this.presets.add(new Option(name, name)));
        this.#removeControls = schemaControls(
          field.store,
          this.controls,
          'compare-param',
          this.changed,
        );
        this.status.textContent = `${effect.title} · independent right parameters · both previews reset to seed ${primary.frame.seed}`;
        this.changed();
      } catch (error) {
        if (revision === this.#generation) this.status.textContent = String(error);
      }
    };
    this.select.onchange = () => void build();
    if (token === this.#generation) await build(true);
    this.#initial = undefined;
  }
  disable() {
    this.#generation++;
    this.#removeControls();
    this.#removePrimary();
    this.field?.destroy();
    this.field = null;
    this.canvas.hidden = true;
    this.handle.hidden = true;
    this.panel.hidden = true;
    this.stage.classList.remove('compare-mode');
    if (this.#primaryCanvas) this.#primaryCanvas.style.clipPath = this.#previousClip;
    this.#primaryCanvas = null;
  }
  dispose() {
    this.disable();
    this.canvas.remove();
    this.handle.remove();
  }
}
