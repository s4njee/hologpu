import { describe, it, expect, vi } from 'vitest';
import { ParamStore, paramLayout, parseColor } from './params.ts';
import { chunk, compose, sourceLocation } from './wgsl/composer.ts';
import { Resources, TexturePool } from './resources.ts';
import { Scheduler, type Clock, type ScheduledSurface } from './scheduler.ts';

describe('host-shared uniforms', () => {
  const schema = {
    scalar: { type: 'f32', default: 1, min: 0, max: 2 },
    vector: { type: 'vec3', default: [2, 3, 4] },
    tail: { type: 'u32', default: 9 },
    pair: { type: 'vec2', default: [5, 6] },
    flag: { type: 'bool', default: true },
    mode: { type: 'enum', default: 'b', options: ['a', 'b'] },
    color: { type: 'color', default: '#80808080' },
    cpu: { type: 'f32', default: 10, uniform: false },
  } as const;
  it('packs WGSL alignment, scalar after vec3, integer enums, and linear color', () => {
    const store = new ParamStore(schema);
    expect(store.layout.fields.map((f) => f.offset)).toEqual([0, 16, 28, 32, 40, 44, 48]);
    expect(store.layout.byteLength).toBe(64);
    const data = new DataView(store.pack());
    expect(data.getUint32(28, true)).toBe(9);
    expect(data.getFloat32(24, true)).toBe(4);
    expect(data.getUint32(40, true)).toBe(1);
    expect(data.getUint32(44, true)).toBe(1);
    expect(data.getFloat32(48, true)).toBeCloseTo(0.21586, 4);
    expect(data.getFloat32(60, true)).toBeCloseTo(128 / 255);
    expect(store.layout.wgsl).not.toContain('cpu');
  });
  it('clamps values, validates patches before writing, and flushes only dirty uniforms', () => {
    const store = new ParamStore(schema);
    const queue = { writeBuffer: vi.fn() };
    const device = { queue } as unknown as GPUDevice;
    store.flush(device, {} as GPUBuffer);
    store.values.scalar = 7;
    expect(store.values.scalar).toBe(2);
    store.flush(device, {} as GPUBuffer);
    expect(store.flush(device, {} as GPUBuffer)).toBe(false);
    store.values.cpu = 11;
    expect(store.flush(device, {} as GPUBuffer)).toBe(false);
    expect(() => store.patch({ scalar: 0, mode: 'bad' })).toThrow();
    expect(store.values.scalar).toBe(2);
    expect(() => store.set('vector', [1, 2])).toThrow();
    expect(() => store.set('scalar', NaN)).toThrow();
    expect(() => Reflect.deleteProperty(store.values, 'scalar')).toThrow();
    expect(() => Object.defineProperty(store.values, 'scalar', { value: 0 })).toThrow();
    expect(queue.writeBuffer).toHaveBeenCalledTimes(2);
  });
  it('uses an empty uniform padding and rejects shader identifiers before compilation', () => {
    expect(paramLayout({}).byteLength).toBe(16);
    expect(parseColor('#fff')).toEqual([1, 1, 1, 1]);
    expect(() => paramLayout({ precision: { type: 'f32', default: 0 } })).toThrow();
  });
});
describe('WGSL composition', () => {
  it('orders and deduplicates dependencies with accurate local source lines', () => {
    const a = chunk('a', 'fn a() {}');
    const b = chunk('b', 'fn b() {}\n// second', [a]);
    const source = compose(b, a);
    expect(source.regions.map((r) => r.id)).toEqual(['a', 'b']);
    expect(sourceLocation(source, source.regions[1]!.startLine + 1)).toEqual({
      chunk: 'b',
      line: 2,
    });
  });
  it('rejects conflicting descendants behind equal parents and dependency cycles', () => {
    const a = chunk('a', 'one'),
      different = chunk('a', 'two');
    expect(() => compose(chunk('b', 'same', [a]), chunk('b', 'same', [different]))).toThrow(
      'Conflicting',
    );
    const cyclic = {
      id: 'cycle',
      code: '',
      dependencies: [] as import('./wgsl/composer.ts').WGSLChunk[],
    };
    cyclic.dependencies.push(cyclic);
    expect(() => compose(cyclic)).toThrow('cycle');
  });
});
describe('resource lifetimes', () => {
  it('shares leased resources and destroys once after the last release', () => {
    const cache = new Resources(),
      create = vi.fn(() => ({})),
      dispose = vi.fn();
    const a = cache.acquire('a', create, dispose, 8),
      b = cache.acquire('a', create, dispose, 8);
    expect(a.value).toBe(b.value);
    a.release();
    a.release();
    expect(dispose).not.toHaveBeenCalled();
    b.release();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(cache.stats()).toEqual({ entries: 0, references: 0, bytes: 0 });
  });
  it('deduplicates concurrent pipelines and retries after failure', async () => {
    const cache = new Resources();
    const create = vi.fn(async () => {
      throw new Error('compile');
    });
    await Promise.allSettled([cache.acquireAsync('p', create), cache.acquireAsync('p', create)]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(cache.stats().entries).toBe(0);
    const lease = await cache.acquireAsync('p', async () => 42);
    expect(lease.value).toBe(42);
    cache.dispose();
    lease.release();
    expect(() => cache.acquire('x', () => 1)).toThrow('closed');
  });
  it('bounds idle textures and destroys outstanding leases on session disposal', () => {
    const textures: { destroy: ReturnType<typeof vi.fn> }[] = [];
    const device = {
      createTexture: () => {
        const texture = { destroy: vi.fn() };
        textures.push(texture);
        return texture;
      },
    } as unknown as GPUDevice;
    const pool = new TexturePool(device);
    const descriptor = { size: [8, 8], format: 'rgba16float', usage: 16 } as GPUTextureDescriptor;
    const a = pool.acquire(descriptor),
      b = pool.acquire(descriptor),
      c = pool.acquire(descriptor);
    a.release();
    b.release();
    c.release();
    expect(textures[2]!.destroy).toHaveBeenCalledTimes(1);
    const live = pool.acquire(descriptor);
    pool.dispose();
    live.release();
    expect(textures.every((t) => t.destroy.mock.calls.length === 1)).toBe(true);
    expect(() => pool.acquire(descriptor)).toThrow('closed');
  });
});
it('schedules one RAF for multiple surfaces, bounded fixed steps, visibility, and dirty frames', () => {
  let callback: ((time: number) => void) | undefined;
  const clock: Clock = {
    request: vi.fn((cb) => {
      callback = cb;
      return 1;
    }),
    cancel: vi.fn(),
    now: () => 0,
  };
  const submit = vi.fn();
  const scheduler = new Scheduler(submit, clock);
  const surface = (): ScheduledSurface => ({
    visible: true,
    playing: true,
    dirty: true,
    update: vi.fn(),
    render: vi.fn(),
  });
  const a = surface(),
    b = surface();
  const removeA = scheduler.add(a),
    removeB = scheduler.add(b);
  expect(clock.request).toHaveBeenCalledTimes(1);
  callback!(0);
  callback!(1000);
  expect(a.update).toHaveBeenCalledTimes(6);
  expect(b.update).toHaveBeenCalledTimes(6);
  b.visible = false;
  callback!(1017);
  expect(b.render).toHaveBeenCalledTimes(2);
  scheduler.setHidden(true);
  scheduler.setHidden(false);
  callback!(5000);
  expect(a.update).toHaveBeenCalledTimes(7);
  a.playing = false;
  a.dirty = true;
  callback!(5010);
  expect(submit).toHaveBeenCalledTimes(5);
  removeA();
  removeB();
  expect(scheduler.surfaceCount).toBe(0);
});
