import {
  defineEffect,
  sphereMesh,
  createSimulationDisplay,
  simulationSource,
  simulationUniformLayout,
  type EffectContext,
  type TextureTap,
} from '@mk7s/hologpu-core';
import { scene, speed, msaa, tint, f } from '../_geometry/common.ts';
const params = {
  speed,
  msaa,
  tint,
  ior: f(1.5, 1, 2.5, 'Index of refraction; 1 has no bending.'),
  dispersion: f(0.035, 0, 0.15, 'RGB refractive-index spread.'),
  thickness: f(0.7, 0, 2, 'Screen-space ray travel through the sphere.'),
  absorption: f(0.15, 0, 2, 'Beer-Lambert coloured absorption strength.'),
  background: {
    type: 'enum',
    default: 'tiles',
    options: ['tiles', 'stripes'],
    group: 'Scene',
    description: 'Captured background scene with time-driven parallax.',
  },
} as const;
const backgroundCode = `@fragment fn fragment(in:VertexOut)->@location(0)vec4f {let time=select(frame.time,0.0,frame.reducedMotion>.5);let uv=in.uv+vec2f(sin(time*.2)*.06,0);var pattern=.5+.5*sin(uv.x*60.0+uv.y*12.0);if(params.background==0u){pattern=f32((u32(floor(uv.x*12.0))+u32(floor(uv.y*9.0)))%2u);}let a=mix(vec3f(.025,.055,.1),vec3f(.65,.26,.09),pattern);let light=exp(-dot(in.uv-vec2f(.7,.25),in.uv-vec2f(.7,.25))*25.0);return vec4f(a+vec3f(.2,.5,.8)*light,1);}`;
const meshCode = `@group(1) @binding(1) var capture:texture_2d<f32>;
@vertex fn meshVertex(@location(0) p:vec3f,@location(1) n:vec3f,@location(2) uv:vec2f)->MeshOut{return mesh_out(p,n,uv);}
@fragment fn meshFragment(in:MeshOut)->@location(0)vec4f {let n=normalize(in.normal);let v=normalize(camera.eye.xyz-in.world);let uv=in.position.xy/frame.resolution;let nr=refract(-v,n,1.0/max(1.0,params.ior-params.dispersion));let ng=refract(-v,n,1.0/params.ior);let nb=refract(-v,n,1.0/(params.ior+params.dispersion));let r=camera.viewProjection*vec4f(nr+v,0);let g=camera.viewProjection*vec4f(ng+v,0);let b=camera.viewProjection*vec4f(nb+v,0);let factor=params.thickness*.12;let red=sample_bilinear(capture,clamp(uv+r.xy*vec2f(1,-1)*factor,vec2f(0),vec2f(1))).r;let green=sample_bilinear(capture,clamp(uv+g.xy*vec2f(1,-1)*factor,vec2f(0),vec2f(1))).g;let blue=sample_bilinear(capture,clamp(uv+b.xy*vec2f(1,-1)*factor,vec2f(0),vec2f(1))).b;let nv=max(0.0,dot(n,v));let f0=pow((params.ior-1.0)/(params.ior+1.0),2.0);let fresnel=select(0.0,f0+(1.0-f0)*pow(1.0-nv,5.0),params.ior>1.0);let transmission=vec3f(red,green,blue)*exp(-(1.0-params.tint.rgb)*params.absorption*params.thickness*2.0*nv);let reflection=vec3f(.4,.65,.9)*(.2+.8*max(0.0,dot(reflect(-v,n),normalize(vec3f(-.5,1,1)))));return vec4f(mix(transmission,reflection,fresnel),1);}`;
const compositeCode = `@group(1) @binding(0) var capture:texture_2d<f32>;@group(1) @binding(1) var glass:texture_2d<f32>;@fragment fn fragment(in:VertexOut)->@location(0)vec4f {let a=sample_bilinear(glass,in.uv);let b=sample_bilinear(capture,in.uv);return a+b*(1.0-a.a);}`;
export default defineEffect({
  id: 'glass',
  title: 'Mesh refraction and chromatic dispersion',
  budget: { expectedMs: 6, referenceSize: [640, 400] },
  family: 'geometry',
  tier: 'T5',
  core: true,
  tags: ['refraction', 'dispersion', 'scene-capture', 'depth', 'msaa'],
  features: [],
  inputs: [],
  params,
  presets: {
    crystal: { ior: 1.45, dispersion: 0.015, absorption: 0.05, tint: '#dcefff' },
    prism: {
      ior: 1.9,
      dispersion: 0.12,
      thickness: 1.2,
      absorption: 0.65,
      tint: '#84d5bb',
      background: 'stripes',
    },
  },
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  poster: new URL('./poster.png', import.meta.url).href,
  fallback: 'radial-gradient(circle at 50% 50%,#8bbac5,#344452 60%)',
  async create(ctx: EffectContext<typeof params>) {
    const device = ctx.device,
      uniform = simulationUniformLayout(device),
      layout = device.createBindGroupLayout({
        entries: [0, 1].map((binding) => ({
          binding,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float' as const },
        })),
      });
    const leases: { dispose(): void }[] = [];
    let capture: GPUTexture | undefined, glass: GPUTexture | undefined;
    try {
      const s = await scene(ctx, 'glass', sphereMesh(), meshCode, [
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float' },
        },
      ]);
      leases.push(s);
      const bg = await createSimulationDisplay(
        ctx.session,
        simulationSource(params, backgroundCode),
        ctx.format,
        'glass-scene-capture',
        [uniform],
      );
      leases.push(bg);
      const composite = await createSimulationDisplay(
        ctx.session,
        simulationSource(params, compositeCode),
        ctx.format,
        'glass-composite',
        [uniform, layout],
      );
      leases.push(composite);
      let group: GPUBindGroup,
        combined: GPUBindGroup,
        size: readonly [number, number] = [0, 0];
      const resize = (next: readonly [number, number]) => {
        s.resize(next);
        if (next[0] === size[0] && next[1] === size[1]) return;
        capture?.destroy();
        glass?.destroy();
        size = [...next];
        const create = (label: string) =>
          device.createTexture({
            label,
            size: [...size],
            format: ctx.format,
            usage:
              GPUTextureUsage.RENDER_ATTACHMENT |
              GPUTextureUsage.TEXTURE_BINDING |
              GPUTextureUsage.COPY_SRC,
          });
        capture = create('glass-scene-capture');
        glass = create('glass-layer');
        group = s.group([{ binding: 1, resource: capture.createView() }]);
        combined = device.createBindGroup({
          layout,
          entries: [
            { binding: 0, resource: capture.createView() },
            { binding: 1, resource: glass.createView() },
          ],
        });
      };
      const tap = (texture: GPUTexture, label: string): TextureTap => ({
        texture,
        format: ctx.format,
        width: size[0],
        height: size[1],
        kind: 'float',
        label,
      });
      return {
        resize,
        update() {},
        reset() {},
        shouldRender: (frame) => !frame.reducedMotion,
        render(frame, encoder, target) {
          const time = frame.reducedMotion ? 0 : frame.time;
          const angle = time * Number(ctx.params.values.speed) + 0.2;
          s.camera.update(
            [Math.sin(angle) * 3.3, 0.5, Math.cos(angle) * 3.3],
            [0, 0, 0],
            size[0] / size[1],
          );
          bg.draw(encoder, capture!.createView(), [s.uniforms]);
          const pass = s.begin(encoder, glass!.createView(), [0, 0, 0, 0]);
          s.draw(pass, group);
          pass.end();
          composite.draw(encoder, target, [s.uniforms, combined]);
        },
        sources: { ...s.sources, capture: bg.source, composite: composite.source },
        diagnostics: [...s.diagnostics, ...bg.diagnostics, ...composite.diagnostics],
        textureTaps: () => ({
          sceneCapture: tap(capture!, 'Unrefracted linear HDR background'),
          glassLayer: tap(glass!, 'Premultiplied mesh coverage and refracted colour'),
        }),
        memory: () => {
          const m = s.memory();
          return { ...m, textureBytes: m.textureBytes + size[0] * size[1] * 16 };
        },
        dispose() {
          capture?.destroy();
          glass?.destroy();
          leases.forEach((l) => l.dispose());
        },
      };
    } catch (error) {
      capture?.destroy();
      glass?.destroy();
      leases.reverse().forEach((l) => l.dispose());
      throw error;
    }
  },
});
