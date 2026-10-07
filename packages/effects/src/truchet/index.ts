import { fragmentEffect, hash } from '@mk7s/hologpu-core';

export default fragmentEffect({
  id: 'truchet',
  title: 'Truchet, hex and quasi-crystal contours',
  core: false,
  tags: ['tiling', 'integer-hash', 'bit-operations', 'quasiperiodic'],
  params: {
    mode: {
      type: 'enum',
      default: 'truchet',
      options: ['truchet', 'hex', 'quasi-crystal'],
      group: 'Algorithm',
      description: 'Square arcs, hexagonal arcs, or quasiperiodic interference contours.',
    },
    waves: {
      type: 'enum',
      default: 'five',
      options: ['five', 'eight'],
      group: 'Algorithm',
      description: 'Plane-wave count in quasi-crystal mode; this does not construct Penrose tiles.',
    },
    scale: {
      type: 'f32',
      default: 14,
      min: 3,
      max: 40,
      step: 0.25,
      group: 'Geometry',
      description: 'Coordinate units along the short stage dimension; hexes span two units.',
    },
    width: {
      type: 'f32',
      default: 0.065,
      min: 0.01,
      max: 0.2,
      step: 0.005,
      group: 'Geometry',
      description: 'Arc half-width in tile units; quasi-crystal uses a scaled field threshold.',
    },
    level: {
      type: 'f32',
      default: 0,
      min: -0.6,
      max: 0.6,
      step: 0.01,
      group: 'Geometry',
      description: 'Normalized interference level traced by quasi-crystal contours.',
    },
    grid: {
      type: 'bool',
      default: false,
      group: 'Geometry',
      description: 'Show square or hex cell boundaries; quasi-crystal has no cell grid.',
    },
    speed: {
      type: 'f32',
      default: 0.15,
      min: 0,
      max: 1,
      step: 0.01,
      group: 'Motion',
      description: 'Pan speed in pattern-coordinate units per second.',
    },
    ink: {
      type: 'color',
      default: '#f1b987',
      group: 'Palette',
      description: 'Arc or contour color; alpha controls coverage over the opaque ground.',
    },
    ground: {
      type: 'color',
      default: '#172333',
      group: 'Palette',
      description: 'Opaque ground color; its alpha is ignored.',
    },
  },
  presets: {
    hex: { mode: 'hex', scale: 20, width: 0.07, grid: true, ink: '#a0e3d0' },
    'quasi-crystal': {
      mode: 'quasi-crystal',
      waves: 'five',
      scale: 7,
      width: 0.1,
      level: 0.05,
      ink: '#d5b0ef',
    },
  },
  features: [],
  inputs: ['time', 'seed'],
  quality: { resolutionScale: [0.25, 1] },
  reducedMotion: { time: 0 },
  fallback: 'repeating-conic-gradient(#172333 0% 25%, #f1b987 0% 50%) 0 0 / 48px 48px',
  chunks: [hash],
  wgsl: /* wgsl */ `
// Preserve signed coordinate bits before rotate/XOR mixing. A low hash bit
// selects tile orientation; unsigned overflow and shifts are intentional.
fn tile_bits(cell: vec2i) -> u32 {
  let bits=bitcast<vec2u>(cell);
  let rotated=(bits.y<<16u)|(bits.y>>16u);
  return hash_u32((bits.x*0x9e3779b9u)^(rotated*0x85ebca6bu)^frame.seed);
}
fn hex_cell(p: vec2f) -> vec2i {
  let axial=vec2f(p.x*0.577350269-p.y/3.0,p.y*0.666666667);
  let cube=vec3f(axial.x,-axial.x-axial.y,axial.y);
  var rounded=round(cube);let error=abs(rounded-cube);
  if(error.x>error.y && error.x>error.z){rounded.x=-rounded.y-rounded.z;}
  else if(error.y>error.z){rounded.y=-rounded.x-rounded.z;}
  else{rounded.z=-rounded.x-rounded.y;}
  return vec2i(vec2f(rounded.x,rounded.z));
}
fn effect(uv: vec2f) -> vec4f {
  let p=aspect_uv(uv,frame.resolution)*params.scale
    +vec2f(frame.time*params.speed,frame.time*params.speed*0.37);
  var distance=0.0;var border=1.0;var halfWidth=params.width;var derivativeSignal=0.0;
  if(params.mode==0u){
    let cell=vec2i(floor(p));var local=fract(p);
    let flip=(tile_bits(cell)&1u)!=0u;
    local.x=select(local.x,1.0-local.x,flip);
    distance=min(abs(length(local)-0.5),abs(length(local-1.0)-0.5));
    border=min(min(local.x,1.0-local.x),min(local.y,1.0-local.y));
  }else if(params.mode==1u){
    let cell=hex_cell(p);let center=vec2f(1.732050808*(f32(cell.x)+0.5*f32(cell.y)),1.5*f32(cell.y));
    let local=p-center;let orientation=tile_bits(cell)&1u;
    distance=10.0;
    // Alternate vertices each carry one radius-1/2 circular arc connecting
    // adjacent edge midpoints. Both bit-selected orientations connect all six.
    for(var i=0u;i<3u;i++){
      let angle=0.523598776+f32((i<<1u)+orientation)*1.047197551;
      let vertex=vec2f(cos(angle),sin(angle));
      distance=min(distance,abs(length(local-vertex)-0.5));
    }
    border=0.866025404-max(abs(local.x),max(abs(0.5*local.x+0.866025404*local.y),abs(0.5*local.x-0.866025404*local.y)));
  }else{
    let count=select(5u,8u,params.waves==1u);
    let shift=vec2f(random(frame.seed^0x2b7e1516u),random(frame.seed^0x9e3779b9u))*4.0;
    var field=0.0;
    for(var i=0u;i<count;i++){
      let angle=f32(i)*6.283185307/f32(count);
      field+=cos(dot(p+shift,vec2f(cos(angle),sin(angle)))*6.283185307);
    }
    derivativeSignal=field/f32(count)-params.level;
    distance=abs(derivativeSignal);
    halfWidth=params.width*0.25;
  }
  // All derivatives occur after both coordinate-dependent and uniform branches.
  // The interference branch uses field-space coverage, not a geometric SDF.
  let geometricFootprint=length(fwidth(p));
  let fieldFootprint=fwidth(derivativeSignal);
  let aa=max(select(geometricFootprint,fieldFootprint,params.mode==2u),0.0001);
  let borderAA=max(geometricFootprint,0.0001);
  let coverage=1.0-smoothstep(max(0.0,halfWidth-aa),halfWidth+aa,distance);
  let cellLine=(1.0-smoothstep(0.008,0.008+borderAA,border))*f32(params.grid);
  let background=mix(params.ground.rgb,params.ink.rgb,cellLine*0.15*params.ink.a);
  return vec4f(mix(background,params.ink.rgb,coverage*params.ink.a),1.0);
}`,
});
