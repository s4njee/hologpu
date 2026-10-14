import {
  createCamera,
  cameraWGSL,
  simulationUniformLayout,
  simulationSource,
  createMeshPipeline,
  createGeometryTargets,
  uploadMesh,
  type EffectContext,
  type ParamSchema,
  type MeshData,
} from '@mk7s/hologpu-core';
export const speed = {
  type: 'f32',
  default: 0.25,
  min: 0,
  max: 2,
  step: 0.05,
  group: 'Camera',
  description: 'Camera orbit speed in radians per second.',
} as const;
export const msaa = {
  type: 'enum',
  default: '4x',
  options: ['off', '4x'],
  uniform: false,
  group: 'Rendering',
  description: 'Single sample or four-sample depth-tested rendering with HDR resolve.',
} as const;
export const tint = {
  type: 'color',
  default: '#56c7dd',
  group: 'Material',
  description: 'Linearized base material colour.',
} as const;
export const f = (
  value: number,
  min: number,
  max: number,
  description: string,
  group = 'Material',
) => ({ type: 'f32' as const, default: value, min, max, step: 0.01, description, group });
export const cameraCode = `struct MeshOut {@builtin(position) position:vec4f,@location(0) world:vec3f,@location(1) normal:vec3f,@location(2) uv:vec2f};
fn mesh_out(p:vec3f,n:vec3f,uv:vec2f)->MeshOut {var out:MeshOut;out.position=camera.viewProjection*vec4f(p,1);out.world=p;out.normal=n;out.uv=uv;return out;}
fn shaded(n:vec3f,c:vec3f)->vec3f {return c*(.15+.85*max(0.0,dot(normalize(n),normalize(vec3f(.6,1,.7)))));}`;
/** Shared minimal ownership for a single mesh; effects retain their explicit render graph. */
export async function scene<S extends ParamSchema>(
  ctx: EffectContext<S>,
  id: string,
  data: MeshData,
  code: string,
  extra: GPUBindGroupLayoutEntry[] = [],
  dependencies: Parameters<typeof simulationSource>[2] = [],
) {
  const device = ctx.device,
    camera = createCamera(device),
    mesh = uploadMesh(device, data, id),
    targets = createGeometryTargets(device, ctx.format);
  const layout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        ...extra,
      ],
    }),
    uniformLayout = simulationUniformLayout(device);
  const uniforms = device.createBindGroup({
    layout: uniformLayout,
    entries: [
      { binding: 0, resource: { buffer: ctx.frameBuffer } },
      { binding: 1, resource: { buffer: ctx.paramsBuffer } },
    ],
  });
  const source = simulationSource(ctx.params.schema, cameraCode + code, [
    cameraWGSL,
    ...(dependencies ?? []),
  ]);
  const pipelines: Awaited<ReturnType<typeof createMeshPipeline>>[] = [];
  try {
    for (const samples of [1, 4] as const)
      pipelines.push(
        await createMeshPipeline(ctx.session, source, {
          label: `${id}-${samples}x`,
          format: ctx.format,
          layouts: [uniformLayout, layout],
          samples,
        }),
      );
    const resize = (size: readonly [number, number]) =>
      targets.resize(size, ctx.params.values.msaa === '4x' ? 4 : 1);
    return {
      device,
      camera,
      mesh,
      targets,
      layout,
      uniforms,
      pipelines,
      resize,
      group(entries: GPUBindGroupEntry[] = []) {
        return device.createBindGroup({
          layout,
          entries: [{ binding: 0, resource: { buffer: camera.buffer } }, ...entries],
        });
      },
      begin(
        encoder: GPUCommandEncoder,
        target: GPUTextureView,
        clear: GPUColor = [0.012, 0.018, 0.03, 1],
      ) {
        const attachments = targets.attachments(target, clear);
        const pass = encoder.beginRenderPass({
          label: `${id}-mesh`,
          ...attachments,
          timestampWrites: ctx.session.profiler.timestampWrites(encoder, `${id}-mesh`),
        });
        return pass;
      },
      draw(pass: GPURenderPassEncoder | GPURenderBundleEncoder, group: GPUBindGroup, count = 1) {
        pass.setPipeline(pipelines[targets.samples === 4 ? 1 : 0]!.pipeline);
        pass.setBindGroup(0, uniforms);
        pass.setBindGroup(1, group);
        pass.setVertexBuffer(0, mesh.vertex);
        pass.setIndexBuffer(mesh.index, 'uint32');
        pass.drawIndexed(mesh.count, count);
      },
      sources: Object.fromEntries(pipelines.map((p, i) => [`${id}-${i === 0 ? 1 : 4}x`, p.source])),
      diagnostics: pipelines.flatMap((p) => p.diagnostics),
      memory: () => ({ textureBytes: targets.bytes, bufferBytes: mesh.bytes + 80 }),
      dispose() {
        targets.dispose();
        camera.dispose();
        mesh.dispose();
        pipelines.forEach((p) => p.dispose());
      },
    };
  } catch (error) {
    targets.dispose();
    camera.dispose();
    mesh.dispose();
    pipelines.forEach((p) => p.dispose());
    throw error;
  }
}
