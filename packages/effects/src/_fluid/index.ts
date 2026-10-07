import {
  createComputePass,
  createSimulationDisplay,
  createPingPongTargets,
  simulationSource,
  simulationUniformLayout,
  hash,
  UniformSnapshots,
} from '@mk7s/hologpu-core';
import type {
  EffectContext,
  FeedbackProgram,
  ParamSchema,
  ComputePass,
  PingPongTargets,
  TextureTap,
  FrameInfo,
  ShaderDiagnostic,
  ComposedWGSL,
} from '@mk7s/hologpu-core';
import { computeShader, displayShader, storageFormat } from './shaders.ts';
import type { FluidKind } from './shaders.ts';
const deviceLayouts = new WeakMap<
  GPUDevice,
  {
    rgba: GPUBindGroupLayout;
    material: GPUBindGroupLayout;
    scalar: GPUBindGroupLayout;
    display: GPUBindGroupLayout;
  }
>();
/** All three material models share exactly the same staggered-grid velocity solve. */
export async function createFluidProgram<S extends ParamSchema>(
  ctx: EffectContext<S>,
  kind: FluidKind,
  schema: S,
): Promise<FeedbackProgram> {
  const device = ctx.device;
  const uniformLayout = simulationUniformLayout(device);
  const computeLayout = (format: GPUTextureFormat) =>
    device.createBindGroupLayout({
      label: `hgpu-${kind}-${format}-state`,
      entries: [
        ...[0, 1, 2, 3].map((binding) => ({
          binding,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: 'unfilterable-float' as const },
        })),
        {
          binding: 4,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format },
        },
      ],
    });
  let sharedLayouts = deviceLayouts.get(device);
  if (!sharedLayouts) {
    const rgbaLayout = computeLayout('rgba16float');
    const scalarLayout = computeLayout('r32float');
    const materialLayout = computeLayout('rgba32float');
    const displayLayout = device.createBindGroupLayout({
      label: `hgpu-${kind}-display-state`,
      entries: [0, 1, 2, 3, 4, 5].map((binding) => ({
        binding,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float' as const },
      })),
    });
    sharedLayouts = {
      rgba: rgbaLayout,
      material: materialLayout,
      scalar: scalarLayout,
      display: displayLayout,
    };
    deviceLayouts.set(device, sharedLayouts);
  }
  const {
    rgba: rgbaLayout,
    material: materialLayout,
    scalar: scalarLayout,
    display: displayLayout,
  } = sharedLayouts;
  const layoutFor = (name: string) =>
    storageFormat(kind, name) === 'r32float'
      ? scalarLayout
      : storageFormat(kind, name) === 'rgba32float'
        ? materialLayout
        : rgbaLayout;
  const names = [
    'initVelocity',
    'initMaterial',
    'zero',
    'zeroRgba',
    'advectVelocity',
    'copy',
    'diffuse',
    'curl',
    'force',
    'divergence',
    'pressure',
    'project',
    'advectMaterial',
    ...(kind === 'ink' ? ['zeroMaterial', 'deposit', 'absorb'] : []),
    ...(kind === 'smoke' ? ['shadow'] : []),
  ];
  const passes: Record<string, ComputePass> = {};
  const sources: Record<string, ComposedWGSL> = {};
  const diagnostics: ShaderDiagnostic[] = [];
  let display: Awaited<ReturnType<typeof createSimulationDisplay>>;
  try {
    for (const name of names) {
      const source = simulationSource(schema, computeShader(kind, name), [hash]);
      const pass = await createComputePass(ctx.session, source, `hgpu-${kind}-${name}`, [
        uniformLayout,
        layoutFor(name),
      ]);
      passes[name] = pass;
      sources[name] = source;
      diagnostics.push(...pass.diagnostics);
    }
    const source = simulationSource(schema, displayShader(kind), [hash]);
    display = await createSimulationDisplay(
      ctx.session,
      source,
      ctx.format,
      `hgpu-${kind}-display`,
      [uniformLayout, displayLayout],
    );
    sources.display = source;
    diagnostics.push(...display.diagnostics);
  } catch (error) {
    Object.values(passes).forEach((pass) => pass.dispose());
    throw error;
  }
  const pairs: Record<string, PingPongTargets> = {};
  const single: Record<string, GPUTexture> = {};
  const formats: Record<string, GPUTextureFormat> = {
    velocity: 'rgba16float',
    dye: kind === 'ink' ? 'rgba32float' : 'rgba16float',
    pressure: 'r32float',
    curl: 'r32float',
    divergence: 'r32float',
    projectedDivergence: 'r32float',
    diffusionRhs: 'rgba16float',
    ...(kind === 'ink' ? { paper: 'rgba32float' } : {}),
    ...(kind === 'smoke' ? { shadow: 'r32float' } : {}),
  };
  let size: readonly [number, number] = [0, 0];
  let neutral: GPUTexture;
  let neutralCreated = false;
  let shadowSnapshots: UniformSnapshots | undefined;
  try {
    neutral = device.createTexture({
      label: `hgpu-${kind}-unused`,
      size: [1, 1],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    neutralCreated = true;
    if (kind === 'smoke')
      shadowSnapshots = new UniformSnapshots(
        device,
        ctx.params.layout.byteLength,
        'hgpu-smoke-shadow-quality',
      );
  } catch (error) {
    Object.values(passes).forEach((pass) => pass.dispose());
    display.dispose();
    if (neutralCreated) neutral!.destroy();
    throw error;
  }
  // Spec guarantees newly-created texture contents are zero before their first observable use.
  const textureIds = new WeakMap<GPUTexture, number>();
  let nextTextureId = 0;
  let groups = new Map<string, GPUBindGroup>();
  const texId = (texture: GPUTexture) => {
    if (!textureIds.has(texture)) textureIds.set(texture, ++nextTextureId);
    return textureIds.get(texture)!;
  };
  const tex = (name: string) => pairs[name]?.read ?? single[name] ?? neutral;
  const group = (name: string, inputs: readonly GPUTexture[], output: GPUTexture) => {
    const key = `${storageFormat(kind, name)}:${[...inputs, output].map(texId).join(',')}`;
    let result = groups.get(key);
    if (!result) {
      result = device.createBindGroup({
        label: `hgpu-${kind}-${name}`,
        layout: layoutFor(name),
        entries: [...inputs, output].map((texture, binding) => ({
          binding,
          resource: texture.createView(),
        })),
      });
      groups.set(key, result);
    }
    return result;
  };
  const dispatch = (
    name: string,
    encoder: GPUCommandEncoder,
    uniforms: GPUBindGroup,
    output: GPUTexture,
    src = neutral,
    vel = neutral,
    aux = neutral,
    material = neutral,
  ) =>
    passes[name]!.dispatch(
      encoder,
      [uniforms, group(name, [src, vel, aux, material], output)],
      [Math.ceil(size[0] / 8), Math.ceil(size[1] / 8)],
    );
  function resize(next: readonly [number, number]) {
    const grid = Math.min(Number(ctx.params.values.grid), device.limits.maxTextureDimension2D);
    const longest = Math.max(next[0], next[1], 1);
    const actual: readonly [number, number] = [
      Math.max(8, Math.round((grid * next[0]) / longest)),
      Math.max(8, Math.round((grid * next[1]) / longest)),
    ];
    if (actual[0] === size[0] && actual[1] === size[1]) return false;
    for (const pair of Object.values(pairs)) pair.dispose();
    for (const texture of Object.values(single)) texture.destroy();
    for (const name of Object.keys(pairs)) delete pairs[name];
    for (const name of Object.keys(single)) delete single[name];
    groups = new Map();
    size = actual;
    for (const [name, format] of Object.entries(formats)) {
      if (['velocity', 'dye', 'pressure', 'paper'].includes(name))
        pairs[name] = createPingPongTargets(ctx.session, {
          label: `hgpu-${kind}-${name}`,
          format,
          size,
        });
      else
        single[name] = device.createTexture({
          label: `hgpu-${kind}-${name}`,
          format,
          size: [...size],
          usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.STORAGE_BINDING |
            GPUTextureUsage.COPY_SRC |
            GPUTextureUsage.COPY_DST,
        });
    }
    return true;
  }
  function initialize(encoder: GPUCommandEncoder, frame: FrameInfo, uniforms: GPUBindGroup) {
    // Allocation controls resize before any state pass is encoded. In particular, never
    // destroy an old grid after initialize has already referenced it in this encoder.
    resize(frame.resolution);
    for (const [name, pair] of Object.entries(pairs)) {
      const passName =
        name === 'velocity'
          ? 'initVelocity'
          : name === 'dye'
            ? 'initMaterial'
            : pair.format === 'r32float'
              ? 'zero'
              : pair.format === 'rgba32float'
                ? 'zeroMaterial'
                : 'zeroRgba';
      dispatch(passName, encoder, uniforms, pair.read);
      dispatch(passName, encoder, uniforms, pair.write);
    }
    for (const [name, texture] of Object.entries(single))
      dispatch(formats[name] === 'r32float' ? 'zero' : 'zeroRgba', encoder, uniforms, texture);
    dispatch('curl', encoder, uniforms, tex('curl'), neutral, tex('velocity'));
    dispatch('divergence', encoder, uniforms, tex('divergence'), neutral, tex('velocity'));
    dispatch('divergence', encoder, uniforms, tex('projectedDivergence'), neutral, tex('velocity'));
    if (kind === 'smoke')
      dispatch('shadow', encoder, uniforms, tex('shadow'), neutral, neutral, neutral, tex('dye'));
  }
  const offsets = Object.fromEntries(
    ctx.params.layout.fields.map((field) => [field.name, field.offset]),
  );
  const packedNumber = (params: ArrayBuffer, name: string, integer = false) =>
    integer
      ? new DataView(params).getUint32(offsets[name]!, true)
      : new DataView(params).getFloat32(offsets[name]!, true);
  let displayGroup: GPUBindGroup | undefined;
  let displayKey = '';
  return {
    resize,
    initialize,
    step(encoder, frame, uniforms, params) {
      const velocity = pairs.velocity!;
      const dye = pairs.dye!;
      const pressure = pairs.pressure!;
      dispatch('advectVelocity', encoder, uniforms, velocity.write, neutral, velocity.read);
      velocity.swap();
      if (packedNumber(params, 'viscosity') > 0) {
        dispatch('copy', encoder, uniforms, tex('diffusionRhs'), velocity.read);
        for (let i = 0; i < 4; i++) {
          dispatch(
            'diffuse',
            encoder,
            uniforms,
            velocity.write,
            velocity.read,
            neutral,
            tex('diffusionRhs'),
          );
          velocity.swap();
        }
      }
      dispatch('curl', encoder, uniforms, tex('curl'), neutral, velocity.read);
      dispatch(
        'force',
        encoder,
        uniforms,
        velocity.write,
        neutral,
        velocity.read,
        tex('curl'),
        dye.read,
      );
      velocity.swap();
      dispatch('divergence', encoder, uniforms, tex('divergence'), neutral, velocity.read);
      const iterations = Math.max(
        2,
        Math.round(packedNumber(params, 'iterations', true) * ctx.qualitySteps()),
      );
      for (let i = 0; i < iterations; i++) {
        dispatch(
          'pressure',
          encoder,
          uniforms,
          pressure.write,
          pressure.read,
          neutral,
          tex('divergence'),
        );
        pressure.swap();
      }
      dispatch('project', encoder, uniforms, velocity.write, neutral, velocity.read, pressure.read);
      velocity.swap();
      dispatch('divergence', encoder, uniforms, tex('projectedDivergence'), neutral, velocity.read);
      dispatch('advectMaterial', encoder, uniforms, dye.write, dye.read, velocity.read);
      dye.swap();
      if (kind === 'ink') {
        const paper = pairs.paper!;
        dispatch('deposit', encoder, uniforms, paper.write, paper.read, neutral, neutral, dye.read);
        paper.swap();
        dispatch('absorb', encoder, uniforms, dye.write, dye.read);
        dye.swap();
      }
    },
    display(encoder, target, frame, uniforms) {
      // Shadows update once per presented frame, independently of catch-up step count.
      if (kind === 'smoke') {
        const params = ctx.params.pack().slice(0);
        const steps = Math.max(
          2,
          Math.round(Number(ctx.params.values.shadowSteps) * ctx.qualitySteps()),
        );
        new DataView(params).setUint32(offsets.shadowSteps!, steps, true);
        const shadowUniforms = shadowSnapshots!.group(encoder, frame, params);
        dispatch(
          'shadow',
          encoder,
          shadowUniforms,
          tex('shadow'),
          neutral,
          neutral,
          neutral,
          tex('dye'),
        );
      }
      const textures = [
        tex('dye'),
        tex('velocity'),
        tex('pressure'),
        tex('projectedDivergence'),
        tex('curl'),
        tex(kind === 'ink' ? 'paper' : 'shadow'),
      ];
      const key = textures.map(texId).join(',');
      if (!displayGroup || key !== displayKey) {
        displayGroup = device.createBindGroup({
          label: `hgpu-${kind}-display`,
          layout: displayLayout,
          entries: textures.map((texture, binding) => ({
            binding,
            resource: texture.createView(),
          })),
        });
        displayKey = key;
      }
      display.draw(encoder, target, [uniforms, displayGroup]);
    },
    sources,
    diagnostics,
    textureTaps() {
      const taps: Record<string, TextureTap> = {};
      for (const [name, format] of Object.entries(formats)) {
        taps[name] = {
          texture: tex(name),
          format,
          width: size[0],
          height: size[1],
          kind: 'float',
          label: `${kind}: ${name}`,
        };
      }
      return taps;
    },
    memory() {
      return {
        textureBytes:
          Object.values(pairs).reduce((n, p) => n + p.bytes, 8) +
          Object.keys(single).reduce(
            (n, name) => n + size[0] * size[1] * (formats[name] === 'r32float' ? 4 : 8),
            0,
          ),
        bufferBytes: shadowSnapshots?.bytes ?? 0,
      };
    },
    dispose() {
      Object.values(passes).forEach((p) => p.dispose());
      display.dispose();
      Object.values(pairs).forEach((p) => p.dispose());
      Object.values(single).forEach((t) => t.destroy());
      neutral.destroy();
      shadowSnapshots?.dispose();
      groups.clear();
      displayGroup = undefined;
    },
  };
}
