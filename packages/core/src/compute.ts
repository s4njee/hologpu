import { compileShader } from './debug.ts';
import type { ShaderDiagnostic } from './debug.ts';
import type { DeviceSession } from './device.ts';
import type { ComposedWGSL, WGSLChunk } from './wgsl/composer.ts';
import { chunk, compose, frame, fullscreen, sampling } from './wgsl/index.ts';
import { paramLayout } from './params.ts';
import type { ParamSchema } from './params.ts';
import type { FullscreenPass } from './passes.ts';

const uniforms = new WeakMap<GPUDevice, GPUBindGroupLayout>();
/** Explicit group zero, shared by compute and display pipelines. */
export function simulationUniformLayout(device: GPUDevice): GPUBindGroupLayout {
  let layout = uniforms.get(device);
  if (!layout) {
    layout = device.createBindGroupLayout({
      label: 'hgpu-simulation-uniforms',
      entries: [0, 1].map((binding) => ({
        binding,
        visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' as const },
      })),
    });
    uniforms.set(device, layout);
  }
  return layout;
}
/** Sources remain inspectable chunks, including generated frame and parameter layouts. */
export function simulationSource(
  schema: ParamSchema,
  code: string | WGSLChunk,
  dependencies: readonly WGSLChunk[] = [],
): ComposedWGSL {
  return compose(
    frame,
    fullscreen,
    sampling,
    chunk(
      'params',
      `${paramLayout(schema).wgsl}\n@group(0) @binding(1) var<uniform> params: Params;`,
    ),
    typeof code === 'string' ? chunk('simulation', code, dependencies) : code,
  );
}
const layoutIds = new WeakMap<GPUBindGroupLayout, number>();
let nextLayout = 0;
function layoutKey(layouts: readonly GPUBindGroupLayout[]) {
  return layouts
    .map((layout) => {
      if (!layoutIds.has(layout)) layoutIds.set(layout, ++nextLayout);
      return layoutIds.get(layout);
    })
    .join(',');
}
export interface ComputePass {
  readonly pipeline: GPUComputePipeline;
  readonly source: ComposedWGSL;
  readonly diagnostics: readonly ShaderDiagnostic[];
  dispatch(
    encoder: GPUCommandEncoder,
    groups: readonly GPUBindGroup[],
    workgroups: readonly [number, number?, number?],
  ): void;
  dispose(): void;
}
/** Each dispatch opens its own compute pass, making inter-dispatch texture hazards explicit. */
export async function createComputePass(
  session: DeviceSession,
  source: ComposedWGSL,
  label: string,
  layouts: readonly GPUBindGroupLayout[],
  entryPoint = 'main',
): Promise<ComputePass> {
  const module = await session.resources.acquireAsync(`shader:${source.code}`, () =>
    compileShader(session.device, source, label),
  );
  try {
    const pipeline = await session.resources.acquireAsync(
      `compute:${layoutKey(layouts)}:${entryPoint}:${source.code}`,
      () =>
        session.validate(() =>
          session.device.createComputePipelineAsync({
            label,
            layout: session.device.createPipelineLayout({
              label: `${label}-layout`,
              bindGroupLayouts: [...layouts],
            }),
            compute: { module: module.value.module, entryPoint },
          }),
        ),
    );
    return {
      pipeline: pipeline.value,
      source,
      diagnostics: module.value.diagnostics,
      dispatch(encoder, groups, dimensions) {
        const [x, y = 1, z = 1] = dimensions;
        if (
          ![x, y, z].every(
            (n) =>
              Number.isInteger(n) &&
              n > 0 &&
              n <= session.device.limits.maxComputeWorkgroupsPerDimension,
          )
        )
          throw new RangeError('Compute dispatch dimensions exceed device limits');
        const pass = encoder.beginComputePass({ label });
        pass.setPipeline(pipeline.value);
        groups.forEach((group, index) => pass.setBindGroup(index, group));
        pass.dispatchWorkgroups(x, y, z);
        pass.end();
      },
      dispose() {
        pipeline.release();
        module.release();
      },
    };
  } catch (error) {
    module.release();
    throw error;
  }
}
/** A fullscreen display pass with arbitrary explicit resource groups after group zero. */
export async function createSimulationDisplay(
  session: DeviceSession,
  source: ComposedWGSL,
  format: GPUTextureFormat,
  label: string,
  layouts: readonly GPUBindGroupLayout[],
): Promise<FullscreenPass> {
  const module = await session.resources.acquireAsync(`shader:${source.code}`, () =>
    compileShader(session.device, source, label),
  );
  try {
    const pipeline = await session.resources.acquireAsync(
      `simulation-display:${format}:${layoutKey(layouts)}:${source.code}`,
      () =>
        session.validate(() =>
          session.device.createRenderPipelineAsync({
            label,
            layout: session.device.createPipelineLayout({
              label: `${label}-layout`,
              bindGroupLayouts: [...layouts],
            }),
            vertex: { module: module.value.module, entryPoint: 'vertex' },
            fragment: {
              module: module.value.module,
              entryPoint: 'fragment',
              targets: [{ format }],
            },
            primitive: { topology: 'triangle-list' },
          }),
        ),
    );
    return {
      pipeline: pipeline.value,
      source,
      diagnostics: module.value.diagnostics,
      draw(encoder, target, groups, clear = [0, 0, 0, 0]) {
        const pass = encoder.beginRenderPass({
          label,
          colorAttachments: [
            { view: target, clearValue: clear, loadOp: 'clear', storeOp: 'store' },
          ],
        });
        pass.setPipeline(pipeline.value);
        groups.forEach((group, index) => pass.setBindGroup(index, group));
        pass.draw(3);
        pass.end();
      },
      dispose() {
        pipeline.release();
        module.release();
      },
    };
  } catch (error) {
    module.release();
    throw error;
  }
}
