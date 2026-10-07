import type { DeviceSession } from '../device.ts';
import {
  PrimitiveResources,
  validateCapacity,
  validateCount,
  validateInput,
  validateDispatchCapacity,
} from './common.ts';
const scanWGSL = `struct Args{n:u32}; @group(0) @binding(0) var<storage,read> input:array<u32>; @group(0) @binding(1) var<storage,read_write> output:array<u32>; @group(0) @binding(2) var<storage,read_write> sums:array<u32>; @group(0) @binding(3) var<uniform> args:Args;
var<workgroup> local:array<u32,256>;
@compute @workgroup_size(256) fn main(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) block:vec3u){let i=block.x*256u+lane;var v=0u;if(i<args.n){v=input[i];}local[lane]=v;workgroupBarrier();for(var stride=1u;stride<256u;stride*=2u){var previous=0u;if(lane>=stride){previous=local[lane-stride];}workgroupBarrier();local[lane]+=previous;workgroupBarrier();}if(i<args.n){output[i]=local[lane]-v;}if(lane==255u){sums[block.x]=local[lane];}}`;
const addWGSL = `struct Args{n:u32}; @group(0) @binding(0) var<storage,read_write> output:array<u32>;@group(0) @binding(1) var<storage,read> offsets:array<u32>;@group(0) @binding(2) var<uniform> args:Args;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id:vec3u){if(id.x<args.n){output[id.x]+=offsets[id.x/256u];}}`;
const flagsWGSL = `struct Args{n:u32};@group(0) @binding(0) var<storage,read> flags:array<u32>;@group(0) @binding(1) var<storage,read_write> normalized:array<u32>;@group(0) @binding(2) var<uniform> args:Args;@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id:vec3u){if(id.x<args.n){normalized[id.x]=select(0u,1u,flags[id.x]!=0u);}}`;
const compactWGSL = `struct Args{n:u32};@group(0) @binding(0) var<storage,read> flags:array<u32>;@group(0) @binding(1) var<storage,read> offsets:array<u32>;@group(0) @binding(2) var<storage,read_write> indices:array<u32>;@group(0) @binding(3) var<storage,read_write> count:array<u32>;@group(0) @binding(4) var<uniform> args:Args;@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i<args.n&&flags[i]!=0u){indices[offsets[i]]=i;}if(i==0u){count[0]=0u;if(args.n>0u){let last=args.n-1u;count[0]=offsets[last]+select(0u,1u,flags[last]!=0u);}}}`;
/** Hierarchical exclusive u32 scan (modulo 2^32), with stable nonzero-flag compaction. */
export async function createPrefixSum(session: DeviceSession, capacity: number) {
  validateCapacity(capacity);
  validateDispatchCapacity(session, capacity);
  const resources = new PrimitiveResources(session, 'prefix-sum');
  try {
    const scan = await resources.pass(scanWGSL, 'scan', [
      'read-only-storage',
      'storage',
      'storage',
      'uniform',
    ]);
    const add = await resources.pass(addWGSL, 'add', ['storage', 'read-only-storage', 'uniform']);
    const normalize = await resources.pass(flagsWGSL, 'flags', [
      'read-only-storage',
      'storage',
      'uniform',
    ]);
    const scatter = await resources.pass(compactWGSL, 'compact', [
      'read-only-storage',
      'read-only-storage',
      'storage',
      'storage',
      'uniform',
    ]);
    const levels: { output: GPUBuffer; sums: GPUBuffer }[] = [];
    let size = capacity;
    do {
      const blocks = Math.ceil(size / 256);
      levels.push({
        output: resources.buffer(size * 4, 'offsets'),
        sums: resources.buffer(blocks * 4, 'sums'),
      });
      size = blocks;
    } while (size > 1);
    const flags = resources.buffer(capacity * 4, 'flags'),
      indices = resources.buffer(capacity * 4, 'indices'),
      countBuffer = resources.buffer(4, 'count');
    function run(
      encoder: GPUCommandEncoder,
      input: GPUBuffer,
      count: number,
      level = 0,
    ): GPUBuffer {
      const current = levels[level]!;
      if (!count) {
        encoder.clearBuffer(current.output);
        return current.output;
      }
      const blocks = Math.ceil(count / 256);
      resources.dispatch(
        scan,
        encoder,
        [input, current.output, current.sums, resources.uniform([count])],
        blocks,
      );
      if (blocks > 1) {
        const prefix = run(encoder, current.sums, blocks, level + 1);
        resources.dispatch(
          add,
          encoder,
          [current.output, prefix, resources.uniform([count])],
          blocks,
        );
      }
      return current.output;
    }
    return {
      capacity,
      output: levels[0]!.output,
      indices,
      count: countBuffer,
      encode(encoder: GPUCommandEncoder, input: GPUBuffer, count: number) {
        resources.assertAlive();
        validateCount(capacity, count);
        validateInput(input, count);
        if (input === levels[0]!.output) throw new RangeError('Scan input must not alias output');
        return run(encoder, input, count);
      },
      compact(encoder: GPUCommandEncoder, input: GPUBuffer, count: number) {
        resources.assertAlive();
        validateCount(capacity, count);
        validateInput(input, count);
        if (input === flags || input === indices || input === levels[0]!.output)
          throw new RangeError('Compaction input must not alias writable output');
        if (count) {
          resources.dispatch(
            normalize,
            encoder,
            [input, flags, resources.uniform([count])],
            Math.ceil(count / 256),
          );
          run(encoder, flags, count);
          resources.dispatch(
            scatter,
            encoder,
            [flags, levels[0]!.output, indices, countBuffer, resources.uniform([count])],
            Math.ceil(count / 256),
          );
        } else encoder.clearBuffer(countBuffer);
        return { indices, count: countBuffer };
      },
      get memory() {
        return resources.memory;
      },
      get sources() {
        return resources.sources;
      },
      get diagnostics() {
        return resources.diagnostics;
      },
      dispose() {
        resources.dispose();
      },
    };
  } catch (error) {
    resources.dispose();
    throw error;
  }
}
export type PrefixSum = Awaited<ReturnType<typeof createPrefixSum>>;
