import { gridEffect, gridParam, stepsParam } from '../_feedback/grid.ts';
export default gridEffect(
  {
    id: 'life',
    title: 'Life and life-like rules',
    family: 'feedback',
    core: true,
    tags: ['cellular-automata', 'integer', 'life'],
    inputs: ['pointer'],
    params: {
      grid: { ...gridParam, default: 256 },
      steps: stepsParam,
      rule: {
        type: 'enum',
        default: 'life',
        options: ['life', 'highlife', 'seeds', 'day-night', 'custom'],
        group: 'Rules',
        description:
          'Conway B3/S23, HighLife B36/S23, Seeds B2/S, Day & Night B3678/S34678, or custom masks.',
      },
      birthMask: {
        type: 'u32',
        default: 8,
        min: 0,
        max: 511,
        step: 1,
        group: 'Rules',
        description: 'Custom birth mask: bit n enables birth with n live neighbours.',
      },
      survivalMask: {
        type: 'u32',
        default: 12,
        min: 0,
        max: 511,
        step: 1,
        group: 'Rules',
        description: 'Custom survival mask: bit n enables survival with n live neighbours.',
      },
      density: {
        type: 'f32',
        default: 0.25,
        min: 0,
        max: 0.7,
        step: 0.01,
        group: 'Initialization',
        description: 'Seeded initial live-cell density; applied on the next reset.',
      },
      tint: {
        type: 'color',
        default: '#a4f5a1',
        group: 'Palette',
        description: 'Living cell color.',
      },
      background: {
        type: 'color',
        default: '#092021',
        group: 'Palette',
        description: 'Dead cell color.',
      },
    },
    presets: {
      replicators: { rule: 'highlife', density: 0.18, tint: '#efd88d' },
      night: { rule: 'day-night', density: 0.48, tint: '#a7adff' },
    },
    quality: { resolutionScale: [0.25, 1] },
    reducedMotion: { time: 0 },
    fallback: 'repeating-linear-gradient(45deg,#092021 0 8px,#a4f5a1 8px 9px)',
  },
  {
    integer: true,
    readWrite: true,
    initialize: /* wgsl */ `@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){if(any(id.xy>=textureDimensions(next))){return;}let p=vec2i(id.xy);textureStore(next,p,vec4u(select(0u,1u,cell_hash(p,frame.seed)<params.density),0u,0u,0u));}`,
    step: /* wgsl */ `fn alive(p:vec2i)->u32{return min(load_cell(wrap(p,vec2i(textureDimensions(state)))).x,1u);}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){let n=textureDimensions(next);if(any(id.xy>=n)){return;}let p=vec2i(id.xy);var neighbors=0u;for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){if(x!=0||y!=0){neighbors+=alive(p+vec2i(x,y));}}}var b=8u;var s=12u;if(params.rule==1u){b=72u;}else if(params.rule==2u){b=4u;s=0u;}else if(params.rule==3u){b=456u;s=472u;}else if(params.rule==4u){b=params.birthMask;s=params.survivalMask;}let mask=select(b,s,alive(p)!=0u);var v=(mask>>neighbors)&1u;let uv=(vec2f(p)+0.5)/vec2f(n);if(frame.buttons!=0u&&distance(uv,frame.pointer)<0.025){v=1u;}textureStore(next,p,vec4u(v,0u,0u,0u));}`,
    display: /* wgsl */ `@fragment fn fragment(in:VertexOut)->@location(0)vec4f{let n=vec2i(textureDimensions(state));let p=clamp(vec2i(in.uv*vec2f(n)),vec2i(0),n-1);let a=textureLoad(state,p,0).x;let line=smoothstep(0.0,0.09,min(fract(in.uv.x*f32(n.x)),fract(in.uv.y*f32(n.y))));return vec4f(mix(params.background.rgb,params.tint.rgb,f32(min(a,1u))*mix(0.7,1.0,line)),1);}`,
  },
);
