import { compileShader } from './debug.ts';
import { compose, chunk, fullscreen, colour } from './wgsl/index.ts';
import type { ComposedWGSL } from './wgsl/composer.ts';
import type { DeviceSession } from './device.ts';
import type { ResourceLease } from './resources.ts';
import type { ShaderDiagnostic } from './debug.ts';
export interface FullscreenPass {
  readonly source: ComposedWGSL;
  readonly diagnostics: readonly ShaderDiagnostic[];
  readonly pipeline: GPURenderPipeline;
  draw(
    encoder: GPUCommandEncoder,
    target: GPUTextureView,
    groups: readonly GPUBindGroup[],
    clear?: GPUColor,
  ): void;
  dispose(): void;
}
export async function createFullscreenPass(
  session: DeviceSession,
  source: ComposedWGSL,
  format: GPUTextureFormat,
  label: string,
  bindings?: readonly GPUBindGroupLayoutEntry[],
): Promise<FullscreenPass> {
  const moduleLease = await session.resources.acquireAsync(`shader:${source.code}`, () =>
    compileShader(session.device, source, label),
  );
  const layoutLease = bindings
    ? session.resources.acquire(`bindings:${JSON.stringify(bindings)}`, () =>
        session.device.createBindGroupLayout({
          label: `${label}-bindings`,
          entries: [...bindings],
        }),
      )
    : null;
  let pipelineLease: ResourceLease<GPURenderPipeline>;
  try {
    pipelineLease = await session.resources.acquireAsync(
      `render:${format}:${JSON.stringify(bindings)}:${source.code}`,
      () =>
        session.validate(() =>
          session.device.createRenderPipelineAsync({
            label,
            layout: bindings
              ? session.device.createPipelineLayout({
                  label: `${label}-layout`,
                  bindGroupLayouts: [layoutLease!.value],
                })
              : 'auto',
            vertex: { module: moduleLease.value.module, entryPoint: 'vertex' },
            fragment: {
              module: moduleLease.value.module,
              entryPoint: 'fragment',
              targets: [{ format }],
            },
            primitive: { topology: 'triangle-list' },
          }),
        ),
    );
  } catch (error) {
    moduleLease.release();
    layoutLease?.release();
    throw error;
  }
  return {
    source,
    diagnostics: moduleLease.value.diagnostics,
    pipeline: pipelineLease.value,
    draw(encoder, target, groups, clear = [0, 0, 0, 0]) {
      const pass = encoder.beginRenderPass({
        label,
        colorAttachments: [{ view: target, clearValue: clear, loadOp: 'clear', storeOp: 'store' }],
      });
      pass.setPipeline(pipelineLease.value);
      groups.forEach((group, index) => pass.setBindGroup(index, group));
      pass.draw(3);
      pass.end();
    },
    dispose() {
      pipelineLease.release();
      moduleLease.release();
      layoutLease?.release();
    },
  };
}
export const resolveSource = compose(
  fullscreen,
  colour,
  chunk(
    'resolve',
    /* wgsl */ `
@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fragment(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let color=textureLoad(image,vec2i(p.xy),0);
  let alpha=clamp(color.a,0.0,1.0);
  let straight=color.rgb/max(alpha,0.00001);
  return vec4f(linear_to_srgb(max(straight,vec3f(0)))*alpha,alpha);
}
`,
  ),
);
