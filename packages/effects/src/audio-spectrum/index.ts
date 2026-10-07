import { filterEffect, createFilterPass, filterGroup } from '@mk7s/hologpu-core';
import { f, u, e, color, audioFixture } from '../_dom/common.ts';
const code = `@group(0) @binding(3) var audio:texture_2d<f32>;
fn fft(u:f32)->f32 {let n=textureDimensions(audio).x;return max(0.0,textureLoad(audio,vec2i(i32(clamp(u,0.0,.999999)*f32(n)),0),0).r)*params.gain;}
fn band(lo:f32,hi:f32)->f32 {let n=textureDimensions(audio).x;let first=u32(clamp(lo,0.0,.999999)*f32(n));let last=min(n,max(first+1u,u32(ceil(clamp(hi,0.0,1.0)*f32(n)))));var amplitude=0.0;for(var i=first;i<last;i++){amplitude=max(amplitude,max(0.0,textureLoad(audio,vec2i(i32(i),0),0).r));}return amplitude*params.gain;}
fn wave(u:f32)->f32 {return sample_bilinear(audio,vec2f(u,.75)).r*params.gain;}
fn effect(uv:vec2f)->vec4f {var amount=0.0;if(params.mode==0u){let cells=f32(params.bars);let cell=floor(uv.x*cells);let amplitude=clamp(band(cell/cells*params.range,(cell+1.0)/cells*params.range),0.0,1.0);let gap=step(params.gap,fract(uv.x*cells));amount=gap*step(1.0-amplitude,uv.y);}else if(params.mode==1u){let y=.5-wave(uv.x)*.38;let distance=abs(uv.y-y)*frame.resolution.y;amount=1.0-smoothstep(params.lineWidth,params.lineWidth+1.0,distance);}else{let q=uv*2.0-1.0;let origin=vec3f(0,1.1,-.8);let ray=normalize(vec3f(q.x*.8,-.55-q.y*.4,1));var travel=0.0;for(var i=0u;i<params.terrainSteps;i++){let p=origin+ray*travel;let x=clamp(p.x*.4+.5,0.0,1.0);let height=clamp(fft(x*params.range),0.0,1.0)*.7*(.75+.25*cos(p.z*8.0));if(p.y<=height){let grid=1.0-smoothstep(.01,.04,min(abs(fract(p.x*12.0)-.5),abs(fract(p.z*12.0)-.5)));amount=(.3+height*.6+grid*.3)*exp(-travel*.18);break;}travel+=max(.025,(p.y-height)*.15);}}let rgb=mix(params.background.rgb,params.tint.rgb,amount);return vec4f(rgb,1);}`;
export default filterEffect({
  id: 'audio-spectrum',
  title: 'Audio FFT, oscilloscope and terrain',
  family: 'input',
  core: true,
  tags: ['audio', 'fft', 'waveform', 'terrain'],
  inputs: ['audio'],
  params: {
    mode: e(
      'spectrum',
      ['spectrum', 'oscilloscope', 'terrain'],
      'FFT amplitude bars, signed waveform or perspective FFT height field.',
      'View',
    ),
    bars: u(64, 8, 256, 'Number of sampled spectrum columns.', 'Spectrum'),
    range: f(
      0.5,
      0.02,
      1,
      'Fraction of audio texture FFT row sampled across the display.',
      'Spectrum',
    ),
    gain: f(1.5, 0, 20, 'Linear amplitude multiplier applied to the actual input.', 'Audio'),
    gap: f(0.2, 0, 0.9, 'Fraction of each bar reserved as a gap.', 'Spectrum'),
    terrainSteps: u(
      48,
      16,
      96,
      'Maximum sampled-height raymarch steps for the FFT terrain.',
      'Terrain',
    ),
    lineWidth: f(1.5, 0.5, 8, 'Oscilloscope stroke half-width in physical pixels.', 'Waveform'),
    tint: color('#8fe0db', 'Lit audio trace colour.'),
    background: color('#071826', 'Background colour.'),
  },
  presets: {
    scope: { mode: 'oscilloscope', gain: 1, tint: '#f4c28e' },
    terrain: { mode: 'terrain', gain: 3, range: 0.2, tint: '#b9a3ef' },
  },
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback: 'linear-gradient(180deg,#071826,#8fe0db)',
  async setup({ ctx, input }) {
    const fallback = audioFixture(ctx.device);
    try {
      const pass = await createFilterPass(ctx, code, 'audio-spectrum', [
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float' },
        },
      ]);
      return {
        resize() {},
        update() {},
        reset() {},
        render(_f, encoder, target) {
          const audio = ctx.inputs?.get('audio') ?? fallback;
          pass.draw(encoder, target, [
            filterGroup(ctx, pass, input(), [
              {
                binding: 3,
                resource: audio.texture.createView({
                  baseMipLevel: audio.mipLevel ?? 0,
                  mipLevelCount: 1,
                }),
              },
            ]),
          ]);
        },
        dispose() {
          pass.dispose();
          fallback.texture.destroy();
        },
        sources: { fragment: pass.source },
        diagnostics: pass.diagnostics,
        textureTaps() {
          return { referenceAudio: fallback };
        },
        memory() {
          return { textureBytes: 256 * 2 * 16, bufferBytes: 0 };
        },
      };
    } catch (error) {
      fallback.texture.destroy();
      throw error;
    }
  },
});
