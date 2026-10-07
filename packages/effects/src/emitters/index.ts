import {
  particleEffect,
  createParticleBuffers,
  createComputePass,
  createPrefixSum,
  simulationSource,
  simulationUniformLayout,
  hash,
  type EffectContext,
  type ParticleProgram,
} from '@mk7s/hologpu-core';
import { renderParams, particleStruct } from '../_particles/basic.ts';
import { particlePresentation } from '../_particles/render.ts';
const params = {
  ...renderParams,
  count: { ...renderParams.count, default: 32768, max: 262144 },
  kind: {
    type: 'enum',
    default: 'fireworks',
    options: ['fireworks', 'sparks'],
    group: 'Emitter',
    description: 'Radial explosions or a continuous upward spark fountain.',
  },
  rate: {
    type: 'f32',
    default: 6000,
    min: 0,
    max: 60000,
    step: 100,
    group: 'Emitter',
    description: 'Desired births per second, limited by the deterministic free list capacity.',
  },
  lifetime: {
    type: 'f32',
    default: 2,
    min: 0.1,
    max: 8,
    step: 0.1,
    group: 'Emitter',
    description: 'Particle lifetime in seconds; dead records return to the stable free list.',
  },
  speed: {
    type: 'f32',
    default: 0.6,
    min: 0.05,
    max: 2,
    step: 0.05,
    group: 'Emitter',
    description: 'Initial normalized velocity magnitude.',
  },
  gravity: {
    type: 'f32',
    default: 0.25,
    min: 0,
    max: 2,
    step: 0.05,
    group: 'Emitter',
    description: 'Downward acceleration in normalized units per second squared.',
  },
  drag: {
    type: 'f32',
    default: 0.2,
    min: 0,
    max: 5,
    step: 0.1,
    group: 'Emitter',
    description: 'Exponential velocity drag per second.',
  },
  origin: {
    type: 'vec2',
    default: [0, -0.45],
    min: -0.9,
    max: 0.9,
    step: 0.05,
    group: 'Emitter',
    description: 'Emitter location in clip coordinates.',
  },
} as const;
export default particleEffect({
  id: 'emitters',
  title: 'Indirect fireworks and spark emitters',
  family: 'particles',
  core: true,
  tags: ['free-list', 'stream-compaction', 'indirect-draw'],
  params,
  inputs: [],
  features: [],
  presets: {
    sparks: {
      kind: 'sparks',
      rate: 15000,
      lifetime: 1.5,
      speed: 0.9,
      gravity: 0.6,
      trail: 0.9,
      tint: '#f1b76c',
    },
    bursts: {
      kind: 'fireworks',
      rate: 3000,
      lifetime: 3.5,
      speed: 0.4,
      trail: 0.985,
      tint: '#d597f3',
    },
  },
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback: 'radial-gradient(ellipse,#f1b76c,#07111e)',
  setup: program,
});
async function program(ctx: EffectContext<typeof params>): Promise<ParticleProgram> {
  const device = ctx.device,
    uniform = simulationUniformLayout(device),
    count = Number(ctx.params.values.count);
  // Capacity changes recreate the program's deterministic storage through resize.
  let capacity = count,
    buffers: ReturnType<typeof createParticleBuffers> | undefined,
    dead: GPUBuffer | undefined,
    alive: GPUBuffer | undefined,
    indirect: GPUBuffer | undefined;
  let free: Awaited<ReturnType<typeof createPrefixSum>> | undefined,
    active: Awaited<ReturnType<typeof createPrefixSum>> | undefined;
  const layout = (
    types: readonly ('storage' | 'read-only-storage')[],
    visibility = GPUShaderStage.COMPUTE,
  ) =>
    device.createBindGroupLayout({
      entries: types.map((type, binding) => ({ binding, visibility, buffer: { type } })),
    });
  const integrateLayout = layout(['storage', 'storage', 'storage']),
    spawnLayout = layout(['storage', 'read-only-storage', 'read-only-storage']),
    argsLayout = layout(['read-only-storage', 'storage']),
    drawLayout = layout(['read-only-storage', 'read-only-storage'], GPUShaderStage.VERTEX);
  const seedCode = `fn birth(index:u32,sequence:u32)->Particle{let h=hash_u32(index+frame.seed*65537u+sequence*8191u);let angle=random(h)*6.2831853;let magnitude=params.speed*(.45+.55*random(hash_u32(h+1u)));var velocity=vec2f(cos(angle),sin(angle))*magnitude;var origin=params.origin;if(params.kind==1u){velocity=vec2f((random(h)-.5)*.45, .6+random(hash_u32(h+2u))*.4)*params.speed;}else{origin+=vec2f(sin(f32(sequence)*1.7)*.5,.3+cos(f32(sequence)*.8)*.15);}let life=params.lifetime*(.65+.35*random(hash_u32(h+3u)));return Particle(vec4f(origin,random(hash_u32(h+4u)),life),vec4f(velocity,life,0));}`;
  const stateDecl = `${particleStruct}@group(1) @binding(0) var<storage,read_write> particles:array<Particle>;@group(1) @binding(1) var<storage,read_write> dead:array<u32>;@group(1) @binding(2) var<storage,read_write> alive:array<u32>;`;
  const sources = {
    initialize: simulationSource(
      params,
      `${stateDecl}${seedCode}@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u){if(id.x>=arrayLength(&particles)){return;}var p=Particle(vec4f(0),vec4f(0));if(id.x<min(1024u,arrayLength(&particles)/4u)){p=birth(id.x,0u);p.position=vec4f(p.position.xy+p.velocity.xy*.35,p.position.zw);}particles[id.x]=p;dead[id.x]=select(1u,0u,p.position.w>0);alive[id.x]=1u-dead[id.x];}`,
      [hash],
    ),
    integrate: simulationSource(
      params,
      `${stateDecl}@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u){if(id.x>=arrayLength(&particles)){return;}var p=particles[id.x];if(p.position.w>0){p.position.w=max(0.0,p.position.w-frame.delta);p.velocity=vec4f(p.velocity.xy*exp(-params.drag*frame.delta)-vec2f(0,params.gravity*frame.delta),p.velocity.zw);p.position=vec4f(p.position.xy+p.velocity.xy*frame.delta,p.position.zw);particles[id.x]=p;}dead[id.x]=select(1u,0u,p.position.w>0);alive[id.x]=1u-dead[id.x];}`,
    ),
    spawn: simulationSource(
      params,
      `${particleStruct}@group(1) @binding(0) var<storage,read_write> particles:array<Particle>;@group(1) @binding(1) var<storage,read> freeList:array<u32>;@group(1) @binding(2) var<storage,read> freeCount:array<u32>;${seedCode}@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u){let quota=u32(max(0.0,floor(frame.time*params.rate)-floor(max(0.0,frame.time-frame.delta)*params.rate)));if(id.x>=min(quota,freeCount[0])){return;}let index=freeList[id.x];particles[index]=birth(index,frame.index/30u);}`,
      [hash],
    ),
    flags: simulationSource(
      params,
      `${stateDecl}@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u){if(id.x>=arrayLength(&particles)){return;}dead[id.x]=select(1u,0u,particles[id.x].position.w>0);alive[id.x]=1u-dead[id.x];}`,
    ),
    indirect: simulationSource(
      params,
      `@group(1) @binding(0) var<storage,read> activeCount:array<u32>;@group(1) @binding(1) var<storage,read_write> args:array<u32>;@compute @workgroup_size(1) fn main(){args[0]=select(activeCount[0],6u,params.draw==1u);args[1]=select(1u,activeCount[0],params.draw==1u);args[2]=0u;args[3]=0u;}`,
    ),
  };
  const shader = (quad: boolean) =>
    simulationSource(
      params,
      `${particleStruct}@group(1) @binding(0) var<storage,read> particles:array<Particle>;@group(1) @binding(1) var<storage,read> activeIndices:array<u32>;struct Out{@builtin(position) position:vec4f,@location(0) local:vec2f,@location(1) color:vec3f};@vertex fn particleVertex(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Out{let p=particles[activeIndices[${quad ? 'instance' : 'vertex'}]];var local=vec2f(0);${quad ? 'let corners=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));local=corners[vertex];' : ''}var out:Out;out.position=vec4f(p.position.xy+local*params.size/frame.resolution,0,1);out.local=local;out.color=params.tint.rgb*.3*max(0.0,p.position.w/max(.001,p.velocity.z))*mix(.6,1.4,p.position.z)*min(1.0,10000.0/(.42*f32(arrayLength(&particles))));return out;}@fragment fn particleFragment(in:Out)->@location(0)vec4f{${quad ? 'if(dot(in.local,in.local)>1){discard;}' : ''}return vec4f(in.color,1);}`,
    );
  const leases: { dispose(): void }[] = [];
  try {
    const init = await createComputePass(ctx.session, sources.initialize, 'emitters-initialize', [
      uniform,
      integrateLayout,
    ]);
    leases.push(init);
    const integrate = await createComputePass(
      ctx.session,
      sources.integrate,
      'emitters-integrate',
      [uniform, integrateLayout],
    );
    leases.push(integrate);
    const spawn = await createComputePass(ctx.session, sources.spawn, 'emitters-spawn', [
      uniform,
      spawnLayout,
    ]);
    leases.push(spawn);
    const flags = await createComputePass(ctx.session, sources.flags, 'emitters-flags', [
      uniform,
      integrateLayout,
    ]);
    leases.push(flags);
    const args = await createComputePass(ctx.session, sources.indirect, 'emitters-indirect', [
      uniform,
      argsLayout,
    ]);
    leases.push(args);
    const presentation = await particlePresentation(
      ctx,
      'emitters',
      shader(false),
      shader(true),
      drawLayout,
    );
    leases.push(presentation);
    function allocate() {
      buffers?.dispose();
      dead?.destroy();
      alive?.destroy();
      indirect?.destroy();
      buffers = createParticleBuffers(ctx.session, {
        count: capacity,
        stride: 32,
        label: 'emitters',
        pingPong: false,
      });
      const buffer = (name: string) =>
        device.createBuffer({
          label: `emitters-${name}`,
          size: capacity * 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });
      dead = buffer('dead-flags');
      alive = buffer('alive-flags');
      indirect = device.createBuffer({
        label: 'emitters-draw-indirect',
        size: 16,
        usage:
          GPUBufferUsage.STORAGE |
          GPUBufferUsage.INDIRECT |
          GPUBufferUsage.COPY_SRC |
          GPUBufferUsage.COPY_DST,
      });
    }
    free = await createPrefixSum(ctx.session, 262144);
    active = await createPrefixSum(ctx.session, 262144);
    allocate();
    function group(layout: GPUBindGroupLayout, resources: GPUBuffer[]) {
      return device.createBindGroup({
        layout,
        entries: resources.map((buffer, binding) => ({ binding, resource: { buffer } })),
      });
    }
    function stateGroup() {
      return group(integrateLayout, [buffers!.read, dead!, alive!]);
    }
    function compact(encoder: GPUCommandEncoder, u: GPUBindGroup) {
      flags.dispatch(encoder, [u, stateGroup()], [Math.ceil(capacity / 128)]);
      free!.compact(encoder, dead!, capacity);
      active!.compact(encoder, alive!, capacity);
      args.dispatch(encoder, [u, group(argsLayout, [active!.count, indirect!])], [1]);
    }
    return {
      resize(size) {
        presentation.resize(size);
        const nextCount = Number(ctx.params.values.count);
        if (nextCount === capacity) return false;
        capacity = nextCount;
        allocate();
        return true;
      },
      initialize(encoder, _frame, u) {
        presentation.reset();
        init.dispatch(encoder, [u, stateGroup()], [Math.ceil(capacity / 128)]);
        compact(encoder, u);
      },
      step(encoder, _frame, u) {
        integrate.dispatch(encoder, [u, stateGroup()], [Math.ceil(capacity / 128)]);
        free!.compact(encoder, dead!, capacity);
        spawn.dispatch(
          encoder,
          [u, group(spawnLayout, [buffers!.read, free!.indices, free!.count])],
          [Math.ceil(capacity / 128)],
        );
        compact(encoder, u);
      },
      display(encoder, target, frame, u) {
        args.dispatch(encoder, [u, group(argsLayout, [active!.count, indirect!])], [1]);
        presentation.draw(
          encoder,
          target,
          u,
          group(drawLayout, [buffers!.read, active!.indices]),
          capacity,
          ctx.params.values.draw === 'point' ? 'point' : 'quad',
          frame.index,
          indirect,
        );
      },
      textureTaps: () => presentation.textureTaps(),
      bufferTaps: () => ({
        particles: {
          buffer: buffers!.read,
          count: capacity,
          stride: 32,
          label: 'position xy / colour / remaining life; velocity xy / original life',
        },
        freeList: {
          buffer: free!.indices,
          stride: 4,
          count: capacity,
          label: 'Stable free-slot IDs; valid prefix length in freeCount',
        },
        freeCount: { buffer: free!.count, stride: 4, count: 1, label: 'Available storage slots' },
        activeIndices: {
          buffer: active!.indices,
          stride: 4,
          count: capacity,
          label: 'Stable living particle IDs',
        },
        activeCount: { buffer: active!.count, stride: 4, count: 1, label: 'Living particle count' },
        indirect: {
          buffer: indirect!,
          stride: 4,
          count: 4,
          label: 'Draw vertexCount / instanceCount / firstVertex / firstInstance',
        },
      }),
      memory: () => ({
        textureBytes: presentation.bytes,
        bufferBytes:
          buffers!.bytes +
          dead!.size +
          alive!.size +
          indirect!.size +
          free!.memory.bufferBytes +
          active!.memory.bufferBytes,
      }),
      sources: {
        ...sources,
        ...presentation.sources,
        ...free!.sources,
        ...Object.fromEntries(Object.entries(active!.sources).map(([k, v]) => [`active-${k}`, v])),
      },
      diagnostics: [
        ...leases.flatMap((l) => (l as typeof init).diagnostics ?? []),
        ...free!.diagnostics,
        ...active!.diagnostics,
      ],
      dispose() {
        buffers?.dispose();
        dead?.destroy();
        alive?.destroy();
        indirect?.destroy();
        free?.dispose();
        active?.dispose();
        leases.reverse().forEach((l) => l.dispose());
      },
    };
  } catch (error) {
    buffers?.dispose();
    dead?.destroy();
    alive?.destroy();
    indirect?.destroy();
    free?.dispose();
    active?.dispose();
    leases.reverse().forEach((l) => l.dispose());
    throw error;
  }
}
