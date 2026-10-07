import { type EffectField, ShaderCompileError } from '@mk7s/hologpu';
export function sourceEditor(field: EffectField, panel: HTMLElement, changed: () => void) {
  const original = { ...field.sources },
    edits = new Set<string>();
  const toolbar = document.createElement('div');
  toolbar.className = 'editor-toolbar';
  const stages = document.createElement('select');
  stages.id = 'shader-stage';
  stages.setAttribute('aria-label', 'Shader stage');
  for (const name of Object.keys(original)) stages.add(new Option(name, name));
  const apply = document.createElement('button');
  apply.id = 'shader-apply';
  apply.textContent = 'Compile edit';
  const revert = document.createElement('button');
  revert.id = 'shader-revert';
  revert.textContent = 'Restore stage';
  const exportButton = document.createElement('button');
  exportButton.id = 'shader-export';
  exportButton.textContent = 'Export patch';
  toolbar.append(stages, apply, revert, exportButton);
  const editor = document.createElement('textarea');
  editor.id = 'shader-editor';
  editor.spellcheck = false;
  editor.wrap = 'off';
  editor.setAttribute('aria-label', 'WGSL shader source');
  const stack = document.createElement('div');
  stack.className = 'source-edit-stack';
  const highlighted = document.createElement('pre');
  highlighted.className = 'shader-highlights';
  highlighted.setAttribute('aria-hidden', 'true');
  stack.append(highlighted, editor);
  const highlight = () => {
    highlighted.replaceChildren();
    const text = editor.value,
      tokens =
        /\/\/[^\n]*|\/\*[\s\S]*?\*\/|@[A-Za-z_]+|\b(?:fn|let|var|const|struct|return|if|else|for|while|loop|break|continue|enable|override|true|false|f32|u32|i32|vec[234][fui])\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[uif]?\b/g;
    let offset = 0;
    for (const match of text.matchAll(tokens)) {
      highlighted.append(document.createTextNode(text.slice(offset, match.index)));
      const span = document.createElement('span');
      span.className = match[0].startsWith('/')
        ? 'wgsl-comment'
        : match[0].startsWith('@')
          ? 'wgsl-attribute'
          : /^\d/.test(match[0])
            ? 'wgsl-number'
            : 'wgsl-keyword';
      span.textContent = match[0];
      highlighted.append(span);
      offset = match.index! + match[0].length;
    }
    highlighted.append(document.createTextNode(text.slice(offset) + '\n'));
    highlighted.scrollTop = editor.scrollTop;
    highlighted.scrollLeft = editor.scrollLeft;
  };
  editor.addEventListener('input', highlight);
  editor.addEventListener('scroll', () => {
    highlighted.scrollTop = editor.scrollTop;
    highlighted.scrollLeft = editor.scrollLeft;
  });
  const status = document.createElement('p');
  status.id = 'shader-diagnostics';
  status.setAttribute('role', 'status');
  const instructions = document.createElement('p');
  instructions.className = 'muted';
  instructions.textContent =
    'Edits stay in this session. A successful compile resets simulation state; an error retains the running pipeline.';
  const source = document.getElementById('source')!;
  const update = () => {
    editor.value = field.sources[stages.value]?.code ?? '';
    highlight();
    source.textContent = Object.entries(field.sources)
      .map(([name, s]) => `// ${name}\n${s.code}`)
      .join('\n');
  };
  const compile = async (code: string) => {
    const name = stages.value;
    apply.disabled = revert.disabled = stages.disabled = true;
    status.textContent = 'Compiling…';
    try {
      await field.editSource(name, code);
      if (field.state !== 'ready' || !panel.contains(editor)) return;
      if (code === original[name]?.code) edits.delete(name);
      else edits.add(name);
      status.textContent = 'Compiled. Simulation reset with the same seed.';
      update();
      changed();
    } catch (error) {
      status.textContent =
        error instanceof ShaderCompileError
          ? error.diagnostics
              .map((d) => `${d.type} · ${d.chunk}:${d.line}:${d.column} · ${d.message}`)
              .join('\n')
          : String(error);
      status.dataset['state'] = 'error';
    } finally {
      apply.disabled = revert.disabled = stages.disabled = false;
    }
  };
  stages.onchange = update;
  apply.onclick = () => {
    delete status.dataset['state'];
    void compile(editor.value);
  };
  revert.onclick = () => {
    delete status.dataset['state'];
    void compile(original[stages.value]!.code);
  };
  exportButton.onclick = () => {
    const patch = {
      effect: field.effect.id,
      seed: field.frame.seed,
      params: field.store.snapshot(),
      overrides: Object.fromEntries([...edits].map((name) => [name, field.sources[name]!.code])),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(patch, null, 2) + '\n'], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `${field.effect.id}-shader-patch.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  panel.prepend(toolbar, instructions, stack, status);
  update();
}
