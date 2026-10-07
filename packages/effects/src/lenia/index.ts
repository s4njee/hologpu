import { gridEffect, gridParam, stepsParam } from '../_feedback/grid.ts';
const kernel = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const r = i / 255;
  kernel[i] = r < 1 ? Math.exp(-0.5 * ((r - 0.5) / 0.15) ** 2) : 0;
}
export default gridEffect(
  {
    id: 'lenia',
    title: 'Lenia continuous cellular automaton',
    family: 'feedback',
    core: true,
    tags: ['lenia', 'convolution', 'kernel-lut'],
    inputs: ['pointer'],
    params: {
      grid: { ...gridParam, default: 128 },
      steps: stepsParam,
      radius: {
        type: 'u32',
        default: 8,
        min: 2,
        max: 16,
        step: 1,
        group: 'Kernel',
        description: 'Circular convolution radius in cells; direct cost grows quadratically.',
      },
      mean: {
        type: 'f32',
        default: 0.15,
        min: 0.05,
        max: 0.4,
        step: 0.005,
        group: 'Growth',
        description: 'Neighbourhood concentration at peak growth.',
      },
      sigma: {
        type: 'f32',
        default: 0.035,
        min: 0.01,
        max: 0.12,
        step: 0.005,
        group: 'Growth',
        description: 'Width of the Gaussian growth response.',
      },
      dt: {
        type: 'f32',
        default: 0.1,
        min: 0.01,
        max: 0.2,
        step: 0.01,
        group: 'Growth',
        description: 'Explicit Euler increment per iteration.',
      },
      tint: {
        type: 'color',
        default: '#a6e6cf',
        group: 'Palette',
        description: 'High-density cell color.',
      },
      background: {
        type: 'color',
        default: '#142339',
        group: 'Palette',
        description: 'Empty field color.',
      },
    },
    presets: {
      coral: { mean: 0.135, sigma: 0.035, radius: 10, tint: '#f4bb97' },
      amoeba: { mean: 0.2, sigma: 0.055, radius: 6, tint: '#9bacff' },
    },
    quality: { resolutionScale: [0.25, 1] },
    reducedMotion: { time: 0 },
    fallback: 'radial-gradient(ellipse,#a6e6cf,#142339)',
  },
  {
    lut: kernel,
    initialize: /* wgsl */ `@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){let n=textureDimensions(next);if(any(id.xy>=n)){return;}let p=vec2i(id.xy);let uv=(vec2f(p)+0.5)/vec2f(n);let q=(uv-0.5)*vec2f(1.0,1.2);let a=exp(-dot(q,q)*35.0)*(0.5+0.5*cell_hash(p,frame.seed));textureStore(next,p,vec4f(a,0,0,1));}`,
    step: /* wgsl */ `@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){let n=textureDimensions(next);if(any(id.xy>=n)){return;}let p=vec2i(id.xy);let r=i32(params.radius);var total=0.0;var weight=0.0;for(var y=-r;y<=r;y++){for(var x=-r;x<=r;x++){let distance=length(vec2f(f32(x),f32(y)))/f32(r);if(distance<1.0){let w=kernel[u32(clamp(distance*255.0,0.0,255.0))];total+=w*textureLoad(state,wrap(p+vec2i(x,y),vec2i(n)),0).x;weight+=w;}}}let u=total/max(weight,0.00001);let z=(u-params.mean)/params.sigma;let growth=2.0*exp(-0.5*z*z)-1.0;var a=clamp(textureLoad(state,p,0).x+params.dt*growth,0.0,1.0);let uv=(vec2f(p)+0.5)/vec2f(n);if(frame.buttons!=0u&&distance(uv,frame.pointer)<0.045){a=0.75;}textureStore(next,p,vec4f(a,u,growth,1));}`,
    display: /* wgsl */ `@fragment fn fragment(in:VertexOut)->@location(0)vec4f{let a=sample_bilinear(state,in.uv).x;return vec4f(mix(params.background.rgb,params.tint.rgb,smoothstep(0.0,0.8,a)),1);}`,
  },
);
