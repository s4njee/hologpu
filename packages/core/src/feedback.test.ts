import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPingPongTargets,
  feedbackEffect,
  packFrame,
  textureTexelBytes,
  UniformSnapshots,
} from './feedback.ts';
import type { FeedbackProgram } from './feedback.ts';
import { createComputePass, simulationSource } from './compute.ts';
import { ParamStore } from './params.ts';
import { Resources } from './resources.ts';
import type { DeviceSession } from './device.ts';
import type { EffectContext, FrameInfo } from './effect.ts';
const schema = { rate: { type: 'f32', default: 1, min: 0, max: 4 } } as const;
function frame(index = 0): FrameInfo {
  return {
    time: index / 60,
    delta: 1 / 60,
    index,
    resolution: [80, 60],
    dpr: 2,
    pointer: [0.2, 0.3],
    velocity: [1, 2],
    buttons: 1,
    pressure: 0.5,
    scroll: 0.1,
    visibility: 0.9,
    seed: 0xffffffff,
  };
}
interface FakeBuffer {
  bytes: ArrayBuffer;
  destroy: ReturnType<typeof vi.fn>;
}
function gpu() {
  const textures: { destroy: ReturnType<typeof vi.fn> }[] = [];
  const buffers: FakeBuffer[] = [];
  const device = {
    limits: { maxTextureDimension2D: 128, maxComputeWorkgroupsPerDimension: 64 },
    createTexture: vi.fn(() => {
      const texture = { destroy: vi.fn() };
      textures.push(texture);
      return texture;
    }),
    createBuffer: vi.fn((descriptor: GPUBufferDescriptor) => {
      const buffer = { bytes: new ArrayBuffer(Number(descriptor.size)), destroy: vi.fn() };
      buffers.push(buffer);
      return buffer;
    }),
    createBindGroupLayout: vi.fn(() => ({})),
    createBindGroup: vi.fn((descriptor: GPUBindGroupDescriptor) => ({
      entries: descriptor.entries,
    })),
    createShaderModule: vi.fn(() => ({ getCompilationInfo: async () => ({ messages: [] }) })),
    createPipelineLayout: vi.fn(() => ({})),
    createComputePipelineAsync: vi.fn(async () => ({})),
    queue: {
      writeBuffer: vi.fn((buffer: FakeBuffer, offset: number, data: ArrayBuffer) => {
        new Uint8Array(buffer.bytes).set(new Uint8Array(data), offset);
      }),
    },
  };
  const resources = new Resources();
  const session = {
    device,
    resources,
    validate: async <T>(fn: () => Promise<T>) => fn(),
  } as unknown as DeviceSession;
  return {
    device: device as unknown as GPUDevice,
    fake: device,
    session,
    textures,
    buffers,
    resources,
  };
}
function groupData(group: GPUBindGroup, binding: number) {
  const entries = (group as unknown as { entries: GPUBindGroupEntry[] }).entries;
  return (
    entries.find((entry) => entry.binding === binding)!.resource as unknown as {
      buffer: FakeBuffer;
    }
  ).buffer.bytes;
}
beforeEach(() => {
  vi.stubGlobal('GPUTextureUsage', {
    TEXTURE_BINDING: 1,
    STORAGE_BINDING: 2,
    RENDER_ATTACHMENT: 4,
    COPY_SRC: 8,
    COPY_DST: 16,
  });
  vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
  vi.stubGlobal('GPUShaderStage', { COMPUTE: 1, FRAGMENT: 2 });
});
afterEach(() => vi.unstubAllGlobals());
describe('ping-pong state targets', () => {
  it('swaps distinct targets, keeps unchanged grids, and accounts both sides across resize/disposal', () => {
    const state = gpu();
    const pair = createPingPongTargets(state.session, {
      label: 'test',
      format: 'rgba16float',
      size: [8, 4],
    });
    const first = pair.read,
      second = pair.write;
    expect(first).not.toBe(second);
    expect(pair.bytes).toBe(8 * 4 * 8 * 2);
    pair.swap();
    expect(pair.read).toBe(second);
    expect(pair.write).toBe(first);
    expect(pair.resize([8, 4])).toBe(false);
    expect(pair.read).toBe(second);
    expect(pair.resize([16, 8])).toBe(true);
    expect(
      state.textures.slice(0, 2).every((texture) => texture.destroy.mock.calls.length === 1),
    ).toBe(true);
    expect(pair.bytes).toBe(16 * 8 * 8 * 2);
    expect(() => pair.resize([129, 1])).toThrow('limits');
    expect(() => pair.resize([2.5, 1])).toThrow('limits');
    pair.dispose();
    pair.dispose();
    expect(pair.bytes).toBe(0);
    expect(state.textures.every((texture) => texture.destroy.mock.calls.length === 1)).toBe(true);
    expect(() => pair.swap()).toThrow('disposed');
  });
  it('retains the live pair and frees partial new allocations when a resize fails', () => {
    const state = gpu();
    const pair = createPingPongTargets(state.session, {
      label: 'failure',
      format: 'r32uint',
      size: [4, 4],
    });
    const first = pair.read;
    state.fake.createTexture
      .mockImplementationOnce(() => {
        const texture = { destroy: vi.fn() };
        state.textures.push(texture);
        return texture;
      })
      .mockImplementationOnce(() => {
        throw new Error('allocation');
      });
    expect(() => pair.resize([8, 8])).toThrow('allocation');
    expect(pair.read).toBe(first);
    expect(pair.size).toEqual([4, 4]);
    expect(state.textures[2]!.destroy).toHaveBeenCalledOnce();
    expect(state.textures[0]!.destroy).not.toHaveBeenCalled();
    pair.dispose();
    expect(textureTexelBytes('r32float')).toBe(4);
    expect(() => textureTexelBytes('bc1-rgba-unorm')).toThrow('uncompressed');
  });
});
describe('step uniform snapshots', () => {
  it('keeps u32 frame fields exact and distinct from floats', () => {
    const bytes = packFrame(frame(123));
    expect(bytes.byteLength).toBe(64);
    expect(new Uint32Array(bytes)[9]).toBe(123);
    expect(new Uint32Array(bytes)[11]).toBe(0xffffffff);
    expect(new Float32Array(bytes)[3]).toBeCloseTo(123 / 60);
    expect(new Float32Array(bytes)[12]).toBeCloseTo(0.1);
  });
  it('never aliases writes within one encoder and reuses allocated capacity on the next submission', () => {
    const state = gpu();
    const snapshots = new UniformSnapshots(state.device, 16);
    const encoder = {} as GPUCommandEncoder;
    const first = snapshots.group(encoder, frame(1), new Float32Array([1, 0, 0, 0]).buffer);
    const second = snapshots.group(encoder, frame(2), new Float32Array([2, 0, 0, 0]).buffer);
    expect(first).not.toBe(second);
    expect(new Uint32Array(groupData(first, 0))[9]).toBe(1);
    expect(new Uint32Array(groupData(second, 0))[9]).toBe(2);
    expect(new Float32Array(groupData(first, 1))[0]).toBe(1);
    expect(snapshots.bytes).toBe(160);
    expect(snapshots.group({} as GPUCommandEncoder, frame(3), new ArrayBuffer(16))).toBe(first);
    expect(state.buffers).toHaveLength(4);
    snapshots.dispose();
    snapshots.dispose();
    expect(snapshots.bytes).toBe(0);
    expect(state.buffers.every((buffer) => buffer.destroy.mock.calls.length === 1)).toBe(true);
    expect(() => snapshots.group(encoder, frame(), new ArrayBuffer(16))).toThrow('disposed');
  });
  it('destroys an incomplete snapshot allocation and can retry the same slot', () => {
    const state = gpu();
    const snapshots = new UniformSnapshots(state.device, 16);
    state.fake.createBindGroup.mockImplementationOnce(() => {
      throw new Error('bind group');
    });
    const encoder = {} as GPUCommandEncoder;
    expect(() => snapshots.group(encoder, frame(), new ArrayBuffer(16))).toThrow('bind group');
    expect(state.buffers).toHaveLength(2);
    expect(state.buffers.every((buffer) => buffer.destroy.mock.calls.length === 1)).toBe(true);
    expect(snapshots.bytes).toBe(0);
    snapshots.group(encoder, frame(), new ArrayBuffer(16));
    expect(snapshots.bytes).toBe(80);
    snapshots.dispose();
  });
});
it('initializes while paused, preserves ordered frame/parameter snapshots, and resets discarded work deterministically', async () => {
  const state = gpu();
  const params = new ParamStore(schema);
  const calls: {
    type: string;
    index: number;
    pointer: number;
    seed: number;
    rate: number;
    group: GPUBindGroup;
  }[] = [];
  const record = (type: string, info: FrameInfo, group: GPUBindGroup) =>
    calls.push({
      type,
      index: info.index,
      pointer: info.pointer[0],
      seed: info.seed,
      rate: new Float32Array(groupData(group, 1))[0]!,
      group,
    });
  const program: FeedbackProgram = {
    resize: () => false,
    initialize: (_encoder, info, group) => {
      record('init', info, group);
    },
    step: (_encoder, info, group) => {
      record('step', info, group);
    },
    display: (_encoder, _target, info, group) => {
      record('display', info, group);
    },
    dispose: vi.fn(),
    memory: () => ({ textureBytes: 256, bufferBytes: 32 }),
  };
  const effect = feedbackEffect({
    id: 'test-feedback',
    title: 'Test',
    params: schema,
    setup: () => program,
  });
  const ctx = {
    device: state.device,
    session: state.session,
    params,
    qualitySteps: () => 1,
  } as EffectContext<typeof schema>;
  const instance = await effect.create(ctx);
  instance.reset(12);
  instance.render(frame(), {} as GPUCommandEncoder, {} as GPUTextureView);
  expect(calls.map((call) => call.type)).toEqual(['init', 'display']);
  expect(calls[0]!.seed).toBe(12);
  calls.length = 0;
  const update = frame(1);
  instance.update(update);
  (update.pointer as unknown as number[])[0] = 0.9;
  update.index = 2;
  params.values.rate = 2;
  instance.update(update);
  params.values.rate = 3;
  instance.resize([80, 60]);
  instance.render(update, {} as GPUCommandEncoder, {} as GPUTextureView);
  expect(calls.map((call) => [call.type, call.index, call.rate])).toEqual([
    ['step', 1, 1],
    ['step', 2, 2],
    ['display', 2, 3],
  ]);
  expect(calls[0]!.pointer).toBe(0.2);
  expect(calls[0]!.group).not.toBe(calls[1]!.group);
  expect(instance.memory!()).toEqual({ textureBytes: 256, bufferBytes: 272 });
  calls.length = 0;
  instance.update(frame(3));
  instance.reset(99);
  instance.render(frame(3), {} as GPUCommandEncoder, {} as GPUTextureView);
  expect(calls.map((call) => call.type)).toEqual(['init', 'display']);
  expect(calls[0]!.index).toBe(0);
  expect(calls[0]!.seed).toBe(99);
  instance.dispose();
  instance.dispose();
  expect(instance.memory!()).toEqual({ textureBytes: 0, bufferBytes: 0 });
  expect(program.dispose).toHaveBeenCalledOnce();
  expect(state.buffers.every((buffer) => buffer.destroy.mock.calls.length === 1)).toBe(true);
});
it('cleans shader leases after a failed asynchronous compute pipeline and validates dispatch counts', async () => {
  const state = gpu();
  const source = simulationSource(schema, '@compute @workgroup_size(1) fn main() {}');
  expect(source.code).toContain('var<uniform> params: Params');
  state.fake.createComputePipelineAsync.mockRejectedValueOnce(new Error('pipeline'));
  await expect(createComputePass(state.session, source, 'failure', [])).rejects.toThrow('pipeline');
  expect(state.resources.stats().entries).toBe(0);
  const pass = await createComputePass(state.session, source, 'working', []);
  const commands = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    dispatchWorkgroups: vi.fn(),
    end: vi.fn(),
  };
  const encoder = { beginComputePass: vi.fn(() => commands) } as unknown as GPUCommandEncoder;
  expect(() => pass.dispatch(encoder, [], [65, 1, 1])).toThrow('limits');
  expect(() => pass.dispatch(encoder, [], [1.5, 1, 1])).toThrow('limits');
  pass.dispatch(encoder, [], [8, 4]);
  expect(commands.dispatchWorkgroups).toHaveBeenCalledWith(8, 4, 1);
  expect(commands.end).toHaveBeenCalledOnce();
  pass.dispose();
  expect(state.resources.stats().entries).toBe(0);
});
