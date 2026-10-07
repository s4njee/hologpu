import { expect, it, vi } from 'vitest';
import { ParamStore, bakeParamTexture } from './params.ts';
import { Scheduler, type ScheduledSurface, type Clock } from './scheduler.ts';

it('keeps texture parameters out of uniforms and owns immutable validated stops', () => {
  const schema = {
    imageMap: { type: 'texture', default: 'image' },
    curve: { type: 'curve', default: [0, 1], min: 0, max: 2 },
    gradient: {
      type: 'gradient',
      default: [
        { offset: 0, color: '#0000' },
        { offset: 1, color: '#fff' },
      ],
    },
    gain: { type: 'f32', default: 1 },
  } as const;
  const store = new ParamStore(schema),
    device = { queue: { writeBuffer: vi.fn() } } as unknown as GPUDevice;
  expect(store.layout.fields.map((field) => field.name)).toEqual(['gain']);
  store.flush(device, {} as GPUBuffer);
  store.set('curve', [0, 2]);
  expect(store.flush(device, {} as GPUBuffer)).toBe(false);
  const stops = [
    { offset: 0, color: '#f00' },
    { offset: 1, color: '#00f' },
  ];
  store.set('gradient', stops);
  stops[0]!.color = '#0f0';
  expect(store.values.gradient[0]!.color).toBe('#f00');
  expect(Object.isFrozen(store.values.gradient[0])).toBe(true);
  expect(() =>
    store.patch({
      gain: 2,
      gradient: [
        { offset: 0.5, color: '#fff' },
        { offset: 0.4, color: '#000' },
      ],
    }),
  ).toThrow();
  expect(store.values.gain).toBe(1);
  expect(() => store.set('curve', [NaN, 0])).toThrow();
  expect(() => store.set('imageMap', '')).toThrow();
  expect(() => store.set('gradient', [{ offset: 0, color: '#fff' }])).toThrow();
});
it('bakes evenly sampled curves and premultiplied linear gradients with exact endpoints', () => {
  const curve = bakeParamTexture({ type: 'curve', default: [0, 2, 0], resolution: 5 }, [0, 2, 0]);
  expect(Array.from(curve.data).filter((_, i) => i % 4 === 0)).toEqual([0, 1, 2, 1, 0]);
  const gradient = bakeParamTexture(
    {
      type: 'gradient',
      default: [
        { offset: 0, color: '#f000' },
        { offset: 1, color: '#00f' },
      ],
      resolution: 3,
    },
    [
      { offset: 0, color: '#f000' },
      { offset: 1, color: '#00f' },
    ],
  );
  expect(Array.from(gradient.data)).toEqual([0, 0, 0, 0, 0, 0, 0.5, 0.5, 0, 0, 1, 1]);
  expect(() =>
    bakeParamTexture({ type: 'curve', default: [0, 1], resolution: 1 }, [0, 1]),
  ).toThrow();
});
it('updates and renders source dependencies before consumers regardless of registration order', () => {
  let callback: ((time: number) => void) | undefined;
  const order: string[] = [];
  const clock: Clock = {
    request: (fn) => {
      callback = fn;
      return 1;
    },
    cancel() {},
    now: () => 0,
  };
  const scheduler = new Scheduler(() => order.push('submit'), clock);
  const source: ScheduledSurface = {
    visible: false,
    playing: true,
    dirty: true,
    update: () => order.push('source-update'),
    render: () => order.push('source-render'),
  };
  const consumer: ScheduledSurface = {
    visible: true,
    playing: true,
    dirty: true,
    dependencies: () => [source],
    update: () => order.push('consumer-update'),
    render: () => order.push('consumer-render'),
  };
  scheduler.add(consumer);
  scheduler.add(source);
  callback!(0);
  expect(order).toEqual(['source-render', 'consumer-render', 'submit']);
  order.length = 0;
  callback!(17);
  expect(order).toEqual([
    'source-update',
    'consumer-update',
    'source-render',
    'consumer-render',
    'submit',
  ]);
  scheduler.stop();
});
