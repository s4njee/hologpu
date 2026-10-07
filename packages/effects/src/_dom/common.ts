import type { ParamSpec, TextureTap } from '@mk7s/hologpu-core';
export { f, u, e } from '../_filters/common.ts';
export const progress = {
  type: 'f32',
  default: 0,
  min: 0,
  max: 1,
  step: 0.01,
  css: true,
  description: 'Normalized progress; may be driven by a registered CSS custom property.',
  group: 'DOM',
} as const satisfies ParamSpec;
export const color = (value: string, description: string) =>
  ({ type: 'color' as const, default: value, description, group: 'Palette' }) satisfies ParamSpec;
export const roundedRect = `fn rounded_rect(p:vec2f,b:vec2f,r:f32)->f32 {let q=abs(p)-b+vec2f(r);return length(max(q,vec2f(0)))+min(max(q.x,q.y),0.0)-r;}`;
/** One rasterization on mount. The shader consumes coverage directly; no per-frame readback. */
export function textMask(device: GPUDevice): TextureTap {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.font = 'bold 150px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'white';
  ctx.fillText('GPU', 256, 136);
  const rgba = ctx.getImageData(0, 0, 512, 256).data;
  const data = Uint8Array.from({ length: 512 * 256 }, (_, i) => rgba[i * 4 + 3]!);
  const texture = device.createTexture({
    label: 'dom-default-text-mask',
    size: [512, 256],
    format: 'r8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
  });
  device.queue.writeTexture({ texture }, data, { bytesPerRow: 512 }, [512, 256]);
  return {
    texture,
    width: 512,
    height: 256,
    format: 'r8unorm',
    kind: 'float',
    label: 'default-text-mask',
  };
}
/** Reference audio consists of two real sine waves and their one-time discrete Fourier transform. */
export function audioFixture(device: GPUDevice): TextureTap {
  const width = 256,
    wave = Float32Array.from(
      { length: width },
      (_, i) =>
        0.6 * Math.sin((2 * Math.PI * 8 * i) / width) +
        0.25 * Math.sin((2 * Math.PI * 23 * i) / width),
    );
  const data = new Float32Array(width * 2 * 4);
  for (let k = 0; k < width; k++) {
    let real = 0,
      imag = 0;
    for (let i = 0; i < width; i++) {
      real += wave[i]! * Math.cos((2 * Math.PI * k * i) / width);
      imag -= wave[i]! * Math.sin((2 * Math.PI * k * i) / width);
    }
    data[k * 4] = k < width / 2 ? (2 * Math.hypot(real, imag)) / width : 0;
    data[k * 4 + 3] = 1;
    data[(width + k) * 4] = wave[k]!;
    data[(width + k) * 4 + 3] = 1;
  }
  const texture = device.createTexture({
    label: 'dom-reference-audio',
    size: [width, 2],
    format: 'rgba32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
  });
  device.queue.writeTexture({ texture }, data, { bytesPerRow: width * 16 }, [width, 2]);
  return {
    texture,
    width,
    height: 2,
    format: 'rgba32float',
    kind: 'float',
    label: 'default-audio',
  };
}
