import {
  feedbackEffect,
  simulationUniformLayout,
  simulationSource,
  createPingPongTargets,
  createComputePass,
  createSimulationDisplay,
  hash,
  type EffectContext,
  type FeedbackProgram,
} from '@mk7s/hologpu-core';
import { gridParam, stepsParam, wrap } from '../_feedback/grid.ts';
const params = {
  grid: { ...gridParam, default: 256 },
  steps: stepsParam,
  agents: {
    type: 'u32',
    default: 8192,
    min: 256,
    max: 65536,
    step: 256,
    uniform: false,
    group: 'Simulation',
    description: 'Independent storage-buffer agents; changing the count restarts.',
  },
  sensorDistance: {
    type: 'f32',
    default: 12,
    min: 1,
    max: 50,
    step: 1,
    group: 'Agents',
    description: 'Distance of three trail sensors in cells.',
  },
  sensorAngle: {
    type: 'f32',
    default: 0.7,
    min: 0.1,
    max: 1.5,
    step: 0.05,
    group: 'Agents',
    description: 'Angular sensor offset in radians.',
  },
  turn: {
    type: 'f32',
    default: 0.3,
    min: 0.02,
    max: 1,
    step: 0.02,
    group: 'Agents',
    description: 'Steering angle per iteration.',
  },
  speed: {
    type: 'f32',
    default: 1.2,
    min: 0.1,
    max: 4,
    step: 0.1,
    group: 'Agents',
    description: 'Distance moved in cells per iteration.',
  },
  deposit: {
    type: 'f32',
    default: 0.3,
    min: 0.01,
    max: 2,
    step: 0.01,
    group: 'Trail',
    description:
      'Trail concentration added per agent; fixed-point integer atomic additions sum races safely.',
  },
  diffusion: {
    type: 'f32',
    default: 0.8,
    min: 0,
    max: 1,
    step: 0.05,
    group: 'Trail',
    description: 'Blend between trail and 3×3 box diffusion.',
  },
  decay: {
    type: 'f32',
    default: 0.97,
    min: 0.85,
    max: 0.999,
    step: 0.001,
    group: 'Trail',
    description: 'Trail retention per iteration.',
  },
  tint: { type: 'color', default: '#a0edcb', group: 'Palette', description: 'Bright trail color.' },
  background: {
    type: 'color',
    default: '#10192d',
    group: 'Palette',
    description: 'Dark empty field.',
  },
} as const;
export default feedbackEffect({
  id: 'physarum',
  title: 'Physarum agents and atomic trail',
  family: 'feedback',
  core: true,
  tags: ['agents', 'storage-buffer', 'atomics'],
  params,
  inputs: [],
  presets: {
    networks: { sensorDistance: 18, sensorAngle: 0.55, turn: 0.18, decay: 0.985, tint: '#f0c795' },
    coral: {
      sensorDistance: 5,
      sensorAngle: 1.1,
      turn: 0.6,
      speed: 1.6,
      decay: 0.95,
      tint: '#b7a0ef',
    },
  },
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback: 'radial-gradient(ellipse,#a0edcb,#10192d)',
  async setup(ctx) {
    return program(ctx);
  },
});
async function program(ctx: EffectContext<typeof params>): Promise<FeedbackProgram> {
  const device = ctx.device;
  const uniforms = simulationUniformLayout(device);
  const state = createPingPongTargets(ctx.session, {
    label: 'physarum-trail',
    format: 'rgba16float',
    size: [32, 32],
  });
  const layout = device.createBindGroupLayout({
    label: 'physarum-state-layout',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: 'unfilterable-float' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: 'write-only', format: 'rgba16float' },
      },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const displayLayout = device.createBindGroupLayout({
    label: 'physarum-display-layout',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float' },
      },
    ],
  });
  const declarations = /* wgsl */ `@group(1) @binding(0) var trail:texture_2d<f32>;@group(1) @binding(1) var next:texture_storage_2d<rgba16float,write>;struct Agent {position:vec2f,heading:f32,seed:u32};@group(1) @binding(2) var<storage,read_write> agents:array<Agent>;@group(1) @binding(3) var<storage,read_write> deposits:array<atomic<u32>>;${wrap}`;
  const source = (body: string) => simulationSource(params, declarations + body, [hash]);
  const sources = {
    initializeTrail: source(
      /* wgsl */ `@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){if(any(id.xy>=textureDimensions(next))){return;}textureStore(next,vec2i(id.xy),vec4f(0,0,0,1));}`,
    ),
    initializeAgents: source(
      /* wgsl */ `@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){if(id.x>=arrayLength(&agents)){return;}let seed=hash_u32(id.x+frame.seed*65537u);let angle=random(seed)*6.2831853;let radius=0.08+0.35*sqrt(random(hash_u32(seed+19u)));agents[id.x]=Agent(vec2f(0.5)+radius*vec2f(cos(angle),sin(angle)),angle+3.1415926,seed);}`,
    ),
    agents:
      source(/* wgsl */ `fn periodic_trail(uv:vec2f)->f32{let n=vec2i(textureDimensions(trail));let p=uv*vec2f(n)-0.5;let b=vec2i(floor(p));let t=fract(p);let a=textureLoad(trail,wrap(b,n),0).x;let c=textureLoad(trail,wrap(b+vec2i(1,0),n),0).x;let d=textureLoad(trail,wrap(b+vec2i(0,1),n),0).x;let e=textureLoad(trail,wrap(b+vec2i(1,1),n),0).x;return mix(mix(a,c,t.x),mix(d,e,t.x),t.y);}
fn sensor(p:vec2f,a:f32)->f32 {let uv=fract(p+params.sensorDistance/vec2f(textureDimensions(trail))*vec2f(cos(a),sin(a)));return periodic_trail(uv);}
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){if(id.x>=arrayLength(&agents)){return;}var a=agents[id.x];let forward=sensor(a.position,a.heading);let left=sensor(a.position,a.heading-params.sensorAngle);let right=sensor(a.position,a.heading+params.sensorAngle);if(forward<left||forward<right){if(left>right){a.heading-=params.turn;}else if(right>left){a.heading+=params.turn;}else {a.heading+=select(-params.turn,params.turn,random(hash_u32(a.seed+frame.index))>0.5);}}a.heading=fract(a.heading/6.2831853)*6.2831853;a.position=fract(a.position+params.speed/vec2f(textureDimensions(trail))*vec2f(cos(a.heading),sin(a.heading)));let n=textureDimensions(trail);let p=min(vec2u(a.position*vec2f(n)),n-1u);atomicAdd(&deposits[p.x+p.y*n.x],1024u);agents[id.x]=a;}`),
    diffuse: source(
      /* wgsl */ `@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){let n=textureDimensions(next);if(any(id.xy>=n)){return;}let p=vec2i(id.xy);var sum=0.0;for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){sum+=textureLoad(trail,wrap(p+vec2i(x,y),vec2i(n)),0).x;}}let center=textureLoad(trail,p,0).x;let deposited=f32(atomicLoad(&deposits[id.x+id.y*n.x]))/1024.0*params.deposit;let v=min(64.0,mix(center,sum/9.0,params.diffusion)*params.decay+deposited);textureStore(next,p,vec4f(v,0,0,1));}`,
    ),
    display: simulationSource(
      params,
      /* wgsl */ `@group(1) @binding(0) var trail:texture_2d<f32>;@fragment fn fragment(in:VertexOut)->@location(0)vec4f{let v=sample_bilinear(trail,in.uv).x;return vec4f(mix(params.background.rgb,params.tint.rgb,1.0-exp(-0.6*v)),1);}`,
    ),
  };
  const leases: { dispose(): void }[] = [];
  try {
    const initTrail = await createComputePass(
      ctx.session,
      sources.initializeTrail,
      'physarum-initialize-trail',
      [uniforms, layout],
    );
    leases.push(initTrail);
    const initAgents = await createComputePass(
      ctx.session,
      sources.initializeAgents,
      'physarum-initialize-agents',
      [uniforms, layout],
    );
    leases.push(initAgents);
    const agentsPass = await createComputePass(ctx.session, sources.agents, 'physarum-agents', [
      uniforms,
      layout,
    ]);
    leases.push(agentsPass);
    const diffuse = await createComputePass(ctx.session, sources.diffuse, 'physarum-diffuse', [
      uniforms,
      layout,
    ]);
    leases.push(diffuse);
    const display = await createSimulationDisplay(
      ctx.session,
      sources.display,
      ctx.format,
      'physarum-display',
      [uniforms, displayLayout],
    );
    leases.push(display);
    const stepsOffset = ctx.params.layout.fields.find((field) => field.name === 'steps')!.offset;
    let grid = 0,
      count = 0,
      side = 0;
    let agents: GPUBuffer;
    let deposits: GPUBuffer;
    let groups: GPUBindGroup[] = [];
    let displays: GPUBindGroup[] = [];
    function bind() {
      groups = [0, 1].map(() => {
        const group = device.createBindGroup({
          label: 'physarum-state-bindings',
          layout,
          entries: [
            { binding: 0, resource: state.read.createView() },
            { binding: 1, resource: state.write.createView() },
            { binding: 2, resource: { buffer: agents } },
            { binding: 3, resource: { buffer: deposits } },
          ],
        });
        state.swap();
        return group;
      });
      displays = [0, 1].map(() => {
        const group = device.createBindGroup({
          label: 'physarum-display-bindings',
          layout: displayLayout,
          entries: [{ binding: 0, resource: state.read.createView() }],
        });
        state.swap();
        return group;
      });
    }
    return {
      resize() {
        const nextGrid = Number(ctx.params.values.grid);
        const nextCount = Number(ctx.params.values.agents);
        if (grid === nextGrid && count === nextCount) {
          return false;
        }
        if (side % 2) {
          state.swap();
        }
        side = 0;
        grid = nextGrid;
        count = nextCount;
        state.resize([grid, grid]);
        agents?.destroy();
        deposits?.destroy();
        agents = device.createBuffer({
          label: 'physarum-agents',
          size: count * 16,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });
        deposits = device.createBuffer({
          label: 'physarum-atomic-deposits',
          size: grid * grid * 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });
        bind();
        return true;
      },
      initialize(encoder, _frame, uniform) {
        if (side % 2) {
          state.swap();
        }
        side = 0;
        encoder.clearBuffer(deposits);
        initAgents.dispatch(encoder, [uniform, groups[0]!], [Math.ceil(count / 64), 1, 1]);
        for (let i = 0; i < 2; i++) {
          initTrail.dispatch(
            encoder,
            [uniform, groups[i]!],
            [Math.ceil(grid / 8), Math.ceil(grid / 8), 1],
          );
        }
      },
      step(encoder, _frame, uniform, snapshot) {
        const requested = new DataView(snapshot).getUint32(stepsOffset, true);
        const iterations = Math.max(1, Math.round(requested * ctx.qualitySteps()));
        for (let i = 0; i < iterations; i++) {
          encoder.clearBuffer(deposits);
          agentsPass.dispatch(encoder, [uniform, groups[side % 2]!], [Math.ceil(count / 64), 1, 1]);
          diffuse.dispatch(
            encoder,
            [uniform, groups[side % 2]!],
            [Math.ceil(grid / 8), Math.ceil(grid / 8), 1],
          );
          state.swap();
          side++;
        }
      },
      display(encoder, target, _frame, uniform) {
        display.draw(encoder, target, [uniform, displays[side % 2]!]);
      },
      textureTaps() {
        return {
          trail: {
            texture: state.read,
            format: 'rgba16float',
            width: grid,
            height: grid,
            kind: 'float',
            label: 'Diffused trail',
          },
        };
      },
      bufferTaps() {
        return {
          agents: { buffer: agents, stride: 16, count, label: 'Agent x/y, heading, seed' },
          deposits: {
            buffer: deposits,
            stride: 4,
            count: grid * grid,
            label: 'Fixed-point atomic deposits (÷1024)',
          },
        };
      },
      memory() {
        return {
          textureBytes: state.bytes,
          bufferBytes: (agents?.size ?? 0) + (deposits?.size ?? 0),
        };
      },
      dispose() {
        state.dispose();
        agents?.destroy();
        deposits?.destroy();
        for (const pass of [initTrail, initAgents, agentsPass, diffuse, display]) pass.dispose();
      },
      sources,
      diagnostics: [
        ...initTrail.diagnostics,
        ...initAgents.diagnostics,
        ...agentsPass.diagnostics,
        ...diffuse.diagnostics,
        ...display.diagnostics,
      ],
    };
  } catch (error) {
    state.dispose();
    for (const lease of leases.reverse()) lease.dispose();
    throw error;
  }
}
