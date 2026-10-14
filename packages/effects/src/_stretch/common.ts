import {
  createComputePass,
  simulationSource,
  simulationUniformLayout,
  hash,
  createParticleDraw,
  createSimulationDisplay,
  type EffectContext,
  type ParamSchema,
  type ComputePass,
  type BufferTap,
} from '@mk7s/hologpu-core';
export const f = (
  value: number,
  min: number,
  max: number,
  description: string,
  group = 'Simulation',
) => ({ type: 'f32' as const, default: value, min, max, step: 0.01, description, group });
export const u = (
  value: number,
  min: number,
  max: number,
  description: string,
  group = 'Workload',
  allocation = false,
) => ({
  type: 'u32' as const,
  default: value,
  min,
  max,
  step: 1,
  description,
  group,
  ...(allocation ? { uniform: false } : {}),
});
export const tint = {
  type: 'color',
  default: '#4cc2e8',
  group: 'Display',
  description: 'Linearized surface colour.',
} as const;
export function buffer(ctx: EffectContext, bytes: number, label: string) {
  if (bytes > ctx.device.limits.maxStorageBufferBindingSize)
    throw new RangeError('Stretch storage exceeds device limits');
  return ctx.device.createBuffer({
    label,
    size: bytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
}
export function layout(
  ctx: EffectContext,
  kinds: readonly GPUBufferBindingType[],
  visibility = GPUShaderStage.COMPUTE,
) {
  return ctx.device.createBindGroupLayout({
    entries: kinds.map((type, binding) => ({ binding, visibility, buffer: { type } })),
  });
}
export function group(ctx: EffectContext, l: GPUBindGroupLayout, buffers: readonly GPUBuffer[]) {
  return ctx.device.createBindGroup({
    layout: l,
    entries: buffers.map((b, binding) => ({ binding, resource: { buffer: b } })),
  });
}
/** All stages share the contract's immutable per-fixed-step snapshot at group zero. */
export async function kernels<S extends ParamSchema>(
  ctx: EffectContext<S>,
  id: string,
  l: GPUBindGroupLayout,
  code: Record<string, string>,
  declarations = '',
) {
  const passes: Record<string, ComputePass> = {};
  try {
    for (const [name, body] of Object.entries(code)) {
      passes[name] = await createComputePass(
        ctx.session,
        simulationSource(ctx.params.schema, declarations + body, [hash]),
        `${id}-${name}`,
        [simulationUniformLayout(ctx.device), l],
      );
    }
    return {
      passes,
      sources: Object.fromEntries(Object.entries(passes).map(([n, p]) => [n, p.source])),
      diagnostics: Object.values(passes).flatMap((p) => p.diagnostics),
      dispose() {
        Object.values(passes).forEach((p) => p.dispose());
      },
    };
  } catch (error) {
    Object.values(passes).forEach((p) => p.dispose());
    throw error;
  }
}
export const tap = (b: GPUBuffer, count: number, stride: number, label: string): BufferTap => ({
  buffer: b,
  count,
  stride,
  label,
});
/** Density splats feed a screen-space water surface, rather than drawing opaque particle discs. */
export async function surface<S extends ParamSchema>(
  ctx: EffectContext<S>,
  id: string,
  declarations: string,
  position: string,
) {
  const l = layout(ctx, ['read-only-storage'], GPUShaderStage.VERTEX);
  const source = simulationSource(
    ctx.params.schema,
    declarations +
      `
@group(1) @binding(0) var<storage,read> particles:array<Particle>;
struct Out{@builtin(position) position:vec4f,@location(0) local:vec2f};
@vertex fn particleVertex(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Out {
 let corners=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
 let local=corners[vertex];let p=${position}; var out:Out;
 let r=vec2f(params.radius,params.radius*frame.resolution.x/frame.resolution.y);
 out.position=vec4f((p+local*r)*vec2f(2,-2)+vec2f(-1,1),0,1);out.local=local;return out;
}
@fragment fn particleFragment(in:Out)->@location(0)vec4f {let r=dot(in.local,in.local);if(r>1){discard;}let d=exp(-r*4.0);return vec4f(d,d,d,d);}`,
  );
  const tl = ctx.device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float' },
      },
    ],
  });
  const displaySource = simulationSource(
    ctx.params.schema,
    `
@group(1) @binding(0) var density:texture_2d<f32>;
@fragment fn fragment(in:VertexOut)->@location(0)vec4f {
 let texel=1.0/vec2f(textureDimensions(density));let d=sample_bilinear(density,in.uv).r;
 let dx=sample_bilinear(density,in.uv+vec2f(texel.x,0)).r-sample_bilinear(density,in.uv-vec2f(texel.x,0)).r;
 let dy=sample_bilinear(density,in.uv+vec2f(0,texel.y)).r-sample_bilinear(density,in.uv-vec2f(0,texel.y)).r;
 let n=normalize(vec3f(-dx,-dy,.8));let light=.3+.7*max(0.0,dot(n,normalize(vec3f(-.4,-.6,1))));
 let a=smoothstep(.12,.6,d);let c=params.tint.rgb*light+vec3f(pow(max(n.z,0.0),32.0)*.15);
 return vec4f(mix(vec3f(.008,.014,.025),c,a),1);
}`,
  );
  const leases: { dispose(): void }[] = [];
  let texture: GPUTexture | undefined,
    width = 0,
    height = 0;
  try {
    const draw = await createParticleDraw(ctx.session, source, {
      label: `${id}-density`,
      format: 'rgba16float',
      layouts: [simulationUniformLayout(ctx.device), l],
      mode: 'quad',
      additive: true,
    });
    leases.push(draw);
    const display = await createSimulationDisplay(
      ctx.session,
      displaySource,
      ctx.format,
      `${id}-surface`,
      [simulationUniformLayout(ctx.device), tl],
    );
    leases.push(display);
    return {
      resize(size: readonly [number, number]) {
        if (width === size[0] && height === size[1]) return;
        texture?.destroy();
        [width, height] = size;
        texture = ctx.device.createTexture({
          label: `${id}-density`,
          format: 'rgba16float',
          size: [width, height],
          usage:
            GPUTextureUsage.RENDER_ATTACHMENT |
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_SRC,
        });
      },
      draw(
        encoder: GPUCommandEncoder,
        target: GPUTextureView,
        uniform: GPUBindGroup,
        state: GPUBuffer,
        count: number,
      ) {
        draw.draw(encoder, texture!.createView(), [uniform, group(ctx, l, [state])], count);
        display.draw(encoder, target, [
          uniform,
          ctx.device.createBindGroup({
            layout: tl,
            entries: [{ binding: 0, resource: texture!.createView() }],
          }),
        ]);
      },
      textureTaps() {
        return {
          density: {
            texture: texture!,
            format: 'rgba16float' as const,
            width,
            height,
            kind: 'float' as const,
            label: 'Additive Gaussian particle thickness',
          },
        };
      },
      get bytes() {
        return width * height * 8;
      },
      sources: { density: draw.source, surface: display.source },
      diagnostics: [...draw.diagnostics, ...display.diagnostics],
      dispose() {
        texture?.destroy();
        leases.forEach((p) => p.dispose());
      },
    };
  } catch (error) {
    texture?.destroy();
    leases.forEach((p) => p.dispose());
    throw error;
  }
}
