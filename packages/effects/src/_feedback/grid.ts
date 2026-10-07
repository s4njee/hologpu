import {
  feedbackEffect,
  createComputePass,
  createSimulationDisplay,
  createPingPongTargets,
  simulationSource,
  simulationUniformLayout,
  hash,
  type ParamSchema,
  type EffectContext,
  type FeedbackProgram,
  type FeedbackOptions,
  type BufferTap,
} from '@mk7s/hologpu-core';
export const gridParam = {
  type: 'u32',
  default: 256,
  min: 32,
  max: 1024,
  step: 32,
  uniform: false,
  group: 'Simulation',
  description: 'Square simulation grid; changing it restarts the seeded field.',
} as const;
export const stepsParam = {
  type: 'u32',
  default: 1,
  min: 1,
  max: 16,
  step: 1,
  group: 'Simulation',
  description: 'Solver iterations per fixed simulation update.',
} as const;
export const wrap = /* wgsl */ `
fn wrap(p:vec2i,n:vec2i)->vec2i{return ((p%n)+n)%n;}
fn cell_hash(p:vec2i,seed:u32)->f32 { let q=bitcast<vec2u>(p);return random(hash_u32((q.x*0x9e3779b9u)^hash_u32(q.y*0x85ebca6bu+seed))); }
`;
interface GridCode {
  initialize: string;
  step: string;
  display: string;
  integer?: boolean;
  alternate?: boolean;
  readWrite?: boolean;
  lut?: Float32Array;
}
export function gridEffect<const S extends ParamSchema>(
  options: Omit<FeedbackOptions<S>, 'setup'>,
  code: GridCode,
) {
  return feedbackEffect({
    ...options,
    async setup(ctx) {
      return gridProgram(ctx, options.id, code);
    },
  });
}
async function gridProgram<S extends ParamSchema>(
  ctx: EffectContext<S>,
  id: string,
  code: GridCode,
): Promise<FeedbackProgram> {
  const device = ctx.device;
  const uniform = simulationUniformLayout(device);
  const format = code.integer ? 'r32uint' : 'rgba16float';
  const readWrite =
    code.readWrite &&
    navigator.gpu.wgslLanguageFeatures?.has('readonly_and_readwrite_storage_textures');
  const bindings: GPUBindGroupLayoutEntry[] = [
    {
      binding: 0,
      visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
      texture: { sampleType: code.integer ? 'uint' : 'unfilterable-float' },
    },
    {
      binding: 1,
      visibility: GPUShaderStage.COMPUTE,
      storageTexture: { access: 'write-only', format },
    },
  ];
  if (code.lut)
    bindings.push({
      binding: 2,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: 'read-only-storage' },
    });
  if (readWrite)
    bindings[0] = {
      binding: 0,
      visibility: GPUShaderStage.COMPUTE,
      storageTexture: { access: 'read-write', format },
    };
  const stateLayout = device.createBindGroupLayout({
    label: `${id}-state-layout`,
    entries: bindings,
  });
  const displayLayout = device.createBindGroupLayout({
    label: `${id}-display-layout`,
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: code.integer ? 'uint' : 'unfilterable-float' },
      },
    ],
  });
  const state = createPingPongTargets(ctx.session, {
    label: `${id}-state`,
    format,
    size: [32, 32],
  });
  const storage = code.integer ? 'u32' : 'f32';
  const declaration = `@group(1) @binding(0) var state:${readWrite ? 'texture_storage_2d<r32uint,read_write>' : `texture_2d<${storage}>`};\n@group(1) @binding(1) var next:texture_storage_2d<${format},write>;\n${code.lut ? '@group(1) @binding(2) var<storage,read> kernel:array<f32>;' : ''}\n${wrap}`;
  const load = `fn load_cell(p:vec2i)->vec4<${storage}>{return textureLoad(state,p${readWrite ? '' : ',0'});}`;
  const source = (_label: string, body: string) =>
    simulationSource(ctx.params.schema, `${declaration}\n${load}\n${body}`, [hash]);
  const initSource = source('initialize', code.initialize);
  const stepSource = source('step', `const blockPhase:u32=0u;\n${code.step}`);
  const otherSource = code.alternate
    ? source('alternate', `const blockPhase:u32=1u;\n${code.step}`)
    : null;
  const displaySource = simulationSource(
    ctx.params.schema,
    `@group(1) @binding(0) var state:texture_2d<${storage}>;\n${code.display}`,
    [hash],
  );
  const leases: { dispose(): void }[] = [];
  let lut: GPUBuffer | null = null;
  try {
    const init = await createComputePass(ctx.session, initSource, `${id}-initialize`, [
      uniform,
      stateLayout,
    ]);
    leases.push(init);
    const update = await createComputePass(ctx.session, stepSource, `${id}-step`, [
      uniform,
      stateLayout,
    ]);
    leases.push(update);
    const alternate = otherSource
      ? await createComputePass(ctx.session, otherSource, `${id}-alternate`, [uniform, stateLayout])
      : null;
    if (alternate) leases.push(alternate);
    const display = await createSimulationDisplay(
      ctx.session,
      displaySource,
      ctx.format,
      `${id}-display`,
      [uniform, displayLayout],
    );
    leases.push(display);
    lut = code.lut
      ? device.createBuffer({
          label: `${id}-kernel-lut`,
          size: code.lut.byteLength,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        })
      : null;
    if (lut && code.lut) device.queue.writeBuffer(lut, 0, code.lut);
    let side = 0,
      grid = 32,
      configuration = '';
    const stepsOffset = ctx.params.layout.fields.find((field) => field.name === 'steps')?.offset;
    const config = () =>
      JSON.stringify(
        Object.entries(ctx.params.schema)
          .filter(([, spec]) => spec.uniform === false)
          .map(([name]) => [name, ctx.params.values[name]]),
      );
    const groups = () =>
      [0, 1].map(() => {
        const group = device.createBindGroup({
          label: `${id}-state-bindings`,
          layout: stateLayout,
          entries: [
            { binding: 0, resource: state.read.createView() },
            { binding: 1, resource: state.write.createView() },
            ...(lut ? [{ binding: 2, resource: { buffer: lut } }] : []),
          ],
        });
        state.swap();
        return group;
      });
    let pair = groups();
    const drawGroup = () =>
      device.createBindGroup({
        label: `${id}-display-bindings`,
        layout: displayLayout,
        entries: [{ binding: 0, resource: state.read.createView() }],
      });
    let displays = [drawGroup()];
    state.swap();
    displays.push(drawGroup());
    state.swap();
    return {
      resize() {
        const next = config();
        if (next === configuration) return false;
        configuration = next;
        const requestedGrid = Math.max(32, Math.min(1024, Number(ctx.params.values.grid ?? 256)));
        const nextGrid = code.alternate ? requestedGrid + (requestedGrid % 2) : requestedGrid;
        if (nextGrid !== grid) {
          grid = nextGrid;
          state.resize([grid, grid]);
          side = 0;
          pair = groups();
          displays = [drawGroup()];
          state.swap();
          displays.push(drawGroup());
          state.swap();
        }
        return true;
      },
      initialize(encoder, _frame, uniforms) {
        if (side % 2) state.swap();
        side = 0;
        init.dispatch(encoder, [uniforms, pair[0]!], [Math.ceil(grid / 8), Math.ceil(grid / 8), 1]);
        state.swap();
        init.dispatch(encoder, [uniforms, pair[1]!], [Math.ceil(grid / 8), Math.ceil(grid / 8), 1]);
        state.swap();
      },
      step(encoder, _frame, uniforms, snapshot) {
        const requested =
          stepsOffset === undefined ? 1 : new DataView(snapshot).getUint32(stepsOffset, true);
        const count = Math.max(1, Math.min(16, Math.round(requested * ctx.qualitySteps())));
        for (let i = 0; i < count; i++) {
          const pass = alternate && side % 2 ? alternate : update;
          pass.dispatch(
            encoder,
            [uniforms, pair[side % 2]!],
            [Math.ceil(grid / 8), Math.ceil(grid / 8), 1],
          );
          state.swap();
          side++;
        }
      },
      display(encoder, target, _frame, uniforms) {
        display.draw(encoder, target, [uniforms, displays[side % 2]!]);
      },
      textureTaps() {
        return {
          state: {
            texture: state.read,
            format,
            width: grid,
            height: grid,
            kind: code.integer ? 'uint' : 'float',
            label: code.integer ? 'Exact integer cells' : 'Current simulation state',
          },
        };
      },
      bufferTaps: (): Readonly<Record<string, BufferTap>> =>
        lut
          ? {
              kernel: {
                buffer: lut,
                label: 'Radial convolution kernel LUT',
                count: 256,
                stride: 4,
              },
            }
          : {},
      memory() {
        return { textureBytes: state.bytes, bufferBytes: lut?.size ?? 0 };
      },
      dispose() {
        state.dispose();
        init.dispose();
        update.dispose();
        alternate?.dispose();
        display.dispose();
        lut?.destroy();
      },
      sources: {
        initialize: initSource,
        step: stepSource,
        ...(otherSource ? { alternate: otherSource } : {}),
        display: displaySource,
      },
      diagnostics: [
        ...init.diagnostics,
        ...update.diagnostics,
        ...(alternate?.diagnostics ?? []),
        ...display.diagnostics,
      ],
    };
  } catch (error) {
    state.dispose();
    lut?.destroy();
    for (const lease of leases.reverse()) lease.dispose();
    throw error;
  }
}
