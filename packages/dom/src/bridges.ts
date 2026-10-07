import type {
  EffectField,
  ParamSchema,
  ParamSpec,
  ParamValue,
  ParamValues,
} from '@mk7s/hologpu-core';

/** CSS polling is deliberately bounded: one computed-style object, at most eight uniforms. */
export const MAX_CSS_PARAMETERS = 8;
export interface CSSBridgeOptions {
  /** Defaults to --hgpu-. Use an effect-specific prefix when property definitions conflict. */
  prefix?: string;
  names?: readonly string[];
  maxParameters?: number;
}
export interface CSSBridgeStats {
  reads: number;
  applied: number;
  /** Includes style resolution, property lookup and parsing; excludes uniform mutation. */
  styleMs: readonly number[];
  applyMs: readonly number[];
  errors: readonly string[];
}
export interface CSSParameterBridge {
  readonly properties: readonly string[];
  readonly stats: CSSBridgeStats;
  resetStats(): void;
  dispose(): void;
}
const registrations = new Map<string, { syntax: string; initialValue: string }>();
const bindings = new WeakMap<EffectField, CSSParameterBridge>();
const pollingOwners = new WeakMap<EffectField, { count: number; original: boolean }>();
function acquirePolling(field: EffectField) {
  const owner = pollingOwners.get(field) ?? { count: 0, original: field.polling };
  owner.count++;
  pollingOwners.set(field, owner);
  field.setFramePolling(true);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    if (--owner.count === 0) {
      pollingOwners.delete(field);
      if (field.state !== 'disposed') field.setFramePolling(owner.original);
    }
  };
}
function descriptor(spec: ParamSpec) {
  switch (spec.type) {
    case 'f32':
      return { syntax: '<number> | none', initialValue: 'none' };
    case 'i32':
    case 'u32':
      return { syntax: '<integer> | none', initialValue: 'none' };
    case 'bool':
      return { syntax: '<number> | none', initialValue: 'none' };
    case 'color':
      return { syntax: '<color> | none', initialValue: 'none' };
    default:
      throw new TypeError(`CSS uniform binding does not support ${spec.type}`);
  }
}
function parse(spec: ParamSpec, raw: string): ParamValue | undefined {
  const text = raw.trim();
  if (!text || text === 'none') return undefined;
  if (spec.type === 'color') return text;
  const value = Number(text);
  if (!Number.isFinite(value)) throw new TypeError(`Non-finite CSS ${spec.type}: ${text}`);
  return spec.type === 'bool' ? value >= 0.5 : value;
}
/**
 * Opted-in scalar/color schema values are typed, non-inheriting CSS properties.
 * The initial keyword none preserves JS/preset values until author CSS supplies a value.
 * Polling shares the device scheduler and continues while paused without advancing simulation.
 */
export function bindCSSParameters<S extends ParamSchema>(
  host: HTMLElement,
  field: EffectField<S>,
  options: CSSBridgeOptions = {},
): CSSParameterBridge {
  if (bindings.has(field as unknown as EffectField))
    throw new Error('Field already has a CSS parameter bridge');
  const prefix = options.prefix ?? '--hgpu-';
  if (!/^--[a-zA-Z][a-zA-Z0-9_-]*$/.test(prefix))
    throw new TypeError('Invalid CSS property prefix');
  const limit = options.maxParameters ?? MAX_CSS_PARAMETERS;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CSS_PARAMETERS)
    throw new RangeError(`CSS binding limit must be in [1, ${MAX_CSS_PARAMETERS}]`);
  const selected =
    options.names ??
    Object.entries(field.effect.params)
      .filter(([, spec]) => spec.css === true)
      .map(([name]) => name);
  if (selected.length > limit) throw new RangeError(`At most ${limit} CSS uniforms may be bound`);
  if (new Set(selected).size !== selected.length) throw new TypeError('Duplicate CSS uniform name');
  const entries = selected.map((name) => {
    const spec = field.effect.params[name];
    if (!spec || !spec.css) throw new TypeError(`Parameter ${name} is not opted into CSS binding`);
    if (spec.uniform === false)
      throw new TypeError(`CSS binding cannot drive allocation control ${name}`);
    return { name, property: `${prefix}${name}`, spec, ...descriptor(spec) };
  });
  // Validate the complete registration set before changing global CSS registration state.
  for (const entry of entries) {
    const prior = registrations.get(entry.property);
    if (prior && (prior.syntax !== entry.syntax || prior.initialValue !== entry.initialValue))
      throw new TypeError(`Conflicting CSS property ${entry.property}; use a unique prefix`);
  }
  const view = host.ownerDocument.defaultView;
  if (!view) throw new Error('CSS bridge requires a document window');
  const css = view.CSS;
  for (const entry of entries) {
    if (registrations.has(entry.property) || !css?.registerProperty) continue;
    try {
      css.registerProperty({
        name: entry.property,
        syntax: entry.syntax,
        inherits: false,
        initialValue: entry.initialValue,
      });
      registrations.set(entry.property, { syntax: entry.syntax, initialValue: entry.initialValue });
    } catch (error) {
      // Authors can declare the same property with @property. Its browser declaration wins.
      if (!(error instanceof DOMException) || error.name !== 'InvalidModificationError')
        throw error;
    }
  }
  let disposed = false,
    reads = 0,
    applied = 0;
  const styleMs: number[] = [],
    applyMs: number[] = [],
    errors: string[] = [];
  const releasePolling = entries.length
    ? acquirePolling(field as unknown as EffectField)
    : () => {};
  const poll = () => {
    if (disposed || !field.visible || field.state !== 'ready' || host.ownerDocument.hidden) return;
    const start = performance.now();
    const style = view.getComputedStyle(host);
    const values: [string, ParamValue][] = [];
    reads++;
    for (const { name, property, spec } of entries) {
      try {
        const value = parse(spec, style.getPropertyValue(property));
        if (value !== undefined) values.push([name, value]);
      } catch (error) {
        recordError(error);
      }
    }
    const encoded = performance.now();
    for (const [name, value] of values) {
      try {
        const before = field.params[name];
        field.store.set(name, value);
        if (before !== field.params[name]) applied++;
      } catch (error) {
        recordError(error);
      }
    }
    styleMs.push(encoded - start);
    applyMs.push(performance.now() - encoded);
    if (styleMs.length > 512) {
      styleMs.shift();
      applyMs.shift();
    }
  };
  function recordError(error: unknown) {
    const message = String(error);
    if (errors.length < 16 && !errors.includes(message)) errors.push(message);
  }
  const remove = entries.length ? field.onBeforeFrame(poll) : () => {};
  const bridge: CSSParameterBridge = {
    properties: Object.freeze(entries.map((e) => e.property)),
    get stats() {
      return { reads, applied, styleMs: [...styleMs], applyMs: [...applyMs], errors: [...errors] };
    },
    resetStats() {
      reads = applied = 0;
      styleMs.length = applyMs.length = errors.length = 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      remove();
      bindings.delete(field as unknown as EffectField);
      releasePolling();
    },
  };
  bindings.set(field as unknown as EffectField, bridge);
  return bridge;
}

export interface UniformDriverStats {
  readonly calls: number;
  readonly applied: number;
  readonly errors: readonly string[];
}
export interface UniformDriver {
  readonly stats: UniformDriverStats;
  resetStats(): void;
  dispose(): void;
}
/** Driver failures are visible and bounded; one author clock cannot stop other fields. */
function driver<S extends ParamSchema>(
  field: EffectField<S>,
  kind: 'properties' | 'timeline',
  apply: () => boolean,
): UniformDriver {
  const releasePolling = acquirePolling(field as unknown as EffectField);
  let disposed = false,
    calls = 0,
    applied = 0;
  const errors: string[] = [];
  const remove = field.onBeforeFrame(() => {
    if (disposed) return;
    calls++;
    try {
      if (apply()) applied++;
    } catch (problem) {
      const error = problem instanceof Error ? problem : new Error(String(problem));
      const message = String(error);
      if (errors.length < 16 && !errors.includes(message)) {
        errors.push(message);
        field.canvas.dispatchEvent(
          new CustomEvent('hgpu-error', {
            bubbles: true,
            composed: true,
            detail: { field, driver: kind, error },
          }),
        );
      }
    }
  });
  return {
    get stats() {
      return { calls, applied, errors: [...errors] };
    },
    resetStats() {
      calls = applied = 0;
      errors.length = 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      remove();
      releasePolling();
    },
  };
}
/** A JS/tween source can instead assign field.params directly; this helper samples a store. */
export function bindProperties<S extends ParamSchema>(
  field: EffectField<S>,
  source: () => ParamValues,
): UniformDriver {
  return driver(field, 'properties', () => {
    let changed = false;
    const remove = field.store.onChange(() => (changed = true));
    try {
      field.store.patch(source());
      return changed;
    } finally {
      remove();
    }
  });
}
/** External normalized clocks are sampled without advancing fixed-step simulation history. */
export function bindTimeline<S extends ParamSchema>(
  field: EffectField<S>,
  clock: () => number,
): UniformDriver {
  return driver(field, 'timeline', () => {
    const before = [
      field.frame.time,
      field.frame.delta,
      field.frame.index,
      field.playing,
      field.requestedPlaying,
    ];
    field.timeline(clock());
    const after = [
      field.frame.time,
      field.frame.delta,
      field.frame.index,
      field.playing,
      field.requestedPlaying,
    ];
    return before.some((value, i) => value !== after[i]);
  });
}
