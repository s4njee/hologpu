import { basicParticleEffect, renderParams, randomInit } from '../_particles/basic.ts';
import { rasterTargets, type MorphInputs } from './targets.ts';
const params = {
  ...renderParams,
  count: { ...renderParams.count, default: 32768 },
  mask: {
    type: 'enum',
    default: 'text',
    options: ['text', 'image'],
    uniform: false,
    group: 'Target',
    description:
      'Local raster text mask or image luminance targets; custom input accepted through field.setInput.',
  },
  word: {
    type: 'enum',
    default: 'GPU',
    options: ['GPU', 'HELLO', 'FLOW'],
    uniform: false,
    group: 'Target',
    description: 'Built-in text mask. setInput("text", string) replaces it with custom text.',
  },
  spring: {
    type: 'f32',
    default: 18,
    min: 1,
    max: 80,
    step: 1,
    group: 'Motion',
    description: 'Spring acceleration toward the target point.',
  },
  damping: {
    type: 'f32',
    default: 5,
    min: 0,
    max: 12,
    step: 0.1,
    group: 'Motion',
    description: 'Exponential velocity damping per second.',
  },
  scatter: {
    type: 'f32',
    default: 2,
    min: 0,
    max: 8,
    step: 0.1,
    group: 'Motion',
    description: 'Pointer repulsion strength while pressed.',
  },
  radius: {
    type: 'f32',
    default: 0.35,
    min: 0.05,
    max: 1,
    step: 0.01,
    group: 'Motion',
    description: 'Pointer scatter radius in normalized coordinates.',
  },
} as const;
// Each instance receives independent local inputs; no cross-mount mutable registry.
export default basicParticleEffect(
  {
    id: 'morph-particles',
    title: 'Text and image particle morph',
    family: 'particles',
    core: true,
    tags: ['text', 'image', 'spring', 'pointer'],
    params,
    inputs: ['pointer', 'text', 'image'],
    features: [],
    presets: {
      image: { mask: 'image', spring: 12, damping: 3, trail: 0.85, tint: '#edb68c' },
      soft: { word: 'HELLO', spring: 5, damping: 2, scatter: 5, trail: 0.97, tint: '#b8a6ef' },
    },
    quality: { resolutionScale: [0.25, 1] },
    reducedMotion: { time: 0 },
    fallback: 'radial-gradient(ellipse,#b8a6ef,#07111e)',
  },
  () => {
    const input: MorphInputs = {};
    return {
      initialize: randomInit,
      step: `let goal= targets[id.x];let dt=frame.delta;var acceleration=(goal.xy-p.position.xy)*params.spring;if(frame.buttons!=0u){let mouse=frame.pointer*vec2f(2,-2)+vec2f(-1,1);let delta=p.position.xy-mouse;let distance=length(delta);acceleration+=delta/max(distance,.01)*params.scatter*max(0.0,1-distance/params.radius);}p.velocity=vec4f((p.velocity.xy+acceleration*dt)*exp(-params.damping*dt),0,0);p.position=vec4f(clamp(p.position.xy+p.velocity.xy*dt,vec2f(-2),vec2f(2)),0,goal.z);`,
      setupTargets: (context, count) =>
        rasterTargets(
          count,
          String(context.params.values.mask),
          String(context.params.values.word),
          input,
        ),
      setInput(name, data) {
        if (name === 'text' && typeof data === 'string') {
          input.text = data;
          return;
        }
        if (name === 'image' && data && typeof data === 'object') {
          const copy = document.createElement('canvas');
          copy.width = 512;
          copy.height = 256;
          const raster = copy.getContext('2d')!;
          raster.imageSmoothingEnabled = false;
          raster.drawImage(data as CanvasImageSource, 0, 0, 512, 256);
          input.image = copy;
          return;
        }
        throw new TypeError(
          'Morph accepts setInput("text", string) or setInput("image", CanvasImageSource)',
        );
      },
    };
  },
);
