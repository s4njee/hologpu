import { fragmentEffect, sdf } from '@mk7s/hologpu-core';

export interface WaveDividerGeometry {
  /** Wave height in CSS pixels, limited to fit the host. */
  amplitude: number;
  /** Resting edge position as a fraction of host height. */
  baseline: number;
  /** Primary sine cycles across the host width. */
  cycles: number;
  /** Primary phase offset in radians. */
  phase: number;
}

export const waveDividerDefaults = {
  amplitude: 18,
  baseline: 0.5,
  cycles: 1.15,
  phase: 0,
  speed: 0.12,
  fill: '#11191c',
} as const;

const SECONDARY_AMPLITUDE = 0.35,
  SECONDARY_FREQUENCY = 2,
  SECONDARY_PHASE = 1.3,
  TAU = Math.PI * 2,
  PATH_ERROR = 0.01;
const ranges = {
  amplitude: [0, 64],
  baseline: [0.25, 0.75],
  cycles: [0.25, 4],
  phase: [-Math.PI, Math.PI],
} as const;
const wgslNumber = (value: number) => value.toFixed(10);
const format = (value: number) => Number(value.toPrecision(12)).toString();

/** Closed time-zero SVG path; vertices follow the shader edge with <=0.01 CSS px interpolation error. */
export function waveDividerPath(
  width: number,
  height: number,
  params: Partial<WaveDividerGeometry> = {},
): string {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    throw new RangeError('Wave divider dimensions must be finite positive CSS pixels');
  const geometry: WaveDividerGeometry = { ...waveDividerDefaults };
  for (const key of Object.keys(ranges) as (keyof WaveDividerGeometry)[]) {
    const value = params[key] ?? waveDividerDefaults[key];
    if (!Number.isFinite(value)) throw new TypeError(`Wave divider ${key} must be finite`);
    const [min, max] = ranges[key];
    geometry[key] = Math.max(min, Math.min(max, value));
  }
  const baseline = height * geometry.baseline;
  const clearance = Math.min(2, height * 0.25);
  const amplitude = Math.min(
    geometry.amplitude,
    Math.max(0, Math.min(baseline, height - baseline) - clearance) / (1 + SECONDARY_AMPLITUDE),
  );
  // For linear interpolation, error <= max|y''| * step^2 / 8.
  const segments = Math.max(
    16,
    Math.ceil(
      TAU *
        geometry.cycles *
        Math.sqrt(
          (amplitude * (1 + SECONDARY_AMPLITUDE * SECONDARY_FREQUENCY ** 2)) / (8 * PATH_ERROR),
        ),
    ),
  );
  const points: string[] = [];
  for (let i = 0; i <= segments; i++) {
    const fraction = i / segments;
    const angle = fraction * TAU * geometry.cycles + geometry.phase;
    const y =
      baseline +
      amplitude *
        (Math.sin(angle) +
          SECONDARY_AMPLITUDE * Math.sin(angle * SECONDARY_FREQUENCY + SECONDARY_PHASE));
    points.push(`${i ? 'L' : 'M'}${format(width * fraction)} ${format(y)}`);
  }
  return `${points.join('')}L${format(width)} ${format(height)}L0 ${format(height)}Z`;
}

export default fragmentEffect({
  id: 'wave-divider',
  budget: { expectedMs: 0.3, referenceSize: [640, 400] },
  title: 'Gentle section wave divider',
  tags: ['divider', 'section', 'wave', 'css', 'launch-page'],
  inputs: ['time', 'css'],
  params: {
    fill: {
      type: 'color',
      default: waveDividerDefaults.fill,
      css: true,
      group: 'Palette',
      description: 'Use the next section’s opaque background colour for a seamless join.',
    },
    amplitude: {
      type: 'f32',
      default: waveDividerDefaults.amplitude,
      min: ranges.amplitude[0],
      max: ranges.amplitude[1],
      step: 1,
      css: true,
      unit: 'px',
      group: 'Geometry',
      description: 'Wave height in CSS pixels; limited to fit the host without clipping.',
    },
    baseline: {
      type: 'f32',
      default: waveDividerDefaults.baseline,
      min: ranges.baseline[0],
      max: ranges.baseline[1],
      step: 0.01,
      css: true,
      group: 'Geometry',
      description: 'Resting edge position as a fraction of divider height.',
    },
    cycles: {
      type: 'f32',
      default: waveDividerDefaults.cycles,
      min: ranges.cycles[0],
      max: ranges.cycles[1],
      step: 0.05,
      css: true,
      group: 'Geometry',
      description: 'Primary sine cycles across the divider width.',
    },
    phase: {
      type: 'f32',
      default: waveDividerDefaults.phase,
      min: ranges.phase[0],
      max: ranges.phase[1],
      step: 0.05,
      css: true,
      unit: 'rad',
      group: 'Geometry',
      description: 'Phase offset shared with the static SVG path.',
    },
    speed: {
      type: 'f32',
      default: waveDividerDefaults.speed,
      min: 0,
      max: 0.4,
      step: 0.01,
      css: true,
      unit: 'rad/s',
      group: 'Motion',
      description: 'Gentle phase travel; zero holds the time-zero shape.',
    },
  },
  presets: {
    gentle: {},
    shallow: { amplitude: 10, cycles: 0.75, speed: 0.08 },
    still: { speed: 0 },
  },
  quality: { resolutionScale: [0.5, 1] },
  reducedMotion: { time: 0 },
  fallback: 'transparent',
  poster: new URL('./poster.png', import.meta.url).href,
  chunks: [sdf],
  wgsl: /* wgsl */ `
fn effect(uv:vec2f)->vec4f {
  let dpr=max(frame.dpr,0.0001);
  let size=frame.resolution/dpr;
  let p=uv*size;
  let baseline=size.y*params.baseline;
  let clearance=min(2.0,size.y*0.25);
  let amplitude=min(params.amplitude,max(0.0,min(baseline,size.y-baseline)-clearance)/${wgslNumber(1 + SECONDARY_AMPLITUDE)});
  let time=select(frame.time,0.0,frame.reducedMotion>0.5);
  let angle=p.x/size.x*${wgslNumber(TAU)}*params.cycles+params.phase+time*params.speed;
  let secondary=angle*${wgslNumber(SECONDARY_FREQUENCY)}+${wgslNumber(SECONDARY_PHASE)};
  let edge=baseline+amplitude*(sin(angle)+${wgslNumber(SECONDARY_AMPLITUDE)}*sin(secondary));
  let slope=amplitude*${wgslNumber(TAU)}*params.cycles/size.x*(cos(angle)+${wgslNumber(SECONDARY_AMPLITUDE * SECONDARY_FREQUENCY)}*cos(secondary));
  // The box extends beyond the canvas sides/bottom; its warped top is the wave.
  let distance=sd_box(p-vec2f(size.x*0.5,edge+size.y),vec2f(size.x*0.5+size.y,size.y))/sqrt(1.0+slope*slope);
  let aa=max(0.5/dpr,0.5*fwidth(distance));
  let coverage=max(1.0-smoothstep(-aa,aa,distance),step(size.y-1.0/dpr,p.y));
  return vec4f(params.fill.rgb,coverage*params.fill.a);
}`,
});
