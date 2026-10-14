import {
  defineEffect,
  planeMesh,
  uploadMesh,
  type EffectInstance,
  type EffectContext,
} from '@mk7s/hologpu-core';
import { terrainHeightField } from '../_geometry/height-field.ts';
import { scene, speed, msaa, tint, f } from '../_geometry/common.ts';
const params = {
  speed,
  msaa,
  tint,
  segments: {
    type: 'u32',
    default: 128,
    min: 8,
    max: 256,
    step: 1,
    uniform: false,
    group: 'Geometry',
    description: 'Indexed height-field cells per side; reallocates only when changed.',
  },
  height: f(2.2, 0, 5, 'Terrain elevation amplitude.', 'Geometry'),
  sculpt: f(0.3, 0, 1, 'Blend raw noise with a smoothstep height remap.', 'Geometry'),
  frequency: f(2.5, 0.2, 8, 'Seeded fractal-noise spatial frequency.', 'Geometry'),
  fog: f(0.06, 0, 0.3, 'Exponential distance fog density.', 'Atmosphere'),
} as const;
const code = `@group(1) @binding(1) var heightField:texture_2d<f32>;
fn height(p:vec2f)->f32{return sample_bilinear(heightField,p*.5+.5).r;}
@vertex fn meshVertex(@location(0) p:vec3f,@location(1) n:vec3f,@location(2) uv:vec2f)->MeshOut {let e=.005;let h=height(p.xz);let dx=(height(p.xz+vec2f(e,0))-height(p.xz-vec2f(e,0)))/(e*24.0);let dz=(height(p.xz+vec2f(0,e))-height(p.xz-vec2f(0,e)))/(e*24.0);return mesh_out(vec3f(p.x*12,h,p.z*12),normalize(vec3f(-dx,1,-dz)),uv);}
@fragment fn meshFragment(in:MeshOut)->@location(0)vec4f {let slope=1.0-normalize(in.normal).y;let elevation=clamp(in.world.y/max(params.height,.01),0.0,1.0);let base=mix(params.tint.rgb,vec3f(.58,.39,.24),clamp(slope*3.0,0.0,1.0));let color=shaded(in.normal,mix(base,vec3f(.82,.88,.92),smoothstep(.72,.92,elevation)));let fog=1.0-exp(-length(camera.eye.xyz-in.world)*params.fog);return vec4f(mix(color,vec3f(.15,.23,.31),fog),1);}`;
export default defineEffect({
  id: 'terrain',
  title: 'Indexed height field and moving camera',
  budget: { expectedMs: 4, referenceSize: [640, 400] },
  family: 'geometry',
  tier: 'T5',
  core: true,
  tags: ['index-buffer', 'vertex-displacement', 'depth', 'msaa', 'fog'],
  features: [],
  inputs: [],
  params,
  presets: {
    alpine: { height: 4, frequency: 3.5, fog: 0.04, tint: '#8baf78' },
    dunes: { height: 1.2, frequency: 1.4, fog: 0.1, tint: '#d8a56d' },
  },
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  poster: new URL('./poster.png', import.meta.url).href,
  fallback: 'linear-gradient(155deg,#577780,#b5aa81)',
  create,
});
async function create(ctx: EffectContext<typeof params>): Promise<EffectInstance> {
  const heights = await terrainHeightField(ctx);
  let s: Awaited<ReturnType<typeof scene<typeof params>>>;
  try {
    s = await scene(ctx, 'terrain', planeMesh(Number(ctx.params.values.segments)), code, [
      {
        binding: 1,
        visibility: GPUShaderStage.VERTEX,
        texture: { sampleType: 'unfilterable-float' },
      },
    ]);
    heights.resize(Number(ctx.params.values.segments));
  } catch (error) {
    heights.dispose();
    throw error;
  }
  let group = s.group([{ binding: 1, resource: heights.view }]),
    mesh = s.mesh,
    segments = Number(ctx.params.values.segments),
    size: readonly [number, number] = [1, 1];
  return {
    resize(next) {
      size = next;
      s.resize(size);
      const count = Number(ctx.params.values.segments);
      if (count !== segments) {
        const nextMesh = uploadMesh(s.device, planeMesh(count), 'terrain');
        mesh.dispose();
        mesh = nextMesh;
        segments = count;
        heights.resize(segments);
        group = s.group([{ binding: 1, resource: heights.view }]);
      }
    },
    update() {},
    reset() {},
    shouldRender: (frame) => !frame.reducedMotion && Number(ctx.params.values.speed) > 0,
    render(frame, encoder, target) {
      heights.encode(encoder, s.uniforms, frame.seed);
      const time = frame.reducedMotion ? 0 : frame.time;
      const angle = time * Number(ctx.params.values.speed) + 0.5;
      s.camera.update(
        [Math.cos(angle) * 13, 5, Math.sin(angle) * 13],
        [0, 1, 0],
        size[0] / size[1],
        Math.PI / 3,
        0.1,
        80,
      );
      const pass = s.begin(encoder, target, [0.15, 0.23, 0.31, 1]);
      pass.setPipeline(s.pipelines[s.targets.samples === 4 ? 1 : 0]!.pipeline);
      pass.setBindGroup(0, s.uniforms);
      pass.setBindGroup(1, group);
      pass.setVertexBuffer(0, mesh.vertex);
      pass.setIndexBuffer(mesh.index, 'uint32');
      pass.drawIndexed(mesh.count);
      pass.end();
    },
    sources: { ...s.sources, ...heights.sources },
    diagnostics: [...s.diagnostics, ...heights.diagnostics],
    textureTaps: () => heights.textureTaps(),
    bufferTaps: () => ({
      vertices: {
        buffer: mesh.vertex,
        count: (segments + 1) ** 2,
        stride: 32,
        label: 'Undisplaced xz grid; vertex shader applies seeded height',
      },
      indices: {
        buffer: mesh.index,
        count: mesh.count,
        stride: 4,
        label: 'Two outward triangles per cell',
      },
    }),
    memory: () => ({ textureBytes: s.targets.bytes + heights.bytes, bufferBytes: mesh.bytes + 80 }),
    dispose() {
      heights.dispose();
      mesh.dispose();
      s.dispose();
    },
  };
}
