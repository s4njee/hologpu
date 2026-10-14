import { backdropInputs } from './backdrop.ts';
import {
  createEffect,
  createHDRCanvas,
  ParamStore,
  fragmentEffect,
  filterEffect,
  chain,
  type EffectField,
  type EffectDefinition,
  type ParamValue,
  type ParamSpec,
} from '@mk7s/hologpu';
import { catalogue } from '@mk7s/hologpu/effects';
import { bindCSSParameters } from '@mk7s/hologpu/dom';
import './style.css';
import { passesDrawer } from './passes.ts';
import { sourceEditor } from './source-editor.ts';
import { profilerDrawer, runBenchmark } from './profiler.ts';
import { morphInputs } from './morph-inputs.ts';
import { mediaInputs } from './media-inputs.ts';
import { CompareStage, type CompareState } from './compare.ts';
import { screenshot, VideoCapture } from './capture.ts';
import { DOMStage } from './dom-stage.ts';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
function resolutionFor(definition: EffectDefinition, requested: number) {
  const [min, max] = definition.quality.resolutionScale;
  return Math.max(min, Math.min(max, requested));
}
function setStageResolution(requested: number) {
  const scale = resolutionFor(effect, requested);
  $<HTMLSelectElement>('resolution').value = String(scale);
  for (const item of stageFields()) item.setResolutionScale(resolutionFor(item.effect, scale));
  if (compare.field) compare.field.setResolutionScale(resolutionFor(compare.field.effect, scale));
}
const canvas = $<HTMLCanvasElement>('canvas');
const query = new URLSearchParams(location.search);
let effect =
  catalogue.find((e) => e.id === query.get('effect')) ??
  catalogue.find((e) => e.id === 'gradient-oklch')!;
let field: EffectField | null = null,
  generation = 0;
canvas.addEventListener('pointerdown', (event) => {
  const current = field;
  if (!current || current.canvas !== canvas || !current.effect.inputs.includes('pointer-down'))
    return;
  const bounds = canvas.getBoundingClientRect();
  current.press([
    (event.clientX - bounds.left) / Math.max(1, bounds.width),
    (event.clientY - bounds.top) / Math.max(1, bounds.height),
  ]);
});
const notes = import.meta.glob('../../../docs/notes/*.md', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>;
const controls = new Map<string, HTMLElement[]>();
let removeMedia = () => {};
let stageMode = ['compare', 'in-page', 'grid'].includes(query.get('mode') ?? '')
  ? query.get('mode')!
  : 'full';
const domStage = new DOMStage($('stage'), catalogue);
const stageFields = () => (domStage.fields.length ? domStage.fields : field ? [field] : []);
let stopTimeline = () => {};
let stopDOMAudio = () => {};
$<HTMLSelectElement>('grid-count').value = ['4', '6', '12', '24'].includes(
  query.get('copies') ?? '',
)
  ? query.get('copies')!
  : '6';
$<HTMLInputElement>('force-fallback').checked = query.get('fallback') === 'true';
$<HTMLInputElement>('overlay-mode').checked = query.get('overlay') === 'true';
$<HTMLSelectElement>('quality-tier').value = ['auto', 'high', 'medium', 'low'].includes(
  query.get('tier') ?? '',
)
  ? query.get('tier')!
  : query.get('quality') === 'auto'
    ? 'auto'
    : 'high';
let compareInitial: CompareState | undefined;
try {
  const params = JSON.parse(query.get('compareParams') ?? '{}');
  const split = Number(query.get('split') ?? 50);
  if (params && typeof params === 'object' && !Array.isArray(params))
    compareInitial = {
      effect: query.get('compareEffect') ?? effect.id,
      params,
      split: Number.isFinite(split) ? Math.max(0, Math.min(100, split)) : 50,
    };
} catch {
  /*Invalid comparisons start with defaults.*/
}
const compare = new CompareStage(
  $('stage'),
  $('compare-panel-controls'),
  catalogue,
  save,
  compareInitial,
);
const capture = new VideoCapture((recording, message) => {
  $('record').textContent = recording ? 'Stop recording' : 'Record video';
  $('capture-status').textContent = message;
});
let startingParams: Record<string, ParamValue> = {};
try {
  const parsed = JSON.parse(query.get('params') ?? '{}');
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) startingParams = parsed;
} catch {
  /* Invalid links use defaults. */
}
function save() {
  const state = new URLSearchParams({
    effect: effect.id,
    mode: stageMode,
    seed: String(field?.frame.seed ?? $<HTMLInputElement>('seed').value),
    params: JSON.stringify(field?.store.snapshot() ?? {}),
    playing: String(field?.playing ?? false),
    resolution: String(field?.quality.maxResolution ?? $<HTMLSelectElement>('resolution').value),
    timeScale: String(field?.timeScale ?? $<HTMLSelectElement>('time-scale').value),
    quality:
      (field?.adaptiveQuality ?? $<HTMLInputElement>('adaptive-quality').checked)
        ? 'auto'
        : 'fixed',
  });
  if (stageMode === 'grid') state.set('copies', $<HTMLSelectElement>('grid-count').value);
  if ($<HTMLInputElement>('force-fallback').checked) state.set('fallback', 'true');
  if ($<HTMLInputElement>('overlay-mode').checked) state.set('overlay', 'true');
  state.set('tier', $<HTMLSelectElement>('quality-tier').value);
  const preset = $<HTMLSelectElement>('presets').value;
  if (preset) state.set('preset', preset);
  if ($<HTMLInputElement>('motion').checked) state.set('motion', 'reduce');
  const comparison = compare.snapshot();
  if (stageMode === 'compare' && comparison) {
    state.set('compareEffect', comparison.effect);
    state.set('compareParams', JSON.stringify(comparison.params));
    state.set('split', String(comparison.split));
  }
  history.replaceState(null, '', `?${state}`);
}
function renderBrowser() {
  const needle = $<HTMLInputElement>('search').value.toLowerCase(),
    family = $<HTMLSelectElement>('family').value;
  const nav = $('effects');
  nav.replaceChildren();
  for (const e of catalogue) {
    if (
      (family !== 'all' && e.family !== family) ||
      !`${e.title} ${e.id} ${e.tags.join(' ')}`.toLowerCase().includes(needle)
    )
      continue;
    const button = document.createElement('button');
    button.className = e.id === effect.id ? 'selected' : '';
    button.dataset['effect'] = e.id;
    button.setAttribute('aria-current', String(e.id === effect.id));
    const title = document.createElement('strong');
    title.textContent = e.title;
    const info = document.createElement('span');
    const missing = field ? e.features.filter((f) => !field!.session.device.features.has(f)) : [];
    info.textContent = `${e.tier} · ${missing.length ? 'Unavailable: ' + missing.join(', ') : field ? 'Available' : 'Checking device'}`;
    button.append(title, info);
    button.onclick = () => void mount(e);
    nav.append(button);
  }
}
for (const family of new Set(catalogue.map((e) => e.family))) {
  const option = document.createElement('option');
  option.value = family;
  option.textContent = family;
  $('family').append(option);
}
$('search').addEventListener('input', renderBrowser);
$('family').addEventListener('change', renderBrowser);
function inputFor(name: string, spec: ParamSpec, index?: number) {
  const input = document.createElement('input');
  input.id = `param-${name}${index === undefined ? '' : `-${index}`}`;
  input.dataset['param'] = name;
  input.type = spec.type === 'bool' ? 'checkbox' : spec.type === 'color' ? 'color' : 'number';
  if ('min' in spec && spec.min !== undefined) input.min = String(spec.min);
  if ('max' in spec && spec.max !== undefined) input.max = String(spec.max);
  input.step = 'step' in spec ? String(spec.step ?? 'any') : 'any';
  input.addEventListener('input', () => {
    if (!field) return;
    try {
      const value =
        index !== undefined
          ? (field.params[name] as readonly number[]).map((v, i) =>
              i === index ? Number(input.value) : v,
            )
          : spec.type === 'bool'
            ? input.checked
            : spec.type === 'color'
              ? input.value
              : Number(input.value);
      field.store.set(name, value);
      save();
    } catch (error) {
      $('status').textContent = String(error);
    }
  });
  return input;
}
function inspector() {
  controls.clear();
  const panel = $('controls');
  panel.replaceChildren();
  const groups = new Map<string, HTMLFieldSetElement>();
  for (const [name, spec] of Object.entries(effect.params)) {
    const group = spec.group ?? 'Parameters';
    let box = groups.get(group);
    if (!box) {
      box = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = group;
      box.append(legend);
      groups.set(group, box);
      panel.append(box);
    }
    const row = document.createElement('div');
    row.className = 'param';
    const label = document.createElement('label');
    label.htmlFor = `param-${name}`;
    label.textContent = name.replace(/([A-Z])/g, ' $1');
    row.append(label);
    const inputs: HTMLElement[] = [];
    if (spec.type === 'enum') {
      const select = document.createElement('select');
      select.id = `param-${name}`;
      select.dataset['param'] = name;
      for (const value of spec.options) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.append(option);
      }
      select.onchange = () => {
        field?.store.set(name, select.value);
        save();
      };
      inputs.push(select);
      row.append(select);
    } else if (spec.type === 'curve' || spec.type === 'gradient') {
      const input = document.createElement('textarea');
      input.id = `param-${name}`;
      input.rows = 3;
      input.dataset['param'] = name;
      input.setAttribute('aria-label', name);
      input.onchange = () => {
        try {
          field?.store.set(name, JSON.parse(input.value) as ParamValue);
          save();
        } catch (error) {
          $('status').textContent = String(error);
        }
      };
      inputs.push(input);
      row.append(input);
    } else if (spec.type === 'texture') {
      const input = document.createElement('input');
      input.id = `param-${name}`;
      input.type = 'text';
      input.dataset['param'] = name;
      input.onchange = () => {
        field?.store.set(name, input.value);
        save();
      };
      inputs.push(input);
      row.append(input);
    } else if (spec.type.startsWith('vec')) {
      const vector = document.createElement('div');
      vector.className = 'vector';
      for (let i = 0; i < Number(spec.type.slice(-1)); i++) {
        const input = inputFor(name, spec, i);
        input.setAttribute('aria-label', `${name} ${'xyzw'[i]}`);
        vector.append(input);
        inputs.push(input);
      }
      row.append(vector);
    } else {
      const input = inputFor(name, spec);
      inputs.push(input);
      row.append(input);
      if (
        ['f32', 'i32', 'u32'].includes(spec.type) &&
        'min' in spec &&
        spec.min !== undefined &&
        spec.max !== undefined
      ) {
        const slider = inputFor(name, spec);
        slider.type = 'range';
        slider.id += `-range`;
        slider.setAttribute('aria-label', name);
        row.append(slider);
        inputs.push(slider);
      }
    }
    const description = document.createElement('small');
    description.textContent = spec.description ?? '';
    row.append(description);
    box.append(row);
    controls.set(name, inputs);
  }
  const presets = $<HTMLSelectElement>('presets');
  presets.replaceChildren(new Option('Defaults', ''));
  for (const name of Object.keys(effect.presets)) presets.add(new Option(name, name));
  refreshControls();
}
function refreshControls() {
  if (!field) return;
  for (const [name, inputs] of controls) {
    const value = field.params[name];
    inputs.forEach((control, index) => {
      if (control instanceof HTMLInputElement && control.type === 'checkbox')
        control.checked = value as boolean;
      else if (control instanceof HTMLTextAreaElement) control.value = JSON.stringify(value);
      else
        (control as HTMLInputElement).value = Array.isArray(value)
          ? String(value[index])
          : String(value);
    });
  }
}
function renderNote(markdown: string, id: string): DocumentFragment {
  const references = import.meta.glob('../../../docs/benchmarks/m*.json', {
    query: '?url',
    import: 'default',
    eager: true,
  }) as Record<string, string>;
  const fragment = document.createDocumentFragment();
  const inline = (parent: Node, text: string) => {
    const tokens = /`([^`]+)`|\[([^\]]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
    let previous = 0;
    for (const match of text.matchAll(tokens)) {
      parent.appendChild(document.createTextNode(text.slice(previous, match.index)));
      const content = match[1] ?? match[2] ?? match[4] ?? match[5] ?? '';
      let element: HTMLElement;
      if (match[1]) element = document.createElement('code');
      else if (match[2]) {
        element = document.createElement('span');
        try {
          const href = match[3]!;
          const url = new URL(href, `https://notes.invalid/docs/notes/${id}.md`);
          const asset = references[`../../..${url.pathname}`];
          if (
            asset ||
            (url.origin !== 'https://notes.invalid' &&
              ['https:', 'http:', 'mailto:'].includes(url.protocol))
          ) {
            const link = document.createElement('a');
            link.href = asset ?? url.href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            element = link;
          }
        } catch {
          // Invalid and unsupported links remain readable text.
        }
      } else element = document.createElement(match[4] ? 'strong' : 'em');
      element.textContent = content;
      parent.appendChild(element);
      previous = match.index + match[0].length;
    }
    parent.appendChild(document.createTextNode(text.slice(previous)));
  };
  const lines = markdown
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const tableCells = (line: string) =>
    line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim());
  const tableDivider = (line: string) =>
    /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
  for (let index = 0; index < lines.length;) {
    const line = lines[index]!;
    if (!line.trim()) {
      index++;
      continue;
    }
    if (/^```/.test(line)) {
      const code = document.createElement('code');
      const body: string[] = [];
      index++;
      while (index < lines.length && !/^```/.test(lines[index]!)) body.push(lines[index++]!);
      if (index < lines.length) index++;
      code.textContent = body.join('\n');
      const pre = document.createElement('pre');
      pre.append(code);
      fragment.append(pre);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const element = document.createElement(`h${Math.min(6, heading[1]!.length + 1)}`);
      inline(element, heading[2]!);
      fragment.append(element);
      index++;
      continue;
    }
    if (line.includes('|') && index + 1 < lines.length && tableDivider(lines[index + 1]!)) {
      const table = document.createElement('table');
      const row = (values: string[], header = false) => {
        const tr = document.createElement('tr');
        for (const value of values) {
          const cell = document.createElement(header ? 'th' : 'td');
          if (header) cell.setAttribute('scope', 'col');
          inline(cell, value);
          tr.append(cell);
        }
        return tr;
      };
      const head = document.createElement('thead');
      head.append(row(tableCells(line), true));
      const body = document.createElement('tbody');
      index += 2;
      while (index < lines.length && lines[index]!.trim() && lines[index]!.includes('|'))
        body.append(row(tableCells(lines[index++]!)));
      table.append(head, body);
      const wrapper = document.createElement('div');
      wrapper.className = 'note-table';
      wrapper.tabIndex = 0;
      wrapper.setAttribute('role', 'region');
      wrapper.setAttribute('aria-label', `${tableCells(line)[0] ?? 'Research'} table`);
      wrapper.append(table);
      fragment.append(wrapper);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const list = document.createElement('ul');
      while (index < lines.length && /^[-*]\s+/.test(lines[index]!)) {
        const item = document.createElement('li');
        inline(item, lines[index++]!.replace(/^[-*]\s+/, ''));
        list.append(item);
      }
      fragment.append(list);
      continue;
    }
    const paragraph: string[] = [line];
    index++;
    while (
      index < lines.length &&
      lines[index]!.trim() &&
      !/^(?:#{1,6}\s|```|[-*]\s)/.test(lines[index]!) &&
      !(lines[index]!.includes('|') && tableDivider(lines[index + 1] ?? ''))
    )
      paragraph.push(lines[index++]!);
    const element = document.createElement('p');
    inline(element, paragraph.join(' '));
    fragment.append(element);
  }
  return fragment;
}
let noteRequest = 0;
async function showNotes(id: string) {
  const token = ++noteRequest;
  const key = Object.keys(notes).find((key) => key.endsWith(`/${id}.md`));
  const node = $('notes');
  node.textContent = key ? 'Loading research note…' : 'Research note is not available.';
  if (!key) return;
  try {
    const markdown = await notes[key]!();
    if (token !== noteRequest || effect.id !== id) return;
    node.replaceChildren(renderNote(markdown, id));
  } catch {
    if (token === noteRequest && effect.id === id)
      node.textContent = 'Research note could not be loaded.';
  }
}
let removeBackdrop = () => {};
async function mount(next: EffectDefinition, initial = false) {
  removeBackdrop();
  const token = ++generation;
  removeMedia();
  compare.disable();
  capture.dispose();
  $('record').textContent = 'Record video';
  $('capture-status').textContent = '';
  stopTimeline();
  stopDOMAudio();
  domStage.destroy();
  field?.destroy();
  field = null;
  effect = next;
  $('title').textContent = next.title;
  $('tier').textContent = `${next.tier} / ${next.family.toUpperCase()}`;
  canvas.style.touchAction =
    next.inputs.includes('pointer') || next.inputs.includes('pointer-down') ? 'none' : 'auto';
  $('passes').replaceChildren();
  $('source-panel').replaceChildren(Object.assign(document.createElement('pre'), { id: 'source' }));
  $('profiler').replaceChildren();
  $('source').textContent = 'Compiling…';
  $('status').dataset['state'] = 'loading';
  $('status').textContent = 'Compiling effect pipelines…';
  $('fallback').hidden = true;
  canvas.hidden = false;
  $('stage').dataset['reducedMotion'] = String($<HTMLInputElement>('motion').checked);
  $('stage').classList.toggle('dom-mode', stageMode === 'in-page' || stageMode === 'grid');
  $('stage').style.background =
    stageMode === 'in-page' || stageMode === 'grid' ? '' : next.fallback;
  renderBrowser();
  void showNotes(next.id);
  try {
    const rawSeed = Number(initial ? (query.get('seed') ?? 7) : $<HTMLInputElement>('seed').value);
    const seed = Number.isFinite(rawSeed) ? rawSeed >>> 0 : 7;
    const rawScale = Number(
      initial
        ? (query.get('resolution') ?? next.defaultResolutionScale ?? 1)
        : $<HTMLSelectElement>('resolution').value,
    );
    const scale = resolutionFor(next, [1, 0.75, 0.5, 0.25].includes(rawScale) ? rawScale : 1);
    for (const option of $<HTMLSelectElement>('resolution').options)
      option.disabled =
        Number(option.value) < next.quality.resolutionScale[0] ||
        Number(option.value) > next.quality.resolutionScale[1];
    if (initial) {
      try {
        new ParamStore(next.params, startingParams);
      } catch {
        startingParams = {};
      }
    }
    const mountOptions = {
      params: initial ? startingParams : undefined,
      preset: initial ? (query.get('preset') ?? undefined) : undefined,
      seed,
      playing: initial ? query.get('playing') !== 'false' : true,
      resolutionScale: scale,
      timeScale:
        initial && [0.25, 0.5, 1, 2].includes(Number(query.get('timeScale')))
          ? Number(query.get('timeScale'))
          : Number($<HTMLSelectElement>('time-scale').value),
      adaptiveQuality: initial
        ? query.get('quality') === 'auto'
        : $<HTMLInputElement>('adaptive-quality').checked,
      reducedMotion: $<HTMLInputElement>('motion').checked ? true : undefined,
    };
    const forceFallback = $<HTMLInputElement>('force-fallback').checked;
    const mounted =
      stageMode === 'in-page' || stageMode === 'grid'
        ? await domStage.mount(next, stageMode, {
            ...mountOptions,
            count: Number($<HTMLSelectElement>('grid-count').value),
            forceFallback,
            overlay: $<HTMLInputElement>('overlay-mode').checked,
          })
        : forceFallback
          ? null
          : await createEffect(canvas, next, mountOptions);
    if (token !== generation) {
      mounted?.destroy();
      return;
    }
    field = mounted;
    if (field && (stageMode === 'full' || stageMode === 'compare'))
      $('stage').style.background = '';
    $<HTMLSelectElement>('stage-mode').value = stageMode;
    if (!field) {
      canvas.hidden = true;
      if (stageMode === 'full' || stageMode === 'compare') {
        $('fallback').hidden = false;
        $('fallback').textContent = `${next.title} · CSS fallback`;
      }
      $('status').dataset['state'] = 'fallback';
      $('status').textContent = 'CSS fallback · content and controls remain accessible';
      $('m5-stage-status').textContent =
        `${domStage.attachments.length} fallback attachments · no GPU required`;
      $<HTMLInputElement>('seed').value = String(seed);
      $<HTMLSelectElement>('resolution').value = String(scale);
      save();
      renderBrowser();
      return;
    }
    $('m5-stage-status').textContent = domStage.fields.length
      ? `${domStage.fields.length} attached fields · ${domStage.memory.presentationContexts} presentation canvases · ${CSS.supports('animation-timeline', 'view()') ? 'CSS view timeline' : 'JS scroll timeline fallback'}`
      : 'Full stage uses the selected effect.';
    inspector();
    morphInputs(field, $('effect-inputs'));
    removeBackdrop = backdropInputs(field, $('effect-inputs'));
    removeMedia = mediaInputs(field, $('media-input-controls'));
    $('media-inputs').hidden = !field.effect.inputs.some((x) =>
      ['image', 'audio', 'text'].includes(x),
    );
    $<HTMLSelectElement>('stage-mode').value = stageMode;
    $('compare-panel').hidden = stageMode !== 'compare';
    if (stageMode === 'compare') await compare.enable(field);
    passesDrawer(field, $('passes'));
    sourceEditor(field, $('source-panel'), () => {
      if (field) passesDrawer(field, $('passes'));
    });
    profilerDrawer(field, $('profiler'));
    $<HTMLSelectElement>('time-scale').value = String(field.timeScale);
    $<HTMLInputElement>('adaptive-quality').checked = field.adaptiveQuality;
    if (initial && (query.get('preset') ?? '') in next.presets)
      $<HTMLSelectElement>('presets').value = query.get('preset')!;
    field.store.onChange(refreshControls);
    field.onChange(() => {
      if (field?.state === 'error') {
        $('stage').style.background = next.fallback;
        canvas.hidden = true;
        $('status').textContent = 'Device recovery failed';
        $('status').dataset['state'] = 'error';
      } else if (field?.state === 'lost' || field?.state === 'building') {
        if (stageMode === 'full' || stageMode === 'compare')
          $('stage').style.background = next.fallback;
        canvas.hidden = true;
        $('status').dataset['state'] = 'lost';
      } else if (field?.state === 'ready') {
        canvas.hidden = false;
        if (stageMode === 'full' || stageMode === 'compare') $('stage').style.background = '';
        $('status').dataset['state'] = 'ready';
        $('m5-stage-status').textContent = domStage.fields.length
          ? `${domStage.fields.length} attached fields · device ready`
          : 'Device ready';
      }
    });
    $('source').textContent = Object.entries(field.sources)
      .map(([name, source]) => `// ${name}\n${source.code}`)
      .join('\n');
    $('capabilities').textContent = JSON.stringify(field.session.capabilities, null, 2);
    $('status').dataset['state'] = 'ready';
    $('status').textContent =
      `${next.id} · ${field.canvas.width} × ${field.canvas.height} · linear RGBA16 float`;
    $<HTMLInputElement>('seed').value = String(seed);
    $<HTMLSelectElement>('resolution').value = String(scale);
    refreshTransport();
    renderBrowser();
    save();
  } catch (error) {
    if (token !== generation) return;
    canvas.hidden = true;
    $('stage').style.background = next.fallback;
    $('fallback').hidden = false;
    $('fallback').textContent = `${next.title} · CSS fallback`;
    $('status').dataset['state'] = 'error';
    $('status').textContent = String(error);
    $('source').textContent = String(error);
    $('capabilities').textContent = navigator.gpu
      ? 'Adapter or pipeline unavailable.'
      : 'WebGPU is unavailable in this browser.';
  }
}
function refreshTransport() {
  $('play').textContent = field?.playing ? 'Pause' : 'Play';
}
$('play').onclick = () => {
  if (field?.playing) {
    for (const item of stageFields()) item.pause();
    compare.field?.pause();
  } else {
    for (const item of stageFields()) item.play();
    compare.field?.play();
  }
  refreshTransport();
  save();
};
$('step').onclick = () => {
  for (const item of stageFields()) item.step();
  compare.field?.step();
  refreshTransport();
  save();
};
$('reset').onclick = () => {
  for (const item of stageFields()) item.reset();
  compare.field?.reset();
  save();
};
$('defaults').onclick = () => {
  field?.store.reset();
  $<HTMLSelectElement>('presets').value = '';
  refreshControls();
  save();
};
$('presets').onchange = () => {
  const name = $<HTMLSelectElement>('presets').value;
  field?.store.reset();
  if (name) field?.store.patch(effect.presets[name]!);
  refreshControls();
  save();
};
$('seed').onchange = () => {
  for (const item of stageFields()) item.reset(Number($<HTMLInputElement>('seed').value));
  compare.field?.reset(field?.frame.seed);
  save();
};
$('time-scale').onchange = () => {
  for (const item of stageFields())
    item.setTimeScale(Number($<HTMLSelectElement>('time-scale').value));
  compare.field?.setTimeScale(Number($<HTMLSelectElement>('time-scale').value));
  save();
};
$('adaptive-quality').onchange = () => {
  for (const item of stageFields())
    item.setAdaptiveQuality($<HTMLInputElement>('adaptive-quality').checked);
  compare.field?.setAdaptiveQuality($<HTMLInputElement>('adaptive-quality').checked);
  save();
};
$('resolution').onchange = () => {
  setStageResolution(Number($<HTMLSelectElement>('resolution').value));
  save();
};
$<HTMLInputElement>('motion').checked = query.get('motion') === 'reduce';
$('motion').onchange = () => {
  $('stage').dataset['reducedMotion'] = String($<HTMLInputElement>('motion').checked);
  for (const item of stageFields())
    item.setReducedMotion($<HTMLInputElement>('motion').checked ? true : undefined);
  compare.field?.setReducedMotion($<HTMLInputElement>('motion').checked ? true : undefined);
  refreshTransport();
  save();
};
for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-drawer]'))
  tab.onclick = () => {
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-drawer]')) {
      const active = button === tab;
      button.setAttribute('aria-selected', String(active));
      $(button.dataset['drawer']!).hidden = !active;
    }
  };
window.addEventListener('keydown', (event) => {
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLSelectElement ||
    event.target instanceof HTMLTextAreaElement
  )
    return;
  const index = catalogue.indexOf(effect);
  if (event.key === ' ') {
    event.preventDefault();
    $('play').click();
  } else if (event.key === '.') $('step').click();
  else if (event.key === 'r') $('reset').click();
  else if (event.key === '/') {
    event.preventDefault();
    $('search').focus();
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    void mount(
      catalogue[
        (index + (event.key === 'ArrowDown' ? 1 : -1) + catalogue.length) % catalogue.length
      ]!,
    );
  }
});
window.addEventListener('popstate', () => location.reload());
$('stage-mode').onchange = async () => {
  stageMode = $<HTMLSelectElement>('stage-mode').value;
  $('compare-panel').hidden = stageMode !== 'compare';
  if (
    stageMode === 'in-page' ||
    stageMode === 'grid' ||
    domStage.fields.length ||
    domStage.attachments.length
  ) {
    void mount(effect);
    return;
  }
  if (stageMode === 'compare' && field) await compare.enable(field);
  else compare.disable();
  $('stage').classList.remove('dom-mode');
  save();
};
for (const id of ['grid-count', 'force-fallback', 'overlay-mode'])
  $(id).onchange = () => void mount(effect);
$('quality-tier').onchange = () => {
  const tier = $<HTMLSelectElement>('quality-tier').value;
  $<HTMLSelectElement>('resolution').value =
    tier === 'low' ? '0.25' : tier === 'medium' ? '0.5' : '1';
  $<HTMLInputElement>('adaptive-quality').checked = tier === 'auto';
  setStageResolution(Number($<HTMLSelectElement>('resolution').value));
  for (const item of stageFields()) item.setAdaptiveQuality(tier === 'auto');
  compare.field?.setAdaptiveQuality(tier === 'auto');
  save();
};
$('device-loss').onclick = () => {
  if (field?.session.state === 'ready') {
    field.session.device.destroy();
    $('m5-stage-status').textContent = 'Rebuilding fields after device loss…';
  }
};
$('timeline-demo').onclick = () => {
  stopTimeline();
  let canceled = false,
    raf = 0;
  const start = performance.now();
  const tick = (now: number) => {
    if (canceled) return;
    const progress = Math.min(1, (now - start) / 3000);
    for (const item of stageFields()) {
      if (item.state !== 'ready') continue;
      item.timeline(progress);
      if (item.effect.params['progress'])
        item.params['progress'] = item.reducedMotion ? 0 : progress;
    }
    for (const host of domStage.hosts)
      if (
        host.dataset['demoEffect'] &&
        ['image-hover', 'text-dissolve', 'scroll-scene'].includes(host.dataset['demoEffect'])
      )
        host.style.setProperty(
          '--hgpu-progress',
          String($<HTMLInputElement>('motion').checked ? 0 : progress),
        );
    if (progress < 1) raf = requestAnimationFrame(tick);
    else {
      $('m5-stage-status').textContent = 'Timeline reached 1 · fixed-step simulation stayed paused';
      refreshTransport();
    }
  };
  raf = requestAnimationFrame(tick);
  stopTimeline = () => {
    canceled = true;
    cancelAnimationFrame(raf);
  };
};
$('dom-audio').onclick = async () => {
  stopDOMAudio();
  const fields = stageFields().filter((item) => item.effect.inputs.includes('audio'));
  if (!fields.length) {
    $('m5-stage-status').textContent = 'Choose Audio spectrum or In page to bind an audio source.';
    return;
  }
  const context = new AudioContext();
  const oscillator = context.createOscillator(),
    analyser = context.createAnalyser(),
    gain = context.createGain();
  analyser.fftSize = 512;
  oscillator.frequency.value = 440;
  gain.gain.value = 0;
  oscillator.connect(analyser);
  analyser.connect(gain);
  gain.connect(context.destination);
  let canceled = false,
    started = false;
  const token = generation;
  const disposeAudio = () => {
    if (canceled) return;
    canceled = true;
    if (started) oscillator.stop();
    oscillator.disconnect();
    analyser.disconnect();
    gain.disconnect();
    void context.close();
  };
  stopDOMAudio = disposeAudio;
  try {
    await context.resume();
    if (canceled || token !== generation) return;
    oscillator.start();
    started = true;
    for (const item of fields) {
      if (canceled || token !== generation) return;
      if (item.state === 'ready') await item.bindInput('audio', { kind: 'audio', analyser });
    }
    if (canceled || token !== generation) return;
    $('m5-stage-status').textContent = 'Live 440 Hz FFT and waveform · silent output';
  } catch (error) {
    if (!canceled && token === generation) {
      disposeAudio();
      $('m5-stage-status').textContent = String(error);
    }
  }
};
$('screenshot').onclick = async () => {
  if (!field) return;
  try {
    await screenshot(field, stageMode === 'compare' ? compare : undefined);
    $('capture-status').textContent = 'PNG saved.';
  } catch (error) {
    $('capture-status').textContent = String(error);
  }
};
$('record').onclick = async () => {
  if (!field) return;
  const button = $('record') as HTMLButtonElement;
  try {
    if (capture.recorder) capture.stop();
    else {
      button.disabled = true;
      $('capture-status').textContent = 'Preparing recording…';
      await capture.start(field, stageMode === 'compare' ? compare : undefined);
    }
  } catch (error) {
    $('capture-status').textContent = String(error);
  } finally {
    button.disabled = false;
  }
};
window.addEventListener('pagehide', () => {
  removeMedia();
  compare.dispose();
  capture.dispose();
  stopTimeline();
  stopDOMAudio();
  domStage.destroy();
  field?.destroy();
});
setInterval(() => {
  if (field) {
    $('meter').textContent =
      `CPU encode ${field.session.scheduler.cpuFrameMs.toFixed(2)} ms · ${(field.memory().textureBytes / 1048576).toFixed(1)} MiB textures · step ${field.frame.index} · ${Math.round((field.surface?.resolutionScale ?? 1) * 100)}% resolution / ${Math.round((field.adaptiveQuality ? field.quality.state.stepScale : 1) * 100)}% work`;
    $('status').textContent =
      `${effect.id} · ${field.canvas.width} × ${field.canvas.height} · linear RGBA16 float`;
  }
}, 500);
// The test/measurement harness uses the same public runtime as the inspector.
Object.assign(window, {
  hologpu: {
    catalogue,
    domStage,
    createEffect,
    createHDRCanvas,
    bindCSSParameters,
    ParamStore,
    fragmentEffect,
    filterEffect,
    chain,
    get compareField() {
      return compare.field;
    },
    get field() {
      return field;
    },
    mount,
    runBenchmark,
  },
});
void mount(effect, true);
