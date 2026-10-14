import { particleEffect, createSpatialHash, type ParticleProgram } from '@mk7s/hologpu-core';
import { f, u, tint, buffer, layout, group, kernels, tap, surface } from '../_stretch/common.ts';
const params = {
  count: u(256, 16, 2048, 'Fixed number of fluid particles.', 'Workload', true),
  support: f(0.065, 0.025, 0.15, 'SPH support radius and spatial hash cell width.'),
  restDensity: f(1800, 100, 12000, 'Target number density in normalized domain units.'),
  iterations: u(3, 1, 8, 'Jacobi density constraint iterations per fixed update.'),
  gravity: f(1.5, 0, 5, 'Downward acceleration.'),
  relaxation: f(0.001, 0.00001, 0.01, 'Lambda denominator regularizer.'),
  radius: f(0.021, 0.004, 0.06, 'Density splat radius for the screen-space surface.', 'Display'),
  tint,
} as const;
const declaration = 'struct Particle{pv:vec4f};';
const storage = `@group(1) @binding(0) var<storage,read> predicted:array<vec4f>;
@group(1) @binding(1) var<storage,read_write> output:array<vec4f>;
@group(1) @binding(2) var<storage,read> original:array<vec4f>;
@group(1) @binding(3) var<storage,read_write> statistics:array<vec4f>;
@group(1) @binding(4) var<storage,read> indices:array<u32>;
@group(1) @binding(5) var<storage,read> offsets:array<u32>;
fn kernel(r:vec2f)->f32{let h=params.support;let q=max(0.0,h*h-dot(r,r));return 4.0*q*q*q/(3.14159265*pow(h,8));}
fn grad(r:vec2f)->vec2f{let d=length(r);let h=params.support;if(d<.000001||d>=h){return vec2f(0);}return -30.0*pow(h-d,2)/(3.14159265*pow(h,5))*r/d;}
fn cell(p:vec2f)->vec2i{let n=i32(floor(1.0/params.support));return clamp(vec2i(p*f32(n)),vec2i(0),vec2i(n-1));}
`;
const code = {
  initialize: `@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=arrayLength(&output)){return;}let side=u32(ceil(sqrt(f32(arrayLength(&output)))));let p=vec2f(.25,.15)+vec2f(f32(i%side),f32(i/side))*(.38/f32(side))+vec2f(random(i+frame.seed),random(i+frame.seed+503u))*.001;output[i]=vec4f(p,0,0);statistics[i]=vec4f(0);}`,
  predict: `@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=arrayLength(&output)){return;}let p=original[i];var v=p.zw+vec2f(0,params.gravity)*frame.delta;if(frame.buttons!=0u){let d=p.xy-frame.pointer;v+=d*exp(-dot(d,d)*100.0)*frame.delta*40.0;}output[i]=vec4f(clamp(p.xy+frame.delta*v,vec2f(.025),vec2f(.975)),v);}`,
  lambda: `@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=arrayLength(&output)){return;}let p=predicted[i].xy;let c=cell(p);let n=i32(floor(1.0/params.support));var density=0.0;var denom=0.0;var own=vec2f(0);var neighbors=0u;
 for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){let cc=c+vec2i(x,y);if(any(cc<vec2i(0))||any(cc>=vec2i(n))){continue;}let k=u32(cc.x+cc.y*n);for(var j=offsets[k];j<offsets[k+1u];j++){let idx=indices[j];let r=p-predicted[idx].xy;density+=kernel(r);if(idx!=i&&dot(r,r)<params.support*params.support){let g=grad(r)/params.restDensity;denom+=dot(g,g);own+=g;neighbors++;}}}}
 let constraint=max(0.0,density/params.restDensity-1.0);let lambda=-constraint/(denom+dot(own,own)+params.relaxation);statistics[i]=vec4f(lambda,density,constraint,f32(neighbors));}`,
  correct: `@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=arrayLength(&output)){return;}let p=predicted[i];let c=cell(p.xy);let n=i32(floor(1.0/params.support));var dp=vec2f(0);
 for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){let cc=c+vec2i(x,y);if(any(cc<vec2i(0))||any(cc>=vec2i(n))){continue;}let k=u32(cc.x+cc.y*n);for(var j=offsets[k];j<offsets[k+1u];j++){let idx=indices[j];if(idx==i){continue;}dp+=(statistics[i].x+statistics[idx].x)*grad(p.xy-predicted[idx].xy)/params.restDensity;}}}
 let len=length(dp);dp*=min(1.0,.01/max(len,.000001));output[i]=vec4f(clamp(p.xy+dp,vec2f(.025),vec2f(.975)),p.zw);}`,
  finish: `@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=arrayLength(&output)){return;}let p=predicted[i].xy;let v=(p-original[i].xy)/max(frame.delta,.000001);output[i]=vec4f(p,clamp(v*.995,vec2f(-2),vec2f(2)));}`,
};
export default particleEffect({
  id: 'pbf-fluid',
  title: 'Position based fluid constraints',
  family: 'particles',
  core: false,
  tags: ['pbf', 'sph', 'spatial-hash', 'jacobi'],
  params,
  inputs: ['pointer'],
  presets: {
    dam: { gravity: 3, restDensity: 1700, tint: '#499edc' },
    soft: { restDensity: 2400, iterations: 5, support: 0.08, tint: '#83dccd' },
  },
  fallback: 'radial-gradient(ellipse,#56abdc,#081a2e)',
  async setup(ctx): Promise<ParticleProgram> {
    const l = layout(ctx, [
      'read-only-storage',
      'storage',
      'read-only-storage',
      'storage',
      'read-only-storage',
      'read-only-storage',
    ]);
    const k = await kernels(ctx, 'pbf-fluid', l, code, storage);
    let hashGrid: Awaited<ReturnType<typeof createSpatialHash>> | undefined,
      view: Awaited<ReturnType<typeof surface>> | undefined;
    let a: GPUBuffer | undefined,
      b: GPUBuffer | undefined,
      old: GPUBuffer | undefined,
      stats: GPUBuffer | undefined,
      count = 0;
    try {
      hashGrid = await createSpatialHash(ctx.session, 2048, {
        dimensions: [16, 16, 1],
        maxDimensions: [40, 40, 1],
        axes: 'xy',
      });
      view = await surface(ctx, 'pbf-fluid', declaration, 'particles[instance].pv.xy');
      function allocate() {
        const c = Number(ctx.params.values.count);
        if (c === count) return false;
        [a, b, old, stats].forEach((x) => x?.destroy());
        count = c;
        a = buffer(ctx, c * 16, 'pbf-a');
        b = buffer(ctx, c * 16, 'pbf-b');
        old = buffer(ctx, c * 16, 'pbf-old');
        stats = buffer(ctx, c * 16, 'pbf-statistics');
        return true;
      }
      const bind = () =>
        group(ctx, l, [a!, b!, old!, stats!, hashGrid!.sortedIndices, hashGrid!.cellOffsets]);
      const run = (name: string, e: GPUCommandEncoder, uniform: GPUBindGroup) =>
        k.passes[name]!.dispatch(e, [uniform, bind()], [Math.ceil(count / 64)]);
      return {
        resize(size) {
          view!.resize(size);
          return allocate();
        },
        initialize(e, _f, uniform) {
          allocate();
          run('initialize', e, uniform);
          [a, b] = [b, a];
          e.copyBufferToBuffer(a!, 0, old!, 0, count * 16);
        },
        step(e, _f, uniform, bytes) {
          e.copyBufferToBuffer(a!, 0, old!, 0, count * 16);
          run('predict', e, uniform);
          [a, b] = [b, a];
          const dv = new DataView(bytes);
          const value = (name: string) =>
            dv.getFloat32(ctx.params.layout.fields.find((f) => f.name === name)!.offset, true);
          const n = Math.floor(Math.fround(1 / value('support')));
          hashGrid!.resize([n, n, 1]);
          const iterations = dv.getUint32(
            ctx.params.layout.fields.find((f) => f.name === 'iterations')!.offset,
            true,
          );
          for (let i = 0; i < Math.max(1, Math.round(iterations * ctx.qualitySteps())); i++) {
            hashGrid!.encode(e, a!, count);
            run('lambda', e, uniform);
            run('correct', e, uniform);
            [a, b] = [b, a];
          }
          run('finish', e, uniform);
          [a, b] = [b, a];
        },
        display(e, target, _f, uniform) {
          view!.draw(e, target, uniform, a!, count);
        },
        textureTaps: () => view!.textureTaps(),
        bufferTaps: () => ({
          particles: tap(a!, count, 16, 'Position xy and reconstructed velocity xy'),
          constraints: tap(
            stats!,
            count,
            16,
            'Lambda, density, positive constraint error, neighbor count',
          ),
          sortedIndices: tap(hashGrid!.sortedIndices, count, 4, 'Last Jacobi input sorted IDs'),
          cellOffsets: tap(
            hashGrid!.cellOffsets,
            hashGrid!.cellCount + 1,
            4,
            'Contiguous exclusive cell ranges',
          ),
        }),
        memory: () => ({
          textureBytes: view!.bytes,
          bufferBytes: a!.size + b!.size + old!.size + stats!.size + hashGrid!.memory.bufferBytes,
        }),
        sources: { ...k.sources, ...hashGrid.sources, ...view.sources },
        diagnostics: [...k.diagnostics, ...hashGrid.diagnostics, ...view.diagnostics],
        dispose() {
          [a, b, old, stats].forEach((x) => x?.destroy());
          view?.dispose();
          hashGrid?.dispose();
          k.dispose();
        },
      };
    } catch (error) {
      [a, b, old, stats].forEach((x) => x?.destroy());
      view?.dispose();
      hashGrid?.dispose();
      k.dispose();
      throw error;
    }
  },
});
