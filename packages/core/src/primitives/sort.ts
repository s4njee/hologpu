import type { DeviceSession } from '../device.ts';
import {
  PrimitiveResources,
  validateCapacity,
  validateCount,
  validateInput,
  validateDispatchCapacity,
} from './common.ts';
import { createPrefixSum } from './prefix-sum.ts';
const partitionWGSL = `struct Args{n:u32,blocks:u32,shift:u32,pad:u32};
@group(0) @binding(0) var<storage,read> keys:array<u32>;@group(0) @binding(1) var<storage,read> values:array<u32>;@group(0) @binding(2) var<storage,read_write> localKeys:array<u32>;@group(0) @binding(3) var<storage,read_write> localValues:array<u32>;@group(0) @binding(4) var<storage,read_write> histogram:array<u32>;@group(0) @binding(5) var<uniform> args:Args;
var<workgroup> k:array<u32,256>;var<workgroup> v:array<u32,256>;var<workgroup> prefix:array<u32,256>;var<workgroup> boundaries:array<atomic<u32>,17>;
@compute @workgroup_size(256) fn main(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) block:vec3u){let i=block.x*256u+lane;let length=min(256u,args.n-block.x*256u);var key=0xffffffffu;var value=0u;if(lane<length){key=keys[i];value=values[i];}k[lane]=key;v[lane]=value;workgroupBarrier();
for(var bit=0u;bit<4u;bit++){key=k[lane];value=v[lane];let zero=select(0u,1u,((key>>(args.shift+bit))&1u)==0u);prefix[lane]=zero;workgroupBarrier();for(var stride=1u;stride<256u;stride*=2u){var previous=0u;if(lane>=stride){previous=prefix[lane-stride];}workgroupBarrier();prefix[lane]+=previous;workgroupBarrier();}let zeros=prefix[255];let destination=select(zeros+lane-prefix[lane],prefix[lane]-1u,zero==1u);workgroupBarrier();k[destination]=key;v[destination]=value;workgroupBarrier();}
if(lane<17u){atomicStore(&boundaries[lane],256u);}workgroupBarrier();let digit=(k[lane]>>args.shift)&15u;if(lane<length){atomicMin(&boundaries[digit],lane);}workgroupBarrier();if(lane<16u){var number=0u;for(var j=0u;j<length;j++){number+=select(0u,1u,((k[j]>>args.shift)&15u)==lane);}histogram[lane*args.blocks+block.x]=number;}if(lane<length){localKeys[i]=k[lane];localValues[i]=v[lane];}}
`;
const scatterWGSL = `struct Args{n:u32,blocks:u32,shift:u32,pad:u32};@group(0) @binding(0) var<storage,read> keys:array<u32>;@group(0) @binding(1) var<storage,read> values:array<u32>;@group(0) @binding(2) var<storage,read> offsets:array<u32>;@group(0) @binding(3) var<storage,read_write> outputKeys:array<u32>;@group(0) @binding(4) var<storage,read_write> outputValues:array<u32>;@group(0) @binding(5) var<uniform> args:Args;var<workgroup> first:array<atomic<u32>,16>;
@compute @workgroup_size(256) fn main(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) block:vec3u){if(lane<16u){atomicStore(&first[lane],256u);}workgroupBarrier();let i=block.x*256u+lane;var digit=0u;if(i<args.n){digit=(keys[i]>>args.shift)&15u;atomicMin(&first[digit],lane);}workgroupBarrier();if(i<args.n){let destination=offsets[digit*args.blocks+block.x]+lane-atomicLoad(&first[digit]);outputKeys[destination]=keys[i];outputValues[destination]=values[i];}}
`;
const initializeWGSL = `struct Args{n:u32,size:u32};@group(0) @binding(0) var<storage,read> keys:array<u32>;@group(0) @binding(1) var<storage,read> values:array<u32>;@group(0) @binding(2) var<storage,read_write> nextKeys:array<u32>;@group(0) @binding(3) var<storage,read_write> nextValues:array<u32>;@group(0) @binding(4) var<storage,read_write> order:array<u32>;@group(0) @binding(5) var<uniform> args:Args;@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=args.size){return;}var key=0xffffffffu;var value=0u;var original=0xffffffffu;if(i<args.n){key=keys[i];value=values[i];original=i;}nextKeys[i]=key;nextValues[i]=value;order[i]=original;}`;
const bitonicWGSL = `struct Args{n:u32,span:u32,distance:u32,pad:u32};@group(0) @binding(0) var<storage,read> keys:array<u32>;@group(0) @binding(1) var<storage,read> values:array<u32>;@group(0) @binding(2) var<storage,read> order:array<u32>;@group(0) @binding(3) var<storage,read_write> nextKeys:array<u32>;@group(0) @binding(4) var<storage,read_write> nextValues:array<u32>;@group(0) @binding(5) var<storage,read_write> nextOrder:array<u32>;@group(0) @binding(6) var<uniform> args:Args;@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=args.n){return;}let j=i^args.distance;let less=keys[i]<keys[j]||(keys[i]==keys[j]&&order[i]<order[j]);let low=(i&args.distance)==0u;let ascending=(i&args.span)==0u;let useSelf=select(!less,less,low==ascending);let chosen=select(j,i,useSelf);nextKeys[i]=keys[chosen];nextValues[i]=values[chosen];nextOrder[i]=order[chosen];}`;
/** Stable full-width unsigned key/value sorting. Radix handles arbitrary lengths; bitonic pads internally. */
export async function createSort(
  session: DeviceSession,
  capacity: number,
  algorithm: 'radix' | 'bitonic' = 'radix',
) {
  validateCapacity(capacity);
  const resources = new PrimitiveResources(session, `sort-${algorithm}`);
  const padded = 2 ** Math.ceil(Math.log2(capacity));
  const allocated = algorithm === 'bitonic' ? padded : capacity;
  validateDispatchCapacity(session, allocated);
  let scan: Awaited<ReturnType<typeof createPrefixSum>> | undefined;
  try {
    const keys = [
        resources.buffer(allocated * 4, 'keys-a'),
        resources.buffer(allocated * 4, 'keys-b'),
      ],
      values = [
        resources.buffer(allocated * 4, 'values-a'),
        resources.buffer(allocated * 4, 'values-b'),
      ];
    let encode: (
      encoder: GPUCommandEncoder,
      inputKeys: GPUBuffer,
      inputValues: GPUBuffer,
      count: number,
    ) => { keys: GPUBuffer; values: GPUBuffer };
    if (algorithm === 'radix') {
      const partition = await resources.pass(partitionWGSL, 'partition', [
        'read-only-storage',
        'read-only-storage',
        'storage',
        'storage',
        'storage',
        'uniform',
      ]);
      const scatter = await resources.pass(scatterWGSL, 'scatter', [
        'read-only-storage',
        'read-only-storage',
        'read-only-storage',
        'storage',
        'storage',
        'uniform',
      ]);
      const histogram = resources.buffer(Math.ceil(capacity / 256) * 16 * 4, 'histogram');
      scan = await createPrefixSum(session, Math.ceil(capacity / 256) * 16);
      encode = (encoder, inputKeys, inputValues, count) => {
        resources.assertAlive();
        validateCount(capacity, count);
        validateInput(inputKeys, count);
        validateInput(inputValues, count);
        if (
          inputKeys === keys[0] ||
          inputValues === keys[0] ||
          inputKeys === values[0] ||
          inputValues === values[0]
        )
          throw new RangeError('Sort inputs must not alias initialization outputs');
        if (!count) return { keys: keys[1]!, values: values[1]! };
        const blocks = Math.ceil(count / 256);
        let currentKeys = inputKeys,
          currentValues = inputValues;
        for (let shift = 0; shift < 32; shift += 4) {
          const args = resources.uniform([count, blocks, shift, 0]);
          resources.dispatch(
            partition,
            encoder,
            [currentKeys, currentValues, keys[0]!, values[0]!, histogram, args],
            blocks,
          );
          const offsets = scan!.encode(encoder, histogram, blocks * 16);
          resources.dispatch(
            scatter,
            encoder,
            [keys[0]!, values[0]!, offsets, keys[1]!, values[1]!, args],
            blocks,
          );
          currentKeys = keys[1]!;
          currentValues = values[1]!;
        }
        return { keys: keys[1]!, values: values[1]! };
      };
    } else {
      const orders = [
        resources.buffer(padded * 4, 'order-a'),
        resources.buffer(padded * 4, 'order-b'),
      ];
      const initialize = await resources.pass(initializeWGSL, 'initialize', [
        'read-only-storage',
        'read-only-storage',
        'storage',
        'storage',
        'storage',
        'uniform',
      ]);
      const compare = await resources.pass(bitonicWGSL, 'compare', [
        'read-only-storage',
        'read-only-storage',
        'read-only-storage',
        'storage',
        'storage',
        'storage',
        'uniform',
      ]);
      encode = (encoder, inputKeys, inputValues, count) => {
        resources.assertAlive();
        validateCount(capacity, count);
        validateInput(inputKeys, count);
        validateInput(inputValues, count);
        if (
          inputKeys === keys[0] ||
          inputValues === keys[0] ||
          inputKeys === values[0] ||
          inputValues === values[0]
        )
          throw new RangeError('Sort inputs must not alias initialization outputs');
        if (!count) return { keys: keys[0]!, values: values[0]! };
        const size = 2 ** Math.ceil(Math.log2(count));
        resources.dispatch(
          initialize,
          encoder,
          [
            inputKeys,
            inputValues,
            keys[0]!,
            values[0]!,
            orders[0]!,
            resources.uniform([count, size]),
          ],
          Math.ceil(size / 256),
        );
        let read = 0;
        for (let span = 2; span <= size; span *= 2) {
          for (let distance = span / 2; distance >= 1; distance /= 2) {
            const write = 1 - read;
            resources.dispatch(
              compare,
              encoder,
              [
                keys[read]!,
                values[read]!,
                orders[read]!,
                keys[write]!,
                values[write]!,
                orders[write]!,
                resources.uniform([size, span, distance, 0]),
              ],
              Math.ceil(size / 256),
            );
            read = write;
          }
        }
        return { keys: keys[read]!, values: values[read]! };
      };
    }
    return {
      capacity,
      algorithm,
      encode,
      get memory() {
        return {
          bufferBytes: resources.memory.bufferBytes + (scan?.memory.bufferBytes ?? 0),
          textureBytes: 0,
        };
      },
      get sources() {
        return { ...resources.sources, ...scan?.sources };
      },
      get diagnostics() {
        return [...resources.diagnostics, ...(scan?.diagnostics ?? [])];
      },
      dispose() {
        scan?.dispose();
        resources.dispose();
      },
    };
  } catch (error) {
    scan?.dispose();
    resources.dispose();
    throw error;
  }
}
export type KeyValueSort = Awaited<ReturnType<typeof createSort>>;
