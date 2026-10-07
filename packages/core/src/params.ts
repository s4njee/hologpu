export type ParamValue = number | boolean | string | readonly number[];
interface Metadata {
  group?: string;
  description?: string;
  unit?: string;
  uniform?: boolean;
  css?: boolean;
}
export type ParamSpec = Metadata &
  (
    | { type: 'f32' | 'i32' | 'u32'; default: number; min?: number; max?: number; step?: number }
    | { type: 'bool'; default: boolean }
    | {
        type: 'vec2' | 'vec3' | 'vec4';
        default: readonly number[];
        min?: number;
        max?: number;
        step?: number;
      }
    | { type: 'color'; default: string }
    | { type: 'enum'; default: string; options: readonly string[] }
  );
export type ParamSchema = Readonly<Record<string, ParamSpec>>;
export type ParamValues = Record<string, ParamValue>;
type ValueOf<T extends ParamSpec> = T extends { type: 'bool' }
  ? boolean
  : T extends { type: 'color' | 'enum' }
    ? string
    : T extends { type: 'vec2' | 'vec3' | 'vec4' }
      ? readonly number[]
      : number;
export type ValuesOf<S extends ParamSchema> = { -readonly [K in keyof S]: ValueOf<S[K]> };
export interface ParamField {
  name: string;
  type: string;
  offset: number;
  size: number;
  spec: ParamSpec;
}
const align = (n: number, a: number) => Math.ceil(n / a) * a;
const identifier = /^[a-zA-Z][a-zA-Z0-9_]*$/;
// WGSL 16.1/16.2 (2026-10-07): reject reserved names before generating a struct.
const reserved = new Set([
  'NULL',
  'Self',
  'abstract',
  'active',
  'alignas',
  'alignof',
  'as',
  'asm',
  'asm_fragment',
  'async',
  'attribute',
  'auto',
  'await',
  'become',
  'cast',
  'catch',
  'class',
  'co_await',
  'co_return',
  'co_yield',
  'coherent',
  'column_major',
  'common',
  'compile',
  'compile_fragment',
  'concept',
  'const_cast',
  'consteval',
  'constexpr',
  'constinit',
  'crate',
  'debugger',
  'decltype',
  'delete',
  'demote',
  'demote_to_helper',
  'do',
  'dynamic_cast',
  'enum',
  'explicit',
  'export',
  'extends',
  'extern',
  'external',
  'fallthrough',
  'filter',
  'final',
  'finally',
  'friend',
  'from',
  'fxgroup',
  'get',
  'goto',
  'groupshared',
  'highp',
  'impl',
  'implements',
  'import',
  'inline',
  'instanceof',
  'interface',
  'layout',
  'lowp',
  'macro',
  'macro_rules',
  'match',
  'mediump',
  'meta',
  'mod',
  'module',
  'move',
  'mut',
  'mutable',
  'namespace',
  'new',
  'nil',
  'noexcept',
  'noinline',
  'nointerpolation',
  'non_coherent',
  'noncoherent',
  'noperspective',
  'null',
  'nullptr',
  'of',
  'operator',
  'package',
  'packoffset',
  'partition',
  'pass',
  'patch',
  'pixelfragment',
  'precise',
  'precision',
  'premerge',
  'priv',
  'protected',
  'pub',
  'public',
  'readonly',
  'ref',
  'regardless',
  'register',
  'reinterpret_cast',
  'require',
  'resource',
  'restrict',
  'self',
  'set',
  'shared',
  'sizeof',
  'smooth',
  'snorm',
  'static',
  'static_assert',
  'static_cast',
  'std',
  'subroutine',
  'super',
  'target',
  'template',
  'this',
  'thread_local',
  'throw',
  'trait',
  'try',
  'type',
  'typedef',
  'typeid',
  'typename',
  'typeof',
  'union',
  'unless',
  'unorm',
  'unsafe',
  'unsized',
  'use',
  'using',
  'varying',
  'virtual',
  'volatile',
  'wgsl',
  'where',
  'with',
  'writeonly',
  'yield',
  'var',
  'let',
  'fn',
  'struct',
  'return',
  'if',
  'else',
  'for',
  'while',
  'loop',
  'true',
  'false',
  'override',
  'const',
  'alias',
  'enable',
  'requires',
  'diagnostic',
  'Params',
  'Frame',
  'set',
  'precision',
  'break',
  'case',
  'const_assert',
  'continue',
  'continuing',
  'default',
  'discard',
  'switch',
  'bitcast',
]);
export function paramLayout(schema: ParamSchema) {
  const fields: ParamField[] = [];
  let offset = 0;
  for (const [name, spec] of Object.entries(schema)) {
    if (!identifier.test(name) || reserved.has(name) || name.startsWith('__'))
      throw new Error(`Invalid WGSL parameter name: ${name}`);
    if (spec.uniform === false) continue;
    const components =
      spec.type === 'color' ? 4 : spec.type.startsWith('vec') ? Number(spec.type.slice(3)) : 1;
    const alignment = components === 1 ? 4 : components === 2 ? 8 : 16;
    const scalar =
      spec.type === 'bool' || spec.type === 'enum' || spec.type === 'u32'
        ? 'u32'
        : spec.type === 'i32'
          ? 'i32'
          : 'f32';
    const type = components === 1 ? scalar : `vec${components}<f32>`;
    offset = align(offset, alignment);
    fields.push({ name, spec, offset, size: components * 4, type });
    offset += components * 4;
  }
  return {
    fields,
    byteLength: Math.max(16, align(offset, 16)),
    wgsl: `struct Params {\n${fields.length ? fields.map((f) => `  ${f.name}: ${f.type},`).join('\n') : '  padding: vec4f,'}\n};`,
  };
}
export function normalizeParam(spec: ParamSpec, value: ParamValue): ParamValue {
  if (spec.type === 'color') {
    if (typeof value !== 'string') throw new TypeError('Color must be a CSS string');
    parseColor(value);
    return value;
  }
  if (spec.type === 'enum') {
    if (typeof value !== 'string' || !spec.options.includes(value))
      throw new RangeError(`Expected ${spec.options.join(', ')}`);
    return value;
  }
  if (spec.type === 'bool') {
    if (typeof value !== 'boolean') throw new TypeError('Boolean parameter expected');
    return value;
  }
  const number = (n: unknown) => {
    if (typeof n !== 'number' || !Number.isFinite(n)) throw new TypeError('Finite number expected');
    n = Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, n));
    if (spec.type === 'i32')
      return Math.max(-2147483648, Math.min(2147483647, Math.round(n as number)));
    if (spec.type === 'u32') return Math.max(0, Math.min(4294967295, Math.round(n as number)));
    if (Math.abs(n as number) > 3.4028234663852886e38)
      throw new RangeError('Parameter exceeds f32 range');
    return n as number;
  };
  if (spec.type.startsWith('vec')) {
    const length = Number(spec.type.slice(3));
    if (!Array.isArray(value) || value.length !== length)
      throw new TypeError(`Expected ${length} components`);
    return value.map(number);
  }
  return number(value);
}
export function srgbToLinear(n: number) {
  return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
}
/** CSS parsing delegates to Canvas2D for browser colors beyond the portable hex/rgb forms. */
export function parseColor(value: string): number[] {
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value);
  if (hex) {
    let digits = hex[1]!;
    if (digits.length <= 4) digits = [...digits].map((c) => c + c).join('');
    const rgba = [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16) / 255);
    return [
      ...rgba.map(srgbToLinear),
      digits.length === 8 ? parseInt(digits.slice(6), 16) / 255 : 1,
    ];
  }
  if (typeof document === 'undefined')
    throw new Error(`CSS color ${value} needs a browser; use hex outside the browser`);
  if (!CSS.supports('color', value)) throw new Error(`Invalid CSS color: ${value}`);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const bytes = context.getImageData(0, 0, 1, 1).data;
  return [
    srgbToLinear(bytes[0]! / 255),
    srgbToLinear(bytes[1]! / 255),
    srgbToLinear(bytes[2]! / 255),
    bytes[3]! / 255,
  ];
}
export class ParamStore<S extends ParamSchema = ParamSchema> {
  readonly schema: S;
  readonly layout: ReturnType<typeof paramLayout>;
  readonly values: ValuesOf<S>;
  readonly bytes: ArrayBuffer;
  #dirty = true;
  readonly #values: ParamValues = {};
  readonly #listeners = new Set<(name: string, value: ParamValue) => void>();
  constructor(schema: S, initial: ParamValues = {}) {
    this.schema = schema;
    this.layout = paramLayout(schema);
    this.bytes = new ArrayBuffer(this.layout.byteLength);
    for (const [name, spec] of Object.entries(schema))
      this.#values[name] = normalizeParam(spec, spec.default);
    for (const [name, value] of Object.entries(initial)) {
      const spec = schema[name];
      if (!spec) throw new Error(`Unknown parameter: ${name}`);
      this.#values[name] = normalizeParam(spec, value);
    }
    this.values = new Proxy(this.#values, {
      set: (_target, key, value) => {
        this.set(String(key), value as ParamValue);
        return true;
      },
      deleteProperty: () => {
        throw new Error('Parameters cannot be deleted');
      },
      defineProperty: () => {
        throw new Error('Use parameter assignment');
      },
      get: (target, key) => {
        const value = Reflect.get(target, key);
        return Array.isArray(value) ? Object.freeze([...value]) : value;
      },
    }) as ValuesOf<S>;
  }
  set(name: string, value: ParamValue) {
    const spec = this.schema[name];
    if (!spec) throw new Error(`Unknown parameter: ${name}`);
    const next = normalizeParam(spec, value);
    if (JSON.stringify(this.#values[name]) === JSON.stringify(next)) return;
    this.#values[name] = next;
    if (spec.uniform !== false) this.#dirty = true;
    for (const listener of this.#listeners) listener(name, next);
  }
  patch(values: ParamValues) {
    const entries = Object.entries(values).map(([name, value]) => {
      const spec = this.schema[name];
      if (!spec) throw new Error(`Unknown parameter: ${name}`);
      return [name, normalizeParam(spec, value)] as const;
    });
    for (const [name, value] of entries) this.set(name, value);
  }
  snapshot(): ParamValues {
    return JSON.parse(JSON.stringify(this.#values)) as ParamValues;
  }
  onChange(listener: (name: string, value: ParamValue) => void) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
  reset() {
    this.patch(
      Object.fromEntries(Object.entries(this.schema).map(([name, spec]) => [name, spec.default])),
    );
  }
  pack(): ArrayBuffer {
    if (!this.#dirty) return this.bytes;
    const data = new DataView(this.bytes);
    for (const field of this.layout.fields) {
      const value = this.#values[field.name]!;
      const values =
        field.spec.type === 'color'
          ? parseColor(value as string)
          : field.spec.type === 'enum'
            ? [field.spec.options.indexOf(value as string)]
            : typeof value === 'boolean'
              ? [Number(value)]
              : Array.isArray(value)
                ? value
                : [value as number];
      values.forEach((n, index) => {
        const offset = field.offset + index * 4;
        if (field.type === 'u32') data.setUint32(offset, n, true);
        else if (field.type === 'i32') data.setInt32(offset, n, true);
        else data.setFloat32(offset, n, true);
      });
    }
    return this.bytes;
  }
  flush(device: GPUDevice, buffer: GPUBuffer) {
    if (!this.#dirty) return false;
    device.queue.writeBuffer(buffer, 0, this.pack());
    this.#dirty = false;
    return true;
  }
}
