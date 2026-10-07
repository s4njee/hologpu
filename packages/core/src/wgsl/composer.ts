export interface WGSLChunk {
  id: string;
  code: string;
  dependencies: readonly WGSLChunk[];
}
export interface SourceRegion {
  id: string;
  startLine: number;
  endLine: number;
}
export interface ComposedWGSL {
  code: string;
  regions: SourceRegion[];
}
export function chunk(
  id: string,
  code: string,
  dependencies: readonly WGSLChunk[] = [],
): WGSLChunk {
  return Object.freeze({ id, code: code.trim(), dependencies });
}
export function compose(...chunks: readonly WGSLChunk[]): ComposedWGSL {
  const ordered: WGSLChunk[] = [];
  const seen = new Map<string, WGSLChunk>();
  const active = new Set<string>();
  function visit(next: WGSLChunk) {
    if (active.has(next.id)) throw new Error(`WGSL chunk dependency cycle: ${next.id}`);
    const previous = seen.get(next.id);
    if (previous) {
      if (
        previous.code !== next.code ||
        previous.dependencies.map((d) => d.id).join() !== next.dependencies.map((d) => d.id).join()
      )
        throw new Error(`Conflicting WGSL chunk: ${next.id}`);
      active.add(next.id);
      for (const dependency of next.dependencies) visit(dependency);
      active.delete(next.id);
      return;
    }
    active.add(next.id);
    for (const dependency of next.dependencies) visit(dependency);
    active.delete(next.id);
    seen.set(next.id, next);
    ordered.push(next);
  }
  for (const next of chunks) visit(next);
  let line = 1;
  const regions: SourceRegion[] = [];
  const code = ordered
    .map((next) => {
      const startLine = line + 1;
      const text = `// --- ${next.id} ---\n${next.code}\n`;
      line += text.split('\n').length - 1;
      regions.push({ id: next.id, startLine, endLine: line - 1 });
      return text;
    })
    .join('');
  return { code, regions };
}
/** Template composition retains dependency identity so shared chunks emit once. */
export function wgsl(
  strings: TemplateStringsArray,
  ...values: (WGSLChunk | string | number)[]
): WGSLChunk {
  let code = strings[0]!;
  const dependencies: WGSLChunk[] = [];
  values.forEach((value, index) => {
    if (typeof value === 'object') dependencies.push(value);
    else code += value;
    code += strings[index + 1]!;
  });
  return chunk(`inline:${code}`, code, dependencies);
}
export function sourceLocation(source: ComposedWGSL, line: number) {
  const region = source.regions.find((r) => line >= r.startLine && line <= r.endLine);
  return region
    ? { chunk: region.id, line: line - region.startLine + 1 }
    : { chunk: 'unknown', line };
}
