import {
  feedbackEffect,
  defineEffect,
  createSort,
  createParticleDraw,
  simulationSource,
  simulationUniformLayout,
  type FeedbackProgram,
} from '@mk7s/hologpu-core';
import { f, u, buffer, layout, group, kernels, tap } from '../_stretch/common.ts';
const params = {
  count: u(
    2048,
    16,
    16384,
    'Procedural 3D Gaussian samples (no trained asset loader).',
    'Workload',
    true,
  ),
  size: f(1, 0.3, 3, 'World-space covariance scale.', 'Display'),
  opacity: f(0.4, 0.02, 0.95, 'Peak Gaussian alpha, before overlap compositing.', 'Display'),
  speed: f(0.2, 0, 1, 'Camera orbit speed in radians per second.', 'Camera'),
  angle: f(0, -3.14, 3.14, 'Additional yaw.', 'Camera'),
  order: {
    type: 'enum',
    default: 'sorted',
    options: ['sorted', 'source'],
    group: 'Rendering',
    description:
      'GPU back-to-front depth sorting versus source order to expose transparency errors.',
  },
} as const;
const declarations = `struct Splat{position:vec4f,color:vec4f,a:vec4f,b:vec4f,c:vec4f};struct Projected{center:vec4f,conic:vec4f,color:vec4f,extent:vec4f};
@group(1) @binding(0) var<storage,read_write> splats:array<Splat>;
@group(1) @binding(1) var<storage,read_write> projected:array<Projected>;
@group(1) @binding(2) var<storage,read_write> keys:array<u32>;
@group(1) @binding(3) var<storage,read_write> ids:array<u32>;
fn rotate(p:vec3f,a:f32)->vec3f{let c=cos(a);let s=sin(a);return vec3f(c*p.x+s*p.z,p.y,-s*p.x+c*p.z);}
`;
const code = {
  initialize: `@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=arrayLength(&splats)){return;}let t=f32(i)/f32(arrayLength(&splats));let phi=t*31.4159265;let r=.5+.25*random(i+frame.seed);let p=vec3f(r*cos(phi),(t-.5)*1.8,r*sin(phi));let rotation=phi*.7;let c=cos(rotation);let s=sin(rotation);splats[i]=Splat(vec4f(p,1),vec4f(.25+.65*t,.3+.5*(1-t),.65+.2*sin(phi),1),vec4f(c*.06,s*.06,0,0),vec4f(-s*.018,c*.018,0,0),vec4f(0,0,.025,0));}`,
  project: `@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=arrayLength(&splats)){return;}let splat=splats[i];let angle=params.angle+frame.time*params.speed;let p=rotate(splat.position.xyz,angle)+vec3f(0,0,3);let aspect=frame.resolution.x/frame.resolution.y;let f=1.8;let center=vec2f(f*p.x/(aspect*p.z),f*p.y/p.z);
 let jx=vec3f(f/(aspect*p.z),0,-f*p.x/(aspect*p.z*p.z));let jy=vec3f(0,f/p.z,-f*p.y/(p.z*p.z));let a=rotate(splat.a.xyz*params.size,angle);let b=rotate(splat.b.xyz*params.size,angle);let c=rotate(splat.c.xyz*params.size,angle);
 let x=vec3f(dot(jx,a),dot(jx,b),dot(jx,c));let y=vec3f(dot(jy,a),dot(jy,b),dot(jy,c));let xx=dot(x,x)+4.0/(frame.resolution.x*frame.resolution.x);let yy=dot(y,y)+4.0/(frame.resolution.y*frame.resolution.y);let xy=dot(x,y);let det=max(xx*yy-xy*xy,1e-12);
 projected[i]=Projected(vec4f(center,p.z,1),vec4f(yy/det,-xy/det,xx/det,0),vec4f(splat.color.rgb,params.opacity),vec4f(3*sqrt(xx),3*sqrt(yy),0,0));keys[i]=0xffffffffu-bitcast<u32>(p.z);ids[i]=i;
 }`,
};
const drawing = `struct Projected{center:vec4f,conic:vec4f,color:vec4f,extent:vec4f};
@group(1) @binding(0) var<storage,read> projected:array<Projected>;@group(1) @binding(1) var<storage,read> order:array<u32>;
struct Out{@builtin(position) position:vec4f,@location(0) delta:vec2f,@location(1) conic:vec3f,@location(2) color:vec4f};
@vertex fn particleVertex(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Out{let corners=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));let p=projected[order[instance]];let d=corners[vertex]*p.extent.xy;var out:Out;out.position=vec4f(p.center.xy+d,0,1);out.delta=d;out.conic=p.conic.xyz;out.color=p.color;return out;}
@fragment fn particleFragment(in:Out)->@location(0)vec4f{let q=in.conic.x*in.delta.x*in.delta.x+2*in.conic.y*in.delta.x*in.delta.y+in.conic.z*in.delta.y*in.delta.y;if(q>9){discard;}let alpha=min(.99,in.color.a*exp(-q*.5));return vec4f(in.color.rgb*alpha,alpha);}`;
const definition = feedbackEffect({
  id: 'splats',
  title: 'GPU sorted anisotropic Gaussian splats',
  family: 'geometry',
  core: false,
  tags: ['gaussian', 'covariance', 'radix-sort', 'alpha-compositing'],
  params,
  presets: {
    wisps: { size: 1.6, opacity: 0.15, speed: 0.35 },
    dense: { size: 0.7, opacity: 0.7, angle: 0.7 },
  },
  fallback: 'radial-gradient(ellipse,#a184ca,#16304b)',
  async setup(ctx): Promise<FeedbackProgram> {
    const l = layout(ctx, ['storage', 'storage', 'storage', 'storage']);
    const k = await kernels(ctx, 'splats', l, code, declarations);
    let sort: Awaited<ReturnType<typeof createSort>> | undefined,
      draw: Awaited<ReturnType<typeof createParticleDraw>> | undefined;
    let data: GPUBuffer | undefined,
      p: GPUBuffer | undefined,
      keys: GPUBuffer | undefined,
      ids: GPUBuffer | undefined,
      sorted: { keys: GPUBuffer; values: GPUBuffer } | undefined,
      count = 0;
    try {
      sort = await createSort(ctx.session, 16384);
      const dl = layout(ctx, ['read-only-storage', 'read-only-storage'], GPUShaderStage.VERTEX);
      draw = await createParticleDraw(ctx.session, simulationSource(ctx.params.schema, drawing), {
        label: 'splats-composite',
        format: ctx.format,
        layouts: [simulationUniformLayout(ctx.device), dl],
        mode: 'quad',
        alphaOver: true,
      });
      function allocate() {
        const n = Number(ctx.params.values.count);
        if (n === count) return false;
        [data, p, keys, ids].forEach((b) => b?.destroy());
        count = n;
        data = buffer(ctx, count * 80, 'splats-data');
        p = buffer(ctx, count * 64, 'splats-projected');
        keys = buffer(ctx, count * 4, 'splats-keys');
        ids = buffer(ctx, count * 4, 'splats-ids');
        sorted = undefined;
        return true;
      }
      const bind = () => group(ctx, l, [data!, p!, keys!, ids!]);
      return {
        resize() {
          return allocate();
        },
        initialize(e, _f, uniform) {
          allocate();
          k.passes.initialize!.dispatch(e, [uniform, bind()], [Math.ceil(count / 64)]);
        },
        step() {},
        display(e, target, _f, uniform) {
          k.passes.project!.dispatch(e, [uniform, bind()], [Math.ceil(count / 64)]);
          sorted = sort!.encode(e, keys!, ids!, count);
          draw!.draw(
            e,
            target,
            [
              uniform,
              group(ctx, dl, [p!, ctx.params.values.order === 'sorted' ? sorted.values : ids!]),
            ],
            count,
          );
        },
        bufferTaps: () => ({
          splats: tap(data!, count, 80, 'World mean, RGB/alpha, three rotated covariance axes'),
          projected: tap(
            p!,
            count,
            64,
            'Projected mean/depth, inverse covariance, color, 3-sigma extent',
          ),
          sortedKeys: tap(
            sorted?.keys ?? keys!,
            count,
            4,
            'Inverted positive depth bits, ascending means back-to-front',
          ),
          sortedIndices: tap(sorted?.values ?? ids!, count, 4, 'Depth ordered Gaussian IDs'),
        }),
        memory: () => ({
          textureBytes: 0,
          bufferBytes: data!.size + p!.size + keys!.size + ids!.size + sort!.memory.bufferBytes,
        }),
        sources: { ...k.sources, ...sort.sources, composite: draw.source },
        diagnostics: [...k.diagnostics, ...sort.diagnostics, ...draw.diagnostics],
        dispose() {
          [data, p, keys, ids].forEach((b) => b?.destroy());
          sort?.dispose();
          draw?.dispose();
          k.dispose();
        },
      };
    } catch (error) {
      [data, p, keys, ids].forEach((b) => b?.destroy());
      sort?.dispose();
      draw?.dispose();
      k.dispose();
      throw error;
    }
  },
});
export default defineEffect({ ...definition, tier: 'T5' });
