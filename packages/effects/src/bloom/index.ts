import { filterEffect } from '@mk7s/hologpu-core';
import type { TextureTap } from '@mk7s/hologpu-core';
import {
  f,
  u,
  stage,
  targetSet,
  texBytes,
  kawaseDown,
  kawaseUp,
  straight,
} from '../_filters/common.ts';
const threshold =
  straight +
  `fn effect(uv:vec2f)->vec4f {let c=sample_image(uv);let brightness=max(max(straight(c).r,straight(c).g),straight(c).b);let knee=max(params.knee,.0001);let soft=clamp(brightness-params.threshold+knee,0.0,2.0*knee);let contribution=max(brightness-params.threshold,soft*soft/(4.0*knee))/max(brightness,.0001);return c*select(clamp(contribution,0.0,1.0),0.0,brightness<.0001);}`;
const up = kawaseUp.replace('return c/12.0;', 'return c/12.0+sample_bilinear(secondImage,uv);');
const composite = `fn effect(uv:vec2f)->vec4f {let base=sample_image(uv);let glow=sample_bilinear(secondImage,uv);return vec4f(base.rgb+glow.rgb*params.strength,max(base.a,clamp(glow.a*params.strength,0.0,1.0)));}`;
export default filterEffect({
  id: 'bloom',
  title: 'HDR mip-pyramid bloom',
  core: true,
  tags: ['filter', 'hdr', 'bloom', 'pyramid'],
  params: {
    threshold: f(1, 0.0, 4, 'Linear HDR brightness threshold.', 'Extraction'),
    knee: f(0.3, 0, 1, 'Smooth transition half-width around threshold.', 'Extraction'),
    strength: f(0.35, 0, 2, 'Additive intensity of reconstructed glow.', 'Composite'),
    levels: u(4, 1, 6, 'Downsample levels accumulated during upsampling.', 'Pyramid'),
  },
  presets: {
    subtle: { threshold: 1, strength: 0.25, levels: 4 },
    dream: { threshold: 0.35, knee: 0.5, strength: 0.6, levels: 5 },
  },
  async setup({ ctx, input }) {
    const stages: import('../_filters/common.ts').Stage[] = [];
    try {
      stages.push(await stage(ctx, threshold, 'bloom-threshold', [0, 0, 1, 0]));
      stages.push(await stage(ctx, kawaseDown, 'bloom-downsample', [0, 0, 1, 0]));
      stages.push(await stage(ctx, up, 'bloom-upsample', [0, 0, 1, 0], true));
      stages.push(await stage(ctx, composite, 'bloom-composite', [0, 0, 1, 0], true));
    } catch (error) {
      stages.forEach((s) => s.dispose());
      throw error;
    }
    let size: readonly [number, number] = [1, 1],
      targets: TextureTap[] = [],
      key = '';
    const allocate = () => {
      const levels = Number(ctx.params.values.levels);
      const next = `${size}:${levels}`;
      if (key === next) return;
      targets.forEach((t) => t.texture.destroy());
      const sizes = Array.from(
        { length: levels + 1 },
        (_, i) =>
          [
            Math.max(1, Math.ceil(size[0] / 2 ** i)),
            Math.max(1, Math.ceil(size[1] / 2 ** i)),
          ] as const,
      );
      targets = targetSet(ctx, [...sizes, ...sizes.slice(0, -1)], 'bloom');
      key = next;
    };
    return {
      resize(s) {
        size = s;
        allocate();
      },
      update() {
        allocate();
      },
      reset() {},
      render(_f, encoder, target) {
        allocate();
        const levels = Number(ctx.params.values.levels);
        stages[0]!.draw(encoder, targets[0]!.texture.createView(), input());
        for (let i = 1; i <= levels; i++)
          stages[1]!.draw(encoder, targets[i]!.texture.createView(), targets[i - 1]!);
        let src = targets[levels]!;
        for (let i = levels - 1; i >= 0; i--) {
          const dst = targets[levels + 1 + i]!;
          stages[2]!.draw(encoder, dst.texture.createView(), src, targets[i]!);
          src = dst;
        }
        stages[3]!.draw(encoder, target, input(), src);
      },
      dispose() {
        stages.forEach((s) => s.dispose());
        targets.forEach((t) => t.texture.destroy());
        targets = [];
      },
      sources: Object.fromEntries(
        stages.map((s, i) => [
          ['threshold', 'downsample', 'upsample', 'composite'][i]!,
          s.pass.source,
        ]),
      ),
      diagnostics: stages.flatMap((s) => s.pass.diagnostics),
      textureTaps() {
        return Object.fromEntries(targets.map((t, i) => [`bloom${i}`, t]));
      },
      memory() {
        return { textureBytes: texBytes(targets), bufferBytes: stages.length * 16 };
      },
    };
  },
});
