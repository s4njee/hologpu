import { particleEffect, type ParticleProgram } from '@mk7s/hologpu-core';
import { f, u, tint, buffer, layout, group, kernels, tap, surface } from '../_stretch/common.ts';
const params = {
  count: u(
    1024,
    16,
    4096,
    'Material samples, each carrying position, velocity, affine momentum and deformation.',
    'Workload',
    true,
  ),
  grid: u(
    32,
    16,
    64,
    'Square background grid resolution. Gather P2G avoids non-portable float atomics.',
    'Workload',
    true,
  ),
  material: {
    type: 'enum',
    default: 'liquid',
    options: ['liquid', 'jelly', 'snow'],
    group: 'Material',
    description:
      'Weakly compressible liquid, compressible elastic jelly, or volumetric plastic snow approximation.',
  },
  bulk: f(30, 0, 100, 'Bulk stiffness; lower values permit greater compression.'),
  gravity: f(2, 0, 5, 'Downward acceleration in normalized domain units.'),
  dt: f(0.002, 0.0005, 0.004, 'Time per transfer substep, independent of display refresh.'),
  steps: u(4, 1, 8, 'Transfer substeps per fixed update.'),
  radius: f(0.011, 0.002, 0.04, 'Screen-space density splat radius.', 'Display'),
  tint,
} as const;
const declaration = `struct Particle {pv:vec4f,C:mat2x2f,F:mat2x2f,plastic:vec4f};`;
const storage =
  declaration +
  `
@group(1) @binding(0) var<storage,read> particles:array<Particle>;
@group(1) @binding(1) var<storage,read_write> next:array<Particle>;
@group(1) @binding(2) var<storage,read_write> grid:array<vec4f>;
fn weight(x:f32)->f32 {let a=abs(x);if(a<.5){return .75-a*a;}if(a<1.5){return .5*(1.5-a)*(1.5-a);}return 0;}
fn identity()->mat2x2f{return mat2x2f(1,0,0,1);}
`;
const code = {
  initialize: `@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=arrayLength(&next)){return;}let side=u32(ceil(sqrt(f32(arrayLength(&next)))));let p=vec2f(.25,.15)+vec2f(f32(i%side),f32(i/side))*(.38/f32(side))+vec2f(random(i+frame.seed),random(i*3u+frame.seed))*.001;next[i]=Particle(vec4f(p,0,0),mat2x2f(0,0,0,0),identity(),vec4f(1,0,0,0));}`,
  p2g: `@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){let i=id.x;let n=u32(sqrt(f32(arrayLength(&grid))));if(i>=n*n){return;}let node=vec2f(f32(i%n),f32(i/n));let h=1.0/f32(n);let mass=1.0/f32(arrayLength(&next));let volume=mass*.12;var momentum=vec2f(0);var total=0.0;
 for(var j=0u;j<arrayLength(&next);j++){let p=particles[j];let d=node-p.pv.xy*f32(n);let w=weight(d.x)*weight(d.y);if(w==0){continue;}let J=max(.2,determinant(p.F));var stress=identity()*(params.bulk*(J-1.0)*J);
 if(params.material==1u){stress=(p.F*transpose(p.F)-identity())*(params.bulk*.4)+identity()*(params.bulk*.6*log(J));}
 let affine=p.C*mass-stress*(params.dt*volume*4.0/(h*h));momentum+=w*(p.pv.zw*mass+affine*(d*h));total+=w*mass;}
 var v=vec2f(0);if(total>0){v=momentum/total;v.y+=params.dt*params.gravity;let cell=vec2u(i%n,i/n);if(cell.x<2u&&v.x<0){v.x=0;}if(cell.x>n-3u&&v.x>0){v.x=0;}if(cell.y<2u&&v.y<0){v.y=0;}if(cell.y>n-3u&&v.y>0){v.y=0;}}
 grid[i]=vec4f(v,total,0);
 }`,
  g2p: `@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=arrayLength(&next)){return;}let p=particles[i];let n=i32(u32(sqrt(f32(arrayLength(&grid)))));let x=p.pv.xy*f32(n);let base=vec2i(floor(x-.5));var v=vec2f(0);var C=mat2x2f(0,0,0,0);
 for(var y=0;y<3;y++){for(var xx=0;xx<3;xx++){let node=base+vec2i(xx,y);if(any(node<vec2i(0))||any(node>=vec2i(n))){continue;}let d=vec2f(node)-x;let w=weight(d.x)*weight(d.y);let gv=grid[u32(node.x+node.y*n)].xy;v+=w*gv;C+=mat2x2f(gv*d.x,gv*d.y)*(w*4.0*f32(n));}}
 v=clamp(v,vec2f(-2),vec2f(2));let pos=clamp(p.pv.xy+params.dt*v,vec2f(2.0/f32(n)),vec2f(1.0-2.0/f32(n)));var F=(identity()+C*params.dt)*p.F;let J=max(.01,determinant(F));var plastic=p.plastic;
 if(params.material==0u){F=identity()*sqrt(clamp(J,.5,1.5));}
 if(params.material==2u){let elastic=clamp(J,.9,1.05);F*=sqrt(elastic/J);plastic.x*=J/elastic;}
 next[i]=Particle(vec4f(pos,v),C,F,plastic);
 }`,
};
export default particleEffect({
  id: 'mpm',
  title: 'Material point transfers',
  family: 'particles',
  core: false,
  tags: ['mpm', 'apic', 'particle-grid', 'elasticity'],
  params,
  presets: {
    jelly: { material: 'jelly', bulk: 65, tint: '#d58ecb' },
    snow: { material: 'snow', bulk: 80, gravity: 3, tint: '#d9edf5' },
  },
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback: 'radial-gradient(ellipse,#54c4da,#0a162a)',
  async setup(ctx): Promise<ParticleProgram> {
    const l = layout(ctx, ['read-only-storage', 'storage', 'storage']);
    const k = await kernels(ctx, 'mpm', l, code, storage);
    let view: Awaited<ReturnType<typeof surface>> | undefined;
    let a: GPUBuffer | undefined,
      b: GPUBuffer | undefined,
      g: GPUBuffer | undefined,
      count = 0,
      n = 0;
    try {
      view = await surface(ctx, 'mpm', declaration, 'particles[instance].pv.xy');
      function allocate() {
        const c = Number(ctx.params.values.count),
          d = Number(ctx.params.values.grid);
        if (c === count && d === n) return false;
        a?.destroy();
        b?.destroy();
        g?.destroy();
        count = c;
        n = d;
        a = buffer(ctx, c * 64, 'mpm-a');
        b = buffer(ctx, c * 64, 'mpm-b');
        g = buffer(ctx, d * d * 16, 'mpm-grid');
        return true;
      }
      return {
        resize(size) {
          view!.resize(size);
          return allocate();
        },
        initialize(e, _f, uniform) {
          allocate();
          k.passes.initialize!.dispatch(
            e,
            [uniform, group(ctx, l, [a!, b!, g!])],
            [Math.ceil(count / 64)],
          );
          [a, b] = [b, a];
          e.clearBuffer(g!);
        },
        step(e, _f, uniform, bytes) {
          const dv = new DataView(bytes);
          const steps = dv.getUint32(
            ctx.params.layout.fields.find((f) => f.name === 'steps')!.offset,
            true,
          );
          for (let i = 0; i < Math.max(1, Math.round(steps * ctx.qualitySteps())); i++) {
            const bind = group(ctx, l, [a!, b!, g!]);
            k.passes.p2g!.dispatch(e, [uniform, bind], [Math.ceil((n * n) / 64)]);
            k.passes.g2p!.dispatch(e, [uniform, bind], [Math.ceil(count / 64)]);
            [a, b] = [b, a];
          }
        },
        display(e, target, _f, uniform) {
          view!.draw(e, target, uniform, a!, count);
        },
        bufferTaps() {
          return {
            particles: tap(a!, count, 64, 'pv xy/vxy, C 2x2, F 2x2, plastic volume'),
            grid: tap(g!, n * n, 16, 'Grid velocity xy, nodal mass, padding'),
          };
        },
        textureTaps: () => view!.textureTaps(),
        memory: () => ({ textureBytes: view!.bytes, bufferBytes: a!.size + b!.size + g!.size }),
        sources: { ...k.sources, ...view.sources },
        diagnostics: [...k.diagnostics, ...view.diagnostics],
        dispose() {
          a?.destroy();
          b?.destroy();
          g?.destroy();
          view?.dispose();
          k.dispose();
        },
      };
    } catch (error) {
      a?.destroy();
      b?.destroy();
      g?.destroy();
      view?.dispose();
      k.dispose();
      throw error;
    }
  },
});
