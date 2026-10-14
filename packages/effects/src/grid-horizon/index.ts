import { fragmentEffect } from '@mk7s/hologpu-core';

/** Static default pose. SVG stays transparent so page copy and base colour remain ordinary DOM. */
function staticGrid(): string {
  const width = 1440,
    height = 900,
    horizon = height * 0.35;
  const focal = height * 0.8,
    camera = 0.8,
    near = (camera * focal) / (height - horizon);
  const project = (x: number, z: number) => [
    width / 2 + (x * focal) / z,
    horizon + (camera * focal) / z,
  ];
  const lines: string[] = [];
  for (let x = -24; x <= 24; x++) {
    const a = project(x, 36),
      b = project(x, near);
    lines.push(`<path d="M${a[0]} ${a[1]}L${b[0]} ${b[1]}"/>`);
  }
  for (let z = 1; z <= 36; z++) {
    const y = project(0, z)[1];
    lines.push(`<path opacity="${Math.exp(-0.13 * z)}" d="M0 ${y}H${width}"/>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><defs><linearGradient id="fog" x2="0" y2="1"><stop offset="0.35" stop-color="white" stop-opacity="0"/><stop offset="1" stop-color="white"/></linearGradient><mask id="fade"><rect width="100%" height="100%" fill="url(#fog)"/></mask></defs><g mask="url(#fade)" stroke="#8d9db4" stroke-width="1" fill="none" opacity="0.18">${lines.join('')}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") center / 100% 100% no-repeat`;
}

export default fragmentEffect({
  id: 'grid-horizon',
  budget: { expectedMs: 0.5, referenceSize: [640, 400] },
  title: 'Soft perspective floor grid',
  tags: ['background', 'launch-page', 'perspective', 'grid'],
  inputs: ['time'],
  params: {
    tint: {
      type: 'color',
      default: '#8d9db4',
      css: true,
      group: 'Palette',
      description: 'Grid line colour, with transparent space between lines.',
    },
    intensity: {
      type: 'f32',
      default: 0.18,
      min: 0,
      max: 1,
      step: 0.01,
      css: true,
      group: 'Appearance',
      description: 'Near-field line opacity before distance fog.',
    },
    horizon: {
      type: 'f32',
      default: 0.35,
      min: 0.1,
      max: 0.75,
      step: 0.01,
      group: 'Geometry',
      description: 'Horizon position as a fraction of field height from the top.',
    },
    spacing: {
      type: 'f32',
      default: 1,
      min: 0.5,
      max: 4,
      step: 0.05,
      group: 'Geometry',
      description: 'Grid pitch in world units on the perspective plane.',
    },
    lineWeight: {
      type: 'f32',
      default: 1,
      min: 0.5,
      max: 3,
      step: 0.05,
      unit: 'px',
      group: 'Appearance',
      description: 'Projected line weight in CSS pixels; independent of DPR and quality scale.',
    },
    fog: {
      type: 'f32',
      default: 0.13,
      min: 0.05,
      max: 0.5,
      step: 0.01,
      group: 'Appearance',
      description: 'Exponential attenuation with distance to the camera.',
    },
    speed: {
      type: 'f32',
      default: 0,
      min: 0,
      max: 0.15,
      step: 0.01,
      group: 'Motion',
      description:
        'Optional slow forward travel in world units per second; zero keeps the grid stationary.',
    },
  },
  presets: {
    quiet: { tint: '#8d9db4', intensity: 0.18, speed: 0 },
    dusk: { tint: '#b699cf', intensity: 0.16, fog: 0.16, speed: 0.03 },
    ember: { tint: '#d7996f', intensity: 0.2, fog: 0.15, speed: 0.02 },
  },
  quality: { resolutionScale: [0.5, 1] },
  reducedMotion: { time: 0 },
  poster: new URL('./poster.png', import.meta.url).href,
  fallback: staticGrid(),
  wgsl: /* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
  let dpr=max(frame.dpr,0.0001);
  let cssSize=frame.resolution/dpr;
  let p=uv*cssSize;
  let focal=cssSize.y*0.8;
  let screenDepth=p.y-cssSize.y*params.horizon;
  let z=0.8*focal/max(screenDepth,0.5);
  let world=vec2f((p.x-cssSize.x*0.5)*z/focal,z+frame.time*params.speed)/params.spacing;
  let footprint=max(fwidth(world),vec2f(0.00001));
  let dist=abs(fract(world+0.5)-0.5)/footprint;
  let halfWidth=params.lineWeight*dpr*0.5;
  let lines=vec2f(1.0)-smoothstep(vec2f(max(0.0,halfWidth-0.5)),vec2f(halfWidth+0.5),dist);
  let resolved=vec2f(1.0)-smoothstep(vec2f(0.15),vec2f(0.5),footprint);
  let coverage=max(lines.x*resolved.x,lines.y*resolved.y);
  let fade=exp(-params.fog*z)*smoothstep(0.0,6.0,screenDepth);
  return vec4f(params.tint.rgb,clamp(coverage*fade*params.intensity*params.tint.a,0.0,1.0));
}`,
});
