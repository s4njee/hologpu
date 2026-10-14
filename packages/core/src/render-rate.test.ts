import { expect, it, vi } from 'vitest';
import { Scheduler, type ScheduledSurface } from './scheduler.ts';

it('keeps time and other fields moving while a throttled field skips GPU batches', () => {
  let callback!: (time: number) => void;
  const submit = vi.fn();
  const scheduler = new Scheduler(submit, {
    request: (next) => {
      callback = next;
      return 1;
    },
    cancel() {},
    now: () => 0,
  });
  let ticks = 0;
  const grain: ScheduledSurface = {
    visible: true,
    playing: true,
    dirty: true,
    shouldRender: () => grain.dirty || ticks % 3 === 0,
    update: () => {
      ticks++;
    },
    render: vi.fn(),
    frameCompleted: vi.fn(),
  };
  const remove = scheduler.add(grain);
  callback(0);
  callback(17);
  callback(34);
  expect(ticks).toBe(2);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(grain.frameCompleted).toHaveBeenCalledTimes(1);
  const other: ScheduledSurface = {
    visible: true,
    playing: true,
    dirty: true,
    update: vi.fn(),
    render: vi.fn(),
  };
  const removeOther = scheduler.add(other);
  callback(51);
  callback(68);
  expect(grain.render).toHaveBeenCalledTimes(2);
  expect(other.render).toHaveBeenCalledTimes(2);
  // External changes still draw immediately between time-driven updates.
  grain.dirty = true;
  callback(85);
  expect(grain.render).toHaveBeenCalledTimes(3);
  removeOther();
  remove();
  expect(scheduler.surfaceCount).toBe(0);
});
