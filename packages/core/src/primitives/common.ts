import { createComputePass, type ComputePass } from '../compute.ts';
import type { DeviceSession } from '../device.ts';
import { chunk, compose, type ComposedWGSL } from '../wgsl/composer.ts';
export class PrimitiveResources {
  readonly buffers: GPUBuffer[] = [];
  readonly passes: ComputePass[] = [];
  readonly uniforms = new Map<string, GPUBuffer>();
  #disposed = false;
  assertAlive() {
    if (this.#disposed) throw new Error('Primitive is disposed');
  }
  readonly session: DeviceSession;
  readonly label: string;
  constructor(session: DeviceSession, label: string) {
    this.session = session;
    this.label = label;
  }
  buffer(bytes: number, label: string) {
    this.assertAlive();
    if (bytes > this.session.device.limits.maxStorageBufferBindingSize)
      throw new RangeError('Primitive storage exceeds device binding limit');
    const buffer = this.session.device.createBuffer({
      label: `${this.label}-${label}`,
      size: Math.max(4, bytes),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    this.buffers.push(buffer);
    return buffer;
  }
  uniform(values: readonly number[]) {
    this.assertAlive();
    const key = values.join(',');
    let buffer = this.uniforms.get(key);
    if (!buffer) {
      buffer = this.session.device.createBuffer({
        label: `${this.label}-arguments`,
        size: Math.max(16, Math.ceil(values.length / 4) * 16),
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.session.device.queue.writeBuffer(buffer, 0, new Uint32Array(values));
      this.uniforms.set(key, buffer);
    }
    return buffer;
  }
  async pass(
    code: string,
    name: string,
    kinds: readonly ('read-only-storage' | 'storage' | 'uniform')[],
  ) {
    this.assertAlive();
    const layout = this.session.device.createBindGroupLayout({
      label: `${this.label}-${name}`,
      entries: kinds.map((type, binding) => ({
        binding,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type },
      })),
    });
    const source = compose(chunk(`primitive:${this.label}:${name}`, code));
    const pass = await createComputePass(this.session, source, `${this.label}-${name}`, [layout]);
    this.passes.push(pass);
    return pass;
  }
  dispatch(
    pass: ComputePass,
    encoder: GPUCommandEncoder,
    buffers: readonly GPUBuffer[],
    groups: number,
  ) {
    this.assertAlive();
    if (!groups) return;
    const group = this.session.device.createBindGroup({
      layout: pass.pipeline.getBindGroupLayout(0),
      entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    pass.dispatch(encoder, [group], [groups]);
  }
  get sources(): Readonly<Record<string, ComposedWGSL>> {
    return Object.fromEntries(
      this.passes.map((pass, index) => [`${this.label}-${index}`, pass.source]),
    );
  }
  get diagnostics() {
    return this.passes.flatMap((pass) => pass.diagnostics);
  }
  get memory() {
    return {
      bufferBytes:
        this.buffers.reduce((n, b) => n + b.size, 0) +
        [...this.uniforms.values()].reduce((n, b) => n + b.size, 0),
      textureBytes: 0,
    };
  }
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.passes.forEach((pass) => pass.dispose());
    this.buffers.forEach((buffer) => buffer.destroy());
    this.uniforms.forEach((buffer) => buffer.destroy());
    this.buffers.length = 0;
    this.passes.length = 0;
    this.uniforms.clear();
  }
}
export function validateCount(capacity: number, count: number) {
  if (!Number.isInteger(count) || count < 0 || count > capacity)
    throw new RangeError(`Primitive count ${count} must be between zero and capacity ${capacity}`);
}
export function validateCapacity(capacity: number) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 0x1000000)
    throw new RangeError('Primitive capacity must be an integer in [1, 16777216]');
}

export function validateInput(buffer: GPUBuffer, count: number, stride = 4) {
  if (!(buffer.usage & GPUBufferUsage.STORAGE) || buffer.size < Math.max(4, count * stride))
    throw new RangeError('Primitive input requires adequately sized STORAGE buffer');
}
export function validateDispatchCapacity(session: DeviceSession, capacity: number) {
  if (Math.ceil(capacity / 256) > session.device.limits.maxComputeWorkgroupsPerDimension)
    throw new RangeError('Primitive capacity exceeds device dispatch limit');
}
