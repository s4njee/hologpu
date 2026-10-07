import type { DeviceSession } from '../device.ts';
import { PrimitiveResources, validateCapacity, validateCount, validateInput } from './common.ts';
import { createPrefixSum } from './prefix-sum.ts';
import { createSort } from './sort.ts';
export interface SpatialHashOptions {
  dimensions: readonly [number, number, number];
  maxDimensions?: readonly [number, number, number];
  axes?: 'xy' | 'xyz';
}
const keyWGSL = `struct Args{n:u32,x:u32,y:u32,z:u32,xyz:u32};@group(0) @binding(0) var<storage,read> positions:array<vec4f>;@group(0) @binding(1) var<storage,read_write> keys:array<u32>;@group(0) @binding(2) var<storage,read_write> indices:array<u32>;@group(0) @binding(3) var<storage,read_write> counts:array<atomic<u32>>;@group(0) @binding(4) var<uniform> args:Args;@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=args.n){return;}let p=positions[i];let x=u32(clamp(p.x,0.0,0.99999994)*f32(args.x));let y=u32(clamp(p.y,0.0,0.99999994)*f32(args.y));let z=select(0u,u32(clamp(p.z,0.0,0.99999994)*f32(args.z)),args.xyz!=0u);let key=x+args.x*(y+args.y*z);keys[i]=key;indices[i]=i;atomicAdd(&counts[key],1u);}`;
const rangesWGSL = `struct Args{cells:u32,n:u32};@group(0) @binding(0) var<storage,read> prefix:array<u32>;@group(0) @binding(1) var<storage,read_write> ranges:array<u32>;@group(0) @binding(2) var<uniform> args:Args;@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id:vec3u){if(id.x<args.cells){ranges[id.x]=prefix[id.x];}if(id.x==args.cells){ranges[id.x]=args.n;}}`;
function gridSize(dimensions: readonly [number, number, number]) {
  if (dimensions.some((x) => !Number.isInteger(x) || x < 1))
    throw new RangeError('Grid dimensions must be positive integers');
  const cells = dimensions.reduce((a, b) => a * b, 1);
  validateCapacity(cells);
  return cells;
}
/** Uniform normalized-position grid: stable sorted indices plus contiguous exclusive cell ranges. */
export async function createSpatialHash(
  session: DeviceSession,
  capacity: number,
  options: SpatialHashOptions,
) {
  validateCapacity(capacity);
  const resources = new PrimitiveResources(session, 'spatial-hash');
  let dimensions = options.dimensions;
  const maxCells = gridSize(options.maxDimensions ?? dimensions);
  let cells = gridSize(dimensions);
  if (cells > maxCells) throw new RangeError('Initial grid exceeds maximum grid');
  let sort: Awaited<ReturnType<typeof createSort>> | undefined,
    scan: Awaited<ReturnType<typeof createPrefixSum>> | undefined;
  try {
    const assign = await resources.pass(keyWGSL, 'assign', [
      'read-only-storage',
      'storage',
      'storage',
      'storage',
      'uniform',
    ]);
    const ranges = await resources.pass(rangesWGSL, 'ranges', [
      'read-only-storage',
      'storage',
      'uniform',
    ]);
    sort = await createSort(session, capacity);
    scan = await createPrefixSum(session, maxCells);
    const keys = resources.buffer(capacity * 4, 'keys'),
      indices = resources.buffer(capacity * 4, 'indices'),
      cellCounts = resources.buffer(maxCells * 4, 'cell-counts'),
      cellOffsets = resources.buffer((maxCells + 1) * 4, 'cell-ranges');
    let sorted = sort.encode(session.device.createCommandEncoder(), keys, indices, 0);
    return {
      capacity,
      cellCounts,
      cellOffsets,
      get dimensions() {
        return dimensions;
      },
      get cellCount() {
        return cells;
      },
      get sortedKeys() {
        return sorted.keys;
      },
      get sortedIndices() {
        return sorted.values;
      },
      resize(next: readonly [number, number, number]) {
        const count = gridSize(next);
        if (count > maxCells) throw new RangeError('Grid exceeds configured maximum');
        dimensions = next;
        cells = count;
      },
      encode(encoder: GPUCommandEncoder, positions: GPUBuffer, count: number) {
        resources.assertAlive();
        validateCount(capacity, count);
        validateInput(positions, count, 16);
        encoder.clearBuffer(cellCounts);
        resources.dispatch(
          assign,
          encoder,
          [
            positions,
            keys,
            indices,
            cellCounts,
            resources.uniform([count, ...dimensions, options.axes === 'xyz' ? 1 : 0]),
          ],
          Math.ceil(count / 256),
        );
        sorted = sort!.encode(encoder, keys, indices, count);
        const prefix = scan!.encode(encoder, cellCounts, cells);
        resources.dispatch(
          ranges,
          encoder,
          [prefix, cellOffsets, resources.uniform([cells, count])],
          Math.ceil((cells + 1) / 256),
        );
      },
      get memory() {
        return {
          bufferBytes:
            resources.memory.bufferBytes + sort!.memory.bufferBytes + scan!.memory.bufferBytes,
          textureBytes: 0,
        };
      },
      get sources() {
        return { ...resources.sources, ...sort!.sources, ...scan!.sources };
      },
      get diagnostics() {
        return [...resources.diagnostics, ...sort!.diagnostics, ...scan!.diagnostics];
      },
      dispose() {
        sort!.dispose();
        scan!.dispose();
        resources.dispose();
      },
    };
  } catch (error) {
    sort?.dispose();
    scan?.dispose();
    resources.dispose();
    throw error;
  }
}
export type SpatialHash = Awaited<ReturnType<typeof createSpatialHash>>;
