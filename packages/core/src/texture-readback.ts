import type { TextureTap } from './effect.ts';
export interface TextureReadback {
  width: number;
  height: number;
  channels: number;
  values: Float32Array | Uint32Array;
}
export function halfToFloat(bits: number) {
  const sign = bits & 0x8000 ? -1 : 1,
    exponent = (bits >>> 10) & 31,
    fraction = bits & 1023;
  return exponent === 31
    ? fraction
      ? NaN
      : sign * Infinity
    : exponent === 0
      ? (sign * 2 ** -14 * fraction) / 1024
      : sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}
/** Raw intermediate values, without SDR resolve or colour transforms. */
export async function readTextureTap(device: GPUDevice, tap: TextureTap): Promise<TextureReadback> {
  const formats: Partial<Record<GPUTextureFormat, readonly [number, number, string]>> = {
    r32float: [1, 4, 'float'],
    rg32float: [2, 4, 'float'],
    rgba32float: [4, 4, 'float'],
    rgba16float: [4, 2, 'half'],
    rg16float: [2, 2, 'half'],
    r16float: [1, 2, 'half'],
    r32uint: [1, 4, 'uint'],
    rgba32uint: [4, 4, 'uint'],
  };
  const spec = formats[tap.format];
  if (!spec) throw new Error(`Unsupported tap format: ${tap.format}`);
  const [channels, componentBytes, kind] = spec,
    rowBytes = tap.width * channels * componentBytes,
    bytesPerRow = Math.ceil(rowBytes / 256) * 256;
  const buffer = device.createBuffer({
    size: bytesPerRow * tap.height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    label: 'hgpu-tap-readback',
  });
  try {
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: tap.texture }, { buffer, bytesPerRow }, [
      tap.width,
      tap.height,
    ]);
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const view = new DataView(buffer.getMappedRange()),
      values =
        kind === 'uint'
          ? new Uint32Array(tap.width * tap.height * channels)
          : new Float32Array(tap.width * tap.height * channels);
    for (let y = 0; y < tap.height; y++)
      for (let x = 0; x < tap.width * channels; x++) {
        const offset = y * bytesPerRow + x * componentBytes;
        values[y * tap.width * channels + x] =
          kind === 'half'
            ? halfToFloat(view.getUint16(offset, true))
            : kind === 'uint'
              ? view.getUint32(offset, true)
              : view.getFloat32(offset, true);
      }
    return { width: tap.width, height: tap.height, channels, values };
  } finally {
    buffer.destroy();
  }
}
