import { gridEffect, gridParam, stepsParam } from '../_feedback/grid.ts';
export default gridEffect(
  {
    id: 'reaction-diffusion',
    title: 'Gray–Scott reaction diffusion',
    family: 'feedback',
    core: true,
    tags: ['gray-scott', 'chemistry', 'parameter-map'],
    inputs: ['pointer'],
    params: {
      grid: { ...gridParam, default: 512 },
      steps: { ...stepsParam, default: 4 },
      feed: {
        type: 'f32',
        default: 0.0545,
        min: 0,
        max: 0.1,
        step: 0.0005,
        group: 'Chemistry',
        description: 'Rate of replenishing reagent A.',
      },
      kill: {
        type: 'f32',
        default: 0.062,
        min: 0,
        max: 0.1,
        step: 0.0005,
        group: 'Chemistry',
        description: 'Additional removal rate of reagent B.',
      },
      map: {
        type: 'bool',
        default: false,
        group: 'Chemistry',
        description: 'Sweep feed horizontally and kill vertically across the domain.',
      },
      dt: {
        type: 'f32',
        default: 1,
        min: 0.1,
        max: 1,
        step: 0.05,
        group: 'Simulation',
        description: 'Explicit integration interval; bounded for the weighted diffusion stencil.',
      },
      tint: {
        type: 'color',
        default: '#f59e71',
        group: 'Palette',
        description: 'High B concentration color.',
      },
      background: {
        type: 'color',
        default: '#102e47',
        group: 'Palette',
        description: 'Low B concentration color.',
      },
    },
    presets: {
      coral: { feed: 0.0545, kill: 0.062, map: false },
      mitosis: { feed: 0.0367, kill: 0.0649, map: false },
    },
    quality: { resolutionScale: [0.25, 1] },
    reducedMotion: { time: 0 },
    fallback: 'radial-gradient(circle,#f59e71,#102e47)',
  },
  {
    initialize: /* wgsl */ `
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){let n=textureDimensions(next);if(any(id.xy>=n)){return;}let p=vec2i(id.xy);let uv=(vec2f(p)+0.5)/vec2f(n);var b=0.0;for(var i=0u;i<12u;i++){let center=vec2f(random(hash_u32(i+frame.seed*13u)),random(hash_u32(i+47u+frame.seed*29u)));if(distance(uv,center)<0.025){b=0.75;}}textureStore(next,p,vec4f(1.0-b,b,0,1));}`,
    step: /* wgsl */ `
fn at(p:vec2i)->vec2f{return textureLoad(state,wrap(p,vec2i(textureDimensions(state))),0).xy;}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){let n=textureDimensions(next);if(any(id.xy>=n)){return;}let p=vec2i(id.xy);var c=at(p);var lap=-c;lap+=0.2*(at(p+vec2i(1,0))+at(p+vec2i(-1,0))+at(p+vec2i(0,1))+at(p+vec2i(0,-1)));lap+=0.05*(at(p+vec2i(1,1))+at(p+vec2i(1,-1))+at(p+vec2i(-1,1))+at(p+vec2i(-1,-1)));let uv=(vec2f(p)+0.5)/vec2f(n);var f=params.feed;var k=params.kill;if(params.map!=0u){f=mix(0.01,0.08,uv.x);k=mix(0.045,0.075,uv.y);}let reaction=c.x*c.y*c.y;c+=params.dt*vec2f(lap.x-reaction+f*(1.0-c.x),0.5*lap.y+reaction-(f+k)*c.y);if(frame.buttons!=0u&&distance(uv,frame.pointer)<0.035){c=vec2f(0.25,0.75);}textureStore(next,p,vec4f(clamp(c,vec2f(0),vec2f(1)),0,1));}`,
    display: /* wgsl */ `
@fragment fn fragment(in:VertexOut)->@location(0)vec4f{let c=sample_bilinear(state,in.uv).xy;let v=smoothstep(0.015,0.48,c.y);return vec4f(mix(params.background.rgb,params.tint.rgb,v),1);}`,
  },
);
