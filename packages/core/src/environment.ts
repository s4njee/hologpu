import type { DeviceSession } from './device.ts';
import type { TextureTap } from './effect.ts';
import { chunk, compose } from './wgsl/composer.ts';
import { createComputePass } from './compute.ts';
import { createMipGenerator } from './primitives/mipgen.ts';
/** Cube layer convention: +X, -X, +Y, -Y, +Z, -Z, top-left texel origin. */
export function cubeDirection(
  face: number,
  u: number,
  v: number,
): readonly [number, number, number] {
  if (!Number.isInteger(face) || face < 0 || face > 5 || ![u, v].every(Number.isFinite))
    throw new RangeError('Invalid cube coordinate');
  const x = 2 * u - 1,
    y = 2 * v - 1;
  const d = [
    [1, -y, -x],
    [-1, -y, x],
    [x, 1, y],
    [x, -1, -y],
    [x, -y, 1],
    [-x, -y, -1],
  ][face]!;
  const length = Math.hypot(...d);
  return d.map((n) => n / length) as unknown as readonly [number, number, number];
}
export const environmentWGSL = chunk(
  'environment',
  `
fn cube_direction(face:u32,uv:vec2f)->vec3f {let p=uv*2.0-1.0;var d=vec3f(1,-p.y,-p.x);switch face {case 1u:{d=vec3f(-1,-p.y,p.x);}case 2u:{d=vec3f(p.x,1,p.y);}case 3u:{d=vec3f(p.x,-1,-p.y);}case 4u:{d=vec3f(p.x,-p.y,1);}case 5u:{d=vec3f(-p.x,-p.y,-1);}default:{}}return normalize(d);}
fn studio_radiance(d:vec3f)->vec3f {let sky=mix(vec3f(.025,.035,.055),vec3f(.25,.38,.58),smoothstep(-.2,1.0,d.y));let warm=pow(max(0.0,dot(d,normalize(vec3f(-.7,.6,.4)))),80.0)*vec3f(8,5.4,3);let cool=pow(max(0.0,dot(d,normalize(vec3f(.8,.2,-.6)))),45.0)*vec3f(1.5,3,6);let strip=exp(-pow((d.y-.45)*20.0,2.0))*smoothstep(.7,.85,d.z)*vec3f(3);return sky+warm+cool+strip;}
fn radical_inverse(i:u32)->f32 {return f32(reverseBits(i))*2.3283064365386963e-10;}
fn sample_basis(n:vec3f)->mat3x3f {let up=select(vec3f(0,1,0),vec3f(1,0,0),abs(n.y)>.99);let t=normalize(cross(up,n));return mat3x3f(t,cross(n,t),n);}
`,
);
/** Procedural HDR studio fixture, area-weighted source mips, GGX specular mips and cosine irradiance. */
export async function createEnvironment(session: DeviceSession, size = 64) {
  if (!Number.isInteger(size) || size < 8 || size > 256 || (size & (size - 1)) !== 0)
    throw new RangeError('Environment size must be a power of two in [8,256]');
  const device = session.device,
    levels = Math.log2(size) + 1,
    owned: GPUTexture[] = [],
    buffers: GPUBuffer[] = [],
    leases: { dispose(): void }[] = [];
  const texture = (label: string, extent: number, mipLevelCount: number) => {
    const t = device.createTexture({
      label,
      format: 'rgba16float',
      size: [extent, extent, 6],
      mipLevelCount,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });
    owned.push(t);
    return t;
  };
  try {
    const raw = texture('hgpu-environment-source', size, levels),
      specular = texture('hgpu-environment-ggx', size, levels),
      diffuse = texture('hgpu-environment-irradiance', 8, 1);
    const sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
    });
    const baseLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: {
            access: 'write-only',
            format: 'rgba16float',
            viewDimension: '2d-array',
          },
        },
      ],
    });
    const baseSource = compose(
      environmentWGSL,
      chunk(
        'environment-base',
        `@group(0) @binding(0) var output:texture_storage_2d_array<rgba16float,write>;@compute @workgroup_size(8,8,1) fn main(@builtin(global_invocation_id) id:vec3u){let size=textureDimensions(output);if(any(id.xy>=size)||id.z>=6u){return;}textureStore(output,vec2i(id.xy),i32(id.z),vec4f(studio_radiance(cube_direction(id.z,(vec2f(id.xy)+.5)/vec2f(size))),1));}`,
      ),
    );
    const base = await createComputePass(session, baseSource, 'environment-base', [baseLayout]);
    leases.push(base);
    const mipgen = await createMipGenerator(session);
    leases.push(mipgen);
    const filterLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { viewDimension: 'cube' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: {
            access: 'write-only',
            format: 'rgba16float',
            viewDimension: '2d-array',
          },
        },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    const filterSource = compose(
      environmentWGSL,
      chunk(
        'environment-prefilter',
        `
struct Filter {roughness:f32,diffuse:u32,pad:vec2f};
@group(0) @binding(0) var input:texture_cube<f32>;@group(0) @binding(1) var linearSampler:sampler;@group(0) @binding(2) var output:texture_storage_2d_array<rgba16float,write>;@group(0) @binding(3) var<uniform> settings:Filter;
@compute @workgroup_size(8,8,1) fn main(@builtin(global_invocation_id) id:vec3u){let extent=textureDimensions(output);if(any(id.xy>=extent)||id.z>=6u){return;}let n=cube_direction(id.z,(vec2f(id.xy)+.5)/vec2f(extent));let basis=sample_basis(n);var total=vec3f(0);var weight=0.0;
for(var i=0u;i<64u;i++){let xi=vec2f((f32(i)+.5)/64.0,radical_inverse(i));let phi=6.2831853*xi.x;var direction=vec3f(0);if(settings.diffuse==1u){let r=sqrt(xi.y);direction=basis*vec3f(r*cos(phi),r*sin(phi),sqrt(1.0-xi.y));}else{let a=max(.001,settings.roughness*settings.roughness);let cosTheta=sqrt((1.0-xi.y)/(1.0+(a*a-1.0)*xi.y));let h=basis*vec3f(sqrt(max(0.0,1.0-cosTheta*cosTheta))*cos(phi),sqrt(max(0.0,1.0-cosTheta*cosTheta))*sin(phi),cosTheta);direction=reflect(-n,h);}let w=select(max(0.0,dot(n,direction)),1.0,settings.diffuse==1u);total+=textureSampleLevel(input,linearSampler,direction,0.0).rgb*w;weight+=w;}textureStore(output,vec2i(id.xy),i32(id.z),vec4f(total/max(weight,.001)*select(1.0,3.14159265,settings.diffuse==1u),1));}`,
      ),
    );
    const filter = await createComputePass(session, filterSource, 'environment-prefilter', [
      filterLayout,
    ]);
    leases.push(filter);
    const baseGroup = device.createBindGroup({
      layout: baseLayout,
      entries: [
        { binding: 0, resource: raw.createView({ dimension: '2d-array', mipLevelCount: 1 }) },
      ],
    });
    const jobs = Array.from({ length: levels + 1 }, (_, i) => {
      const irradiance = i === levels,
        roughness = irradiance ? 1 : i / (levels - 1),
        buffer = device.createBuffer({
          label: `environment-roughness-${i}`,
          size: 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
      buffers.push(buffer);
      const data = new ArrayBuffer(16);
      new Float32Array(data)[0] = roughness;
      new Uint32Array(data)[1] = irradiance ? 1 : 0;
      device.queue.writeBuffer(buffer, 0, data);
      return {
        extent: irradiance ? 8 : Math.max(1, size >> i),
        group: device.createBindGroup({
          layout: filterLayout,
          entries: [
            { binding: 0, resource: raw.createView({ dimension: 'cube' }) },
            { binding: 1, resource: sampler },
            {
              binding: 2,
              resource: (irradiance ? diffuse : specular).createView({
                dimension: '2d-array',
                baseMipLevel: irradiance ? 0 : i,
                mipLevelCount: 1,
              }),
            },
            { binding: 3, resource: { buffer } },
          ],
        }),
      };
    });
    let initial = true,
      disposed = false;
    const tap = (t: GPUTexture, layer: number, level: number, label: string): TextureTap => ({
      texture: t,
      format: 'rgba16float',
      width: Math.max(1, t.width >> level),
      height: Math.max(1, t.height >> level),
      mipLevel: level,
      arrayLayer: layer,
      kind: 'float',
      label,
    });
    return {
      specular: specular.createView({ dimension: 'cube' }),
      diffuse: diffuse.createView({ dimension: 'cube' }),
      sampler,
      levels,
      encode(encoder: GPUCommandEncoder) {
        if (disposed) throw new Error('Environment disposed');
        if (!initial) return;
        base.dispatch(encoder, [baseGroup], [size / 8, size / 8, 6]);
        mipgen.encode(encoder, raw);
        for (const job of jobs)
          filter.dispatch(
            encoder,
            [job.group],
            [Math.ceil(job.extent / 8), Math.ceil(job.extent / 8), 6],
          );
        initial = false;
      },
      textureTaps() {
        const taps: Record<string, TextureTap> = {};
        for (let layer = 0; layer < 6; layer++) {
          taps[`environment-face-${layer}`] = tap(raw, layer, 0, 'Unfiltered HDR source cube face');
          taps[`irradiance-face-${layer}`] = tap(
            diffuse,
            layer,
            0,
            'Cosine-weighted diffuse irradiance',
          );
          for (let level = 0; level < levels; level++)
            taps[`specular-${layer}-mip-${level}`] = tap(
              specular,
              layer,
              level,
              `GGX roughness ${level / (levels - 1)}`,
            );
        }
        return taps;
      },
      memory: () => ({
        textureBytes: disposed
          ? 0
          : 2 *
              6 *
              8 *
              Array.from({ length: levels }, (_, i) => (size >> i) ** 2).reduce(
                (a, b) => a + b,
                0,
              ) +
            8 * 8 * 6 * 8,
        bufferBytes: disposed ? 0 : buffers.length * 16,
      }),
      sources: { base: base.source, ...mipgen.sources, prefilter: filter.source },
      diagnostics: [...base.diagnostics, ...mipgen.diagnostics, ...filter.diagnostics],
      dispose() {
        if (disposed) return;
        disposed = true;
        owned.forEach((t) => t.destroy());
        buffers.forEach((b) => b.destroy());
        leases.forEach((l) => l.dispose());
      },
    };
  } catch (error) {
    owned.forEach((t) => t.destroy());
    buffers.forEach((b) => b.destroy());
    leases.reverse().forEach((l) => l.dispose());
    throw error;
  }
}
