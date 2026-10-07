import { filterEffect, createFilterPass, filterGroup } from '@mk7s/hologpu-core';
import { f, u, e, straight } from '../_filters/common.ts';
const glyphs = ' .,:;irsXA253hMHGS#9B&@';
function glyphAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 20;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.font = 'bold 18px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'white';
  const glyphData = [...glyphs]
    .map((char) => {
      ctx.clearRect(0, 0, 16, 20);
      ctx.fillText(char, 8, 10);
      const rgba = ctx.getImageData(0, 0, 16, 20).data;
      const coverage = Uint8Array.from({ length: 320 }, (_, i) => rgba[i * 4 + 3]!);
      return { coverage, density: coverage.reduce((a, b) => a + b, 0) };
    })
    .sort((a, b) => a.density - b.density);
  const data = new Uint8Array(glyphs.length * 320);
  glyphData.forEach((glyph, index) => {
    for (let y = 0; y < 20; y++)
      for (let x = 0; x < 16; x++)
        data[y * 16 * glyphs.length + index * 16 + x] = glyph.coverage[y * 16 + x]!;
  });
  return data;
}
const code =
  straight +
  `
@group(0) @binding(3) var glyphTexture:texture_2d<f32>;
fn effect(uv:vec2f)->vec4f {var pixel=uv*frame.resolution;let co=cos(params.angle);let si=sin(params.angle);if(params.mode==0u){pixel=vec2f(co*pixel.x-si*pixel.y,si*pixel.x+co*pixel.y);}let cell=f32(params.cell);var centre=(floor(pixel/cell)+.5)*cell;if(params.mode==0u){centre=vec2f(co*centre.x+si*centre.y,-si*centre.x+co*centre.y);}centre/=frame.resolution;let source=sample_image(centre);let l=clamp(luminance(straight(source))*params.contrast,0.0,1.0);var coverage=0.0;if(params.mode==0u){let q=fract(pixel/cell)-.5;let c=cos(params.angle);let s=sin(params.angle);let rotated=vec2f(c*q.x-s*q.y,s*q.x+c*q.y);let radius=sqrt(l)*.5;let distance=length(rotated);if(l>0.0){coverage=1.0-smoothstep(radius-1.0/cell,radius+1.0/cell,distance);}}else{let index=floor(l*${glyphs.length - 1}.0);let local=fract(pixel/cell);let pos=vec2f((index+local.x)/${glyphs.length}.0,local.y);coverage=sample_bilinear(glyphTexture,pos).r;}let ink=select(params.ink.rgb,straight(source),params.coloured!=0u);return premul(mix(params.paper.rgb,ink,coverage),source.a);}`;
export default filterEffect({
  id: 'halftone-ascii',
  title: 'Halftone dots and glyph atlas',
  core: true,
  tags: ['filter', 'halftone', 'ascii', 'atlas'],
  params: {
    mode: e(
      'ascii',
      ['halftone', 'ascii'],
      'Area-coded dots or density-sorted raster glyph atlas.',
    ),
    cell: u(10, 4, 32, 'Output cell width and height in pixels.', 'Grid'),
    contrast: f(1, 0.2, 3, 'Luminance-to-density gain.', 'Grid'),
    angle: f(0.5, -3.14, 3.14, 'Halftone sampling screen rotation in radians.', 'Grid'),
    coloured: {
      type: 'bool',
      default: true,
      description: 'Use source colour for ink.',
      group: 'Palette',
    },
    ink: {
      type: 'color',
      default: '#f1cc92',
      description: 'Monochrome ink colour.',
      group: 'Palette',
    },
    paper: {
      type: 'color',
      default: '#101b29',
      description: 'Paper/background colour.',
      group: 'Palette',
    },
  },
  presets: {
    newsprint: { mode: 'halftone', cell: 8, coloured: false, ink: '#181a20', paper: '#ead9bd' },
    terminal: { mode: 'ascii', cell: 12, coloured: true },
  },
  async setup({ ctx, input }) {
    const width = glyphs.length * 16;
    const texture = ctx.device.createTexture({
      label: 'density-sorted-ascii-glyphs',
      size: [width, 20],
      format: 'r8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    });
    ctx.device.queue.writeTexture(
      { texture },
      glyphAtlas(),
      { bytesPerRow: width },
      { width, height: 20 },
    );
    try {
      const pass = await createFilterPass(ctx, code, 'halftone-ascii', [
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float' },
        },
      ]);
      return {
        resize() {},
        update() {},
        reset() {},
        render(_f, encoder, target) {
          pass.draw(encoder, target, [
            filterGroup(ctx, pass, input(), [{ binding: 3, resource: texture.createView() }]),
          ]);
        },
        dispose() {
          pass.dispose();
          texture.destroy();
        },
        sources: { fragment: pass.source },
        diagnostics: pass.diagnostics,
        textureTaps() {
          return {
            glyphAtlas: { texture, width, height: 20, format: 'r8unorm', kind: 'float' as const },
          };
        },
        memory() {
          return { textureBytes: width * 20, bufferBytes: 0 };
        },
      };
    } catch (error) {
      texture.destroy();
      throw error;
    }
  },
});
