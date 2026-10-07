import { expect, test } from 'vitest';
import { Scheduler, type Clock, type ScheduledSurface } from './scheduler.ts';

test('paused uniform polling submits only changed frames and sleeps offscreen or hidden', () => {
  let callback: ((time: number) => void) | null = null;
  const clock: Clock = {
    request: (run) => {
      callback = run;
      return 1;
    },
    cancel: () => {
      callback = null;
    },
    now: () => 0,
  };
  const order: string[] = [];
  let value = 0,
    uniform = 0;
  const surface: ScheduledSurface = {
    visible: true,
    playing: false,
    dirty: false,
    polling: true,
    beforeFrame: () => {
      order.push('uniforms');
      if (value !== uniform) {
        uniform = value;
        surface.dirty = true;
      }
    },
    update: () => order.push('step'),
    render: () => order.push('render'),
    frameCompleted: () => order.push('completed'),
  };
  const scheduler = new Scheduler(() => order.push('submit'), clock);
  const remove = scheduler.add(surface);
  const tick = (time: number) => {
    const run = callback;
    callback = null;
    run?.(time);
  };
  tick(0);
  tick(20);
  expect(order).toEqual(['uniforms', 'uniforms']);
  value = 1;
  tick(40);
  expect(order.slice(-4)).toEqual(['uniforms', 'render', 'submit', 'completed']);
  tick(60);
  expect(order.slice(-1)).toEqual(['uniforms']);
  expect(order.filter((value) => value === 'submit')).toHaveLength(1);
  surface.playing = true;
  tick(80);
  expect(order.slice(-5)).toEqual(['uniforms', 'step', 'render', 'submit', 'completed']);
  scheduler.setHidden(true);
  expect(callback).toBeNull();
  scheduler.setHidden(false);
  surface.visible = false;
  tick(100);
  expect(callback).toBeNull();
  const count = order.length;
  scheduler.invalidate();
  expect(order).toHaveLength(count);
  expect(callback).toBeNull();
  remove();
  expect(scheduler.surfaceCount).toBe(0);
});

test('source renders dirty a paused borrowing consumer in the same dependency-ordered frame', () => {
  let callback: ((time: number) => void) | undefined;
  const order: string[] = [];
  const clock: Clock = {
    request: (run) => {
      callback = run;
      return 1;
    },
    cancel: () => {},
    now: () => 0,
  };
  const consumer: ScheduledSurface = {
    visible: true,
    playing: false,
    dirty: false,
    polling: true,
    beforeFrame: () => order.push('consumer uniforms'),
    update: () => {},
    render: () => order.push('consumer'),
  };
  const source: ScheduledSurface = {
    visible: false,
    playing: false,
    dirty: true,
    update: () => {},
    render: () => {
      order.push('source');
      consumer.dirty = true;
    },
  };
  consumer.dependencies = () => [source];
  const scheduler = new Scheduler(() => order.push('submit'), clock);
  const remove = scheduler.add(consumer);
  callback!(0);
  expect(order).toEqual(['consumer uniforms', 'source', 'consumer', 'submit']);
  expect(source.dirty).toBe(false);
  expect(consumer.dirty).toBe(false);
  remove();
});
