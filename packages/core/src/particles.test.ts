import { describe, it, expect, vi } from 'vitest';
import { particleLayout, createParticleBuffers } from './particles.ts';
import type { DeviceSession } from './device.ts';
describe('particle storage contract', () => {
  it('aligns vec3 fields while allowing a scalar in their trailing word', () => {
    const layout = particleLayout({
      position: 'vec3f',
      life: 'f32',
      velocity: 'vec2f',
      seed: 'u32',
    });
    expect(layout.fields.map((f) => [f.offset, f.size])).toEqual([
      [0, 12],
      [12, 4],
      [16, 8],
      [24, 4],
    ]);
    expect(layout.stride).toBe(32);
    expect(particleLayout({ mass: 'f32', position: 'vec4f' }).stride).toBe(32);
  });
  it('counts both ping-pong buffers, swaps stable identities and destroys them exactly once', () => {
    vi.stubGlobal('GPUBufferUsage', { STORAGE: 128, COPY_SRC: 4, COPY_DST: 8 });
    const handles = [{ destroy: vi.fn() }, { destroy: vi.fn() }];
    const createBuffer = vi.fn().mockReturnValueOnce(handles[0]).mockReturnValueOnce(handles[1]);
    const session = {
      device: { limits: { maxStorageBufferBindingSize: 1024 }, createBuffer },
    } as unknown as DeviceSession;
    const buffers = createParticleBuffers(session, { count: 8, stride: 32, label: 'test' });
    expect(buffers.bytes).toBe(512);
    expect(buffers.read).toBe(handles[0]);
    buffers.swap();
    expect(buffers.read).toBe(handles[1]);
    buffers.dispose();
    buffers.dispose();
    expect(buffers.bytes).toBe(0);
    handles.forEach((h) => expect(h.destroy).toHaveBeenCalledTimes(1));
    vi.unstubAllGlobals();
  });
  it('cleans a partially allocated pair when the second allocation throws', () => {
    vi.stubGlobal('GPUBufferUsage', { STORAGE: 128, COPY_SRC: 4, COPY_DST: 8 });
    const first = { destroy: vi.fn() };
    const session = {
      device: {
        limits: { maxStorageBufferBindingSize: 1024 },
        createBuffer: vi
          .fn()
          .mockReturnValueOnce(first)
          .mockImplementationOnce(() => {
            throw new Error('allocation');
          }),
      },
    } as unknown as DeviceSession;
    expect(() => createParticleBuffers(session, { count: 8, stride: 32, label: 'test' })).toThrow(
      'allocation',
    );
    expect(first.destroy).toHaveBeenCalledOnce();
    expect(() => createParticleBuffers(session, { count: 40, stride: 32, label: 'test' })).toThrow(
      'limits',
    );
    vi.unstubAllGlobals();
  });
});
