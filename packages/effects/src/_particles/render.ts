import {
  createPingPongTargets,
  createComputePass,
  createParticleDraw,
  createSimulationDisplay,
  simulationSource,
  simulationUniformLayout,
  type EffectContext,
  type ParamSchema,
  type ComposedWGSL,
} from '@mk7s/hologpu-core';
/** rgba16float trail accumulation followed by an explicit exposure/Reinhard presentation pass. */
export async function particlePresentation<S extends ParamSchema>(
  ctx: EffectContext<S>,
  id: string,
  point: ComposedWGSL,
  quad: ComposedWGSL,
  drawLayout: GPUBindGroupLayout,
) {
  const device = ctx.device,
    uniforms = simulationUniformLayout(device);
  const trail = createPingPongTargets(ctx.session, {
    label: `${id}-hdr`,
    size: [1, 1],
    format: 'rgba16float',
  });
  const decayLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: 'write-only', format: 'rgba16float' },
      },
    ],
  });
  const displayLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float' },
      },
    ],
  });
  const decaySource = simulationSource(
    ctx.params.schema,
    `@group(1) @binding(0) var previous:texture_2d<f32>;@group(1) @binding(1) var next:texture_storage_2d<rgba16float,write>;@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){if(any(id.xy>=textureDimensions(next))){return;}let c=textureLoad(previous,vec2i(id.xy),0);textureStore(next,vec2i(id.xy),vec4f(min(c.rgb*params.trail,vec3f(50000)),1));}`,
  );
  const displaySource = simulationSource(
    ctx.params.schema,
    `@group(1) @binding(0) var hdr:texture_2d<f32>;@fragment fn fragment(in:VertexOut)->@location(0)vec4f{let c=max(sample_bilinear(hdr,in.uv).rgb*params.exposure,vec3f(0));let mapped=c/(vec3f(1)+c);return vec4f(mix(params.background.rgb,vec3f(1),mapped),1);}`,
  );
  const leases: { dispose(): void }[] = [];
  try {
    const decay = await createComputePass(ctx.session, decaySource, `${id}-trail-decay`, [
      uniforms,
      decayLayout,
    ]);
    leases.push(decay);
    const resolve = await createSimulationDisplay(
      ctx.session,
      displaySource,
      ctx.format,
      `${id}-tone-map`,
      [uniforms, displayLayout],
    );
    leases.push(resolve);
    const points = await createParticleDraw(ctx.session, point, {
      label: `${id}-points`,
      format: 'rgba16float',
      layouts: [uniforms, drawLayout],
      mode: 'point',
      additive: true,
    });
    leases.push(points);
    const quads = await createParticleDraw(ctx.session, quad, {
      label: `${id}-quads`,
      format: 'rgba16float',
      layouts: [uniforms, drawLayout],
      mode: 'quad',
      additive: true,
    });
    leases.push(quads);
    // Only parameters actually referenced by the compiled particle shaders invalidate the
    // baked HDR colour/geometry. Exposure/background resolve without clearing, and trail
    // retention changes apply on the next simulation tick. Include edited shader sources.
    const presentationKeys = [
      ...new Set(
        [
          ...`${points.source.code}\n${quads.source.code}`.matchAll(
            /\bparams\.([A-Za-z][A-Za-z0-9_]*)/g,
          ),
        ].map((match) => match[1]!),
      ),
    ]
      .filter((key) => key in ctx.params.schema)
      .sort();
    let lastSignature: string | undefined;
    let lastIndex: number | undefined;
    let decayGroups: GPUBindGroup[] = [],
      displays: GPUBindGroup[] = [],
      side = 0,
      clear = true;
    function bind() {
      side = 0;
      decayGroups = [0, 1].map(() => {
        const g = device.createBindGroup({
          layout: decayLayout,
          entries: [
            { binding: 0, resource: trail.read.createView() },
            { binding: 1, resource: trail.write.createView() },
          ],
        });
        trail.swap();
        return g;
      });
      displays = [0, 1].map(() => {
        const g = device.createBindGroup({
          layout: displayLayout,
          entries: [{ binding: 0, resource: trail.read.createView() }],
        });
        trail.swap();
        return g;
      });
    }
    return {
      resize(size: readonly [number, number]) {
        if (trail.resize(size)) {
          bind();
          clear = true;
        }
      },
      reset() {
        clear = true;
      },
      draw(
        encoder: GPUCommandEncoder,
        target: GPUTextureView,
        uniform: GPUBindGroup,
        group: GPUBindGroup,
        count: number,
        mode: 'point' | 'quad',
        frameIndex: number,
        indirect?: GPUBuffer,
      ) {
        if (!decayGroups.length) bind();
        const signature = JSON.stringify([
          mode,
          ...presentationKeys.map((key) => ctx.params.values[key]),
        ]);
        if (lastSignature !== undefined && signature !== lastSignature) clear = true;
        if (clear || lastIndex !== frameIndex) {
          if (!clear) {
            decay.dispatch(
              encoder,
              [uniform, decayGroups[side]!],
              [Math.ceil(trail.size[0] / 8), Math.ceil(trail.size[1] / 8)],
            );
            trail.swap();
            side = 1 - side;
          }
          (mode === 'point' ? points : quads).draw(
            encoder,
            trail.read.createView(),
            [uniform, group],
            count,
            indirect,
            !clear,
          );
          clear = false;
          lastIndex = frameIndex;
          lastSignature = signature;
        }
        resolve.draw(encoder, target, [uniform, displays[side]!]);
      },
      textureTaps() {
        return {
          hdr: {
            texture: trail.read,
            format: 'rgba16float' as const,
            width: trail.size[0],
            height: trail.size[1],
            kind: 'float' as const,
            label: 'Linear additive HDR accumulation',
          },
        };
      },
      get bytes() {
        return trail.bytes;
      },
      sources: { points: point, quads: quad, decay: decaySource, toneMap: displaySource },
      diagnostics: leases.flatMap((l) => (l as typeof decay).diagnostics ?? []),
      dispose() {
        trail.dispose();
        leases.forEach((l) => l.dispose());
      },
    };
  } catch (error) {
    trail.dispose();
    leases.reverse().forEach((l) => l.dispose());
    throw error;
  }
}
