import {
  defineEffect,
  sphereMesh,
  createEnvironment,
  type EffectContext,
} from '@mk7s/hologpu-core';
import { scene, speed, msaa, tint, f } from '../_geometry/common.ts';
const params = {
  speed,
  msaa,
  tint,
  roughness: f(0.25, 0.04, 1, 'GGX roughness selects a prefiltered specular cube mip.'),
  metallic: f(0.85, 0, 1, 'Blend dielectric F0 .04 with metallic base colour.'),
  environment: f(1, 0, 4, 'HDR image-based lighting intensity.'),
  exposure: f(1, 0.1, 4, 'Linear exposure before Reinhard presentation.'),
} as const;
const code = `@group(1) @binding(1) var specularEnv:texture_cube<f32>;@group(1) @binding(2) var diffuseEnv:texture_cube<f32>;@group(1) @binding(3) var linearSampler:sampler;
@vertex fn meshVertex(@location(0) p:vec3f,@location(1) n:vec3f,@location(2) uv:vec2f)->MeshOut{return mesh_out(p,n,uv);}
fn fresnel(f0:vec3f,cosine:f32)->vec3f{return f0+(1.0-f0)*pow(1.0-clamp(cosine,0.0,1.0),5.0);}
@fragment fn meshFragment(in:MeshOut)->@location(0)vec4f {let n=normalize(in.normal);let v=normalize(camera.eye.xyz-in.world);let nv=max(.001,dot(n,v));let l=normalize(vec3f(-.6,1,.7));let h=normalize(v+l);let nl=max(0.0,dot(n,l));let nh=max(0.0,dot(n,h));let vh=max(0.0,dot(v,h));let base=params.tint.rgb;let f0=mix(vec3f(.04),base,params.metallic);let a=params.roughness*params.roughness;let a2=a*a;let d=a2/(3.14159265*pow(nh*nh*(a2-1.0)+1.0,2.0));let k=pow(params.roughness+1.0,2.0)/8.0;let g=nv/(nv*(1.0-k)+k)*nl/(nl*(1.0-k)+k);let spec=d*g*fresnel(f0,vh)/max(4.0*nv*nl,.001);let diffuse=(1.0-fresnel(f0,vh))*(1.0-params.metallic)*base/3.14159265;
// Split-sum DFG approximation (Lazarov); GGX prefilter and cosine irradiance are separate.
let r=params.roughness*vec4f(-1,-.0275,-.572,.022)+vec4f(1,.0425,1.04,-.04);let a004=min(r.x*r.x,exp2(-9.28*nv))*r.x+r.y;let ab=vec2f(-1.04,1.04)*a004+r.zw;
let reflected=reflect(-v,n);let lod=params.roughness*f32(textureNumLevels(specularEnv)-1u);let iblSpec=textureSampleLevel(specularEnv,linearSampler,reflected,lod).rgb*(f0*ab.x+ab.y);let irradiance=textureSampleLevel(diffuseEnv,linearSampler,n,0.0).rgb;let iblDiffuse=irradiance*base*(1.0-params.metallic)*(1.0-fresnel(f0,nv))/3.14159265;let color=max(vec3f(0),(diffuse+spec)*nl*2.0+(iblSpec+iblDiffuse)*params.environment)*params.exposure;return vec4f(color/(1.0+color),1);}`;
export default defineEffect({
  id: 'material-ball',
  title: 'GGX material and prefiltered cube lighting',
  budget: { expectedMs: 3, referenceSize: [640, 400] },
  family: 'geometry',
  tier: 'T5',
  core: true,
  tags: ['pbr', 'cube-map', 'texture-array', 'prefiltered-mips', 'depth', 'msaa'],
  features: [],
  inputs: [],
  params,
  presets: {
    copper: { metallic: 1, roughness: 0.15, tint: '#d99869' },
    ceramic: { metallic: 0, roughness: 0.6, tint: '#74b8d9' },
  },
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  poster: new URL('./poster.png', import.meta.url).href,
  fallback: 'radial-gradient(circle at 45% 40%,#deb586,#253446 60%)',
  async create(ctx: EffectContext<typeof params>) {
    const env = await createEnvironment(ctx.session);
    let s: Awaited<ReturnType<typeof scene<typeof params>>>;
    try {
      s = await scene(ctx, 'material-ball', sphereMesh(), code, [
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: 'cube' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: 'cube' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ]);
    } catch (error) {
      env.dispose();
      throw error;
    }
    const group = s.group([
      { binding: 1, resource: env.specular },
      { binding: 2, resource: env.diffuse },
      { binding: 3, resource: env.sampler },
    ]);
    let size: readonly [number, number] = [1, 1];
    return {
      resize(next) {
        size = next;
        s.resize(size);
      },
      update() {},
      reset() {},
      shouldRender: (frame) => !frame.reducedMotion && Number(ctx.params.values.speed) > 0,
      render(frame, encoder, target) {
        env.encode(encoder);
        const time = frame.reducedMotion ? 0 : frame.time;
        const angle = time * Number(ctx.params.values.speed) + 0.7;
        s.camera.update(
          [Math.sin(angle) * 3.4, 1.1, Math.cos(angle) * 3.4],
          [0, 0, 0],
          size[0] / size[1],
        );
        const pass = s.begin(encoder, target);
        s.draw(pass, group);
        pass.end();
      },
      sources: { ...s.sources, ...env.sources },
      diagnostics: [...s.diagnostics, ...env.diagnostics],
      textureTaps: () => env.textureTaps(),
      bufferTaps: () => ({
        vertices: {
          buffer: s.mesh.vertex,
          stride: 32,
          count: (48 + 1) * (24 + 1),
          label: 'Unit sphere positions, normals, UVs',
        },
        camera: {
          buffer: s.camera.buffer,
          stride: 4,
          count: 20,
          label: 'Column-major view-projection and world-space eye',
        },
      }),
      memory: () => {
        const a = s.memory(),
          b = env.memory();
        return {
          textureBytes: a.textureBytes + b.textureBytes,
          bufferBytes: a.bufferBytes + b.bufferBytes,
        };
      },
      dispose() {
        env.dispose();
        s.dispose();
      },
    };
  },
});
