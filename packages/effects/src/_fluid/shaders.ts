export type FluidKind = 'fluid' | 'ink' | 'smoke';
/** MAC storage: x is the right face, y is the bottom face of each cell. */
export function solverCommon(kind: FluidKind, obstacles = false) {
  return /* wgsl */ `
@group(1) @binding(0) var src: texture_2d<f32>;
@group(1) @binding(1) var vel: texture_2d<f32>;
@group(1) @binding(2) var aux: texture_2d<f32>;
@group(1) @binding(3) var material: texture_2d<f32>;
${kind === 'ink' ? '@group(2) @binding(0) var resistance: texture_2d<f32>;' : ''}
${
  obstacles
    ? `struct Rects {count:u32,pad0:u32,pad1:u32,pad2:u32,rects:array<vec4f>};
@group(2) @binding(0) var<storage,read> obstacles:Rects;
fn solid(i:vec2i,n:vec2i)->bool {
  let cell=select(i,((i%n)+n)%n,params.boundary==1u);
  let q=(vec2f(cell)+0.5)/vec2f(n);
  for(var j=0u;j<min(obstacles.count,arrayLength(&obstacles.rects));j++) {
    let r=obstacles.rects[j]; if(all(q>=r.xy) && all(q<r.zw)) {return true;}
  }
  return false;
}
// Slab intersection stops semi-Lagrangian characteristics at the first solid rectangle;
// even a backtrace spanning multiple cells cannot tunnel through a thin heading.
fn obstacle_backtrace(start:vec2f,end:vec2f,n:vec2f)->vec2f {
  let a=start/n;let b=end/n;let d=b-a;var hit=1.0;
  for(var j=0u;j<min(obstacles.count,arrayLength(&obstacles.rects));j++) {
    let radius=select(0,1,params.boundary==1u);
    for(var oy=-radius;oy<=radius;oy++) {for(var ox=-radius;ox<=radius;ox++) {
    let r=obstacles.rects[j]+vec4f(f32(ox),f32(oy),f32(ox),f32(oy));
    let safe=select(select(vec2f(-1e-8),vec2f(1e-8),d>=vec2f(0)),d,abs(d)>vec2f(1e-8));
    let t0=(r.xy-a)/safe;let t1=(r.zw-a)/safe;
    let near=min(t0,t1);let far=max(t0,t1);
    let enter=max(near.x,near.y);let exit=min(far.x,far.y);
    if(enter>=0.0 && enter<=exit && enter<=hit) {hit=max(0.0,enter-0.0001);}
    }}
  }
  return mix(start,end,hit);
}`
    : ''
}
fn wrap_cell(i: vec2i,n: vec2i) -> vec2i { return ((i%n)+n)%n; }
fn load_cell(image: texture_2d<f32>,i: vec2i) -> vec4f {
  let n=vec2i(textureDimensions(image));
  if(params.boundary==1u) { return textureLoad(image,wrap_cell(i,n),0); }
  return textureLoad(image,clamp(i,vec2i(0),n-1),0);
}
fn bilerp(image: texture_2d<f32>,p: vec2f) -> vec4f {
  let b=vec2i(floor(p-0.5));let t=fract(p-0.5);
  return mix(mix(load_cell(image,b),load_cell(image,b+vec2i(1,0)),t.x),mix(load_cell(image,b+vec2i(0,1)),load_cell(image,b+vec2i(1,1)),t.x),t.y);
}
fn face_velocity(i: vec2i) -> vec2f {
  let n=vec2i(textureDimensions(vel));var v=load_cell(vel,i).xy;
  if(params.boundary==0u) { if(i.x<0 || i.x>=n.x-1) {v.x=0.0;}if(i.y<0 || i.y>=n.y-1) {v.y=0.0;} }
  ${obstacles ? 'if(solid(i,n) || solid(i+vec2i(1,0),n)) {v.x=0.0;} if(solid(i,n) || solid(i+vec2i(0,1),n)) {v.y=0.0;}' : ''}
  return v;
}
fn velocity_at(p: vec2f) -> vec2f {
  return vec2f(bilerp(vel,p-vec2f(0.5,0)).x,bilerp(vel,p-vec2f(0,0.5)).y);
}
fn wall_velocity(v: vec2f,i: vec2i,n: vec2i) -> vec2f {
  var result=v;
  if(params.boundary==0u) { if(i.x==n.x-1) {result.x=0.0;}if(i.y==n.y-1) {result.y=0.0;} }
  ${obstacles ? 'if(solid(i,n) || solid(i+vec2i(1,0),n)) {result.x=0.0;} if(solid(i,n) || solid(i+vec2i(0,1),n)) {result.y=0.0;}' : ''}
  return result;
}
fn gaussian(p: vec2f,c: vec2f,r: f32) -> f32 { let d=(p-c)/max(r,0.001);return exp(-dot(d,d)*0.5); }
fn source_position() -> vec2f { return ${kind === 'smoke' ? 'vec2f(0.5,0.86)' : 'vec2f(0.5+0.23*cos(frame.time*0.7),0.5+0.19*sin(frame.time*0.9))'}; }
fn pointer_position(n: vec2f) -> vec2f { return frame.pointer*n/n.y; }
fn pointer_weight(p: vec2f,n: vec2f) -> f32 {
  return select(0.0,gaussian(p,pointer_position(n),params.radius),frame.buttons!=0u);
}
fn paper_grain(i: vec2i) -> f32 {
  let p=vec2u(i);let h=hash_u32((p.x*1664525u) ^ hash_u32(p.y*1013904223u+frame.seed));
  return f32(h)/4294967295.0;
}
${
  kind === 'ink'
    ? `fn paper_resistance(i: vec2i) -> f32 {
  let n=vec2f(textureDimensions(src));
  let r=vec2i(textureDimensions(resistance));
  let uv=(vec2f(i)+0.5)/n;
  return clamp(textureLoad(resistance,clamp(vec2i(uv*vec2f(r)),vec2i(0),r-1),0).r,0.0,1.0);
}
fn pigment_transfer(m: vec4f,i: vec2i) -> vec2f {
  let grain=mix(1.0,0.35+1.3*paper_grain(i),params.grain);
  let rate=params.absorption*grain*(1.0+1.5*exp(-m.z))*(1.0-paper_resistance(i));
  return m.xy*(1.0-exp(-rate*frame.delta));
}`
    : ''
}
`;
}
export function storageFormat(kind: FluidKind, name: string): GPUTextureFormat {
  if (['divergence', 'curl', 'pressure', 'zero', 'shadow', 'obstacleMask'].includes(name))
    return 'r32float';
  // Pigment history must not undergo another half-float narrowing at every transfer.
  if (
    kind === 'ink' &&
    ['initMaterial', 'advectMaterial', 'deposit', 'absorb', 'zeroMaterial'].includes(name)
  )
    return 'rgba32float';
  return 'rgba16float';
}
export function computeShader(kind: FluidKind, name: string, obstacles = false) {
  const output = `@group(1) @binding(4) var destination: texture_storage_2d<${storageFormat(kind, name)},write>;`;
  const start = `@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) gid:vec3u) {
  let n=vec2i(textureDimensions(destination));let i=vec2i(gid.xy);if(any(i>=n)) {return;}
  let nf=vec2f(n);let cell=vec2f(i)+0.5;let uv=cell/nf;let p=cell/nf.y;`;
  const end = '\n}';
  const bodies: Record<string, string> = {
    obstacleMask: 'textureStore(destination,i,vec4f(select(0.0,1.0,solid(i,n)),0,0,0));',
    enforceVelocity:
      'textureStore(destination,i,vec4f(wall_velocity(load_cell(src,i).xy,i,n),0,0));',
    clearMaterial: 'textureStore(destination,i,select(load_cell(src,i),vec4f(0),solid(i,n)));',
    initVelocity: /* wgsl */ `
  var v=vec2f(0.0);
  if(params.initial==2u) { v=params.initialVelocity; }
  if(params.initial==3u) { v=vec2f(sin((f32(i.x)+1.0)/nf.x*6.2831853),sin((f32(i.y)+1.0)/nf.y*6.2831853))*0.18; }
  if(params.initial==0u) {
    let offset=(random(frame.seed+71u)-0.5)*0.12;
    for(var j=0u;j<3u;j++) {
      let c=vec2f(nf.x/nf.y*(0.27+0.23*f32(j)),0.42+offset+0.11*sin(f32(j)*2.0));
      let dx=(vec2f(i)+vec2f(1.0,0.5))/nf.y-c;
      let dy=(vec2f(i)+vec2f(0.5,1.0))/nf.y-c;
      let s=select(-1.0,1.0,j%2u==0u);
      v+=vec2f(-dx.y*exp(-dot(dx,dx)/0.035),dy.x*exp(-dot(dy,dy)/0.035))*s*1.4;
    }
  }
  textureStore(destination,i,vec4f(wall_velocity(v,i,n),0,0));`,
    initMaterial: /* wgsl */ `
  let shift=(random(frame.seed+31u)-0.5)*0.12;
  let a=gaussian(p,vec2f(nf.x/nf.y*0.34,${kind === 'smoke' ? '0.72' : '0.43'}+shift),${kind === 'smoke' ? '0.09' : '0.12'});
  let b=gaussian(p,vec2f(nf.x/nf.y*0.66,${kind === 'smoke' ? '0.8' : '0.57'}-shift),0.1);
  let weights=select(vec2f(a,b),vec2f(0.5),params.initial==2u)*params.initialAmount;
  ${kind === 'fluid' ? 'let m=vec4f(params.dyeA.rgb*weights.x+params.dyeB.rgb*weights.y,0);' : kind === 'ink' ? 'let m=vec4f(weights,weights.x+weights.y,0);' : 'let m=vec4f(weights.x+weights.y,(weights.x+weights.y)*params.heat,0,0);'}
  textureStore(destination,i,${obstacles ? 'select(m,vec4f(0),solid(i,n))' : 'm'});`,
    zero: 'textureStore(destination,i,vec4f(0));',
    zeroRgba: 'textureStore(destination,i,vec4f(0));',
    zeroMaterial: 'textureStore(destination,i,vec4f(0));',
    advectVelocity: /* wgsl */ `
  let dt=frame.delta;let px=vec2f(i)+vec2f(1.0,0.5);let py=vec2f(i)+vec2f(0.5,1.0);
  let qx=px-velocity_at(px)*dt*nf.y;let qy=py-velocity_at(py)*dt*nf.y;
  let v=vec2f(bilerp(vel,qx-vec2f(0.5,0)).x,bilerp(vel,qy-vec2f(0,0.5)).y)*exp(-params.drag*dt);
  textureStore(destination,i,vec4f(wall_velocity(v,i,n),0,0));`,
    copy: 'textureStore(destination,i,load_cell(src,i));',
    diffuse: /* wgsl */ `
  let alpha=params.viscosity*frame.delta;
  let rhs=load_cell(aux,i).xy;
  let neighbours=load_cell(src,i+vec2i(-1,0)).xy+load_cell(src,i+vec2i(1,0)).xy+load_cell(src,i+vec2i(0,-1)).xy+load_cell(src,i+vec2i(0,1)).xy;
  let v=(rhs+alpha*neighbours)/(1.0+4.0*alpha);
  textureStore(destination,i,vec4f(wall_velocity(v,i,n),0,0));`,
    curl: /* wgsl */ `
  // Center face velocities first, then differentiate. Curl is in domain units.
  let vr=velocity_at(cell+vec2f(1,0));let vl=velocity_at(cell-vec2f(1,0));
  let vb=velocity_at(cell+vec2f(0,1));let vt=velocity_at(cell-vec2f(0,1));
  let curl=((vr.y-vl.y)-(vb.x-vt.x))*0.5*nf.y;
  textureStore(destination,i,vec4f(curl,0,0,0));`,
    force: /* wgsl */ `
  let curl=load_cell(aux,i).x;
  let grad=vec2f(abs(load_cell(aux,i+vec2i(1,0)).x)-abs(load_cell(aux,i-vec2i(1,0)).x),abs(load_cell(aux,i+vec2i(0,1)).x)-abs(load_cell(aux,i-vec2i(0,1)).x));
  let normal=grad/max(length(grad),0.00001);
  var force=vec2f(normal.y,-normal.x)*curl*params.vorticity/nf.y;
  let srcPos=source_position()*vec2f(nf.x/nf.y,1.0);
  let emitter=gaussian(p,srcPos,params.radius);
  force+=${kind === 'smoke' ? 'vec2f(0,-1)' : 'vec2f(-sin(frame.time*0.7),cos(frame.time*0.9))'}*emitter*params.source*params.force;
  let pointer=pointer_weight(p,nf);
  force+=clamp(frame.velocity*vec2f(nf.x/nf.y,1),vec2f(-2),vec2f(2))*pointer*params.force*12.0;
  ${kind === 'smoke' ? 'let m=load_cell(material,i);force.y+=params.weight*m.x-params.buoyancy*m.y;' : ''}
  let v=face_velocity(i)+force*frame.delta;
  textureStore(destination,i,vec4f(wall_velocity(clamp(v,vec2f(-2),vec2f(2)),i,n),0,0));`,
    divergence: /* wgsl */ `
  ${obstacles ? 'if(solid(i,n)) {textureStore(destination,i,vec4f(0));return;}' : ''}
  let v=face_velocity(i);let l=face_velocity(i-vec2i(1,0));let t=face_velocity(i-vec2i(0,1));
  textureStore(destination,i,vec4f(v.x-l.x+v.y-t.y,0,0,0));`,
    pressure: /* wgsl */ `
  ${obstacles ? 'if(solid(i,n)) {textureStore(destination,i,vec4f(0));return;}' : ''}
  var sum=0.0;var count=0.0;
  let offsets=array<vec2i,4>(vec2i(-1,0),vec2i(1,0),vec2i(0,-1),vec2i(0,1));
  for(var j=0u;j<4u;j++) {
    let q=i+offsets[j];
    if((params.boundary==1u || (all(q>=vec2i(0)) && all(q<n))) ${obstacles ? '&& !solid(q,n)' : ''}) {sum+=load_cell(src,q).x;count+=1.0;}
  }
  // Neumann walls omit absent neighbours. Pressure is defined up to an additive constant.
  let pNew=(sum-load_cell(aux,i).x)/max(count,1.0);
  textureStore(destination,i,vec4f(pNew,0,0,0));`,
    project: /* wgsl */ `
  let p0=load_cell(aux,i).x;
  let grad=vec2f(load_cell(aux,i+vec2i(1,0)).x-p0,load_cell(aux,i+vec2i(0,1)).x-p0);
  textureStore(destination,i,vec4f(wall_velocity(face_velocity(i)-grad,i,n),0,0));`,
    advectMaterial: /* wgsl */ `
  ${obstacles ? 'if(solid(i,n)) {textureStore(destination,i,vec4f(0));return;}' : ''}
  ${
    kind === 'ink'
      ? `// Capillary transport is material movement through porous paper, separate from the projected fluid.
  let fibers=0.72+0.22*sin(uv.x*61.0+sin(uv.y*17.0)*1.4)+0.12*sin(uv.x*137.0+uv.y*9.0);
  let wick=vec2f(sin(uv.y*23.0+uv.x*31.0)*0.04, fibers)*params.paperFlow;
  let back=cell-(velocity_at(cell)+wick)*frame.delta*nf.y;`
      : 'let back=cell-velocity_at(cell)*frame.delta*nf.y;'
  }
  let q=${obstacles ? 'obstacle_backtrace(cell,back,nf)' : 'back'};
  var m=bilerp(src,q);let fade=exp(-params.dissipation*frame.delta);
  ${kind === 'ink' ? '// Paper transport has clean incoming water at the top, rather than repeating the clamped edge pigment.\n  if(params.paperFlow>0.0 && q.y<0.5) {m=vec4f(0);}' : ''}
  ${kind === 'fluid' ? 'm*=fade;' : kind === 'ink' ? 'm=vec4f(m.xy*fade,m.z*exp(-params.evaporation*frame.delta),0);' : 'm=vec4f(m.x*fade,m.y*exp(-params.cooling*frame.delta),0,0);'}
  var emitter=gaussian(p,source_position()*vec2f(nf.x/nf.y,1),params.radius);
  ${
    kind === 'ink'
      ? `if(params.feed==1u) {
    let edge=0.024+0.008*sin(uv.x*27.0)+0.004*sin(uv.x*71.0);
    let band=exp(-pow((uv.y-edge)/0.021,2.0)*0.5);
    let sides=smoothstep(0.025,0.12,uv.x)*(1.0-smoothstep(0.88,0.975,uv.x));
    let variation=0.76+0.16*sin(uv.x*43.0)+0.08*sin(uv.x*107.0);
    let envelope=select(1.0,1.0-smoothstep(params.feedDuration-1.0,params.feedDuration,frame.time),params.feedDuration>0.0);
    emitter=band*sides*variation*envelope;
  }`
      : ''
  }
  let pointer=pointer_weight(p,nf)*max(frame.pressure,0.5);
  let amount=(emitter*params.source+pointer*2.0)*frame.delta*3.0;
  let colorMix=0.5+0.5*sin(frame.time*0.63);
  ${kind === 'fluid' ? 'm+=vec4f(mix(params.dyeA.rgb,params.dyeB.rgb,colorMix)*amount,0);' : kind === 'ink' ? 'm+=vec4f(amount*(1.0-colorMix),amount*colorMix,amount*1.4,0);' : 'm+=vec4f(amount,amount*params.heat,0,0);'}
  textureStore(destination,i,clamp(m,vec4f(0),vec4f(32)));`,
    deposit: /* wgsl */ `
  ${kind === 'ink' ? 'let m=load_cell(material,i);let old=load_cell(src,i);textureStore(destination,i,vec4f(min(old.xy+pigment_transfer(m,i),vec2f(128)),0,0));' : 'textureStore(destination,i,vec4f(0));'}`,
    absorb: /* wgsl */ `
  ${kind === 'ink' ? 'let m=load_cell(src,i);textureStore(destination,i,vec4f(max(m.xy-pigment_transfer(m,i),vec2f(0)),m.z,0));' : 'textureStore(destination,i,load_cell(src,i));'}`,
    shadow: /* wgsl */ `
  ${
    kind === 'smoke'
      ? `let direction=params.lightDirection/max(length(params.lightDirection),0.0001);
  let ray=select(vec2f(0,-1),direction,length(params.lightDirection)>0.0001);
  let steps=max(params.shadowSteps,2u);let stride=nf.y*0.45/f32(steps);var optical=0.0;
  for(var j=0u;j<steps;j++) {
    let q=cell+ray*stride*(f32(j)+0.5);
    if(all(q>=vec2f(0)) && all(q<nf)) { optical+=bilerp(material,q).x*0.45/f32(steps); }
  }
  textureStore(destination,i,vec4f(exp(-optical*params.extinction),0,0,0));`
      : 'textureStore(destination,i,vec4f(1,0,0,0));'
  }`,
  };
  if (!(name in bodies)) throw new Error(`Unknown solver pass ${name}`);
  return solverCommon(kind, obstacles) + '\n' + output + '\n' + start + bodies[name] + end;
}
export function displayShader(kind: FluidKind) {
  return /* wgsl */ `
@group(1) @binding(0) var dye: texture_2d<f32>;
@group(1) @binding(1) var flow: texture_2d<f32>;
@group(1) @binding(2) var pressure: texture_2d<f32>;
@group(1) @binding(3) var divergence: texture_2d<f32>;
@group(1) @binding(4) var curl: texture_2d<f32>;
@group(1) @binding(5) var extra: texture_2d<f32>;
${kind === 'ink' ? '@group(2) @binding(0) var resistance: texture_2d<f32>;' : ''}
@fragment fn fragment(in:VertexOut) -> @location(0) vec4f {
  let m=sample_bilinear(dye,in.uv);var rgb=params.background.rgb;
  ${
    kind === 'fluid'
      ? 'rgb=mix(rgb,vec3f(1)-exp(-max(m.rgb,vec3f(0))*1.8),clamp(length(m.rgb)*1.8,0,1));'
      : kind === 'ink'
        ? `let deposit=sample_bilinear(extra,in.uv).xy;
  let a=-log(max(params.dyeA.rgb,vec3f(0.03)));let b=-log(max(params.dyeB.rgb,vec3f(0.03)));
  // A wax coating rejects the visible wet wash as well as irreversible absorption.
  let wax=clamp(sample_bilinear(resistance,in.uv).r,0.0,1.0);
  let pigments=max(m.xy+deposit,vec2f(0))*(1.0-wax);
  let cell=vec2u(in.uv*vec2f(textureDimensions(dye)));
  let grain=f32(hash_u32((cell.x*1664525u) ^ hash_u32(cell.y*1013904223u+frame.seed)))/4294967295.0;
  rgb*=exp(-(a*pigments.x+b*pigments.y)*params.opticalDensity)*(1.0-params.grain*0.035*grain);`
        : `let transmittance=sample_bilinear(extra,in.uv).x;
  let opacity=1.0-exp(-max(m.x,0.0)*params.extinction);
  let warm=clamp(m.y*0.15,0,1);
  let scattering=mix(params.dyeA.rgb,params.dyeB.rgb,warm)*(0.2+0.8*transmittance);
  rgb=mix(rgb,scattering,opacity);`
  }
  if(params.view==1u) {let v=sample_bilinear(flow,in.uv).xy;rgb=vec3f(v*2.0+0.5,0.5);}
  if(params.view==2u) {let x=sample_bilinear(pressure,in.uv).x;rgb=vec3f(0.5+x*3.0,0.5-abs(x)*3.0,0.5-x*3.0);}
  if(params.view==3u) {let x=sample_bilinear(divergence,in.uv).x;rgb=vec3f(0.5+x*30.0,0.5-abs(x)*30.0,0.5-x*30.0);}
  if(params.view==4u) {let x=sample_bilinear(curl,in.uv).x;rgb=vec3f(0.5+x*0.1,0.5-abs(x)*0.1,0.5-x*0.1);}
  return vec4f(clamp(rgb,vec3f(0),vec3f(1)),1);
}`;
}
