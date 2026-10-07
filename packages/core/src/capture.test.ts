import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ compile: vi.fn() }));
vi.mock('./passes.ts', async (actual) => ({
  ...(await actual<typeof import('./passes.ts')>()),
  createFullscreenPass: mocks.compile,
}));
import { EffectField } from './runtime.ts';
import { fragmentEffect } from './effect.ts';
import type { Surface } from './surface.ts';
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 16, COPY_SRC: 1 });
  vi.stubGlobal('GPUBufferUsage', { MAP_READ: 1, COPY_DST: 8 });
  vi.stubGlobal('GPUMapMode', { READ: 1 });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fixture() {
  const compilation = deferred(),
    mapping = deferred(),
    pass = { pipeline: { getBindGroupLayout: () => ({}) }, draw: vi.fn(), dispose: vi.fn() };
  mocks.compile.mockImplementation(async () => {
    await compilation.promise;
    return pass;
  });
  const texture = { createView: () => ({}), destroy: vi.fn() };
  let size = 0;
  const buffer = {
    mapAsync: vi.fn(() => mapping.promise),
    getMappedRange: () => new ArrayBuffer(size),
    destroy: vi.fn(),
  };
  const device = {
    createTexture: vi.fn(() => texture),
    createBuffer: vi.fn((descriptor: GPUBufferDescriptor) => {
      size = descriptor.size;
      return buffer;
    }),
    createBindGroup: vi.fn(),
    createCommandEncoder: () => ({ copyTextureToBuffer: vi.fn() }),
  };
  const session = {
    state: 'ready',
    generation: 0,
    device,
    submit: vi.fn(),
    submitEncoder: vi.fn(),
    scheduler: { invalidate() {} },
  };
  const effect = fragmentEffect({
    id: 'capture-unit',
    title: 'capture',
    params: {},
    wgsl: 'fn effect(uv:vec2f)->vec4f{return vec4f(1);}',
  });
  const field = Reflect.construct(EffectField, [
    {},
    effect,
    session,
    () => {},
    { playing: false },
  ]) as EffectField;
  field.state = 'ready';
  const first = { createView: vi.fn(() => ({ old: true })) },
    next = { createView: vi.fn(() => ({ current: true })) };
  field.surface = { target: first, size: [8, 6] } as unknown as Surface;
  const render = vi.spyOn(field, 'render').mockImplementation(() => {
    field.dirty = false;
  });
  return {
    field,
    session,
    device,
    compilation,
    mapping,
    pass,
    buffer,
    texture,
    first,
    next,
    render,
  };
}
it('selects and paints a resized target after compilation, then returns its submitted snapshot despite another resize', async () => {
  const f = fixture(),
    capture = f.field.readPixels();
  f.field.surface = { target: f.next, size: [4, 3] } as unknown as Surface;
  f.compilation.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(f.render).toHaveBeenCalledTimes(1);
  expect(f.first.createView).not.toHaveBeenCalled();
  expect(f.next.createView).toHaveBeenCalledTimes(1);
  expect(f.device.createTexture).toHaveBeenCalledWith(expect.objectContaining({ size: [4, 3] }));
  f.field.surface = { target: f.first, size: [2, 1] } as unknown as Surface;
  f.mapping.resolve();
  const result = await capture;
  expect(result).toMatchObject({ width: 4, height: 3 });
  expect(result.pixels.length).toBe(48);
  expect(f.buffer.destroy).toHaveBeenCalledTimes(1);
  expect(f.texture.destroy).toHaveBeenCalledTimes(1);
  expect(f.pass.dispose).toHaveBeenCalledTimes(1);
});
it('releases the compiled capture pass when painting the current pose fails', async () => {
  const f = fixture();
  f.render.mockImplementation(() => {
    throw new Error('paint failed');
  });
  const capture = f.field.readPixels(),
    rejected = expect(capture).rejects.toThrow('paint failed');
  f.compilation.resolve();
  await rejected;
  expect(f.pass.dispose).toHaveBeenCalledTimes(1);
  expect(f.device.createTexture).not.toHaveBeenCalled();
});
for (const phase of ['compilation', 'mapping'] as const)
  for (const action of ['generation', 'disposal'] as const)
    it(`rejects ${action} during ${phase} and releases capture resources`, async () => {
      const f = fixture(),
        capture = f.field.readPixels(),
        rejected = expect(capture).rejects.toThrow('Field is not ready');
      if (phase === 'mapping') {
        f.compilation.resolve();
        await Promise.resolve();
        await Promise.resolve();
      }
      if (action === 'generation') f.session.generation++;
      else f.field.state = 'disposed';
      f.compilation.resolve();
      f.mapping.resolve();
      await rejected;
      expect(f.pass.dispose).toHaveBeenCalledTimes(1);
      if (phase === 'mapping') {
        expect(f.buffer.destroy).toHaveBeenCalledTimes(1);
        expect(f.texture.destroy).toHaveBeenCalledTimes(1);
      }
    });
