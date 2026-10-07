import { createFullscreenPass, compose, chunk, fullscreen, colour } from '@mk7s/hologpu';
import type { EffectField, FullscreenPass, ScheduledSurface, DeviceSession } from '@mk7s/hologpu';
type Source = { host: HTMLElement; field: EffectField; clip?: HTMLElement };

/** CSS overflow clips the padding box; its inner corner radii subtract the border widths. */
function geometry({ host, field, clip }: Source) {
  const source = field.canvas.getBoundingClientRect(),
    bounds = host.getBoundingClientRect(),
    style = getComputedStyle(host),
    sx = bounds.width / (host.offsetWidth || bounds.width || 1),
    sy = bounds.height / (host.offsetHeight || bounds.height || 1),
    border = [
      style.borderLeftWidth,
      style.borderTopWidth,
      style.borderRightWidth,
      style.borderBottomWidth,
    ].map((value, i) => (parseFloat(value) || 0) * (i % 2 ? sy : sx)),
    clipsX = style.overflowX !== 'visible',
    clipsY = style.overflowY !== 'visible';
  const inner = {
    left: clipsX ? bounds.left + border[0]! : source.left,
    top: clipsY ? bounds.top + border[1]! : source.top,
    right: clipsX ? bounds.right - border[2]! : source.right,
    bottom: clipsY ? bounds.bottom - border[3]! : source.bottom,
  };
  const radii = [
    style.borderTopLeftRadius,
    style.borderTopRightRadius,
    style.borderBottomRightRadius,
    style.borderBottomLeftRadius,
  ].map((value) => {
    const parts = value.trim().split(/\s+/),
      size = (part: string, length: number, scale: number) =>
        (parseFloat(part) || 0) * (part.endsWith('%') ? length / 100 : scale);
    return [size(parts[0]!, bounds.width, sx), size(parts[1] ?? parts[0]!, bounds.height, sy)];
  });
  const factor = Math.min(
    1,
    ...[
      bounds.width / Math.max(1, radii[0]![0]! + radii[1]![0]!),
      bounds.width / Math.max(1, radii[3]![0]! + radii[2]![0]!),
      bounds.height / Math.max(1, radii[0]![1]! + radii[3]![1]!),
      bounds.height / Math.max(1, radii[1]![1]! + radii[2]![1]!),
    ],
  );
  const rx = radii.map((r, i) =>
      clipsX && clipsY ? Math.max(0, r[0]! * factor - border[i === 0 || i === 3 ? 0 : 2]!) : 0,
    ),
    ry = radii.map((r, i) =>
      clipsX && clipsY ? Math.max(0, r[1]! * factor - border[i < 2 ? 1 : 3]!) : 0,
    );
  return { source, inner, rx, ry, ancestor: clip?.getBoundingClientRect() };
}
/** Research only: one fixed presentation surface; source fields own float-only targets. */
export class OverlayRenderer implements ScheduledSurface {
  visible = true;
  playing = false;
  polling = true;
  dirty = true;
  readonly canvas = document.createElement('canvas');
  readonly session: DeviceSession;
  readonly sources: readonly Source[];
  readonly context: GPUCanvasContext;
  #pass: FullscreenPass | null = null;
  #groups = new Map<
    EffectField,
    { texture: GPUTexture; group: GPUBindGroup; uniform: GPUBuffer }
  >();
  #remove = () => {};
  #removeState = () => {};
  #disposed = false;
  #lastGeometry = '';
  #removeSources: (() => void)[] = [];
  #epoch = 0;
  drawnRects: readonly { left: number; top: number; width: number; height: number }[] = [];
  private constructor(
    sources: readonly { host: HTMLElement; field: EffectField; clip?: HTMLElement }[],
  ) {
    if (!sources.length) throw new Error('Overlay needs a source field');
    this.sources = sources;
    this.session = sources[0]!.field.session;
    if (sources.some((s) => s.field.session !== this.session || s.field.surface?.context))
      throw new Error('Overlay sources must share a device and use present:false');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.dataset['overlay'] = 'research';
    this.canvas.style.cssText =
      'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2';
    const context = this.canvas.getContext('webgpu');
    if (!context) throw new Error('No overlay canvas context');
    this.context = context;
    document.body.append(this.canvas);
  }
  static async create(
    sources: readonly { host: HTMLElement; field: EffectField; clip?: HTMLElement }[],
  ) {
    const overlay = new OverlayRenderer(sources);
    try {
      await overlay.#restore();
      overlay.#removeState = overlay.session.onState(async (event) => {
        if (overlay.#disposed) return;
        if (event === 'lost') {
          overlay.#release();
          overlay.visible = false;
        } else if (event === 'ready') {
          await overlay.#restore();
          overlay.visible = true;
          overlay.session.scheduler.invalidate();
        } else {
          overlay.visible = false;
          overlay.canvas.hidden = true;
        }
      });
      overlay.#removeSources = sources.map(({ field }) =>
        field.onRendered(() => {
          overlay.dirty = true;
        }),
      );
      overlay.#remove = overlay.session.scheduler.add(overlay);
      return overlay;
    } catch (error) {
      overlay.destroy();
      throw error;
    }
  }
  async #restore() {
    const epoch = ++this.#epoch,
      generation = this.session.generation;
    this.#release();
    const pass = await createFullscreenPass(
      this.session,
      compose(
        fullscreen,
        colour,
        chunk(
          'overlay-resolve',
          `
@group(0) @binding(0) var image:texture_2d<f32>;
struct Geometry { source:vec4f, clip:vec4f, rx:vec4f, ry:vec4f }
@group(0) @binding(1) var<uniform> geometry:Geometry;
@fragment fn fragment(@builtin(position) p:vec4f)->@location(0) vec4f {
 let local=p.xy-geometry.clip.xy;let half=geometry.clip.zw*.5;
 let right=local.x>half.x;let bottom=local.y>half.y;
 let corner=select(select(0u,1u,right),select(3u,2u,right),bottom);
 let radius=vec2f(geometry.rx[corner],geometry.ry[corner]);
 var coverage=1.0;
 if(all(radius>vec2f(0))){
  let edge=select(local,geometry.clip.zw-local,vec2<bool>(right,bottom));
  if(all(edge<radius)){
   let distance=length((radius-edge)/radius)-1.0;
   let edgeWidth=.5/max(1.0,min(radius.x,radius.y));
   coverage=1.0-smoothstep(-edgeWidth,edgeWidth,distance);
  }
 }
 let uv=(p.xy-geometry.source.xy)/geometry.source.zw;let size=textureDimensions(image);
 let c=textureLoad(image,clamp(vec2i(uv*vec2f(size)),vec2i(0),vec2i(size)-1),0);
 let a=clamp(c.a,0.0,1.0);return vec4f(linear_to_srgb(max(c.rgb/max(a,.00001),vec3f(0)))*a,a)*coverage;
}`,
        ),
      ),
      this.session.capabilities.preferredFormat,
      'hgpu-overlay-resolve',
    );
    if (this.#disposed || epoch !== this.#epoch || generation !== this.session.generation) {
      pass.dispose();
      return;
    }
    this.#pass = pass;
    this.context.configure({
      device: this.session.device,
      format: this.session.capabilities.preferredFormat,
      alphaMode: 'premultiplied',
    });
  }
  dependencies() {
    return this.sources.filter((s) => s.field.visible).map((s) => s.field);
  }
  beforeFrame() {
    const geometrySignature = JSON.stringify([
      innerWidth,
      innerHeight,
      devicePixelRatio,
      this.sources.map((source) => {
        const g = geometry(source),
          r = g.source,
          c = g.ancestor;
        return [
          r.left,
          r.top,
          r.width,
          r.height,
          g.inner,
          g.rx,
          g.ry,
          c && [c.left, c.top, c.right, c.bottom],
          source.field.visible,
          source.field.state,
        ];
      }),
    ]);
    if (geometrySignature !== this.#lastGeometry) {
      this.#lastGeometry = geometrySignature;
      this.dirty = true;
    }
  }
  update() {}
  render() {
    if (this.#disposed || !this.#pass || this.session.state !== 'ready') return;
    const dpr = Math.min(devicePixelRatio, 2);
    const width = Math.max(1, Math.round(innerWidth * dpr)),
      height = Math.max(1, Math.round(innerHeight * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const encoder = this.session.encoder();
    const pass = encoder.beginRenderPass({
      label: 'hgpu-overlay',
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: [0, 0, 0, 0],
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(this.#pass.pipeline);
    const drawn: { left: number; top: number; width: number; height: number }[] = [];
    for (const source of this.sources) {
      const { field } = source,
        g = geometry(source),
        output = field.output,
        r = g.source;
      if (
        !output ||
        !field.visible ||
        r.width <= 0 ||
        r.height <= 0 ||
        r.right <= 0 ||
        r.left >= innerWidth ||
        r.bottom <= 0 ||
        r.top >= innerHeight
      )
        continue;
      let entry = this.#groups.get(field);
      if (!entry || entry.texture !== output.texture) {
        const uniform =
          entry?.uniform ??
          this.session.device.createBuffer({
            size: 64,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label: 'hgpu-overlay-rect',
          });
        entry = {
          texture: output.texture,
          uniform,
          group: this.session.device.createBindGroup({
            layout: this.#pass.pipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: output.texture.createView() },
              { binding: 1, resource: { buffer: uniform } },
            ],
          }),
        };
        this.#groups.set(field, entry);
      }
      this.session.device.queue.writeBuffer(
        entry.uniform,
        0,
        new Float32Array(
          [
            r.left,
            r.top,
            r.width,
            r.height,
            g.inner.left,
            g.inner.top,
            g.inner.right - g.inner.left,
            g.inner.bottom - g.inner.top,
            ...g.rx,
            ...g.ry,
          ].map((value) => value * dpr),
        ),
      );
      const c = g.ancestor;
      const x = Math.max(
          0,
          Math.ceil(g.inner.left * dpr),
          Math.floor(r.left * dpr),
          c ? Math.ceil(c.left * dpr) : 0,
        ),
        y = Math.max(
          0,
          Math.ceil(g.inner.top * dpr),
          Math.floor(r.top * dpr),
          c ? Math.ceil(c.top * dpr) : 0,
        ),
        right = Math.min(
          width,
          Math.floor(g.inner.right * dpr),
          Math.ceil(r.right * dpr),
          c ? Math.floor(c.right * dpr) : width,
        ),
        bottom = Math.min(
          height,
          Math.floor(g.inner.bottom * dpr),
          Math.ceil(r.bottom * dpr),
          c ? Math.floor(c.bottom * dpr) : height,
        );
      if (right <= x || bottom <= y) continue;
      pass.setViewport(x, y, right - x, bottom - y, 0, 1);
      pass.setScissorRect(x, y, right - x, bottom - y);
      pass.setBindGroup(0, entry.group);
      pass.draw(3);
      drawn.push({ left: r.left, top: r.top, width: r.width, height: r.height });
    }
    pass.end();
    this.drawnRects = drawn;
  }
  get memory() {
    return {
      sourceFloatBytes: this.sources.reduce((n, s) => n + s.field.memory().textureBytes, 0),
      rectBufferBytes: this.#groups.size * 64,
      presentationPixels: this.canvas.width * this.canvas.height,
      contexts: 1,
    };
  }
  #release() {
    this.#pass?.dispose();
    this.#pass = null;
    for (const entry of this.#groups.values()) entry.uniform.destroy();
    this.#groups.clear();
  }
  destroy() {
    if (this.#disposed) return;
    // Flush draws that still reference the overlay's uniforms or presentation texture.
    if (this.session.state === 'ready') this.session.submit();
    this.#disposed = true;
    this.#epoch++;
    this.#remove();
    this.#removeState();
    for (const remove of this.#removeSources) remove();
    this.#removeSources = [];
    this.#release();
    this.context.unconfigure();
    this.canvas.remove();
  }
}
