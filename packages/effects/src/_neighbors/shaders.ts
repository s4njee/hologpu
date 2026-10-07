export const declarations = /* wgsl */ `
@group(1) @binding(0) var<storage,read> agents:array<vec4f>;
@group(1) @binding(1) var<storage,read_write> next:array<vec4f>;
@group(1) @binding(2) var<storage,read> sorted:array<u32>;
@group(1) @binding(3) var<storage,read> offsets:array<u32>;
@group(1) @binding(4) var<storage,read_write> statistics:array<vec4f>;
@group(1) @binding(5) var<storage,read_write> aggregates:array<vec4f>;
fn grid_dimension()->u32{return u32(sqrt(f32(arrayLength(&aggregates))));}
fn periodic(d:vec2f)->vec2f{return d-round(d);}
fn cell(p:vec2f)->vec2i{return min(vec2i(p*f32(grid_dimension())),vec2i(i32(grid_dimension())-1));}
fn key(c:vec2i)->u32{return u32(c.x)+grid_dimension()*u32(c.y);}
`;
export const initialize = /* wgsl */ `
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){if(id.x>=arrayLength(&next)){return;}let h=hash_u32(id.x+frame.seed*65537u);let angle=random(h)*6.2831853;let r=.04+.4*sqrt(random(hash_u32(h+19u)));let p=vec2f(.5)+r*vec2f(cos(angle),sin(angle));let v=params.speed*vec2f(-sin(angle),cos(angle));next[id.x]=vec4f(p,v);}
`;
export const boids = /* wgsl */ `
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=arrayLength(&agents)){return;}let a=agents[i];let home=cell(a.xy);let extent=i32(ceil(params.radius*f32(grid_dimension())));var neighbors=0u;var separation=vec2f(0);var alignment=vec2f(0);var cohesion=vec2f(0);var candidates=0u;
for(var dy=-extent;dy<=extent;dy++){for(var dx=-extent;dx<=extent;dx++){let c=((home+vec2i(dx,dy))%i32(grid_dimension())+i32(grid_dimension()))%i32(grid_dimension());let k=key(c);for(var slot=offsets[k];slot<offsets[k+1u];slot++){let j=sorted[slot];if(j==i){continue;}candidates++;let b=agents[j];let d=periodic(b.xy-a.xy);let d2=dot(d,d);if(d2<params.radius*params.radius){neighbors++;cohesion+=d;alignment+=b.zw;separation-=d/max(d2,.0001);}}}}
var acceleration=vec2f(0);if(neighbors>0u){let count=f32(neighbors);acceleration=params.cohesion*cohesion/count+params.alignment*(alignment/count-a.zw)+params.separation*.01*separation/count;}if(frame.buttons>0u){acceleration+=params.pointer*periodic(frame.pointer-a.xy);}var v=a.zw+frame.delta*acceleration;let speed=length(v);if(speed>params.maxSpeed){v*=params.maxSpeed/speed;}next[i]=vec4f(fract(a.xy+frame.delta*v),v);statistics[i]=vec4f(f32(neighbors),f32(candidates),acceleration);}
`;
export const aggregate = /* wgsl */ `
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){let k=id.x;if(k>=grid_dimension()*grid_dimension()){return;}var sum=vec2f(0);let count=offsets[k+1u]-offsets[k];for(var slot=offsets[k];slot<offsets[k+1u];slot++){sum+=agents[sorted[slot]].xy;}aggregates[k]=vec4f(sum/max(1.,f32(count)),f32(count)/f32(arrayLength(&agents)),f32(count));}
`;
export const gravityFunctions = /* wgsl */ `
fn force(d:vec2f,mass:f32)->vec2f {let r2=dot(d,d)+params.softening*params.softening;return params.gravity*mass*d*inverseSqrt(r2)/r2;}
fn integrate(i:u32,acceleration:vec2f){let a=agents[i];var v=(a.zw+frame.delta*acceleration)*exp(-params.damping*frame.delta);var p=a.xy+frame.delta*v;for(var axis=0u;axis<2u;axis++){let folded=((p[axis]%2.)+2.)%2.;p[axis]=select(folded,2.-folded,folded>1.);v[axis]*=select(1.,-1.,folded>1.);}next[i]=vec4f(clamp(p,vec2f(0),vec2f(.99999994)),v);statistics[i]=vec4f(acceleration,length(v),1);}
`;
export const tiled = /* wgsl */ `
var<workgroup> tile:array<vec2f,64>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32){let n=arrayLength(&agents);let i=id.x;let a=agents[min(i,n-1u)];var acceleration=vec2f(0);let mass=1./f32(n);for(var base=0u;base<n;base+=64u){let j=base+lane;tile[lane]=agents[min(j,n-1u)].xy;workgroupBarrier();if(i<n){for(var k=0u;k<min(64u,n-base);k++){if(base+k!=i){acceleration+=force(tile[k]-a.xy,mass);}}}workgroupBarrier();}if(i<n){integrate(i,acceleration);}}
`;
export const gridGravity = /* wgsl */ `
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){let i=id.x;let n=arrayLength(&agents);if(i>=n){return;}let a=agents[i];let home=cell(a.xy);var acceleration=vec2f(0);for(var y=0;y<i32(grid_dimension());y++){for(var x=0;x<i32(grid_dimension());x++){let c=vec2i(x,y);let k=key(c);if(all(abs(c-home)<=vec2i(1))){for(var slot=offsets[k];slot<offsets[k+1u];slot++){let j=sorted[slot];if(j!=i){acceleration+=force(agents[j].xy-a.xy,1./f32(n));}}}else{let b=aggregates[k];if(b.z>0.){acceleration+=force(b.xy-a.xy,b.z);}}}}integrate(i,acceleration);}
`;
export const drawing = /* wgsl */ `
@group(1) @binding(0) var<storage,read> particles:array<vec4f>;
struct ParticleVertex { @builtin(position) position:vec4f,@location(0) local:vec2f,@location(1) speed:f32 };
@vertex fn particleVertex(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->ParticleVertex{let corners=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));let a=particles[instance];let local=corners[vertex];var out:ParticleVertex;out.position=vec4f((a.xy+local*params.size/frame.resolution)*vec2f(2,-2)+vec2f(-1,1),0,1);out.local=local;out.speed=min(1.,10000./f32(arrayLength(&particles)));return out;}
@fragment fn particleFragment(in:ParticleVertex)->@location(0)vec4f {let r=dot(in.local,in.local);if(r>1.){discard;}let glow=exp(-3.*r);return vec4f(params.tint.rgb*glow*in.speed,glow);}
`;
