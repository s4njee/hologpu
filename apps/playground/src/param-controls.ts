import { type ParamStore, type ParamValue, isTextureParam } from '@mk7s/hologpu';

/** The same schema drives each independent Compare parameter set. */
export function schemaControls(
  store: ParamStore,
  panel: HTMLElement,
  prefix = 'compare',
  changed = () => {},
) {
  panel.replaceChildren();
  const refreshers: (() => void)[] = [];
  const groups = new Map<string, HTMLFieldSetElement>();
  for (const [name, spec] of Object.entries(store.schema)) {
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
    label.textContent = name.replace(/([A-Z])/g, ' $1');
    label.htmlFor = `${prefix}-${name}`;
    row.append(label);
    const edit = (value: ParamValue) => {
      try {
        store.set(name, value);
        changed();
        status.textContent = spec.description ?? '';
      } catch (error) {
        status.textContent = String(error);
      }
    };
    const status = document.createElement('small');
    status.textContent = spec.description ?? '';
    if (spec.type === 'curve' || spec.type === 'gradient') {
      const input = document.createElement('textarea');
      input.id = `${prefix}-${name}`;
      input.rows = 3;
      input.setAttribute('aria-label', name);
      input.onchange = () => {
        try {
          edit(JSON.parse(input.value) as ParamValue);
        } catch (error) {
          status.textContent = String(error);
        }
      };
      refreshers.push(() => (input.value = JSON.stringify(store.values[name])));
      row.append(input);
    } else if (spec.type === 'enum') {
      const input = document.createElement('select');
      input.id = `${prefix}-${name}`;
      spec.options.forEach((value) => input.add(new Option(value, value)));
      input.onchange = () => edit(input.value);
      refreshers.push(() => (input.value = String(store.values[name])));
      row.append(input);
    } else if (spec.type.startsWith('vec')) {
      const vector = document.createElement('div');
      vector.className = 'vector';
      for (let i = 0; i < Number(spec.type.slice(-1)); i++) {
        const input = document.createElement('input');
        input.id = `${prefix}-${name}-${i}`;
        input.type = 'number';
        input.setAttribute('aria-label', `${name} ${'xyzw'[i]}`);
        input.step = 'step' in spec ? String(spec.step ?? 'any') : 'any';
        if ('min' in spec && spec.min !== undefined) input.min = String(spec.min);
        if ('max' in spec && spec.max !== undefined) input.max = String(spec.max);
        input.oninput = () =>
          edit(
            (store.values[name] as readonly number[]).map((n, j) =>
              j === i ? Number(input.value) : n,
            ),
          );
        refreshers.push(() => (input.value = String((store.values[name] as readonly number[])[i])));
        vector.append(input);
      }
      row.append(vector);
    } else {
      const input = document.createElement('input');
      input.id = `${prefix}-${name}`;
      input.type =
        spec.type === 'bool'
          ? 'checkbox'
          : spec.type === 'color'
            ? 'color'
            : isTextureParam(spec)
              ? 'text'
              : 'number';
      input.step = 'step' in spec ? String(spec.step ?? 'any') : 'any';
      if ('min' in spec && spec.min !== undefined) input.min = String(spec.min);
      if ('max' in spec && spec.max !== undefined) input.max = String(spec.max);
      input.oninput = () =>
        edit(
          spec.type === 'bool'
            ? input.checked
            : spec.type === 'color' || spec.type === 'texture'
              ? input.value
              : Number(input.value),
        );
      refreshers.push(() => {
        if (input.type === 'checkbox') input.checked = Boolean(store.values[name]);
        else input.value = String(store.values[name]);
      });
      row.append(input);
    }
    row.append(status);
    box.append(row);
  }
  const refresh = () => refreshers.forEach((fn) => fn());
  refresh();
  const remove = store.onChange(refresh);
  return remove;
}
