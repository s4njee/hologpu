import { filterEffect, createFilterPass, filterGroup } from '@mk7s/hologpu-core';
import { f, e, v, straight } from '../_filters/common.ts';
const code =
  straight +
  `
@group(0) @binding(3) var lutTexture:texture_3d<f32>;
fn lut(c:vec3f)->vec3f {let p=clamp(c,vec3f(0),vec3f(1))*16.0;let b=vec3i(floor(p));let t=fract(p);let m=vec3i(16);let a=textureLoad(lutTexture,min(b,m),0).rgb;let z=textureLoad(lutTexture,min(b+vec3i(0,0,1),m),0).rgb;let bx=textureLoad(lutTexture,min(b+vec3i(1,0,0),m),0).rgb;let bz=textureLoad(lutTexture,min(b+vec3i(1,0,1),m),0).rgb;let cy=textureLoad(lutTexture,min(b+vec3i(0,1,0),m),0).rgb;let cz=textureLoad(lutTexture,min(b+vec3i(0,1,1),m),0).rgb;let dx=textureLoad(lutTexture,min(b+vec3i(1,1,0),m),0).rgb;let dz=textureLoad(lutTexture,min(b+vec3i(1,1,1),m),0).rgb;return mix(mix(mix(a,bx,t.x),mix(cy,dx,t.x),t.y),mix(mix(z,bz,t.x),mix(cz,dz,t.x),t.y),t.z);}
fn tone(c:vec3f)->vec3f {if(params.toneMap==1u){return c/(1.0+c);}if(params.toneMap==2u){return clamp((c*(2.51*c+.03))/(c*(2.43*c+.59)+.14),vec3f(0),vec3f(1));}if(params.toneMap==3u){let x=max(vec3f(0),c-.004);return (x*(6.2*x+.5))/(x*(6.2*x+1.7)+.06);}return c;}
fn effect(uv:vec2f)->vec4f {let source=sample_image(uv);var c=max(straight(source)*exp2(params.exposure)+params.lift,vec3f(0));c=pow(c,1.0/max(params.gamma,vec3f(.05)))*params.gain;c=tone(c);if(params.curveAmount>0.0){let curved=vec3f(sample_toneCurve(vec2f(clamp(c.r,0.0,1.0),.5)).r,sample_toneCurve(vec2f(clamp(c.g,0.0,1.0),.5)).r,sample_toneCurve(vec2f(clamp(c.b,0.0,1.0),.5)).r);c=mix(c,curved,params.curveAmount);}if(params.lutAmount>0.0){c=mix(c,lut(c),params.lutAmount);}return premul(c,source.a);}`;
export default filterEffect({
  id: 'color-grade',
  title: '3D LUT and tone mapping',
  core: true,
  tags: ['filter', 'colour', '3d-texture', 'hdr'],
  params: {
    toneMap: e(
      'aces',
      ['linear', 'reinhard', 'aces', 'filmic'],
      'Tone operator before the normalized 3D lookup.',
      'Tone',
    ),
    exposure: f(0, -4, 4, 'Linear exposure multiplier in stops.', 'Tone'),
    lift: v([0, 0, 0], -0.5, 0.5, 'Linear additive RGB offset.'),
    gamma: v([1, 1, 1], 0.1, 3, 'Per-channel inverse-power gamma.'),
    gain: v([1, 1, 1], 0, 3, 'Linear RGB gain.'),
    toneCurve: {
      type: 'curve',
      default: [0, 0.25, 0.5, 0.75, 1],
      description: 'Evenly spaced baked tone-curve LUT values.',
      group: 'Tone curve',
    },
    curveAmount: f(0, 0, 1, 'Tone curve blend after the operator.', 'Tone curve'),
    look: e(
      'identity',
      ['identity', 'warm', 'cool'],
      '17³ LUT data: identity or RGB matrix look.',
      'LUT',
    ),
    lutAmount: f(1, 0, 1, 'Blend between tone result and trilinear LUT output.', 'LUT'),
  },
  presets: {
    neutral: { toneMap: 'linear', look: 'identity', lutAmount: 1 },
    cinema: {
      toneMap: 'aces',
      look: 'warm',
      exposure: 0.35,
      lift: [0.01, 0, -0.01],
      gamma: [1.08, 1, 1],
      gain: [1.05, 1, 0.92],
    },
  },
  async setup({ ctx, input }) {
    const texture = ctx.device.createTexture({
      label: 'colour-grade-3d-lut',
      dimension: '3d',
      size: [17, 17, 17],
      format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    });
    let look = '';
    const upload = () => {
      const next = String(ctx.params.values.look);
      if (next === look) return;
      const data = new Float32Array(17 ** 3 * 4);
      for (let z = 0; z < 17; z++)
        for (let y = 0; y < 17; y++)
          for (let x = 0; x < 17; x++) {
            const r = x / 16,
              g = y / 16,
              b = z / 16;
            const rgb =
              next === 'warm'
                ? [r * 1.04 + g * 0.04, g * 0.98, b * 0.88 + r * 0.025]
                : next === 'cool'
                  ? [r * 0.88, g * 0.99 + b * 0.025, b * 1.05 + r * 0.025]
                  : [r, g, b];
            data.set([...rgb, 1], ((z * 17 + y) * 17 + x) * 4);
          }
      ctx.device.queue.writeTexture(
        { texture },
        data,
        { bytesPerRow: 17 * 16, rowsPerImage: 17 },
        { width: 17, height: 17, depthOrArrayLayers: 17 },
      );
      look = next;
    };
    try {
      const pass = await createFilterPass(ctx, code, 'color-grade', [
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { viewDimension: '3d', sampleType: 'unfilterable-float' },
        },
      ]);
      upload();
      return {
        resize() {},
        update() {
          upload();
        },
        reset() {},
        render(_f, encoder, target) {
          upload();
          pass.draw(encoder, target, [
            filterGroup(ctx, pass, input(), [{ binding: 3, resource: texture.createView() }]),
          ]);
        },
        dispose() {
          pass.dispose();
          texture.destroy();
        },
        sources: { fragment: pass.source },
        diagnostics: pass.diagnostics,
        textureTaps() {
          return Object.fromEntries(
            Array.from({ length: 17 }, (_, depthSlice) => [
              `lutSlice${depthSlice}`,
              {
                texture,
                width: 17,
                height: 17,
                format: 'rgba32float' as const,
                kind: 'float' as const,
                depthSlice,
                label: `3D LUT z=${depthSlice}/16`,
              },
            ]),
          );
        },
        memory() {
          return { textureBytes: 17 ** 3 * 16, bufferBytes: 0 };
        },
      };
    } catch (error) {
      texture.destroy();
      throw error;
    }
  },
});
