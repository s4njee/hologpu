import { createFilterPass, createJumpFlood, defineEffect, filterGroup } from '@mk7s/hologpu-core';
import type { TextureTap } from '@mk7s/hologpu-core';
import { defaultTextMask } from '../_typography/common.ts';

const params = {
  mode: {
    type: 'enum',
    default: 'glow',
    options: ['glow', 'outline', 'both'],
    group: 'Appearance',
    description: 'Soft exterior halo, crisp exterior outline, or both.',
  },
  tint: {
    type: 'color',
    default: '#c2b8e6',
    css: true,
    group: 'Palette',
    description: 'Soft halo colour.',
  },
  outlineTint: {
    type: 'color',
    default: '#ebe5ff',
    css: true,
    group: 'Palette',
    description: 'Crisp outline colour.',
  },
  intensity: {
    type: 'f32',
    default: 0.18,
    min: 0,
    max: 1,
    step: 0.01,
    css: true,
    group: 'Appearance',
    description: 'Peak exterior glow or outline opacity.',
  },
  glow: {
    type: 'f32',
    default: 6,
    min: 0.5,
    max: 32,
    step: 0.5,
    unit: 'px',
    css: true,
    group: 'Geometry',
    description: 'Exponential halo falloff in CSS pixels.',
  },
  width: {
    type: 'f32',
    default: 1,
    min: 0.25,
    max: 6,
    step: 0.25,
    unit: 'px',
    css: true,
    group: 'Geometry',
    description: 'Exterior outline width in CSS pixels.',
  },
  breathing: {
    type: 'f32',
    default: 0.04,
    min: 0,
    max: 0.15,
    step: 0.01,
    group: 'Motion',
    description: 'Optional slow opacity breathing; disabled with reduced motion.',
  },
  speed: {
    type: 'f32',
    default: 0.25,
    min: 0,
    max: 0.5,
    step: 0.01,
    unit: 'rad/s',
    group: 'Motion',
    description: 'Breathing angular speed; default cycle is about 25 seconds.',
  },
  pointerStrength: {
    type: 'f32',
    default: 0,
    min: 0,
    max: 0.2,
    step: 0.01,
    group: 'Interaction',
    description: 'Optional pointer proximity opacity boost; disabled with reduced motion.',
  },
  pointerRadius: {
    type: 'f32',
    default: 160,
    min: 32,
    max: 480,
    step: 1,
    unit: 'px',
    group: 'Interaction',
    description: 'Pointer boost radius in CSS pixels.',
  },
} as const;

type MaskKey = {
  texture: GPUTexture;
  width: number;
  height: number;
  mipLevel: number;
  arrayLayer: number;
  version?: number;
};
const keyFor = (tap: TextureTap): MaskKey => ({
  texture: tap.texture,
  width: tap.width,
  height: tap.height,
  mipLevel: tap.mipLevel ?? 0,
  arrayLayer: tap.arrayLayer ?? 0,
  version: tap.version,
});
const sameMask = (a: MaskKey | undefined, b: MaskKey) =>
  Boolean(
    a &&
    a.texture === b.texture &&
    a.width === b.width &&
    a.height === b.height &&
    a.mipLevel === b.mipLevel &&
    a.arrayLayer === b.arrayLayer &&
    a.version === b.version,
  );

export default defineEffect({
  id: 'text-outline-glow',
  budget: { expectedMs: 0.7, referenceSize: [640, 400] },
  title: 'Cached text outline and glow',
  family: 'dom',
  tier: 'T1',
  core: true,
  tags: ['text', 'outline', 'glow', 'cached-distance', 'css'],
  features: [],
  inputs: ['text', 'time', 'pointer', 'css'],
  params,
  presets: {
    halo: { mode: 'glow', intensity: 0.18, glow: 6, tint: '#c2b8e6' },
    outline: { mode: 'outline', intensity: 0.22, width: 1, breathing: 0 },
    ember: {
      mode: 'both',
      tint: '#e9ad87',
      outlineTint: '#ffe2bd',
      intensity: 0.2,
      glow: 5,
      width: 0.75,
    },
  },
  quality: { resolutionScale: [0.5, 1] },
  reducedMotion: { time: 0 },
  fallback: 'transparent',
  textFallback: {
    kind: 'shadow',
    colors: ['tint'],
    shadow:
      '0 0 calc(var(--hgpu-glow, 6) * 1px) color-mix(in srgb, var(--hgpu-tint, #c2b8e6) calc(var(--hgpu-intensity, 0.18) * 100%), transparent)',
  },
  poster: new URL('./poster.png', import.meta.url).href,
  async create(ctx) {
    const fallback = defaultTextMask(ctx.device);
    const jfa = await createJumpFlood(ctx.session, [fallback.width, fallback.height]).catch(
      (error) => {
        fallback.texture.destroy();
        throw error;
      },
    );
    try {
      const pass = await createFilterPass(
        ctx,
        /* wgsl */ `
@group(0) @binding(3) var distanceMap:texture_2d<f32>;
fn effect(uv:vec2f)->vec4f {
  let cssSize=frame.resolution/max(frame.dpr,0.0001);
  let maskSize=vec2f(textureDimensions(distanceMap));
  let cssPerMaskPixel=min(cssSize.x/maskSize.x,cssSize.y/maskSize.y);
  let distanceCss=max(sample_bilinear(distanceMap,uv).r,0.0)*cssPerMaskPixel;
  let outside=1.0-clamp(sample_image(uv).a,0.0,1.0);
  let aa=max(0.5/max(frame.dpr,0.0001),0.5*fwidth(distanceCss));
  var halo=exp(-distanceCss/params.glow)*outside;
  var outline=(1.0-smoothstep(params.width-aa,params.width+aa,distanceCss))*outside;
  if(params.mode==0u) {outline=0.0;} else if(params.mode==1u) {halo=0.0;}
  let proximity=1.0-smoothstep(0.0,params.pointerRadius,distance(uv*cssSize,frame.pointer*cssSize));
  let moving=1.0-frame.reducedMotion;
  let modulation=1.0+moving*(params.breathing*sin(frame.time*params.speed)+proximity*params.pointerStrength);
  let tint=mix(params.tint.rgb,params.outlineTint.rgb,outline/max(halo+outline,0.00001));
  let alpha=clamp(params.intensity*max(halo*params.tint.a,outline*params.outlineTint.a)*modulation,0.0,1.0);
  return vec4f(tint*alpha,alpha);
}`,
        'hgpu-text-outline-glow',
        [
          {
            binding: 3,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: 'unfilterable-float' },
          },
        ],
      );
      let cache: MaskKey | undefined, group: GPUBindGroup | undefined;
      let revision = 0,
        disposed = false;
      return {
        resize() {},
        update() {},
        reset() {},
        render(_frame, encoder, target) {
          const mask = ctx.inputs?.get('text') ?? fallback;
          const key = keyFor(mask);
          if (!sameMask(cache, key)) {
            jfa.resize([mask.width, mask.height]);
            const result = jfa.encode(encoder, mask);
            group = filterGroup(ctx, pass, mask, [
              { binding: 3, resource: result.distance.texture.createView() },
            ]);
            cache = key;
            revision++;
          }
          pass.draw(encoder, target, [group!]);
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          pass.dispose();
          jfa.dispose();
          fallback.texture.destroy();
          group = undefined;
          cache = undefined;
        },
        sources: { fragment: pass.source, ...jfa.sources },
        diagnostics: [...pass.diagnostics, ...jfa.diagnostics],
        textureTaps(): Readonly<Record<string, TextureTap>> {
          return disposed || !cache
            ? {}
            : {
                distance: { ...jfa.distance, version: revision },
                nearest: { ...jfa.nearest, version: revision },
              };
        },
        memory() {
          const memory = jfa.memory();
          return disposed
            ? { textureBytes: 0, bufferBytes: 0 }
            : {
                textureBytes: memory.textureBytes + fallback.width * fallback.height * 4,
                bufferBytes: memory.bufferBytes,
              };
        },
      };
    } catch (error) {
      jfa.dispose();
      fallback.texture.destroy();
      throw error;
    }
  },
});
