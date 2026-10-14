import {
  defineEffect,
  createParticleDraw,
  compose,
  chunk,
  frame,
  sampling,
} from '@mk7s/hologpu-core';
import { f, u, color, progress, textMask } from '../_dom/common.ts';
import { paramLayout } from '@mk7s/hologpu-core';
const params = {
  progress,
  assembly: {
    type: 'bool',
    default: false,
    group: 'Motion',
    description:
      'Assemble-and-hold mode: progress zero scatters and one restores the mask; reduced motion always restores it.',
  },
  intensity: {
    ...f(1, 0, 1, 'Particle intensity; the assembly preset uses a quiet 0.22.', 'Particles'),
    css: true,
  },
  grid: u(
    128,
    32,
    256,
    'Number of columns in the mask particle grid; rows are half this number.',
    'Particles',
  ),
  spread: f(0.75, 0, 2, 'Normalized displacement at complete dissolution.', 'Particles'),
  size: f(1.8, 0.5, 8, 'Particle quad radius in CSS pixels.', 'Particles'),
  curl: f(0.3, 0, 2, 'Perpendicular sinusoidal trajectory amplitude.', 'Motion'),
  opacity: f(0.85, 0, 1, 'Particle opacity, multiplied by the sampled text coverage.', 'Particles'),
  tint: { ...color('#c5bbf2', 'Linear particle colour.'), css: true },
} as const;
const code = `
@group(0) @binding(1) var<uniform> params:Params;
@group(0) @binding(2) var mask:texture_2d<f32>;
fn random(id:u32)->f32 {var n=id^frame.seed;n=(n^(n>>16u))*2246822519u;n=(n^(n>>13u))*3266489917u;return f32(n^(n>>16u))/4294967295.0;}
struct Out{@builtin(position) position:vec4f,@location(0) local:vec2f,@location(1) coverage:f32};
@vertex fn particleVertex(@builtin(vertex_index) vertex:u32,@builtin(instance_index) id:u32)->Out {
 let columns=params.grid;let rows=max(1u,columns/2u);let uv=(vec2f(f32(id%columns),f32(id/columns))+.5)/vec2f(f32(columns),f32(rows));
 let coverage=sample_bilinear(mask,uv).r;let angle=random(id*3u+1u)*6.2831853;let direction=vec2f(cos(angle),sin(angle));let perpendicular=vec2f(-direction.y,direction.x);
 var t=clamp(params.progress,0.0,1.0);if(params.assembly!=0u){t=1.0-t;if(frame.reducedMotion>0.5){t=0.0;}}let displacement=direction*params.spread*t*(.3+.7*random(id*3u+2u))+perpendicular*sin(t*3.14159265)*params.curl;
 let anchor=uv+displacement;let corners=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));let local=corners[vertex];let p=anchor+local*params.size*frame.dpr/frame.resolution;
 var out:Out;out.position=vec4f(p*vec2f(2,-2)+vec2f(-1,1),0,1);out.local=local;out.coverage=coverage*params.opacity*(1.0-.35*t)*params.intensity;return out;
}
@fragment fn particleFragment(in:Out)->@location(0) vec4f {let alpha=(1.0-smoothstep(.6,1.0,length(in.local)))*in.coverage*params.tint.a;return vec4f(params.tint.rgb*alpha,alpha);}`;
export default defineEffect({
  id: 'text-dissolve',
  title: 'Text mask particle dissolve and reform',
  family: 'dom',
  tier: 'T3',
  core: true,
  tags: ['dom', 'text', 'particles', 'mask', 'css'],
  inputs: ['text', 'css'],
  features: [],
  params,
  presets: {
    drift: { progress: 0.55, spread: 0.45, curl: 0.15, tint: '#f4b99a' },
    burst: { progress: 0.85, spread: 0.8, curl: 0.5, tint: '#a5e4de' },
    'assemble-and-hold': {
      assembly: true,
      progress: 0,
      grid: 128,
      spread: 0.45,
      curl: 0.15,
      size: 1.15,
      intensity: 0.22,
    },
  },
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback: 'linear-gradient(135deg,#c5bbf2,#17263e)',
  presetPosters: {
    'assemble-and-hold': new URL('./poster-assemble-and-hold.png', import.meta.url).href,
  },
  async create(ctx) {
    const fallback = textMask(ctx.device);
    const source = compose(
      frame,
      sampling,
      chunk('text-params', paramLayout(params).wgsl),
      chunk('text-particles', code),
    );
    const visibility = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    const layout = ctx.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility, buffer: { type: 'uniform' } },
        { binding: 1, visibility, buffer: { type: 'uniform' } },
        {
          binding: 2,
          visibility: GPUShaderStage.VERTEX,
          texture: { sampleType: 'unfilterable-float' },
        },
      ],
    });
    try {
      const pass = await createParticleDraw(ctx.session, source, {
        label: 'text-dissolve-particles',
        format: ctx.format,
        layouts: [layout],
        mode: 'quad',
        additive: true,
        additiveAlpha: 'over',
      });
      let disposed = false;
      return {
        resize() {},
        update() {},
        shouldRender: () => !ctx.params.values.assembly,
        reset() {},
        render(_f, encoder, target) {
          const mask = ctx.inputs?.get('text') ?? fallback;
          const group = ctx.device.createBindGroup({
            layout,
            entries: [
              { binding: 0, resource: { buffer: ctx.frameBuffer } },
              { binding: 1, resource: { buffer: ctx.paramsBuffer } },
              {
                binding: 2,
                resource: mask.texture.createView({
                  baseMipLevel: mask.mipLevel ?? 0,
                  mipLevelCount: 1,
                }),
              },
            ],
          });
          const grid = Number(ctx.params.values.grid);
          pass.draw(encoder, target, [group], grid * Math.max(1, Math.floor(grid / 2)));
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          pass.dispose();
          fallback.texture.destroy();
        },
        sources: { particles: pass.source },
        diagnostics: pass.diagnostics,
        textureTaps(): Readonly<Record<string, import('@mk7s/hologpu-core').TextureTap>> {
          return disposed ? {} : { textMask: fallback };
        },
        memory() {
          return { textureBytes: disposed ? 0 : 512 * 256, bufferBytes: 0 };
        },
      };
    } catch (error) {
      fallback.texture.destroy();
      throw error;
    }
  },
});
