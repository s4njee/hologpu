import './vendor/holocss/motion.css';
import './vendor/holocss/properties.css';

type Point = readonly [number, number];
type Quad = readonly [Point, Point, Point, Point];
const billboards: { name: string; corners: Quad; duration: number }[] = [
  {
    name: 'Street portrait',
    corners: [
      [435, 332],
      [550, 414],
      [544, 570],
      [428, 507],
    ],
    duration: 12,
  },
  {
    name: 'Vertical neon',
    corners: [
      [568, 319],
      [663, 320],
      [661, 565],
      [566, 566],
    ],
    duration: 9,
  },
  {
    name: 'Skyline ticker',
    corners: [
      [789, 76],
      [814, 75],
      [814, 206],
      [789, 210],
    ],
    duration: 17,
  },
  {
    name: 'Distant tower',
    corners: [
      [1020, 90],
      [1073, 75],
      [1075, 174],
      [1023, 190],
    ],
    duration: 14,
  },
  {
    name: 'Shop marquee',
    corners: [
      [331, 533],
      [410, 556],
      [406, 581],
      [327, 557],
    ],
    duration: 11,
  },
  {
    name: 'Street kiosk',
    corners: [
      [286, 629],
      [339, 633],
      [339, 664],
      [285, 662],
    ],
    duration: 13,
  },
];

/** Unit-square homography. The same projection extracts and places each display. */
function projection([p0, p1, p2, p3]: Quad) {
  const dx1 = p1[0] - p2[0],
    dx2 = p3[0] - p2[0];
  const dy1 = p1[1] - p2[1],
    dy2 = p3[1] - p2[1];
  const dx3 = p0[0] - p1[0] + p2[0] - p3[0];
  const dy3 = p0[1] - p1[1] + p2[1] - p3[1];
  const determinant = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / determinant;
  const h = (dx1 * dy3 - dx3 * dy1) / determinant;
  return {
    a: p1[0] - p0[0] + g * p1[0],
    b: p3[0] - p0[0] + h * p3[0],
    c: p0[0],
    d: p1[1] - p0[1] + g * p1[1],
    e: p3[1] - p0[1] + h * p3[1],
    f: p0[1],
    g,
    h,
  };
}

/** Keep actual artwork from the photo, then scroll it inside its perspective frame. */
export function mountBillboards(scene: HTMLElement, photo: HTMLImageElement): () => void {
  const layer = document.createElement('div');
  layer.id = 'billboards';
  layer.className = 'billboard-layer hcss-stagger';
  // The requested sign animation is independent of the mouse-only LCD.
  layer.dataset['hcssMotion'] = 'none';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.setProperty('--hcss-stagger-step', '1700ms');
  const source = document.createElement('canvas');
  source.width = photo.naturalWidth;
  source.height = photo.naturalHeight;
  const sourceCtx = source.getContext('2d', { willReadFrequently: true })!;
  sourceCtx.drawImage(photo, 0, 0);
  const pixels = sourceCtx.getImageData(0, 0, source.width, source.height).data;
  const scaleX = source.width / 2048,
    scaleY = source.height / 1117;
  for (const [index, board] of billboards.entries()) {
    const p = projection(board.corners);
    const width = Math.round(
      Math.hypot(
        board.corners[1][0] - board.corners[0][0],
        board.corners[1][1] - board.corners[0][1],
      ),
    );
    const height = Math.round(
      Math.hypot(
        board.corners[3][0] - board.corners[0][0],
        board.corners[3][1] - board.corners[0][1],
      ),
    );
    const display = document.createElement('div');
    display.className = 'billboard';
    display.dataset['billboard'] = board.name;
    display.style.width = `${width}px`;
    display.style.height = `${height}px`;
    display.style.transform = `matrix3d(${p.a / width},${p.d / width},0,${p.g / width},${p.b / height},${p.e / height},0,${p.h / height},0,0,1,0,${p.c},${p.f},0,1)`;
    display.style.setProperty('--hcss-stagger-index', String(index));
    display.style.setProperty('--hcss-stagger-count', String(billboards.length));
    display.style.setProperty('--hcss-duration', `${board.duration}s`);
    const strip = document.createElement('div');
    strip.className = 'billboard-scroll';
    for (let copy = 0; copy < 2; copy++) {
      const tile = document.createElement('canvas');
      tile.width = width * 2;
      tile.height = height * 2;
      const ctx = tile.getContext('2d')!;
      const image = ctx.createImageData(tile.width, tile.height);
      for (let y = 0; y < tile.height; y++) {
        for (let x = 0; x < tile.width; x++) {
          const u = (x + 0.5) / tile.width,
            v = (y + 0.5) / tile.height;
          const w = p.g * u + p.h * v + 1;
          const sx = Math.min(
            source.width - 1,
            Math.max(0, Math.round(((p.a * u + p.b * v + p.c) / w) * scaleX)),
          );
          const sy = Math.min(
            source.height - 1,
            Math.max(0, Math.round(((p.d * u + p.e * v + p.f) / w) * scaleY)),
          );
          const from = (sy * source.width + sx) * 4;
          const to = (y * tile.width + x) * 4;
          image.data.set(pixels.subarray(from, from + 4), to);
        }
      }
      ctx.putImageData(image, 0, 0);
      strip.append(tile);
    }
    display.append(strip);
    layer.append(display);
  }
  scene.append(layer);
  const resize = () => {
    layer.style.transform = `scale(${scene.clientWidth / 2048}, ${scene.clientHeight / 1117})`;
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(scene);
  source.width = source.height = 0;
  return () => {
    observer.disconnect();
    layer.remove();
  };
}
