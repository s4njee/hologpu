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

async function fixture(present = true) {
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
    getContext: vi.fn(() => context),
    getBoundingClientRect: () => ({ width: 8, height: 8 }),
  } as unknown as HTMLCanvasElement;
  const surface = await Surface.create(canvas, session, () => {}, 1, 2, present);
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
  it('allocates a float-only surface without a canvas context or resolve pipeline', async () => {
    const { surface, session, context, device } = await fixture(false);
    try {
      expect(surface.canvas.getContext).not.toHaveBeenCalled();
      expect(surface.context).toBeNull();
      expect(context.configure).not.toHaveBeenCalled();
      expect(surface.size).toEqual([8, 8]);
      expect(surface.bytes).toBe(512);
      expect(device.createTexture).toHaveBeenCalledTimes(1);
      expect(session.resources.stats().references).toBe(0);
      surface.present({} as GPUCommandEncoder);
      surface.dispose();
      expect(context.unconfigure).not.toHaveBeenCalled();
      expect(surface.bytes).toBe(0);
    } finally {
      surface.dispose();
      session.dispose();
    }
  });
  it('requires restoration before a float-only surface can allocate on a new generation', async () => {
    const { surface, session, device } = await fixture(false);
    try {
      session.generation++;
      surface.destroyTarget();
      surface.resize();
      expect(device.createTexture).toHaveBeenCalledTimes(1);
      await surface.restore();
      expect(device.createTexture).toHaveBeenCalledTimes(2);
      expect(surface.target).not.toBeNull();
    } finally {
      surface.dispose();
      session.dispose();
    }
  });

  it('ignores observer resize while a new device is ready but this surface still has an old resolve pass', async () => {
    const { surface, session, device } = await fixture();
    try {
      session.generation++;
      surface.destroyTarget();
      surface.resize();
      expect(surface.target).toBeNull();
      expect(device.createTexture).toHaveBeenCalledTimes(1);
    } finally {
      surface.dispose();
      session.dispose();
    }
  });
  it('prevents superseded surfaces from unconfiguring or resizing a newer mount on the same canvas', async () => {
    const { surface, session, compilation, context } = await fixture();
    const older = surface.restore();
    const replacement = Surface.create(surface.canvas, session, () => {});
    compilation.resolve();
    await expect(older).rejects.toThrow('superseded');
    const newer = await replacement;
    const width = newer.canvas.width;
    surface.resolutionScale = 0.5;
    surface.resize();
    expect(newer.canvas.width).toBe(width);
    surface.dispose();
    expect(context.unconfigure).not.toHaveBeenCalled();
    newer.dispose();
    expect(context.unconfigure).toHaveBeenCalledTimes(1);
    session.dispose();
  });
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
