import { chunk } from './composer.ts';
export const colour = chunk(
  'colour',
  /* wgsl */ `
fn srgb_to_linear(c: vec3f) -> vec3f { return select(c/12.92,pow(max((c+0.055)/1.055,vec3f(0)),vec3f(2.4)),c>vec3f(0.04045)); }
fn linear_to_srgb(c: vec3f) -> vec3f { return select(12.92*c,1.055*pow(max(c,vec3f(0)),vec3f(1.0/2.4))-0.055,c>vec3f(0.0031308)); }
fn linear_to_oklab(c: vec3f) -> vec3f {
  let lms=vec3f(dot(c,vec3f(0.4122214708,0.5363325363,0.0514459929)),dot(c,vec3f(0.2119034982,0.6806995451,0.1073969566)),dot(c,vec3f(0.0883024619,0.2817188376,0.6299787005)));
  let v=sign(lms)*pow(abs(lms),vec3f(1.0/3.0));
  return vec3f(dot(v,vec3f(0.2104542553,0.7936177850,-0.0040720468)),dot(v,vec3f(1.9779984951,-2.4285922050,0.4505937099)),dot(v,vec3f(0.0259040371,0.7827717662,-0.8086757660)));
}
fn oklab_to_linear(c: vec3f) -> vec3f {
  let v=vec3f(c.x+0.3963377774*c.y+0.2158037573*c.z,c.x-0.1055613458*c.y-0.0638541728*c.z,c.x-0.0894841775*c.y-1.2914855480*c.z);
  let lms=v*v*v;
  return vec3f(dot(lms,vec3f(4.0767416621,-3.3077115913,0.2309699292)),dot(lms,vec3f(-1.2684380046,2.6097574011,-0.3413193965)),dot(lms,vec3f(-0.0041960863,-0.7034186147,1.7076147010)));
}
fn oklab_to_oklch(c: vec3f) -> vec3f { return vec3f(c.x,length(c.yz),atan2(c.z,c.y)); }
fn oklch_to_oklab(c: vec3f) -> vec3f { return vec3f(c.x,c.y*cos(c.z),c.y*sin(c.z)); }
fn tone_map(c: vec3f) -> vec3f { return c/(vec3f(1)+max(c,vec3f(0))); }
`,
  [],
);
