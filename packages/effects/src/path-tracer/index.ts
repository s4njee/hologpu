import {
  feedbackEffect,
  createSimulationDisplay,
  simulationSource,
  simulationUniformLayout,
  defineEffect,
  type FeedbackProgram,
} from '@mk7s/hologpu-core';
import { f, u, buffer, layout, group, kernels, tap } from '../_stretch/common.ts';
import { sphereBVH, tracerSpheres } from '../_stretch/bvh.ts';
const params = {
  samples: u(1, 1, 4, 'Paths added per pixel per fixed update.'),
  bounces: u(4, 1, 8, 'Maximum diffuse/specular path segments.'),
  angle: f(
    0,
    -3.14,
    3.14,
    'Static camera yaw; changing the camera clears accumulated radiance.',
    'Camera',
  ),
  material: {
    type: 'enum',
    default: 'mixed',
    options: ['mixed', 'diffuse'],
    group: 'Material',
    description: 'Ideal mirror on the right sphere, or all Lambertian spheres.',
  },
  exposure: f(
    1.2,
    0.1,
    4,
    'Exposure after averaging; changing it retains the accumulation.',
    'Display',
  ),
} as const;
const declaration = `struct Sphere{cr:vec4f,color:vec4f};struct Node{lo:vec3f,left:u32,hi:vec3f,right:u32};
@group(1) @binding(0) var<storage,read> spheres:array<Sphere>;
@group(1) @binding(1) var<storage,read> nodes:array<Node>;
@group(1) @binding(2) var<storage,read_write> accumulation:array<vec4f>;
@group(1) @binding(3) var<storage,read_write> hits:array<vec4f>;
fn sphere_hit(o:vec3f,d:vec3f,s:Sphere)->f32{let oc=o-s.cr.xyz;let b=dot(oc,d);let c=dot(oc,oc)-s.cr.w*s.cr.w;let q=b*b-c;if(q<0){return 1e20;}let a=-b-sqrt(q);let z=-b+sqrt(q);if(a>.0001){return a;}if(z>.0001){return z;}return 1e20;}
fn box_hit(o:vec3f,d:vec3f,node:Node,limit:f32)->bool{let safe=select(vec3f(1e-8),d,abs(d)>vec3f(1e-8));let a=(node.lo-o)/safe;let b=(node.hi-o)/safe;let near=min(a,b);let far=max(a,b);return max(max(max(near.x,near.y),near.z),0.0)<=min(min(min(far.x,far.y),far.z),limit);}
fn intersect(o:vec3f,d:vec3f)->vec2f{var stack:array<u32,32>;stack[0]=0u;var top=1u;var nearest=1e20;var sphere=-1.0;
 loop{if(top==0u){break;}top--;let node=nodes[stack[top]];if(!box_hit(o,d,node,nearest)){continue;}if(node.left==0xffffffffu){let t=sphere_hit(o,d,spheres[node.right]);if(t<nearest){nearest=t;sphere=f32(node.right);}}else{stack[top]=node.left;stack[top+1u]=node.right;top+=2u;}}
 return vec2f(nearest,sphere);}
fn rng(state:ptr<function,u32>)->f32{*state=hash_u32(*state+0x9e3779b9u);return f32(*state>>8u)/16777216.0;}
fn ray(uv:vec2f)->vec3f{let local=normalize(vec3f((uv*2-1)*vec2f(frame.resolution.x/frame.resolution.y,-1)*.55,-1));let c=cos(params.angle);let s=sin(params.angle);return vec3f(c*local.x+s*local.z,local.y,-s*local.x+c*local.z);}
fn eye()->vec3f{return vec3f(3.5*sin(params.angle),.5,3.5*cos(params.angle));}
`;
const trace = `@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){let width=u32(frame.resolution.x);let height=u32(frame.resolution.y);let i=id.x;if(i>=width*height){return;}let pixel=vec2f(f32(i%width),f32(i/width));let primary=intersect(eye(),ray((pixel+.5)/frame.resolution));hits[i]=vec4f(select(primary.x,0.0,primary.y<0),primary.y,0,0);
 var sum=accumulation[i];for(var sample=0u;sample<params.samples;sample++){var seed=hash_u32(i^frame.seed^hash_u32(u32(sum.w)));let uv=(pixel+vec2f(rng(&seed),rng(&seed)))/frame.resolution;var origin=eye();var direction=ray(uv);var throughput=vec3f(1);var radiance=vec3f(0);
 for(var bounce=0u;bounce<params.bounces;bounce++){let hit=intersect(origin,direction);if(hit.y<0){radiance+=throughput*mix(vec3f(.08,.12,.2),vec3f(.6,.75,1),clamp(direction.y*.5+.5,0,1));break;}let idx=u32(hit.y);let sphere=spheres[idx];let p=origin+direction*hit.x;let n=normalize(p-sphere.cr.xyz);radiance+=throughput*sphere.color.rgb*sphere.color.w;if(sphere.color.w>0){break;}
 throughput*=sphere.color.rgb;origin=p+n*.0005;if(params.material==0u&&idx==2u){direction=reflect(direction,n);}else{let r=sqrt(rng(&seed));let phi=6.2831853*rng(&seed);let tangent=normalize(cross(select(vec3f(0,1,0),vec3f(1,0,0),abs(n.y)>.9),n));let bitangent=cross(n,tangent);direction=normalize(tangent*(r*cos(phi))+bitangent*(r*sin(phi))+n*sqrt(1-r*r));}
 }
 sum+=vec4f(radiance,1);
 }accumulation[i]=sum;}`;
const definition = feedbackEffect({
  id: 'path-tracer',
  title: 'Progressive BVH path tracer',
  family: 'geometry',
  core: false,
  tags: ['bvh', 'path-tracing', 'progressive', 'compute-rendering'],
  params,
  presets: {
    diffuse: { material: 'diffuse', bounces: 6, exposure: 1.5 },
    mirror: { material: 'mixed', angle: 0.5, bounces: 8 },
  },
  fallback: 'radial-gradient(circle at 35% 60%,#cda174,#182238)',
  async setup(ctx): Promise<FeedbackProgram> {
    const l = layout(ctx, ['read-only-storage', 'read-only-storage', 'storage', 'storage']);
    const k = await kernels(ctx, 'path-tracer', l, { trace }, declaration);
    let draw: Awaited<ReturnType<typeof createSimulationDisplay>> | undefined;
    const dl = layout(ctx, ['read-only-storage'], GPUShaderStage.FRAGMENT);
    let scene: GPUBuffer | undefined,
      bvh: GPUBuffer | undefined,
      acc: GPUBuffer | undefined,
      hits: GPUBuffer | undefined,
      width = 0,
      height = 0,
      signature = '';
    try {
      const built = sphereBVH(tracerSpheres);
      scene = buffer(ctx, tracerSpheres.length * 32, 'tracer-spheres');
      bvh = buffer(ctx, built.bytes.byteLength, 'tracer-bvh');
      const data = new Float32Array(tracerSpheres.length * 8);
      const colors = [
        [0.65, 0.65, 0.65, 0],
        [0.7, 0.12, 0.045, 0],
        [0.65, 0.75, 0.9, 0],
        [0.15, 0.55, 0.25, 0],
        [1, 0.9, 0.7, 6],
        [0.6, 0.4, 0.08, 0],
        [0.2, 0.3, 0.6, 0],
      ];
      tracerSpheres.forEach((s, i) => {
        data.set(s, i * 8);
        data.set(colors[i]!, i * 8 + 4);
      });
      ctx.device.queue.writeBuffer(scene, 0, data);
      ctx.device.queue.writeBuffer(bvh, 0, built.bytes);
      const source = simulationSource(
        ctx.params.schema,
        `@group(1) @binding(0) var<storage,read> accumulation:array<vec4f>;@fragment fn fragment(in:VertexOut)->@location(0)vec4f {let size=vec2u(frame.resolution);let p=min(vec2u(in.uv*frame.resolution),size-1u);let sample=accumulation[p.x+p.y*size.x];let c=max(sample.rgb/max(sample.w,1.0)*params.exposure,vec3f(0));return vec4f(c/(1+c),1);}`,
      );
      draw = await createSimulationDisplay(ctx.session, source, ctx.format, 'path-tracer-display', [
        simulationUniformLayout(ctx.device),
        dl,
      ]);
      const sig = () =>
        JSON.stringify([
          ctx.params.values.angle,
          ctx.params.values.material,
          ctx.params.values.bounces,
        ]);
      const run = (e: GPUCommandEncoder, uniform: GPUBindGroup) =>
        k.passes.trace!.dispatch(
          e,
          [uniform, group(ctx, l, [scene!, bvh!, acc!, hits!])],
          [Math.ceil((width * height) / 64)],
        );
      return {
        resize(size) {
          if (width === size[0] && height === size[1]) return false;
          acc?.destroy();
          hits?.destroy();
          [width, height] = size;
          acc = buffer(ctx, width * height * 16, 'tracer-accumulation');
          hits = buffer(ctx, width * height * 16, 'tracer-primary-hits');
          return true;
        },
        initialize(e, _f, uniform) {
          signature = sig();
          e.clearBuffer(acc!);
          run(e, uniform);
        },
        step(e, _f, uniform) {
          run(e, uniform);
        },
        display(e, target, _f, uniform) {
          if (signature !== sig()) {
            signature = sig();
            e.clearBuffer(acc!);
            run(e, uniform);
          }
          draw!.draw(e, target, [uniform, group(ctx, dl, [acc!])]);
        },
        bufferTaps: () => ({
          accumulation: tap(acc!, width * height, 16, 'Summed radiance RGB and exact path count'),
          primaryHits: tap(
            hits!,
            width * height,
            16,
            'Unjittered primary distance and sphere ID (-1 misses)',
          ),
          spheres: tap(scene!, tracerSpheres.length, 32, 'Center/radius, albedo RGB/emission'),
          bvh: tap(bvh!, built.nodes.length, 32, 'AABB min/left and max/right u32 links'),
        }),
        memory: () => ({
          textureBytes: 0,
          bufferBytes: scene!.size + bvh!.size + acc!.size + hits!.size,
        }),
        sources: { ...k.sources, display: draw.source },
        diagnostics: [...k.diagnostics, ...draw.diagnostics],
        dispose() {
          [scene, bvh, acc, hits].forEach((b) => b?.destroy());
          k.dispose();
          draw?.dispose();
        },
      };
    } catch (error) {
      [scene, bvh, acc, hits].forEach((b) => b?.destroy());
      k.dispose();
      draw?.dispose();
      throw error;
    }
  },
});
export default defineEffect({ ...definition, tier: 'T5' });
