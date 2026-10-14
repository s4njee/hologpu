import type { DeviceSession } from './device.ts';
import type { ComposedWGSL } from './wgsl/composer.ts';
import { compileShader } from './debug.ts';
import { textureTexelBytes } from './feedback.ts';
import { chunk } from './wgsl/composer.ts';

export type Vec3 = readonly [number, number, number];
export type Mat4 = Float32Array;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(...v);
  if (!Number.isFinite(length) || length < 1e-8) throw new RangeError('Degenerate camera basis');
  return v.map((n) => n / length) as unknown as Vec3;
}
/** Column-major right-handed perspective, WebGPU depth range [0, 1]. */
export function perspective(fov: number, aspect: number, near = 0.1, far = 100): Mat4 {
  if (
    ![fov, aspect, near, far].every(Number.isFinite) ||
    fov <= 0 ||
    fov >= Math.PI ||
    aspect <= 0 ||
    near <= 0 ||
    far <= near
  )
    throw new RangeError('Invalid perspective frustum');
  const f = 1 / Math.tan(fov / 2),
    z = far / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, z, -1, 0, 0, z * near, 0]);
}
export function lookAt(eye: Vec3, target: Vec3, up: Vec3 = [0, 1, 0]): Mat4 {
  const z = normalize(sub(eye, target)),
    x = normalize(cross(up, z)),
    y = cross(z, x);
  return new Float32Array([
    x[0],
    y[0],
    z[0],
    0,
    x[1],
    y[1],
    z[1],
    0,
    x[2],
    y[2],
    z[2],
    0,
    -dot(x, eye),
    -dot(y, eye),
    -dot(z, eye),
    1,
  ]);
}
export function multiplyMat4(a: ArrayLike<number>, b: ArrayLike<number>): Mat4 {
  if (a.length !== 16 || b.length !== 16) throw new RangeError('Expected 4x4 matrices');
  const result = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) result[c * 4 + r]! += a[k * 4 + r]! * b[c * 4 + k]!;
  return result;
}
/** Minimal camera buffer: view-projection followed by world-space eye. Caller owns it. */
export function createCamera(device: GPUDevice) {
  const buffer = device.createBuffer({
    label: 'hgpu-camera',
    size: 80,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  return {
    buffer,
    update(eye: Vec3, target: Vec3, aspect: number, fov = Math.PI / 3, near = 0.1, far = 100) {
      const data = new Float32Array(20);
      data.set(multiplyMat4(perspective(fov, aspect, near, far), lookAt(eye, target)));
      data.set([...eye, 1], 16);
      device.queue.writeBuffer(buffer, 0, data);
    },
    dispose() {
      buffer.destroy();
    },
  };
}
export const cameraWGSL = chunk(
  'camera',
  `struct Camera { viewProjection:mat4x4f, eye:vec4f }; @group(1) @binding(0) var<uniform> camera:Camera;`,
);
export interface MeshData {
  vertices: Float32Array;
  indices: Uint32Array;
}
export const meshVertexLayout: GPUVertexBufferLayout = {
  arrayStride: 32,
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },
    { shaderLocation: 1, offset: 12, format: 'float32x3' },
    { shaderLocation: 2, offset: 24, format: 'float32x2' },
  ],
};
/** Indexed UV sphere with outward winding and unit normals. */
export function sphereMesh(segments = 48, rings = 24): MeshData {
  if (
    !Number.isInteger(segments) ||
    !Number.isInteger(rings) ||
    segments < 3 ||
    segments > 512 ||
    rings < 2 ||
    rings > 512
  )
    throw new RangeError('Invalid sphere tessellation');
  const vertices: number[] = [],
    indices: number[] = [];
  for (let y = 0; y <= rings; y++)
    for (let x = 0; x <= segments; x++) {
      const u = x / segments,
        v = y / rings,
        theta = u * Math.PI * 2,
        phi = v * Math.PI;
      const p = [Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)];
      vertices.push(...p, ...p, u, v);
    }
  for (let y = 0; y < rings; y++)
    for (let x = 0; x < segments; x++) {
      const a = y * (segments + 1) + x,
        b = a + segments + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}
export function planeMesh(segments = 128): MeshData {
  if (!Number.isInteger(segments) || segments < 1 || segments > 512)
    throw new RangeError('Invalid plane tessellation');
  const vertices: number[] = [],
    indices: number[] = [];
  for (let y = 0; y <= segments; y++)
    for (let x = 0; x <= segments; x++)
      vertices.push(
        (x / segments) * 2 - 1,
        0,
        (y / segments) * 2 - 1,
        0,
        1,
        0,
        x / segments,
        y / segments,
      );
  for (let y = 0; y < segments; y++)
    for (let x = 0; x < segments; x++) {
      const a = y * (segments + 1) + x,
        b = a + segments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}
export function cubeMesh(): MeshData {
  const vertices: number[] = [],
    indices: number[] = [];
  for (const normal of [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ] as Vec3[]) {
    const tangent = normalize(cross(Math.abs(normal[1]) > 0.5 ? [0, 0, 1] : [0, 1, 0], normal)),
      bitangent = cross(normal, tangent),
      base = vertices.length / 8;
    for (const [u, v] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ])
      vertices.push(
        ...normal.map((n, i) => n + tangent[i]! * u! + bitangent[i]! * v!),
        ...normal,
        (u! + 1) / 2,
        (v! + 1) / 2,
      );
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}
export function uploadMesh(device: GPUDevice, data: MeshData, label = 'hgpu-mesh') {
  const vertex = device.createBuffer({
    label: `${label}-vertices`,
    size: data.vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  let index: GPUBuffer;
  try {
    index = device.createBuffer({
      label: `${label}-indices`,
      size: data.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
  } catch (error) {
    vertex.destroy();
    throw error;
  }
  device.queue.writeBuffer(vertex, 0, data.vertices as Float32Array<ArrayBuffer>);
  device.queue.writeBuffer(index, 0, data.indices as Uint32Array<ArrayBuffer>);
  return {
    vertex,
    index,
    count: data.indices.length,
    bytes: vertex.size + index.size,
    dispose() {
      vertex.destroy();
      index.destroy();
    },
  };
}
/** Size-dependent depth and optional 4x colour resolve. No swap-chain ownership. */
export function createGeometryTargets(device: GPUDevice, format: GPUTextureFormat) {
  let depth: GPUTexture | undefined,
    color: GPUTexture | undefined,
    size: readonly [number, number] = [0, 0],
    samples: 1 | 4 = 1,
    disposed = false;
  return {
    resize(next: readonly [number, number], count: 1 | 4) {
      if (disposed) throw new Error('Geometry targets disposed');
      if (
        ![1, 4].includes(count) ||
        !next.every((n) => Number.isInteger(n) && n > 0 && n <= device.limits.maxTextureDimension2D)
      )
        throw new RangeError('Invalid geometry targets');
      if (next[0] === size[0] && next[1] === size[1] && samples === count) return;
      depth?.destroy();
      color?.destroy();
      color = undefined;
      size = [...next];
      samples = count;
      depth = device.createTexture({
        label: 'hgpu-geometry-depth',
        format: 'depth32float',
        size: [...size],
        sampleCount: samples,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      if (samples === 4)
        color = device.createTexture({
          label: 'hgpu-geometry-msaa',
          format,
          size: [...size],
          sampleCount: samples,
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
    },
    attachments(
      target: GPUTextureView,
      clear: GPUColor,
    ): Pick<GPURenderPassDescriptor, 'colorAttachments' | 'depthStencilAttachment'> {
      if (!depth) throw new Error('Geometry targets need resize');
      return {
        colorAttachments: [
          {
            view: color?.createView() ?? target,
            ...(color ? { resolveTarget: target } : {}),
            loadOp: 'clear',
            storeOp: color ? 'discard' : 'store',
            clearValue: clear,
          },
        ],
        depthStencilAttachment: {
          view: depth.createView(),
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'discard',
        },
      };
    },
    get samples() {
      return samples;
    },
    get bytes() {
      return disposed
        ? 0
        : size[0] * size[1] * samples * (4 + (color ? textureTexelBytes(format) : 0));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      depth?.destroy();
      color?.destroy();
    },
  };
}
/** Async T5 pipeline with diagnostics/source overrides and reference-counted shader ownership. */
export async function createMeshPipeline(
  session: DeviceSession,
  source: ComposedWGSL,
  options: {
    label: string;
    format: GPUTextureFormat;
    layouts: readonly GPUBindGroupLayout[];
    samples?: 1 | 4;
    depthWrite?: boolean;
    cullMode?: GPUCullMode;
  },
) {
  source = session.shaderSource?.(options.label, source) ?? source;
  const shader = await session.resources.acquireAsync(`shader:${source.code}`, () =>
    session.validate(() => compileShader(session.device, source, options.label)),
  );
  try {
    const pipeline = await session.validate(() =>
      session.device.createRenderPipelineAsync({
        label: options.label,
        layout: session.device.createPipelineLayout({ bindGroupLayouts: [...options.layouts] }),
        vertex: {
          module: shader.value.module,
          entryPoint: 'meshVertex',
          buffers: [meshVertexLayout],
        },
        fragment: {
          module: shader.value.module,
          entryPoint: 'meshFragment',
          targets: [{ format: options.format }],
        },
        primitive: { topology: 'triangle-list', cullMode: options.cullMode ?? 'back' },
        depthStencil: {
          format: 'depth32float',
          depthWriteEnabled: options.depthWrite ?? true,
          depthCompare: 'less',
        },
        multisample: { count: options.samples ?? 1 },
      }),
    );
    return {
      pipeline,
      source,
      diagnostics: shader.value.diagnostics,
      dispose() {
        shader.release();
      },
    };
  } catch (error) {
    shader.release();
    throw error;
  }
}
