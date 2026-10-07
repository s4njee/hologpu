import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceSession } from './device.ts';
import { Surface } from './surface.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture() {
  const compilation = deferred();
  let modules = 0;
  const texture = { destroy: vi.fn(), createView: () => ({}) };
  const device = {
    features: new Set(),
    limits: { maxTextureDimension2D: 8192 },
    lost: new Promise(() => {}),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    destroy: vi.fn(),
    pushErrorScope: vi.fn(),
    popErrorScope: async () => null,
    createShaderModule: () => {
      const index = ++modules;
      return {
        getCompilationInfo: async () => {
          if (index > 1) await compilation.promise;
          return { messages: [] };
        },
      };
    },
    createRenderPipelineAsync: async () => ({ getBindGroupLayout: () => ({}) }),
    createTexture: vi.fn(() => texture),
    createBindGroup: () => ({}),
  };
  const adapter = { features: new Set(), info: {}, requestDevice: async () => device };
  const gpu = {
    requestAdapter: async () => adapter,
    getPreferredCanvasFormat: () => 'bgra8unorm',
  } as unknown as GPU;
  const session = new DeviceSession(gpu, []);
  session.retain();
  await session.ready;
  const context = { configure: vi.fn(), unconfigure: vi.fn() };
  const canvas = {
    width: 8,
    height: 8,
    getContext: () => context,
    getBoundingClientRect: () => ({ width: 8, height: 8 }),
  } as unknown as HTMLCanvasElement;
  const surface = await Surface.create(canvas, session, () => {});
  return { compilation, session, surface, context, texture, device };
}

beforeEach(() => {
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 16, TEXTURE_BINDING: 4 });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('asynchronous surface restoration', () => {
  it('ignores resize while the replacement resolve pass is still compiling', async () => {
    const { surface, session, compilation, device } = await fixture();
    try {
      const restoration = surface.restore();
      surface.destroyTarget();
      surface.resize();
      expect(device.createTexture).toHaveBeenCalledTimes(1);
      compilation.resolve();
      await restoration;
      expect(device.createTexture).toHaveBeenCalledTimes(2);
    } finally {
      surface.dispose();
      session.dispose();
    }
  });
  it('releases a deferred resolve pass without reconfiguring a disposed canvas', async () => {
    const { surface, session, compilation, context, texture } = await fixture();
    try {
      expect(session.resources.stats().references).toBe(2);
      const restoration = surface.restore();
      surface.dispose();
      compilation.resolve();
      await restoration;
      expect(context.configure).toHaveBeenCalledTimes(1);
      expect(context.unconfigure).toHaveBeenCalledTimes(1);
      expect(texture.destroy).toHaveBeenCalledTimes(1);
      expect(surface.target).toBeNull();
      expect(session.resources.stats()).toEqual({ entries: 0, references: 0, bytes: 0 });
    } finally {
      surface.dispose();
      session.dispose();
    }
  });

  it('releases a deferred pass if the device generation changes during compilation', async () => {
    const { surface, session, compilation, context } = await fixture();
    try {
      const restoration = surface.restore();
      session.generation++;
      compilation.resolve();
      await expect(restoration).rejects.toThrow('GPU device changed');
      expect(context.configure).toHaveBeenCalledTimes(1);
      expect(session.resources.stats()).toEqual({ entries: 0, references: 0, bytes: 0 });
    } finally {
      surface.dispose();
      session.dispose();
    }
  });
});
