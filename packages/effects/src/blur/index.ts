import { filterEffect } from '@mk7s/hologpu-core';
import type { TextureTap } from '@mk7s/hologpu-core';
import { f, u, e, stage, targetSet, texBytes, kawaseDown, kawaseUp } from '../_filters/common.ts';
const gaussian = `fn effect(uv:vec2f)->vec4f {if(params.radius<.001){return sample_image(uv);} let direction=stage.xy/frame.resolution;var c=vec4f(0);var sum=0.0;let radius=i32(ceil(params.radius));let sigma=max(params.radius/3.0,.35);for(var i=-24;i<=24;i++){if(abs(i)<=radius){let weight=select(exp(-f32(i*i)/(2.0*sigma*sigma)),1.0,params.algorithm==2u);c+=sample_image(uv+direction*f32(i))*weight;sum+=weight;}}return c/max(sum,.00001);}`;
export default filterEffect({
  id: 'blur',
  title: 'Gaussian / dual Kawase / box blur',
  core: true,
  tags: ['filter', 'blur', 'separable', 'pyramid'],
  params: {
    algorithm: e(
      'gaussian',
      ['gaussian', 'dual-kawase', 'box'],
      'Normalized separable Gaussian or box; dual Kawase uses a down/up pyramid.',
    ),
    radius: f(
      8,
      0,
      24,
      'Gaussian/box radius in output texels; Gaussian sigma is radius / 3. Dual offset is radius / 8.',
      'Kernel',
    ),
    passes: u(3, 1, 5, 'Dual Kawase pyramid depth.', 'Kernel'),
  },
  presets: {
    soft: { algorithm: 'gaussian', radius: 8 },
    wide: { algorithm: 'dual-kawase', radius: 16, passes: 4 },
  },
  async setup({ ctx, input }) {
    const stages: import('../_filters/common.ts').Stage[] = [];
    try {
      stages.push(await stage(ctx, gaussian, 'blur-horizontal', [1, 0, 1, 0]));
      stages.push(await stage(ctx, gaussian, 'blur-vertical', [0, 1, 1, 0]));
      stages.push(
        await stage(
          ctx,
          kawaseDown.replace('texel*stage.z', 'texel*max(params.radius/8.0,.25)'),
          'blur-kawase-down',
          [0, 0, 1, 0],
        ),
      );
      stages.push(
        await stage(
          ctx,
          kawaseUp.replace('stage.z/', 'max(params.radius/8.0,.25)/'),
          'blur-kawase-up',
          [0, 0, 1, 0],
        ),
      );
    } catch (error) {
      stages.forEach((s) => s.dispose());
      throw error;
    }
    let size: readonly [number, number] = [1, 1],
      targets: TextureTap[] = [],
      key = '';
    const allocate = () => {
      const levels = Number(ctx.params.values.passes);
      const next = `${size}:${levels}`;
      if (key === next) return;
      targets.forEach((t) => t.texture.destroy());
      targets = targetSet(
        ctx,
        [
          size,
          ...Array.from(
            { length: levels },
            (_, i) =>
              [
                Math.max(1, Math.ceil(size[0] / 2 ** (i + 1))),
                Math.max(1, Math.ceil(size[1] / 2 ** (i + 1))),
              ] as const,
          ),
          ...Array.from(
            { length: levels - 1 },
            (_, i) =>
              [
                Math.max(1, Math.ceil(size[0] / 2 ** (i + 1))),
                Math.max(1, Math.ceil(size[1] / 2 ** (i + 1))),
              ] as const,
          ),
        ],
        'blur',
      );
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
        if (
          ctx.params.values.algorithm !== 'dual-kawase' ||
          Number(ctx.params.values.radius) === 0
        ) {
          stages[0]!.draw(encoder, targets[0]!.texture.createView(), input());
          stages[1]!.draw(encoder, target, targets[0]!);
          return;
        }
        const levels = Number(ctx.params.values.passes);
        let src = input();
        for (let i = 0; i < levels; i++) {
          const dst = targets[1 + i]!;
          stages[2]!.draw(encoder, dst.texture.createView(), src);
          src = dst;
        }
        for (let i = levels - 2; i >= 0; i--) {
          const dst = targets[levels + 1 + i]!;
          stages[3]!.draw(encoder, dst.texture.createView(), src);
          src = dst;
        }
        stages[3]!.draw(encoder, target, src);
      },
      dispose() {
        stages.forEach((s) => s.dispose());
        targets.forEach((t) => t.texture.destroy());
        targets = [];
      },
      sources: Object.fromEntries(
        stages.map((s, i) => [
          ['horizontal', 'vertical', 'downsample', 'upsample'][i]!,
          s.pass.source,
        ]),
      ),
      diagnostics: stages.flatMap((s) => s.pass.diagnostics),
      textureTaps() {
        return Object.fromEntries(targets.map((t, i) => [`blur${i}`, t]));
      },
      memory() {
        return { textureBytes: texBytes(targets), bufferBytes: stages.length * 16 };
      },
    };
  },
});
