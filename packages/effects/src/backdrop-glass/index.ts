import {
  filterEffect,
  createFilterPass,
  filterGroup,
  createElementCapture,
  type TextureTap,
} from '@mk7s/hologpu-core';
import { f } from '../_stretch/common.ts';
const params = {
  refraction: f(
    0.035,
    0,
    0.12,
    'Screen-space normal offset; zero gives an exact texture pass-through.',
    'Glass',
  ),
  frost: f(1.5, 0, 8, 'Five-tap cross blur radius in source texels.', 'Glass'),
  radius: f(0.27, 0.1, 0.48, 'Circular glass lens radius in normalized coordinates.', 'Glass'),
  dispersion: f(0.012, 0, 0.06, 'RGB channel separation along the refracted direction.', 'Glass'),
} as const;
export default filterEffect({
  id: 'backdrop-glass',
  title: 'Experimental DOM backdrop glass',
  family: 'dom',
  core: false,
  tags: ['html-in-canvas', 'experimental', 'refraction', 'dom-capture'],
  params,
  inputs: ['image', 'element'],
  presets: {
    clear: { refraction: 0.05, frost: 0, dispersion: 0.008 },
    frosted: { refraction: 0.015, frost: 6, dispersion: 0 },
  },
  fallback: 'linear-gradient(135deg,#61748588,#dbe7edaa)',
  async setup({ ctx, input }) {
    const pass = await createFilterPass(
      ctx,
      `
 struct CaptureArgs{straight:u32};@group(0) @binding(3) var<uniform> captureArgs:CaptureArgs;
 fn load_premult(p:vec2i)->vec4f{let c=textureLoad(image,clamp(p,vec2i(0),vec2i(textureDimensions(image))-1),0);return select(c,vec4f(c.rgb*c.a,c.a),captureArgs.straight!=0u);}
 fn sample_backdrop(uv:vec2f)->vec4f{let p=uv*vec2f(textureDimensions(image))-.5;let base=vec2i(floor(p));let frac=fract(p);return mix(mix(load_premult(base),load_premult(base+vec2i(1,0)),frac.x),mix(load_premult(base+vec2i(0,1)),load_premult(base+vec2i(1,1)),frac.x),frac.y);}
 fn blur(uv:vec2f)->vec4f{let d=params.frost/vec2f(textureDimensions(image));return (sample_backdrop(uv)*4+sample_backdrop(uv+vec2f(d.x,0))+sample_backdrop(uv-vec2f(d.x,0))+sample_backdrop(uv+vec2f(0,d.y))+sample_backdrop(uv-vec2f(0,d.y)))/8;}
 fn effect(uv:vec2f)->vec4f{let p=uv-.5;let r=length(p);let mask=1-smoothstep(params.radius-.01,params.radius,r);let offset=p*sqrt(max(0.0,1-r*r/(params.radius*params.radius)))*params.refraction/params.radius;let base=sample_backdrop(uv);let center=blur(uv+offset);let red=blur(uv+offset*(1+params.dispersion));let blue=blur(uv+offset*(1-params.dispersion));let glass=vec4f(red.r,center.g,blue.b,center.a);return mix(base,glass,mask);}`,
      'backdrop-glass-refraction',
      [{ binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    );
    const flags = ctx.device.createBuffer({
      label: 'backdrop-alpha-flags',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    let capture: ReturnType<typeof createElementCapture> | undefined;
    return {
      resize() {},
      reset() {},
      update() {},
      render(_f, e, target) {
        const captured = capture?.tap;
        ctx.device.queue.writeBuffer(flags, 0, new Uint32Array([captured ? 1 : 0]));
        pass.draw(e, target, [
          filterGroup(ctx, pass, captured ?? input(), [
            { binding: 3, resource: { buffer: flags } },
          ]),
        ]);
      },
      setInput(name, value) {
        if (name !== 'element')
          throw new Error(
            'Backdrop glass accepts an explicit element capture or a bound image texture',
          );
        if (value === null) {
          capture?.dispose();
          capture = undefined;
          return;
        }
        if (!(value instanceof HTMLElement)) throw new TypeError('Expected a DOM element');
        const next = createElementCapture(ctx.session, value);
        capture?.dispose();
        capture = next;
      },
      textureTaps(): Readonly<Record<string, TextureTap>> {
        return capture?.tap ? { domCapture: capture.tap } : {};
      },
      memory() {
        return { textureBytes: capture?.bytes ?? 0, bufferBytes: 16 };
      },
      sources: { refraction: pass.source },
      diagnostics: pass.diagnostics,
      dispose() {
        capture?.dispose();
        pass.dispose();
        flags.destroy();
      },
    };
  },
});
