import {
  feedbackEffect,
  createSimulationDisplay,
  simulationSource,
  simulationUniformLayout,
  type FeedbackProgram,
} from '@mk7s/hologpu-core';
import { f, u, buffer, layout, group, kernels, tap } from '../_stretch/common.ts';
const params = {
  grid: u(96, 16, 256, 'D2Q9 square lattice; nine f32 distributions per cell.', 'Workload', true),
  tau: f(0.8, 0.56, 1.5, 'BGK relaxation time; viscosity = (tau - 0.5) / 3 lattice units.'),
  flow: f(0.06, 0, 0.12, 'Inlet velocity in lattice units (keep Mach number small).'),
  obstacle: f(0.1, 0, 0.22, 'Cylinder radius as a fraction of the grid width.'),
  steps: u(4, 1, 16, 'Lattice stream/collision ticks per fixed update.'),
  boundary: {
    type: 'enum',
    default: 'channel',
    options: ['channel', 'periodic'],
    group: 'Simulation',
    description: 'Driven inlet/outlet channel or closed periodic mass-conservation probe.',
  },
  display: {
    type: 'enum',
    default: 'vorticity',
    options: ['vorticity', 'speed', 'density'],
    group: 'Display',
    description: 'Centered curl, velocity magnitude, or density perturbation.',
  },
  gain: f(15, 1, 80, 'Field display contrast.', 'Display'),
} as const;
const declarations = `
@group(1) @binding(0) var<storage,read> previous:array<f32>;
@group(1) @binding(1) var<storage,read_write> next:array<f32>;
@group(1) @binding(2) var<storage,read_write> fields:array<vec4f>;
const E=array<vec2i,9>(vec2i(0),vec2i(1,0),vec2i(0,1),vec2i(-1,0),vec2i(0,-1),vec2i(1,1),vec2i(-1,1),vec2i(-1,-1),vec2i(1,-1));
const W=array<f32,9>(4.0/9,1.0/9,1.0/9,1.0/9,1.0/9,1.0/36,1.0/36,1.0/36,1.0/36);
const O=array<u32,9>(0,3,4,1,2,7,8,5,6);
fn equilibrium(q:u32,rho:f32,v:vec2f)->f32{let eu=dot(vec2f(E[q]),v);return W[q]*rho*(1+3*eu+4.5*eu*eu-1.5*dot(v,v));}
fn solid(p:vec2i)->bool{let uv=(vec2f(p)+.5)/f32(u32(sqrt(f32(arrayLength(&fields)))));return distance(uv,vec2f(.3,.5))<params.obstacle||(params.boundary==0u&&(p.y==0||p.y==i32(u32(sqrt(f32(arrayLength(&fields)))))-1));}
`;
const code = {
  initialize: `@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){let i=id.x;let n=u32(sqrt(f32(arrayLength(&fields))));if(i>=n*n){return;}let p=vec2i(vec2u(i%n,i/n));var v=vec2f(params.flow,0);if(solid(p)){v=vec2f(0);}let rho=1.0+.001*sin(f32(i%n)*6.2831853/f32(n))*sin(f32(i/n)*6.2831853/f32(n));for(var q=0u;q<9u;q++){next[i*9u+q]=equilibrium(q,rho,v);}fields[i]=vec4f(v,rho,select(0.0,1.0,solid(p)));}`,
  step: `@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){let i=id.x;let n=u32(sqrt(f32(arrayLength(&fields))));if(i>=n*n){return;}let p=vec2i(vec2u(i%n,i/n));var fi:array<f32,9>;var rho=0.0;var velocity=vec2f(0);
 if(solid(p)){for(var q=0u;q<9u;q++){next[i*9u+q]=previous[i*9u+O[q]];}fields[i]=vec4f(0,0,1,1);return;}
 for(var q=0u;q<9u;q++){let src=(p-E[q]+vec2i(i32(n)))%vec2i(i32(n));var val=previous[u32(src.x+src.y*i32(n))*9u+q];if(solid(src)){val=previous[i*9u+O[q]];}fi[q]=val;rho+=val;velocity+=vec2f(E[q])*val;}
 velocity/=max(rho,.000001);
 if(params.boundary==0u&&p.x==0){rho=1;velocity=vec2f(params.flow,.0005*sin(f32(p.y)*.7));for(var q=0u;q<9u;q++){fi[q]=equilibrium(q,rho,velocity);}}
 if(params.boundary==0u&&p.x==i32(n)-1){rho=0;velocity=vec2f(0);for(var q=0u;q<9u;q++){fi[q]=previous[(i-1u)*9u+q];rho+=fi[q];velocity+=vec2f(E[q])*fi[q];}velocity/=max(rho,.000001);}
 for(var q=0u;q<9u;q++){next[i*9u+q]=fi[q]-(fi[q]-equilibrium(q,rho,velocity))/params.tau;}fields[i]=vec4f(velocity,rho,0);
 }`,
};
export default feedbackEffect({
  id: 'lattice-boltzmann',
  title: 'D2Q9 lattice Boltzmann',
  family: 'fluids',
  core: false,
  tags: ['lbm', 'bgk', 'vortex-shedding', 'bounce-back'],
  params,
  presets: {
    wake: { flow: 0.1, tau: 0.58, obstacle: 0.12, steps: 8 },
    density: { display: 'density', boundary: 'periodic', obstacle: 0, gain: 40 },
  },
  fallback: 'linear-gradient(90deg,#104351,#da8653)',
  async setup(ctx): Promise<FeedbackProgram> {
    const l = layout(ctx, ['read-only-storage', 'storage', 'storage']);
    const k = await kernels(ctx, 'lattice-boltzmann', l, code, declarations);
    const dl = layout(ctx, ['read-only-storage'], GPUShaderStage.FRAGMENT);
    const source = simulationSource(
      ctx.params.schema,
      `@group(1) @binding(0) var<storage,read> fields:array<vec4f>;
 fn at(p:vec2i)->vec4f{let n=i32(u32(sqrt(f32(arrayLength(&fields)))));let c=(p+vec2i(n))%vec2i(n);return fields[u32(c.x+c.y*n)];}
 @fragment fn fragment(in:VertexOut)->@location(0)vec4f {let n=i32(u32(sqrt(f32(arrayLength(&fields)))));let p=clamp(vec2i(in.uv*f32(n)),vec2i(0),vec2i(n-1));let m=at(p);if(m.w>.5){return vec4f(.018,.025,.03,1);}var value=(at(p+vec2i(1,0)).y-at(p-vec2i(1,0)).y-at(p+vec2i(0,1)).x+at(p-vec2i(0,1)).x)*params.gain;
 if(params.display==1u){value=length(m.xy)*params.gain-.5;}if(params.display==2u){value=(m.z-1)*params.gain;}
 let c=mix(vec3f(.02,.1,.16),select(vec3f(.08,.65,.8),vec3f(.95,.3,.08),value>0),clamp(.08+abs(value),0,1));return vec4f(c,1);}`,
    );
    let draw: Awaited<ReturnType<typeof createSimulationDisplay>> | undefined;
    let a: GPUBuffer | undefined,
      b: GPUBuffer | undefined,
      m: GPUBuffer | undefined,
      n = 0;
    try {
      draw = await createSimulationDisplay(
        ctx.session,
        source,
        ctx.format,
        'lattice-boltzmann-display',
        [simulationUniformLayout(ctx.device), dl],
      );
      function allocate() {
        const next = Number(ctx.params.values.grid);
        if (next === n) return false;
        [a, b, m].forEach((x) => x?.destroy());
        n = next;
        a = buffer(ctx, n * n * 36, 'lbm-a');
        b = buffer(ctx, n * n * 36, 'lbm-b');
        m = buffer(ctx, n * n * 16, 'lbm-fields');
        return true;
      }
      const bind = () => group(ctx, l, [a!, b!, m!]);
      return {
        resize() {
          return allocate();
        },
        initialize(e, _f, uniform) {
          allocate();
          k.passes.initialize!.dispatch(e, [uniform, bind()], [Math.ceil((n * n) / 64)]);
          [a, b] = [b, a];
        },
        step(e, _f, uniform, bytes) {
          const steps = new DataView(bytes).getUint32(
            ctx.params.layout.fields.find((f) => f.name === 'steps')!.offset,
            true,
          );
          for (let i = 0; i < Math.max(1, Math.round(steps * ctx.qualitySteps())); i++) {
            k.passes.step!.dispatch(e, [uniform, bind()], [Math.ceil((n * n) / 64)]);
            [a, b] = [b, a];
          }
        },
        display(e, target, _f, uniform) {
          draw!.draw(e, target, [uniform, group(ctx, dl, [m!])]);
        },
        bufferTaps: () => ({
          distributions: tap(a!, n * n, 36, 'D2Q9 populations in rest,E,S,W,N,SE,SW,NW,NE order'),
          macroscopic: tap(m!, n * n, 16, 'Velocity xy, density, solid flag'),
        }),
        memory: () => ({ textureBytes: 0, bufferBytes: a!.size + b!.size + m!.size }),
        sources: { ...k.sources, display: draw.source },
        diagnostics: [...k.diagnostics, ...draw.diagnostics],
        dispose() {
          [a, b, m].forEach((x) => x?.destroy());
          draw?.dispose();
          k.dispose();
        },
      };
    } catch (error) {
      [a, b, m].forEach((x) => x?.destroy());
      draw?.dispose();
      k.dispose();
      throw error;
    }
  },
});
