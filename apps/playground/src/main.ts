import {
  createEffect,
  ParamStore,
  fragmentEffect,
  type EffectField,
  type EffectDefinition,
  type ParamValue,
  type ParamSpec,
} from '@mk7s/hologpu';
import { catalogue } from '@mk7s/hologpu/effects';
import './style.css';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('canvas');
const query = new URLSearchParams(location.search);
let effect =
  catalogue.find((e) => e.id === query.get('effect')) ??
  catalogue.find((e) => e.id === 'gradient-oklch')!;
let field: EffectField | null = null,
  generation = 0;
const notes = import.meta.glob('../../../docs/notes/*.md', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>;
const controls = new Map<string, HTMLElement[]>();
let startingParams: Record<string, ParamValue> = {};
try {
  const parsed = JSON.parse(query.get('params') ?? '{}');
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) startingParams = parsed;
} catch {
  /* Invalid links use defaults. */
}
function save() {
  if (!field) return;
  const state = new URLSearchParams({
    effect: effect.id,
    mode: 'full',
    seed: String(field.frame.seed),
    params: JSON.stringify(field.store.snapshot()),
    playing: String(field.playing),
    resolution: String(field.surface?.resolutionScale ?? 1),
  });
  const preset = $<HTMLSelectElement>('presets').value;
  if (preset) state.set('preset', preset);
  if ($<HTMLInputElement>('motion').checked) state.set('motion', 'reduce');
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
      else
        (control as HTMLInputElement).value = Array.isArray(value)
          ? String(value[index])
          : String(value);
    });
  }
}
function renderNote(markdown: string, id: string): DocumentFragment {
  const references = import.meta.glob('../../../docs/benchmarks/m1-*.json', {
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
async function mount(next: EffectDefinition, initial = false) {
  const token = ++generation;
  field?.destroy();
  field = null;
  effect = next;
  $('title').textContent = next.title;
  $('source').textContent = 'Compiling…';
  $('status').dataset['state'] = 'loading';
  $('status').textContent = 'Compiling fragment pipeline…';
  $('fallback').hidden = true;
  canvas.hidden = false;
  $('stage').style.background = next.fallback;
  renderBrowser();
  void showNotes(next.id);
  try {
    const rawSeed = Number(initial ? (query.get('seed') ?? 7) : $<HTMLInputElement>('seed').value);
    const seed = Number.isFinite(rawSeed) ? rawSeed >>> 0 : 7;
    const rawScale = Number(
      initial ? (query.get('resolution') ?? 1) : $<HTMLSelectElement>('resolution').value,
    );
    const scale = [1, 0.75, 0.5, 0.25].includes(rawScale) ? rawScale : 1;
    if (initial) {
      try {
        new ParamStore(next.params, startingParams);
      } catch {
        startingParams = {};
      }
    }
    const mounted = await createEffect(canvas, next, {
      params: initial ? startingParams : undefined,
      preset: initial ? (query.get('preset') ?? undefined) : undefined,
      seed,
      playing: initial ? query.get('playing') !== 'false' : true,
      resolutionScale: scale,
      reducedMotion: $<HTMLInputElement>('motion').checked ? true : undefined,
    });
    if (token !== generation) {
      mounted.destroy();
      return;
    }
    field = mounted;
    inspector();
    if (initial && (query.get('preset') ?? '') in next.presets)
      $<HTMLSelectElement>('presets').value = query.get('preset')!;
    field.store.onChange(refreshControls);
    field.onChange(() => {
      if (field?.state === 'error') {
        $('status').textContent = 'Device recovery failed';
        $('status').dataset['state'] = 'error';
      }
    });
    $('source').textContent = Object.entries(field.sources)
      .map(([name, source]) => `// ${name}\n${source.code}`)
      .join('\n');
    $('capabilities').textContent = JSON.stringify(field.session.capabilities, null, 2);
    $('status').dataset['state'] = 'ready';
    $('status').textContent =
      `${next.id} · ${canvas.width} × ${canvas.height} · linear RGBA16 float`;
    $<HTMLInputElement>('seed').value = String(seed);
    $<HTMLSelectElement>('resolution').value = String(scale);
    refreshTransport();
    renderBrowser();
    save();
  } catch (error) {
    if (token !== generation) return;
    canvas.hidden = true;
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
  if (field?.playing) field.pause();
  else field?.play();
  refreshTransport();
  save();
};
$('step').onclick = () => {
  field?.step();
  refreshTransport();
  save();
};
$('reset').onclick = () => {
  field?.reset();
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
  field?.reset(Number($<HTMLInputElement>('seed').value));
  save();
};
$('resolution').onchange = () => {
  field?.setResolutionScale(Number($<HTMLSelectElement>('resolution').value));
  save();
};
$<HTMLInputElement>('motion').checked = query.get('motion') === 'reduce';
$('motion').onchange = () => {
  field?.setReducedMotion($<HTMLInputElement>('motion').checked ? true : undefined);
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
window.addEventListener('pagehide', () => field?.destroy());
setInterval(() => {
  if (field) {
    $('meter').textContent =
      `CPU encode ${field.session.scheduler.cpuFrameMs.toFixed(2)} ms · ${(field.memory().textureBytes / 1048576).toFixed(1)} MiB target`;
    $('status').textContent =
      `${effect.id} · ${canvas.width} × ${canvas.height} · linear RGBA16 float`;
  }
}, 500);
// The test/measurement harness uses the same public runtime as the inspector.
Object.assign(window, {
  hologpu: {
    catalogue,
    createEffect,
    ParamStore,
    fragmentEffect,
    get field() {
      return field;
    },
    mount,
  },
});
void mount(effect, true);
