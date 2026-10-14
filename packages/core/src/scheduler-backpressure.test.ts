import { expect, it, vi } from 'vitest';
import { Scheduler, type Clock, type ScheduledSurface } from './scheduler.ts';

function harness(pipelinedSubmissionLimit = 1) {
  let callback!: (time: number) => void,
    now = 0;
  const clock: Clock = {
    request: vi.fn((next) => {
      callback = next;
      return 1;
    }),
    cancel: vi.fn(),
    now: () => now,
  };
  const submissions = vi.fn(),
    queue: { resolve(): void; reject(error: Error): void }[] = [];
  const scheduler = new Scheduler(
    submissions,
    clock,
    () => new Promise<void>((resolve, reject) => queue.push({ resolve, reject })),
    { pipelinedSubmissionLimit },
  );
  return {
    clock,
    scheduler,
    submissions,
    queue,
    tick(time: number) {
      now = time;
      callback(time);
    },
    time(time: number) {
      now = time;
    },
  };
}
const surface = (): ScheduledSurface => ({
  visible: true,
  playing: true,
  dirty: true,
  update: vi.fn(),
  render: vi.fn(),
  frameCompleted: vi.fn(),
});
it('bounds six fair scheduled fields to one actual unfinished batch and avoids a stall catch-up burst', async () => {
  const h = harness(),
    fields = Array.from({ length: 6 }, surface);
  fields.forEach((field) => h.scheduler.add(field));
  h.tick(0);
  expect(h.submissions).toHaveBeenCalledTimes(1);
  expect(h.scheduler.submissionPending).toBe(true);
  for (const field of fields) expect(field.render).toHaveBeenCalledTimes(1);
  const requests = vi.mocked(h.clock.request).mock.calls.length;
  for (let i = 0; i < 200; i++) h.scheduler.invalidate();
  expect(h.clock.request).toHaveBeenCalledTimes(requests);
  h.tick(1000); // Even an already queued callback cannot encode extra work.
  expect(h.submissions).toHaveBeenCalledTimes(1);
  for (const field of fields) expect(field.update).not.toHaveBeenCalled();
  h.time(10000);
  h.queue[0]!.resolve();
  await Promise.resolve();
  expect(h.scheduler.submissionPending).toBe(false);
  h.tick(10016);
  expect(h.submissions).toHaveBeenCalledTimes(2);
  for (const field of fields) {
    expect(field.render).toHaveBeenCalledTimes(2);
    expect(field.update).toHaveBeenCalledTimes(1);
    expect(field.frameCompleted).toHaveBeenCalledTimes(2);
  }
});
it('preserves next-frame native cadence and includes newly dirty/added fields when the current queue completes', async () => {
  const h = harness(),
    a = surface(),
    b = surface();
  a.playing = b.playing = false;
  h.scheduler.add(a);
  h.tick(0);
  h.scheduler.add(b);
  a.dirty = true;
  h.scheduler.invalidate();
  h.time(4);
  h.queue[0]!.resolve();
  await Promise.resolve();
  h.tick(16.7);
  expect(a.render).toHaveBeenCalledTimes(2);
  expect(b.render).toHaveBeenCalledTimes(1);
  expect(h.submissions).toHaveBeenCalledTimes(2);
  h.time(21);
  h.queue[1]!.resolve();
  await Promise.resolve();
  expect(h.scheduler.submissionPending).toBe(false);
  const calls = vi.mocked(h.clock.request).mock.calls.length;
  h.scheduler.invalidate();
  expect(h.clock.request).toHaveBeenCalledTimes(calls); // Paused clean fields sleep.
});
it('abandons an old device lease, ignores its late rejection, and does not wake disposed fields', async () => {
  const h = harness(),
    old = surface(),
    remove = h.scheduler.add(old);
  h.tick(0);
  h.scheduler.setHidden(true);
  h.scheduler.resetSubmission();
  remove();
  const current = surface(),
    removeCurrent = h.scheduler.add(current);
  h.scheduler.setHidden(false);
  h.tick(50);
  h.queue[0]!.reject(new Error('old device lost'));
  await Promise.resolve();
  expect(h.scheduler.submissionPending).toBe(true);
  expect(current.render).toHaveBeenCalledTimes(1);
  removeCurrent();
  const calls = vi.mocked(h.clock.request).mock.calls.length;
  h.queue[1]!.resolve();
  await Promise.resolve();
  expect(h.scheduler.submissionPending).toBe(false);
  expect(h.scheduler.surfaceCount).toBe(0);
  expect(h.clock.request).toHaveBeenCalledTimes(calls);
});
it('releases queue rejection without leaving healthy scheduled fields blocked', async () => {
  const h = harness(),
    f = surface();
  h.scheduler.add(f);
  h.tick(0);
  h.queue[0]!.reject(new Error('device lost'));
  await Promise.resolve();
  expect(h.scheduler.submissionPending).toBe(false);
  h.tick(16.7);
  expect(f.render).toHaveBeenCalledTimes(2);
});

it('pipelines delayed completion notifications only up to the explicit bound', async () => {
  const h = harness(),
    f = surface();
  h.scheduler.setSubmissionLimit(8);
  h.scheduler.add(f);
  for (let i = 0; i < 8; i++) h.tick(i * 16.7);
  expect(h.submissions).toHaveBeenCalledTimes(8);
  const requests = vi.mocked(h.clock.request).mock.calls.length;
  h.scheduler.invalidate();
  h.tick(160);
  expect(h.submissions).toHaveBeenCalledTimes(8);
  expect(h.clock.request).toHaveBeenCalledTimes(requests);
  // Notifications can complete out of order; freeing one slot admits only one batch.
  h.queue[3]!.resolve();
  await Promise.resolve();
  h.tick(167);
  expect(h.submissions).toHaveBeenCalledTimes(9);
  h.scheduler.resetSubmission();
  h.tick(184);
  h.queue[0]!.resolve();
  await Promise.resolve();
  expect(h.scheduler.submissionPending).toBe(true);
  expect(h.scheduler.submissionLimit).toBe(8);
  expect(() => h.scheduler.setSubmissionLimit(0)).toThrow(RangeError);
  expect(() => h.scheduler.setSubmissionLimit(9)).toThrow(RangeError);
});

it('lowering the pipeline bound waits for existing batches to drain', async () => {
  const h = harness(),
    f = surface();
  h.scheduler.setSubmissionLimit(3);
  h.scheduler.add(f);
  for (let i = 0; i < 3; i++) h.tick(i * 16.7);
  h.scheduler.setSubmissionLimit(1);
  h.queue[0]!.resolve();
  h.queue[1]!.resolve();
  await Promise.resolve();
  h.tick(50);
  expect(h.submissions).toHaveBeenCalledTimes(3);
  h.queue[2]!.resolve();
  await Promise.resolve();
  h.tick(67);
  expect(h.submissions).toHaveBeenCalledTimes(4);
});

it('automatically pipelines stateless scenes and waits for outstanding work when a serial field joins', async () => {
  const h = harness(8),
    a = { ...surface(), submissionPipelining: true };
  const removeA = h.scheduler.add(a);
  expect(h.scheduler.submissionLimit).toBe(8);
  for (let i = 0; i < 8; i++) h.tick(i * 16.7);
  expect(h.submissions).toHaveBeenCalledTimes(8);
  const serial = surface(),
    removeSerial = h.scheduler.add(serial);
  expect(h.scheduler.submissionLimit).toBe(1);
  h.tick(150);
  expect(h.submissions).toHaveBeenCalledTimes(8);
  for (const pending of h.queue) pending.resolve();
  await Promise.resolve();
  h.tick(166.7);
  expect(serial.render).toHaveBeenCalledTimes(1);
  removeSerial();
  expect(h.scheduler.submissionLimit).toBe(8);
  h.scheduler.setSubmissionLimit(2);
  expect(h.scheduler.submissionLimit).toBe(2);
  const removeUnknown = h.scheduler.add(surface());
  expect(h.scheduler.submissionLimit).toBe(2);
  removeUnknown();
  removeA();
});
it('keeps unknown surfaces serial and validates automatic pipeline configuration', () => {
  const h = harness(8);
  h.scheduler.add(surface());
  expect(h.scheduler.submissionLimit).toBe(1);
  for (const limit of [0, 9, 1.5, NaN, Infinity]) expect(() => harness(limit)).toThrow(RangeError);
});

it('includes unregistered dependencies in the automatic serial safety check', () => {
  const h = harness(8),
    source = surface();
  const consumer = { ...surface(), submissionPipelining: true, dependencies: () => [source] };
  h.scheduler.add(consumer);
  expect(h.scheduler.submissionLimit).toBe(1);
  Object.assign(source, { submissionPipelining: true });
  expect(h.scheduler.submissionLimit).toBe(8);
});
it('wakes the available T1 pipeline immediately when the last serial surface leaves', () => {
  const h = harness(8);
  h.scheduler.add({ ...surface(), submissionPipelining: true });
  const removeSerial = h.scheduler.add(surface());
  h.tick(0);
  const requests = vi.mocked(h.clock.request).mock.calls.length;
  removeSerial();
  expect(h.scheduler.submissionLimit).toBe(8);
  expect(h.clock.request).toHaveBeenCalledTimes(requests + 1);
});
