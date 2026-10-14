import {
  defineEffect,
  cubeMesh,
  noise,
  type EffectInstance,
  type EffectContext,
} from '@mk7s/hologpu-core';
import { scene, speed, msaa, tint, f } from '../_geometry/common.ts';
const params = {
  speed,
  msaa,
  tint,
  count: {
    type: 'u32',
    default: 4096,
    min: 1,
    max: 65536,
    step: 1,
    group: 'Geometry',
    description: 'Actual indexed mesh instance count, arranged on a square grid.',
  },
  height: f(1.8, 0, 4, 'Seeded vertex-stage noise displacement amplitude.', 'Geometry'),
  scale: f(0.15, 0.02, 0.4, 'Half size of each cube.', 'Geometry'),
  draw: {
    type: 'enum',
    default: 'bundle',
    options: ['direct', 'bundle'],
    uniform: false,
    group: 'Rendering',
    description: 'Direct indexed instancing or reusable render bundle encoding.',
  },
  occlusion: {
    type: 'bool',
    default: true,
    group: 'Rendering',
    description:
      'Query visible samples and a second identical depth-occluded draw; results appear in buffer taps.',
  },
} as const;
const code = `@vertex fn meshVertex(@location(0) p:vec3f,@location(1) n:vec3f,@location(2) uv:vec2f,@builtin(instance_index) i:u32)->MeshOut {
 let side=u32(ceil(sqrt(f32(params.count))));let grid=vec2f(f32(i%side),f32(i/side))-f32(side-1u)*.5;
 let time=select(frame.time,0.0,frame.reducedMotion>.5);let spacing=12.0/f32(side);let height=value_noise(grid*.11+time*.3,frame.seed)*params.height;
 let world=p*min(params.scale,spacing*.43)+vec3f(grid.x*spacing,height,grid.y*spacing);return mesh_out(world,n,uv);}
@fragment fn meshFragment(in:MeshOut)->@location(0)vec4f {let c=shaded(in.normal,mix(params.tint.rgb,vec3f(.85,.32,.12),clamp(in.world.y/max(params.height,.01),0.0,1.0)));let fog=1.0-exp(-length(camera.eye.xyz-in.world)*.025);return vec4f(mix(c,vec3f(.012,.018,.03),fog),1);}`;
export default defineEffect({
  id: 'instances',
  title: 'Noise-displaced instanced meshes',
  budget: { expectedMs: 3, referenceSize: [640, 400] },
  family: 'geometry',
  tier: 'T5',
  core: true,
  tags: ['instancing', 'depth', 'msaa', 'render-bundles', 'occlusion-queries'],
  features: [],
  inputs: [],
  params,
  presets: {
    city: { count: 16384, height: 3, scale: 0.2, tint: '#e5b96c' },
    islands: { count: 1024, height: 0.65, scale: 0.1, tint: '#6adecc' },
  },
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  poster: new URL('./poster.png', import.meta.url).href,
  fallback: 'linear-gradient(145deg,#172535,#65acb3)',
  create,
});
async function create(ctx: EffectContext<typeof params>): Promise<EffectInstance> {
  const s = await scene(ctx, 'instances', cubeMesh(), code, [], [noise]),
    group = s.group();
  let query: GPUQuerySet | undefined, results: GPUBuffer | undefined;
  try {
    query = s.device.createQuerySet({ label: 'instances-occlusion', type: 'occlusion', count: 2 });
    results = s.device.createBuffer({
      label: 'instances-occlusion-results',
      size: 16,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    let bundle: GPURenderBundle | undefined,
      signature = '',
      size: readonly [number, number] = [1, 1];
    return {
      resize(next: readonly [number, number]) {
        size = next;
        s.resize(size);
      },
      update() {},
      reset() {},
      shouldRender: (frame) => !frame.reducedMotion,
      render(frame, encoder, target) {
        s.resize(size);
        const time = frame.reducedMotion ? 0 : frame.time;
        const angle = time * Number(ctx.params.values.speed) + 0.65;
        s.camera.update(
          [Math.cos(angle) * 11, 8, Math.sin(angle) * 11],
          [0, 0.5, 0],
          size[0] / size[1],
        );
        const count = Number(ctx.params.values.count),
          next = `${count}/${s.targets.samples}`;
        if (!bundle || signature !== next) {
          const b = s.device.createRenderBundleEncoder({
            label: 'instances-bundle',
            colorFormats: [ctx.format],
            depthStencilFormat: 'depth32float',
            sampleCount: s.targets.samples,
          });
          s.draw(b, group, count);
          bundle = b.finish();
          signature = next;
        }
        const active = Boolean(ctx.params.values.occlusion),
          pass = encoder.beginRenderPass({
            label: 'instances-mesh',
            ...s.targets.attachments(target, [0.012, 0.018, 0.03, 1]),
            ...(active ? { occlusionQuerySet: query } : {}),
            timestampWrites: ctx.session.profiler.timestampWrites(encoder, 'instances-mesh'),
          });
        const draw = () =>
          ctx.params.values.draw === 'bundle'
            ? pass.executeBundles([bundle!])
            : s.draw(pass, group, count);
        if (active) pass.beginOcclusionQuery(0);
        draw();
        if (active) {
          pass.endOcclusionQuery();
          pass.beginOcclusionQuery(1);
          draw();
          pass.endOcclusionQuery();
        }
        pass.end();
        if (active) encoder.resolveQuerySet(query!, 0, 2, results!, 0);
      },
      sources: s.sources,
      diagnostics: s.diagnostics,
      bufferTaps: () => ({
        vertices: {
          buffer: s.mesh.vertex,
          stride: 32,
          count: 24,
          label: 'Cube positions, outward normals and UVs',
        },
        indices: {
          buffer: s.mesh.index,
          stride: 4,
          count: s.mesh.count,
          label: 'Indexed triangles',
        },
        occlusion: {
          buffer: results!,
          stride: 8,
          count: 2,
          label: 'u64 visible samples; repeated draw fails strict-less depth (zero)',
        },
      }),
      memory: () => {
        const m = s.memory();
        return { ...m, bufferBytes: m.bufferBytes + 16 };
      },
      dispose() {
        query?.destroy();
        results?.destroy();
        s.dispose();
      },
    };
  } catch (error) {
    query?.destroy();
    results?.destroy();
    s.dispose();
    throw error;
  }
}
