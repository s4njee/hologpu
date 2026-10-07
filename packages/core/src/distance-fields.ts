import { createComputePass, type ComputePass } from './compute.ts';
import { chunk, compose } from './wgsl/composer.ts';
import type { DeviceSession } from './device.ts';
import type { TextureTap } from './effect.ts';

/** Pixel-space JFA+1. Inputs are borrowed; taps live until disposal. Encode once per submission: the helper reuses its output and uniform storage. */
export async function createJumpFlood(session: DeviceSession, size: readonly [number, number]) {
  let [width, height] = size;
  const device = session.device;
  if (
    ![width, height].every(
      (n) => Number.isInteger(n) && n > 0 && n <= device.limits.maxTextureDimension2D,
    )
  )
    throw new RangeError('Jump flood dimensions exceed texture limits');
  const textures: GPUTexture[] = [],
    buffers: GPUBuffer[] = [],
    passes: ComputePass[] = [];
  let disposed = false;
  const texture = (format: GPUTextureFormat, label: string) => {
    const t = device.createTexture({
      label,
      size: [width, height],
      format,
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });
    textures.push(t);
    return t;
  };
  let seeds = [texture('rg32float', 'jfa-seeds-a'), texture('rg32float', 'jfa-seeds-b')];
  let distance = texture('r32float', 'jfa-distance');
  const configs = new Map<string, GPUBuffer>();
  const config = (stride: number, threshold: number, boundary: boolean) => {
    const key = `${stride}:${boundary}`;
    let b = configs.get(key);
    if (!b) {
      b = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(b, 0, new Float32Array([stride, threshold, boundary ? 1 : 0, 0]));
      configs.set(key, b);
      buffers.push(b);
    }
    device.queue.writeBuffer(b, 0, new Float32Array([stride, threshold, boundary ? 1 : 0, 0]));
    return b;
  };
  const base = `struct Config { stride:f32, threshold:f32, boundary:f32, pad:f32 }; @group(0) @binding(2) var<uniform> cfg:Config;`;
  const mask = `fn occupied(p:vec2i)->bool { let n=vec2i(textureDimensions(input)); if(any(p<vec2i(0))||any(p>=n)){return false;} return textureLoad(input,p,0).a>=cfg.threshold; }`;
  const init = `@group(0) @binding(0) var input:texture_2d<f32>; @group(0) @binding(1) var output:texture_storage_2d<rg32float,write>; ${base} ${mask}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){let n=textureDimensions(output);if(any(id.xy>=n)){return;}let p=vec2i(id.xy);let yes=occupied(p);var edge=yes;
if(cfg.boundary>0.5){edge=false;for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){if(occupied(p+vec2i(x,y))!=yes){edge=true;}}}}
textureStore(output,p,vec4f(select(vec2f(-1.0),vec2f(p),edge),0.0,0.0));}`;
  const jump = `@group(0) @binding(0) var input:texture_2d<f32>; @group(0) @binding(1) var output:texture_storage_2d<rg32float,write>; ${base}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){let n=vec2i(textureDimensions(output));let p=vec2i(id.xy);if(any(p>=n)){return;}var best=vec2f(-1.0);var d=1e30;let step=i32(cfg.stride);
for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){let q=p+vec2i(x,y)*step;if(any(q<vec2i(0))||any(q>=n)){continue;}let s=textureLoad(input,q,0).xy;if(s.x<0.0){continue;}let delta=s-vec2f(p);let ds=dot(delta,delta);let tie=ds==d&&(s.y<best.y||(s.y==best.y&&s.x<best.x));if(ds<d||tie){best=s;d=ds;}}}textureStore(output,p,vec4f(best,0.0,0.0));}`;
  const finish = `@group(0) @binding(0) var input:texture_2d<f32>; @group(0) @binding(1) var output:texture_storage_2d<r32float,write>; ${base} @group(0) @binding(3) var nearest:texture_2d<f32>; ${mask}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){let n=textureDimensions(output);if(any(id.xy>=n)){return;}let p=vec2i(id.xy);let seed=textureLoad(nearest,p,0).xy;var d=length(vec2f(n));if(seed.x>=0.0){d=length(seed-vec2f(p));}d=select(d,-d,occupied(p));textureStore(output,p,vec4f(d,0.0,0.0,1.0));}`;
  try {
    for (const [label, code, format, extra] of [
      ['seed', init, 'rg32float', false],
      ['jump', jump, 'rg32float', false],
      ['distance', finish, 'r32float', true],
    ] as const) {
      const entries: GPUBindGroupLayoutEntry[] = [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: 'unfilterable-float' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format },
        },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ];
      if (extra)
        entries.push({
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: 'unfilterable-float' },
        });
      const layout = device.createBindGroupLayout({ entries });
      passes.push(
        await createComputePass(session, compose(chunk(`jfa:${label}`, code)), `jfa-${label}`, [
          layout,
        ]),
      );
    }
  } catch (error) {
    passes.forEach((p) => p.dispose());
    textures.forEach((t) => t.destroy());
    throw error;
  }
  let strides: number[] = [],
    nearest = seeds[0]!;
  const refresh = () => {
    strides = [];
    for (
      let s = 2 ** Math.max(0, Math.ceil(Math.log2(Math.max(width, height))) - 1);
      s >= 1;
      s /= 2
    )
      strides.push(s);
    strides.push(1);
    nearest = seeds[strides.length % 2]!;
  };
  refresh();
  const tap = (t: GPUTexture, format: GPUTextureFormat, label: string): TextureTap => ({
    texture: t,
    format,
    width,
    height,
    label,
    kind: 'float',
  });
  return {
    encode(
      encoder: GPUCommandEncoder,
      input: TextureTap,
      options: { threshold?: number; boundary?: boolean } = {},
    ) {
      if (disposed) throw new Error('Jump flood is disposed');
      const threshold = options.threshold ?? 0.5,
        boundary = options.boundary ?? true;
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
        throw new RangeError('Mask threshold must be in [0,1]');
      if (
        input.width !== width ||
        input.height !== height ||
        input.kind !== 'float' ||
        !(input.texture.usage & GPUTextureUsage.TEXTURE_BINDING) ||
        textures.includes(input.texture) ||
        input.texture.dimension !== '2d' ||
        /depth|stencil|uint|sint/.test(input.format) ||
        !Number.isInteger(input.mipLevel ?? 0) ||
        (input.mipLevel ?? 0) < 0 ||
        (input.mipLevel ?? 0) >= input.texture.mipLevelCount ||
        !Number.isInteger(input.arrayLayer ?? 0) ||
        (input.arrayLayer ?? 0) < 0 ||
        (input.arrayLayer ?? 0) >= input.texture.depthOrArrayLayers ||
        Math.max(1, input.texture.width >> (input.mipLevel ?? 0)) !== width ||
        Math.max(1, input.texture.height >> (input.mipLevel ?? 0)) !== height
      )
        throw new RangeError('Jump flood requires a distinct, equal-sized sampled float mask');
      const dispatch = (
        pass: ComputePass,
        src: GPUTexture,
        dst: GPUTexture,
        stride: number,
        extra?: GPUTexture,
      ) => {
        const entries: GPUBindGroupEntry[] = [
          {
            binding: 0,
            resource: src.createView({
              baseMipLevel: input.texture === src ? (input.mipLevel ?? 0) : 0,
              mipLevelCount: 1,
              dimension: '2d',
              baseArrayLayer: input.texture === src ? (input.arrayLayer ?? 0) : 0,
              arrayLayerCount: 1,
            }),
          },
          { binding: 1, resource: dst.createView() },
          { binding: 2, resource: { buffer: config(stride, threshold, boundary) } },
        ];
        if (extra) entries.push({ binding: 3, resource: extra.createView() });
        pass.dispatch(
          encoder,
          [device.createBindGroup({ layout: pass.pipeline.getBindGroupLayout(0), entries })],
          [Math.ceil(width / 8), Math.ceil(height / 8)],
        );
      };
      dispatch(passes[0]!, input.texture, seeds[0]!, 0);
      let current = 0;
      for (const stride of strides) {
        dispatch(passes[1]!, seeds[current]!, seeds[1 - current]!, stride);
        current = 1 - current;
      }
      dispatch(passes[2]!, input.texture, distance, 0, nearest);
      return {
        nearest: tap(nearest, 'rg32float', 'Nearest boundary seed'),
        distance: tap(distance, 'r32float', 'Signed pixel distance'),
      };
    },
    get nearest() {
      return tap(nearest, 'rg32float', 'Nearest boundary seed');
    },
    get distance() {
      return tap(distance, 'r32float', 'Signed pixel distance');
    },
    resize(next: readonly [number, number]) {
      if (disposed) throw new Error('Jump flood is disposed');
      if (
        !next.every((n) => Number.isInteger(n) && n > 0 && n <= device.limits.maxTextureDimension2D)
      )
        throw new RangeError('Jump flood dimensions exceed texture limits');
      if (next[0] === width && next[1] === height) return;
      textures.forEach((t) => t.destroy());
      textures.length = 0;
      [width, height] = next;
      seeds = [texture('rg32float', 'jfa-seeds-a'), texture('rg32float', 'jfa-seeds-b')];
      distance = texture('r32float', 'jfa-distance');
      refresh();
    },
    get sources() {
      return Object.fromEntries(passes.map((p, i) => [['seed', 'jump', 'distance'][i]!, p.source]));
    },
    get diagnostics() {
      return passes.flatMap((p) => p.diagnostics);
    },
    memory() {
      return disposed
        ? { textureBytes: 0, bufferBytes: 0 }
        : {
            textureBytes: width * height * 20,
            bufferBytes: buffers.reduce((n, b) => n + b.size, 0),
          };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      passes.forEach((p) => p.dispose());
      textures.forEach((t) => t.destroy());
      buffers.forEach((b) => b.destroy());
    },
  };
}
