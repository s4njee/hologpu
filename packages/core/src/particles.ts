import { defineEffect, type FragmentOptions } from './effect.ts';
import { feedbackEffect, type FeedbackProgram } from './feedback.ts';
import type { EffectContext } from './effect.ts';
import type { ParamSchema } from './params.ts';
import type { DeviceSession } from './device.ts';
import type { ComposedWGSL } from './wgsl/composer.ts';
import { compileShader } from './debug.ts';
import type { ShaderDiagnostic } from './debug.ts';

export interface ParticleProgram extends FeedbackProgram {
  setInput?(name: string, data: unknown): void | Promise<void>;
}
export interface ParticleOptions<S extends ParamSchema> extends Omit<
  FragmentOptions<S>,
  'wgsl' | 'chunks'
> {
  setup(ctx: EffectContext<S>): ParticleProgram | Promise<ParticleProgram>;
}
/** Particle storage obeys the same immutable fixed-step queue contract as feedback textures. */
export function particleEffect<const S extends ParamSchema>(options: ParticleOptions<S>) {
  return defineEffect({
    ...feedbackEffect({ ...options, family: options.family ?? 'particles' }),
    tier: 'T3',
    async create(ctx) {
      let program: ParticleProgram;
      const instance = await feedbackEffect({
        ...options,
        family: options.family ?? 'particles',
        setup: async (context) => {
          program = await options.setup(context);
          return program;
        },
      }).create(ctx);
      return {
        ...instance,
        setInput: (name: string, data: unknown) => program.setInput?.(name, data),
      };
    },
  });
}
export type ParticleFieldType =
  'f32' | 'u32' | 'i32' | 'vec2f' | 'vec3f' | 'vec4f' | 'vec2u' | 'vec4u';
export function particleLayout(
  fields: Readonly<Record<string, ParticleFieldType>>,
  name = 'Particle',
) {
  const sizes: Record<ParticleFieldType, readonly [number, number]> = {
    f32: [4, 4],
    u32: [4, 4],
    i32: [4, 4],
    vec2f: [8, 8],
    vec3f: [16, 12],
    vec4f: [16, 16],
    vec2u: [8, 8],
    vec4u: [16, 16],
  };
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || Object.keys(fields).length === 0)
    throw new RangeError('Invalid particle struct');
  let offset = 0,
    alignment = 4;
  const layout = Object.entries(fields).map(([field, type]) => {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(field) || !sizes[type])
      throw new RangeError('Invalid particle field');
    const [align, size] = sizes[type];
    alignment = Math.max(alignment, align);
    offset = Math.ceil(offset / align) * align;
    const entry = { name: field, type, offset, size };
    offset += size;
    return entry;
  });
  return {
    fields: layout,
    stride: Math.ceil(offset / alignment) * alignment,
    wgsl: `struct ${name} { ${layout.map((f) => `${f.name}:${f.type}`).join(',')} };`,
  };
}
export function createParticleBuffers(
  session: DeviceSession,
  options: { count: number; stride: number; label: string; pingPong?: boolean },
) {
  const size = options.count * options.stride;
  if (
    !Number.isInteger(options.count) ||
    options.count < 1 ||
    !Number.isInteger(options.stride) ||
    options.stride < 4 ||
    options.stride % 4 ||
    size > session.device.limits.maxStorageBufferBindingSize
  )
    throw new RangeError('Particle storage exceeds device limits');
  const buffers: GPUBuffer[] = [];
  try {
    for (let i = 0; i < (options.pingPong === false ? 1 : 2); i++)
      buffers.push(
        session.device.createBuffer({
          label: `${options.label}-${i}`,
          size,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        }),
      );
  } catch (error) {
    buffers.forEach((b) => b.destroy());
    throw error;
  }
  let side = 0,
    disposed = false;
  return {
    get read() {
      return buffers[side]!;
    },
    get write() {
      return buffers[1 - side] ?? buffers[0]!;
    },
    get bytes() {
      return disposed ? 0 : size * buffers.length;
    },
    swap() {
      if (buffers.length === 2) side = 1 - side;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      buffers.forEach((b) => b.destroy());
    },
  };
}
export interface ParticleDraw {
  readonly pipeline: GPURenderPipeline;
  readonly source: ComposedWGSL;
  readonly diagnostics: readonly ShaderDiagnostic[];
  draw(
    encoder: GPUCommandEncoder,
    target: GPUTextureView,
    groups: readonly GPUBindGroup[],
    count: number,
    indirect?: GPUBuffer,
    load?: boolean,
  ): void;
  dispose(): void;
}
/** Vertex entry particleVertex; fragment entry particleFragment. Quads use six vertices per instance. */
export async function createParticleDraw(
  session: DeviceSession,
  source: ComposedWGSL,
  options: {
    label: string;
    format: GPUTextureFormat;
    layouts: readonly GPUBindGroupLayout[];
    mode: 'point' | 'quad';
    additive?: boolean;
    /** Replace alpha for trail targets, or composite coverage for overlapping translucent quads. */
    additiveAlpha?: 'replace' | 'over';
  },
): Promise<ParticleDraw> {
  source = session.shaderSource(options.label, source);
  const module = await session.resources.acquireAsync(`shader:${source.code}`, () =>
    session.validate(() => compileShader(session.device, source, options.label)),
  );
  try {
    const pipeline = await session.validate(() =>
      session.device.createRenderPipelineAsync({
        label: options.label,
        layout: session.device.createPipelineLayout({ bindGroupLayouts: [...options.layouts] }),
        vertex: { module: module.value.module, entryPoint: 'particleVertex' },
        fragment: {
          module: module.value.module,
          entryPoint: 'particleFragment',
          targets: [
            {
              format: options.format,
              ...(options.additive
                ? {
                    blend: {
                      color: {
                        srcFactor: 'one',
                        dstFactor: 'one',
                        operation: 'add',
                      } as GPUBlendComponent,
                      alpha: {
                        srcFactor: 'one',
                        dstFactor:
                          options.additiveAlpha === 'over' ? 'one-minus-src-alpha' : 'zero',
                        operation: 'add',
                      } as GPUBlendComponent,
                    },
                  }
                : {}),
            },
          ],
        },
        primitive: { topology: options.mode === 'point' ? 'point-list' : 'triangle-list' },
      }),
    );
    return {
      pipeline,
      source,
      diagnostics: module.value.diagnostics,
      draw(encoder, target, groups, count, indirect, load = false) {
        const pass = encoder.beginRenderPass({
          label: options.label,
          timestampWrites: session.profiler?.timestampWrites(encoder, options.label),
          colorAttachments: [
            {
              view: target,
              clearValue: [0, 0, 0, 0],
              loadOp: load ? 'load' : 'clear',
              storeOp: 'store',
            },
          ],
        });
        pass.setPipeline(pipeline);
        groups.forEach((g, i) => pass.setBindGroup(i, g));
        if (indirect) pass.drawIndirect(indirect, 0);
        else if (options.mode === 'point') pass.draw(count);
        else pass.draw(6, count);
        pass.end();
      },
      dispose() {
        module.release();
      },
    };
  } catch (error) {
    module.release();
    throw error;
  }
}
