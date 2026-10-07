import {
  createJumpFlood,
  createComputePass,
  createSimulationDisplay,
  simulationSource,
  simulationUniformLayout,
  type EffectContext,
  type EffectInstance,
  type ParamSchema,
  type TextureTap,
  type ComputePass,
} from '@mk7s/hologpu-core';
export async function createLighting(
  ctx: EffectContext<ParamSchema>,
  kind: 'jump' | 'shadows' | 'cascades',
): Promise<EffectInstance> {
  const d = ctx.device,
    u = simulationUniformLayout(d),
    owned: { dispose(): void }[] = [];
  let size = Number(ctx.params.values['grid']),
    disposed = false;
  const jfa = await createJumpFlood(ctx.session, [size, size]);
  owned.push(jfa);
  let scene: GPUTexture,
    irradiance: GPUTexture[] = [],
    cascade: GPUTexture[] = [],
    mask: GPUTexture;
  const rects = d.createBuffer({
    size: 16 + 64 * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  d.queue.writeBuffer(rects, 0, new Uint32Array([0, 0, 0, 0]));
  const constants = new Map<string, GPUBuffer>();
  const args = (level: number, bounce: number) => {
    const key = `${level}:${bounce}:${size}`;
    let b = constants.get(key);
    if (!b) {
      b = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(b, 0, new Uint32Array([level, size, bounce, 0]));
      constants.set(key, b);
    }
    return b;
  };
  const texture = (w: number, h: number, format: GPUTextureFormat, label: string) =>
    d.createTexture({
      label,
      size: [w, h],
      format,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
  const uploadText = (text: string) => {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const x = c.getContext('2d')!;
    x.clearRect(0, 0, size, size);
    x.fillStyle = 'white';
    x.font = `bold ${size * 0.35}px sans-serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(text.slice(0, 32), size / 2, size / 2, size * 0.85);
    d.queue.copyExternalImageToTexture({ source: c }, { texture: mask }, [size, size]);
  };
  let text = 'HGPU';
  const allocate = () => {
    scene?.destroy();
    mask?.destroy();
    irradiance.forEach((t) => t.destroy());
    cascade.forEach((t) => t.destroy());
    scene = texture(size, size, 'rgba16float', 'lighting-scene');
    mask = texture(size, size, 'rgba8unorm', 'lighting-text-mask');
    irradiance = [
      texture(size, size, 'rgba16float', 'irradiance-a'),
      texture(size, size, 'rgba16float', 'irradiance-b'),
    ];
    cascade = Array.from({ length: kind === 'cascades' ? 4 : 0 }, (_, l) => {
      const n = Math.max(1, (size / 4) >> l),
        angles = 4 * 4 ** l;
      return texture(n * angles, n, 'rgba16float', `radiance-cascade-${l}`);
    });
    uploadText(text);
  };
  allocate();
  const sampled = (binding: number): GPUBindGroupLayoutEntry => ({
    binding,
    visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
    texture: { sampleType: 'unfilterable-float' },
  });
  const storage = (binding: number, format: GPUTextureFormat): GPUBindGroupLayoutEntry => ({
    binding,
    visibility: GPUShaderStage.COMPUTE,
    storageTexture: { access: 'write-only', format },
  });
  const make = async (code: string, name: string, entries: GPUBindGroupLayoutEntry[]) => {
    const layout = d.createBindGroupLayout({ entries });
    const p = await createComputePass(
      ctx.session,
      simulationSource(ctx.params.schema, code),
      `lighting-${name}`,
      [u, layout],
    );
    owned.push(p);
    return p;
  };
  const group0 = d.createBindGroup({
    layout: u,
    entries: [
      { binding: 0, resource: { buffer: ctx.frameBuffer } },
      { binding: 1, resource: { buffer: ctx.paramsBuffer } },
    ],
  });
  const dispatch = (
    p: ComputePass,
    e: GPUCommandEncoder,
    resources: (GPUTexture | GPUBuffer)[],
    w = size,
    h = size,
  ) => {
    p.dispatch(
      e,
      [
        group0,
        d.createBindGroup({
          layout: p.pipeline.getBindGroupLayout(1),
          entries: resources.map((r, binding) => ({
            binding,
            resource: 'createView' in r ? r.createView({ mipLevelCount: 1 }) : { buffer: r },
          })),
        }),
      ],
      [Math.ceil(w / 8), Math.ceil(h / 8)],
    );
  };
  const sceneCode = `@group(1) @binding(0) var input:texture_2d<f32>; @group(1) @binding(1) var output:texture_storage_2d<rgba16float,write>;
struct Rects{count:vec4u,items:array<vec4f>};@group(1) @binding(2) var<storage,read> rects:Rects;
struct Config{level:u32,size:u32,bounce:u32,connected:u32};@group(1) @binding(3) var<uniform> cfg:Config;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){let n=textureDimensions(output);if(any(id.xy>=n)){return;}let uv=(vec2f(id.xy)+0.5)/vec2f(n);let inSize=textureDimensions(input);let c=textureLoad(input,vec2i(min(vec2u(uv*vec2f(inSize)),inSize-1u)),0);var occ=0.0;
if(params.scene==0u||cfg.level>0u){let coverage=select(c.a,dot(c.rgb,vec3f(0.2126,0.7152,0.0722)),params.channel==1u);occ=select(0.0,1.0,coverage>=params.threshold);}
if(params.scene==1u&&cfg.level==0u){occ=select(0.0,1.0,(uv.x>0.35&&uv.x<0.41&&uv.y>0.25&&uv.y<0.78)||(uv.x>0.60&&uv.x<0.76&&uv.y>0.62&&uv.y<0.70));}
if(params.scene==3u&&cfg.level==0u){occ=1.0;}
for(var i=0u;i<min(rects.count.x,64u);i++){let r=rects.items[i];if(all(uv>=r.xy)&&all(uv<r.xy+r.zw)){occ=1.0;}}
var emission=vec3f(0.0);
${kind === 'cascades' ? `if(params.scene<2u||cfg.level>0u){if(length(uv-vec2f(0.19,0.23))<0.04){emission=vec3f(5.0,1.2,0.2);occ=1.0;}if(length(uv-vec2f(0.80,0.32))<0.045){emission=vec3f(0.4,1.2,5.0);occ=1.0;}}` : ''}
textureStore(output,vec2i(id.xy),vec4f(emission,occ));}`;
  let init: ComputePass,
    shade: ComputePass | undefined,
    trace: ComputePass | undefined,
    integrate: ComputePass | undefined;
  let display: Awaited<ReturnType<typeof createSimulationDisplay>>;
  try {
    init = await make(sceneCode, 'scene', [
      sampled(0),
      storage(1, 'rgba16float'),
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ]);
    const distanceFunctions = `fn sdf(p:vec2f)->f32{let n=vec2i(textureDimensions(dist));if(any(p<vec2f(0.0))||any(p>=vec2f(n))){return 1e4;}return textureLoad(dist,clamp(vec2i(p),vec2i(0),n-1),0).x;}`;
    if (kind === 'shadows')
      shade = await make(
        `@group(1) @binding(0) var dist:texture_2d<f32>;@group(1) @binding(1) var scene:texture_2d<f32>;@group(1) @binding(2) var output:texture_storage_2d<rgba16float,write>;${distanceFunctions}
fn visibility(p:vec2f,light:vec2f)->f32{let delta=light-p;let end=length(delta);let dir=delta/max(end,0.001);var t=1.5;var v=1.0;for(var i=0u;i<256u;i++){if(i>=params.steps||t>=end){break;}let h=sdf(p+dir*t);if(h<0.5){return 0.0;}v=min(v,params.softness*max(h,0.0)/max(t,0.1));t+=clamp(h,1.0,8.0);}if(t<end){return 0.0;}return clamp(v,0.0,1.0);}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){let n=textureDimensions(output);if(any(id.xy>=n)){return;}let p=vec2f(id.xy)+0.5;let uv=p/vec2f(n);let light=params.light*vec2f(n);let v=visibility(p,light);let fall=1.0/(1.0+dot(uv-params.light,uv-params.light)*params.falloff);var rgb=params.background.rgb+params.tint.rgb*v*fall*params.intensity;if(textureLoad(scene,vec2i(id.xy),0).a>0.5){rgb=params.background.rgb*0.3;}if(params.view==1u){rgb=vec3f(v);}if(params.view==2u){rgb=vec3f(clamp(sdf(p)/f32(n.y)*4.0+0.5,0.0,1.0));}textureStore(output,vec2i(id.xy),vec4f(rgb,1.0));}`,
        'shadows',
        [sampled(0), sampled(1), storage(2, 'rgba16float')],
      );
    if (kind === 'cascades') {
      trace = await make(
        `@group(1) @binding(0) var dist:texture_2d<f32>;@group(1) @binding(1) var scene:texture_2d<f32>;@group(1) @binding(2) var coarse:texture_2d<f32>;@group(1) @binding(3) var previous:texture_2d<f32>;@group(1) @binding(4) var output:texture_storage_2d<rgba16float,write>;struct Config{level:u32,size:u32,bounce:u32,pad:u32};@group(1) @binding(5) var<uniform> cfg:Config;${distanceFunctions}
fn coarseRay(probe:vec2f,angle:u32)->vec4f{let level=cfg.level+1u;let n=max(1u,(cfg.size/4u)>>level);let directions=4u*(1u<<(2u*level));let q=probe/(4.0*f32(1u<<level))-0.5;let lo=vec2i(floor(q));let f=fract(q);var value=vec4f(0.0);for(var y=0;y<2;y++){for(var x=0;x<2;x++){let p=clamp(lo+vec2i(x,y),vec2i(0),vec2i(i32(n)-1));let weight=select(1.0-f.x,f.x,x==1)*select(1.0-f.y,f.y,y==1);value+=textureLoad(coarse,vec2i(p.x*i32(directions)+i32(angle),p.y),0)*weight;}}return value;}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){let outSize=textureDimensions(output);if(any(id.xy>=outSize)){return;}let l=cfg.level;let directions=4u*(1u<<(2u*l));let probe=vec2f(f32(id.x/directions)+0.5,f32(id.y)+0.5)*(4.0*f32(1u<<l));let angle=id.x%directions;let theta=(f32(angle)+0.5)*6.28318530718/f32(directions);let dir=vec2f(cos(theta),sin(theta));let scale=f32(1u<<(2u*l));let begin=params.interval*(scale-1.0)/3.0;let end=begin+params.interval*scale;var t=begin+0.5;var rgb=vec3f(0.0);var trans=1.0;
for(var step=0u;step<512u;step++){if(t>=end){break;}let p=probe+dir*t;if(any(p<vec2f(0.0))||any(p>=vec2f(f32(cfg.size)))){rgb=params.environment.rgb;trans=0.0;break;}let cell=clamp(vec2i(p),vec2i(0),vec2i(i32(cfg.size)-1));let material=textureLoad(scene,cell,0);if(material.a>0.5){rgb=material.rgb;if(cfg.bounce>0u){rgb+=textureLoad(previous,cell,0).rgb*params.albedo;}trans=0.0;break;}t+=clamp(max(sdf(p),1.0),1.0,8.0);}
if(trans>0.0){if(l+1u<params.levels){var far=vec4f(0.0);for(var child=0u;child<4u;child++){far+=coarseRay(probe,angle*4u+child)*0.25;}rgb+=trans*far.rgb;trans*=far.a;}else{rgb+=trans*params.environment.rgb;}}
textureStore(output,vec2i(id.xy),vec4f(clamp(rgb,vec3f(0.0),vec3f(16.0)),clamp(trans,0.0,1.0)));}`,
        'cascade-trace',
        [
          sampled(0),
          sampled(1),
          sampled(2),
          sampled(3),
          storage(4, 'rgba16float'),
          { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        ],
      );
      integrate = await make(
        `@group(1) @binding(0) var rays:texture_2d<f32>;@group(1) @binding(1) var output:texture_storage_2d<rgba16float,write>;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){let n=textureDimensions(output);if(any(id.xy>=n)){return;}let probes=vec2i(textureDimensions(rays)/vec2u(4u,1u));let q=(vec2f(id.xy)+0.5)/4.0-0.5;let lo=vec2i(floor(q));let f=fract(q);var rgb=vec3f(0.0);for(var y=0;y<2;y++){for(var x=0;x<2;x++){let p=clamp(lo+vec2i(x,y),vec2i(0),probes-1);let weight=select(1.0-f.x,f.x,x==1)*select(1.0-f.y,f.y,y==1);for(var a=0;a<4;a++){rgb+=textureLoad(rays,vec2i(p.x*4+a,p.y),0).rgb*weight*0.25;}}}textureStore(output,vec2i(id.xy),vec4f(rgb,1.0));}`,
        'integrate',
        [sampled(0), storage(1, 'rgba16float')],
      );
    }
    const displayCode = `@group(1) @binding(0) var dist:texture_2d<f32>;@group(1) @binding(1) var nearest:texture_2d<f32>;@group(1) @binding(2) var scene:texture_2d<f32>;@group(1) @binding(3) var lit:texture_2d<f32>;
@fragment fn fragment(in:VertexOut)->@location(0) vec4f{let n=textureDimensions(dist);let p=clamp(vec2i(in.uv*vec2f(n)),vec2i(0),vec2i(n)-1);let sd=textureLoad(dist,p,0).x;var rgb=params.background.rgb;
${kind === 'jump' ? `let outline=1.0-smoothstep(params.width,params.width+1.0,abs(sd));let glow=exp(-abs(sd)/max(params.glow,0.1));rgb+=params.tint.rgb*max(outline,glow*0.5);if(params.view==1u){rgb=vec3f(clamp(sd/f32(n.y)*4.0+0.5,0.0,1.0));}if(params.view==2u){let seed=textureLoad(nearest,p,0).xy;rgb=select(vec3f(0.0),fract(vec3f(seed.x*0.1031,seed.y*0.11369,(seed.x+seed.y)*0.13787)),seed.x>=0.0);}` : kind === 'shadows' ? `rgb=textureLoad(lit,p,0).rgb;` : `let radiance=textureLoad(lit,p,0).rgb;rgb=params.background.rgb+radiance*params.exposure;let material=textureLoad(scene,p,0);if(material.a>0.5){rgb=material.rgb+radiance*params.albedo;}if(params.view==1u){rgb=radiance;}if(params.view==2u){rgb=vec3f(clamp(sd/f32(n.y)*4.0+0.5,0.0,1.0));}`}
return vec4f(${kind === 'jump' ? 'rgb' : 'rgb/(vec3f(1.0)+max(rgb,vec3f(0.0)))'},1.0);}`;
    const dl = d.createBindGroupLayout({
      entries: [sampled(0), sampled(1), sampled(2), sampled(3)],
    });
    display = await createSimulationDisplay(
      ctx.session,
      simulationSource(ctx.params.schema, displayCode),
      ctx.format,
      `lighting-${kind}-display`,
      [u, dl],
    );
    owned.push(display);
  } catch (error) {
    owned.forEach((x) => x.dispose());
    scene!.destroy();
    mask!.destroy();
    irradiance.forEach((t) => t.destroy());
    cascade.forEach((t) => t.destroy());
    rects.destroy();
    constants.forEach((b) => b.destroy());
    throw error;
  }
  const tap = (t: GPUTexture, label: string): TextureTap => ({
    texture: t,
    format: t.format,
    width: t.width,
    height: t.height,
    label,
    kind: 'float',
  });
  let rectCount = 0;
  return {
    resize() {
      const next = Number(ctx.params.values['grid']);
      if (next !== size) {
        size = next;
        jfa.resize([size, size]);
        allocate();
      }
    },
    update() {},
    reset() {},
    render(_frame, e, target) {
      if (disposed) return;
      const connected = ctx.inputs?.get('text-mask') ?? ctx.inputs?.get('image');
      const input = connected?.texture ?? mask;
      dispatch(init, e, [input, scene, rects, args(connected ? 1 : 0, 0)]);
      jfa.encode(e, tap(scene, 'Occupancy and emissive mask'));
      let lit = irradiance[0]!;
      if (shade) {
        dispatch(shade, e, [jfa.distance.texture, scene, lit]);
      }
      if (trace && integrate) {
        const levels = Number(ctx.params.values['levels']),
          bounces = Number(ctx.params.values['bounces']);
        for (let b = 0; b < bounces; b++) {
          for (let l = levels - 1; l >= 0; l--) {
            const out = cascade[l]!;
            dispatch(
              trace,
              e,
              [
                jfa.distance.texture,
                scene,
                l + 1 < levels ? cascade[l + 1]! : mask,
                irradiance[(b + 1) % 2]!,
                out,
                args(l, b),
              ],
              out.width,
              out.height,
            );
          }
          lit = irradiance[b % 2]!;
          dispatch(integrate, e, [cascade[0]!, lit]);
        }
      }
      const g = d.createBindGroup({
        layout: display.pipeline.getBindGroupLayout(1),
        entries: [jfa.distance.texture, jfa.nearest.texture, scene, lit].map((t, binding) => ({
          binding,
          resource: t.createView(),
        })),
      });
      display.draw(e, target, [group0, g]);
    },
    async setInput(name, value) {
      if (disposed) throw new Error('Lighting effect is disposed');
      if (name === 'text') {
        if (typeof value !== 'string') throw new TypeError('Text mask requires a string');
        text = value;
        uploadText(text);
      } else if (name === 'rects') {
        if (!Array.isArray(value) || value.length > 64)
          throw new RangeError(
            'Rect input requires at most 64 [x,y,width,height] normalized rectangles',
          );
        const data = new Float32Array(64 * 4);
        value.forEach((r, i) => {
          if (
            !Array.isArray(r) ||
            r.length !== 4 ||
            !r.every((x) => typeof x === 'number' && Number.isFinite(x)) ||
            r[2] < 0 ||
            r[3] < 0
          )
            throw new TypeError('Rect coordinates must be finite, with nonnegative extent');
          data.set(r, i * 4);
        });
        rectCount = value.length;
        d.queue.writeBuffer(rects, 0, new Uint32Array([rectCount, 0, 0, 0]));
        d.queue.writeBuffer(rects, 16, data);
      }
    },
    textureTaps() {
      return {
        scene: tap(scene, 'Occupancy and emission'),
        distance: jfa.distance,
        nearest: jfa.nearest,
        ...(kind === 'cascades'
          ? Object.fromEntries([
              ...cascade.map((t, i) => [`cascade-${i}`, tap(t, `Radiance cascade ${i}`)]),
              ...irradiance.map((t, i) => [`irradiance-${i}`, tap(t, `Irradiance ${i}`)]),
            ])
          : kind === 'shadows'
            ? { visibility: tap(irradiance[0]!, 'Soft-shadow light') }
            : {}),
      };
    },
    get sources() {
      return {
        ...jfa.sources,
        ...Object.fromEntries(
          owned
            .filter((p): p is ComputePass => 'source' in p)
            .map((p, i) => [`lighting-${i}`, p.source]),
        ),
        display: display.source,
      };
    },
    get diagnostics() {
      return [
        ...jfa.diagnostics,
        ...owned.filter((p): p is ComputePass => 'diagnostics' in p).flatMap((p) => p.diagnostics),
      ];
    },
    memory() {
      return disposed
        ? { textureBytes: 0, bufferBytes: 0 }
        : {
            textureBytes:
              jfa.memory().textureBytes +
              size * size * 28 +
              cascade.reduce((n, t) => n + t.width * t.height * 8, 0),
            bufferBytes:
              jfa.memory().bufferBytes +
              rects.size +
              [...constants.values()].reduce((n, b) => n + b.size, 0),
          };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      owned.forEach((x) => x.dispose());
      scene.destroy();
      mask.destroy();
      cascade.forEach((t) => t.destroy());
      irradiance.forEach((t) => t.destroy());
      rects.destroy();
      constants.forEach((b) => b.destroy());
    },
  };
}
