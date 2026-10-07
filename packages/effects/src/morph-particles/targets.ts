export interface MorphInputs {
  text?: string;
  image?: CanvasImageSource;
}
/** Raster masks deliberately remain local M3 targets; the general input binding layer arrives in M4. */
export function rasterTargets(
  count: number,
  mode: string,
  word: string,
  input: MorphInputs,
): Float32Array {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, 512, 256);
  if (mode === 'image') {
    if (input.image) {
      ctx.drawImage(input.image, 0, 0, 512, 256);
    } else {
      const gradient = ctx.createRadialGradient(256, 128, 8, 256, 128, 140);
      gradient.addColorStop(0, 'white');
      gradient.addColorStop(0.65, '#cc76ed');
      gradient.addColorStop(1, 'black');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(256, 128, 190, 90, -0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'black';
      ctx.beginPath();
      ctx.ellipse(256, 128, 100, 44, -0.15, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 102px sans-serif';
    ctx.fillText(input.text ?? word, 256, 128, 460);
  }
  const data = ctx.getImageData(0, 0, 512, 256).data;
  const samples: { x: number; y: number; l: number }[] = [];
  for (let y = 0; y < 256; y += 2)
    for (let x = 0; x < 512; x += 2) {
      const i = (x + y * 512) * 4,
        l =
          (((data[i]! * 0.2126 + data[i + 1]! * 0.7152 + data[i + 2]! * 0.0722) / 255) *
            data[i + 3]!) /
          255;
      if (l > 0.08) samples.push({ x: x / 256 - 1, y: 1 - y / 128, l });
    }
  if (!samples.length) samples.push({ x: 0, y: 0, l: 0 });
  const result = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const s = samples[(Math.imul(i, 1664525) >>> 0) % samples.length]!;
    result.set([s.x * 0.9, s.y * 0.65, s.l, 1], i * 4);
  }
  return result;
}
