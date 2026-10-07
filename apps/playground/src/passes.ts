import type { EffectField } from '@mk7s/hologpu';
/** Inspection is explicit so reading an intermediate texture cannot perturb normal frame cadence. */
export function passesDrawer(field: EffectField, node: HTMLElement) {
  node.replaceChildren();
  const list = document.createElement('ol');
  for (const name of Object.keys(field.sources)) {
    const item = document.createElement('li');
    item.textContent = name;
    list.append(item);
  }
  node.append(list);
  const resources = document.createElement('p');
  resources.className = 'muted';
  const summary = () => {
    const textures = Object.entries(field.textureTaps).map(
      ([name, t]) => `${name}: ${t.width}×${t.height} ${t.format}`,
    );
    const buffers = Object.entries(field.bufferTaps).map(
      ([name, b]) =>
        `${name}: ${b.count ?? '?'} items, ${b.stride ?? '?'} bytes/item (${b.buffer.size} bytes)`,
    );
    resources.textContent =
      [...textures, ...buffers].join(' · ') ||
      'This effect has no intermediate textures or buffers.';
  };
  summary();
  node.append(resources);
  const names = Object.keys(field.textureTaps);
  if (!names.length) return;
  const toolbar = document.createElement('div');
  toolbar.className = 'tap-controls';
  const label = (name: string, control: HTMLElement) => {
    const l = document.createElement('label');
    l.append(name, control);
    toolbar.append(l);
  };
  const select = document.createElement('select');
  select.id = 'tap-select';
  for (const name of names) select.add(new Option(name, name));
  label('Texture', select);
  const channel = document.createElement('select');
  channel.id = 'tap-channel';
  for (const [i, c] of ['R', 'G', 'B', 'A'].entries()) channel.add(new Option(c, String(i)));
  label('Channel', channel);
  const auto = document.createElement('input');
  auto.type = 'checkbox';
  auto.checked = true;
  auto.id = 'tap-auto';
  label('Auto range', auto);
  const low = document.createElement('input');
  low.type = 'number';
  low.step = 'any';
  low.value = '0';
  low.id = 'tap-min';
  label('Min', low);
  const high = document.createElement('input');
  high.type = 'number';
  high.step = 'any';
  high.value = '1';
  high.id = 'tap-max';
  label('Max', high);
  const colour = document.createElement('input');
  colour.type = 'checkbox';
  colour.checked = true;
  colour.id = 'tap-colour';
  label('False colour', colour);
  const button = document.createElement('button');
  button.id = 'tap-refresh';
  button.textContent = 'Capture texture';
  toolbar.append(button);
  node.append(toolbar);
  const output = document.createElement('p');
  output.id = 'tap-status';
  output.setAttribute('role', 'status');
  const canvas = document.createElement('canvas');
  canvas.id = 'tap-preview';
  canvas.setAttribute('aria-label', 'Intermediate texture snapshot');
  canvas.hidden = true;
  node.append(output, canvas);
  let request = 0;
  const capture = async () => {
    const token = ++request;
    button.disabled = true;
    output.textContent = 'Reading texture…';
    try {
      summary();
      const read = await field.readTap(select.value);
      if (token !== request || field.state === 'disposed' || !node.contains(canvas)) return;
      const component = Math.min(read.channels - 1, Number(channel.value));
      let min = Infinity,
        max = -Infinity,
        invalid = 0;
      for (let i = component; i < read.values.length; i += read.channels) {
        const v = read.values[i]!;
        if (Number.isFinite(v)) {
          min = Math.min(min, v);
          max = Math.max(max, v);
        } else invalid++;
      }
      if (!Number.isFinite(min)) {
        min = 0;
        max = 1;
      }
      if (auto.checked) {
        low.value = String(min);
        high.value = String(max);
      }
      const lo = Number(low.value),
        hi = Number(high.value);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo)
        throw new Error('Choose a finite range with Max ≥ Min.');
      const scale = Math.min(1, 256 / read.width, 256 / read.height);
      canvas.width = Math.max(1, Math.round(read.width * scale));
      canvas.height = Math.max(1, Math.round(read.height * scale));
      const image = new ImageData(canvas.width, canvas.height);
      for (let y = 0; y < canvas.height; y++)
        for (let x = 0; x < canvas.width; x++) {
          const px = Math.min(read.width - 1, Math.floor(x / scale)),
            py = Math.min(read.height - 1, Math.floor(y / scale));
          const value = read.values[(py * read.width + px) * read.channels + component]!;
          const v = Math.max(0, Math.min(1, (value - lo) / Math.max(hi - lo, 1e-12))),
            offset = (y * canvas.width + x) * 4;
          const rgb = !Number.isFinite(value)
            ? [255, 0, 255]
            : colour.checked
              ? [255 * v, 255 * (1 - Math.abs(2 * v - 1)), 255 * (1 - v)]
              : [255 * v, 255 * v, 255 * v];
          image.data.set([...rgb, 255], offset);
        }
      canvas.getContext('2d')!.putImageData(image, 0, 0);
      canvas.hidden = false;
      output.textContent = `${select.value} · ${read.width}×${read.height} · channel ${component} · range ${min.toPrecision(4)}…${max.toPrecision(4)} · ${invalid} non-finite values · snapshot at step ${field.frame.index}`;
    } catch (error) {
      if (token === request && node.contains(canvas)) output.textContent = String(error);
    } finally {
      if (token === request) button.disabled = false;
    }
  };
  button.onclick = () => void capture();
  for (const input of [select, channel, auto, low, high, colour])
    input.addEventListener('change', () => void capture());
}
