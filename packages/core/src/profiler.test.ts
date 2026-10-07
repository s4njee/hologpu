import { describe, it, expect, vi, afterEach } from 'vitest';
import { GPUProfiler } from './profiler.ts';
afterEach(() => vi.unstubAllGlobals());
function fake(supported = true) {
  vi.stubGlobal('GPUBufferUsage', { QUERY_RESOLVE: 1, COPY_SRC: 2, COPY_DST: 4, MAP_READ: 8 });
  vi.stubGlobal('GPUMapMode', { READ: 1 });
  const reads: (() => void)[] = [],
    buffers: { destroy: ReturnType<typeof vi.fn>; unmap: ReturnType<typeof vi.fn> }[] = [],
    queries: { destroy: ReturnType<typeof vi.fn> }[] = [];
  const device = {
    features: new Set(supported ? ['timestamp-query'] : []),
    createQuerySet: vi.fn(() => {
      const q = { destroy: vi.fn() };
      queries.push(q);
      return q;
    }),
    createBuffer: vi.fn(() => {
      const b = {
        destroy: vi.fn(),
        unmap: vi.fn(),
        mapAsync: vi.fn(() => new Promise<void>((resolve) => reads.push(resolve))),
        getMappedRange: () => new BigUint64Array([1000000n, 2000000n, 2000000n, 5000000n]).buffer,
      };
      buffers.push(b);
      return b;
    }),
  } as unknown as GPUDevice;
  const encoder = () =>
    ({ resolveQuerySet: vi.fn(), copyBufferToBuffer: vi.fn() }) as unknown as GPUCommandEncoder;
  return { device, encoder, reads, buffers, queries };
}
describe('asynchronous timestamp ownership', () => {
  it('leaves unsupported and disabled devices free of profiling allocations', () => {
    for (const supported of [true, false]) {
      const f = fake(supported),
        p = new GPUProfiler(f.device, 2);
      expect(p.timestampWrites(f.encoder(), 'idle')).toBeUndefined();
      if (!supported) {
        p.enabled = true;
        expect(p.timestampWrites(f.encoder(), 'unsupported')).toBeUndefined();
      }
      expect(f.buffers).toHaveLength(0);
      expect(p.bytes).toBe(0);
      p.dispose();
    }
  });
  it('keeps three submissions distinct until mapping completes and drops each excess frame once', async () => {
    const f = fake(),
      p = new GPUProfiler(f.device, 2);
    p.enabled = true;
    const encoders = [f.encoder(), f.encoder(), f.encoder()],
      sets = encoders.map((e) => p.timestampWrites(e, 'step')!.querySet);
    expect(new Set(sets).size).toBe(3);
    for (const e of encoders) p.resolve(e)!();
    const fourth = f.encoder();
    expect(p.timestampWrites(fourth, 'first')).toBeUndefined();
    expect(p.timestampWrites(fourth, 'second')).toBeUndefined();
    expect(p.droppedFrames).toBe(1);
    expect(p.bytes).toBe(192);
    f.reads.forEach((resolve) => resolve());
    await p.settle();
    const next = p.timestampWrites(f.encoder(), 'available');
    expect(next).toBeDefined();
    expect(f.queries).toHaveLength(3);
    p.dispose();
    expect(f.buffers.every((b) => b.destroy.mock.calls.length === 1)).toBe(true);
  });
  it('aggregates repeated pass labels in nanoseconds and marks capacity truncation', async () => {
    const f = fake(),
      p = new GPUProfiler(f.device, 2);
    p.enabled = true;
    const e = f.encoder();
    expect(p.timestampWrites(e, 'pressure')!.beginningOfPassWriteIndex).toBe(0);
    expect(p.timestampWrites(e, 'pressure')!.beginningOfPassWriteIndex).toBe(2);
    expect(p.timestampWrites(e, 'overflow')).toBeUndefined();
    p.resolve(e)!();
    f.reads[0]!();
    await p.settle();
    expect(p.latest).toMatchObject({
      totalMs: 4,
      passes: { pressure: { ms: 4, count: 2 } },
      truncated: true,
    });
    expect(f.buffers[1]!.unmap).toHaveBeenCalledOnce();
    p.dispose();
  });
  it('disposal suppresses a delayed capture and releases every timestamp allocation', async () => {
    const f = fake(),
      p = new GPUProfiler(f.device, 2);
    p.enabled = true;
    const listener = vi.fn();
    p.onFrame(listener);
    const e = f.encoder();
    p.timestampWrites(e, 'late');
    p.resolve(e)!();
    p.dispose();
    f.reads[0]!();
    await p.settle();
    expect(listener).not.toHaveBeenCalled();
    expect(p.latest).toBeNull();
    expect(p.bytes).toBe(0);
    expect(f.queries[0]!.destroy).toHaveBeenCalledOnce();
    expect(f.buffers.every((b) => b.destroy.mock.calls.length === 1)).toBe(true);
  });
});
