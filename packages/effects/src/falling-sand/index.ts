import { gridEffect, gridParam, stepsParam } from '../_feedback/grid.ts';
export default gridEffect(
  {
    id: 'falling-sand',
    title: 'Margolus sand, water and fire',
    family: 'feedback',
    core: true,
    tags: ['margolus', 'block-ca', 'integer'],
    inputs: ['pointer'],
    params: {
      grid: { ...gridParam, default: 256 },
      steps: { ...stepsParam, default: 2 },
      material: {
        type: 'enum',
        default: 'sand',
        options: ['sand', 'water', 'fire', 'wall', 'erase'],
        group: 'Interaction',
        description: 'Material drawn by a pressed pointer.',
      },
      brush: {
        type: 'f32',
        default: 0.04,
        min: 0.01,
        max: 0.15,
        step: 0.005,
        group: 'Interaction',
        description: 'Brush radius as a fraction of simulation extent.',
      },
      fireLife: {
        type: 'u32',
        default: 80,
        min: 8,
        max: 240,
        step: 8,
        group: 'Rules',
        description: 'Initial fire lifetime in block updates; fire rises and expires.',
      },
      waterFlow: {
        type: 'bool',
        default: true,
        group: 'Rules',
        description: 'Permit water to shuffle horizontally inside each alternating block.',
      },
      sand: { type: 'color', default: '#efcb8c', group: 'Palette', description: 'Sand color.' },
      water: { type: 'color', default: '#489ce2', group: 'Palette', description: 'Water color.' },
      background: {
        type: 'color',
        default: '#111b2c',
        group: 'Palette',
        description: 'Empty background.',
      },
    },
    presets: {
      reservoir: { material: 'water', waterFlow: true, steps: 4, water: '#73dedc' },
      embers: { material: 'fire', fireLife: 160, steps: 2, background: '#211220' },
    },
    quality: { resolutionScale: [0.25, 1] },
    reducedMotion: { time: 0 },
    fallback: 'linear-gradient(#111b2c 60%,#489ce2 60% 80%,#efcb8c 80%)',
  },
  {
    integer: true,
    alternate: true,
    initialize: /* wgsl */ `@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){let n=textureDimensions(next);if(any(id.xy>=n)){return;}let p=vec2i(id.xy);let uv=(vec2f(p)+0.5)/vec2f(n);var a=0u;if(uv.y>0.82){a=2u;}if(uv.y>0.08&&uv.y<0.35&&abs(uv.x-0.5)<0.18&&cell_hash(p,frame.seed)>0.2){a=1u;}if(uv.y>0.55&&uv.y<0.65&&abs(uv.x-0.2)<0.03){a=3u|(params.fireLife<<8u);}if(p.y==i32(n.y)-1||p.x==0||p.x==i32(n.x)-1){a=4u;}textureStore(next,p,vec4u(a,0u,0u,0u));}`,
    step: /* wgsl */ `fn kind(v:u32)->u32{return v&255u;}
fn heavy(a:u32,b:u32)->bool {let x=kind(a);let y=kind(b);return (x==1u&&(y==0u||y==2u||y==3u))||(x==2u&&(y==0u||y==3u));}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){let n=vec2i(textureDimensions(next));if(any(vec2i(id.xy)>=n)||any((id.xy&vec2u(1u))!=vec2u(0u))){return;}let base=vec2i(id.xy)+vec2i(i32(blockPhase));let a=wrap(base,n);let b=wrap(base+vec2i(1,0),n);let c=wrap(base+vec2i(0,1),n);let d=wrap(base+vec2i(1,1),n);var v=array<u32,4>(textureLoad(state,a,0).x,textureLoad(state,b,0).x,textureLoad(state,c,0).x,textureLoad(state,d,0).x);for(var i=0u;i<4u;i++){if(kind(v[i])==3u){let ttl=v[i]>>8u;v[i]=select(0u,3u|((ttl-1u)<<8u),ttl>1u);}}if(heavy(v[0],v[2])){let t=v[0];v[0]=v[2];v[2]=t;}if(heavy(v[1],v[3])){let t=v[1];v[1]=v[3];v[3]=t;}let choice=cell_hash(base,frame.seed+blockPhase*37u);if(choice<0.5){if(kind(v[0])==1u&&kind(v[3])==0u){let t=v[0];v[0]=v[3];v[3]=t;}}else {if(kind(v[1])==1u&&kind(v[2])==0u){let t=v[1];v[1]=v[2];v[2]=t;}}for(var column=0u;column<2u;column++){if(kind(v[column+2u])==3u&&kind(v[column])==0u){let t=v[column];v[column]=v[column+2u];v[column+2u]=t;}}if(params.waterFlow!=0u){for(var row=0u;row<2u;row++){let left=row*2u;let right=left+1u;if((kind(v[left])==2u&&kind(v[right])==0u)||(kind(v[right])==2u&&kind(v[left])==0u)){if(choice<0.5){let t=v[left];v[left]=v[right];v[right]=t;}}}}let cells=array<vec2i,4>(a,b,c,d);for(var i=0u;i<4u;i++){let uv=(vec2f(cells[i])+0.5)/vec2f(n);if(frame.buttons!=0u&&distance(uv,frame.pointer)<params.brush){v[i]=params.material+1u;if(params.material==2u){v[i]=3u|(params.fireLife<<8u);}if(params.material==4u){v[i]=0u;}}textureStore(next,cells[i],vec4u(v[i],0u,0u,0u));}}`,
    display: /* wgsl */ `@fragment fn fragment(in:VertexOut)->@location(0)vec4f{let n=vec2i(textureDimensions(state));let p=clamp(vec2i(in.uv*vec2f(n)),vec2i(0),n-1);let a=textureLoad(state,p,0).x;let material=a&255u;var c=params.background.rgb;if(material==1u){c=params.sand.rgb*(0.85+0.15*random(hash_u32(u32(p.x)+u32(p.y)*197u)));}else if(material==2u){c=params.water.rgb;}else if(material==3u){c=mix(vec3f(1,0.1,0.01),vec3f(1,0.8,0.2),f32(a>>8u)/f32(params.fireLife));}else if(material==4u){c=vec3f(0.2,0.25,0.3);}return vec4f(c,1);}`,
  },
);
