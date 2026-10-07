import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  EffectField,
  fragmentEffect,
  Scheduler,
  type Clock,
  type Surface,
} from '@mk7s/hologpu-core';
import { bindProperties, bindTimeline } from './bridges.ts';

beforeEach(() => {
  vi.stubGlobal('document', { hidden: false });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function field(session: object, adaptiveQuality = false) {
  const definition = fragmentEffect({
    id: 'driver-unit',
    title: 'driver',
    params: { amount: { type: 'f32', default: 0.2 } },
    wgsl: 'fn effect(uv:vec2f)->vec4f{return vec4f(1);}',
  });
  // Construct the real field/controller without allocating a GPU. Generation zero is
  // the deliberately controlled session lease used by these scheduler unit tests.
  const result = Reflect.construct(EffectField, [
    new EventTarget(),
    definition,
    session,
    () => {},
    { playing: false, adaptiveQuality },
  ]) as EffectField;
  result.state = 'ready';
  return result;
}
it('isolates author driver errors, keeps healthy fields scheduled, and resumes valid sources', () => {
  let callback!: (time: number) => void;
  const clock: Clock = {
    request: vi.fn((next) => {
      callback = next;
      return 1;
    }),
    cancel: vi.fn(),
    now: () => 0,
  };
  const submit = vi.fn(),
    scheduler = new Scheduler(submit, clock);
  const session = { state: 'ready', generation: 0, scheduler };
  const bad = field(session),
    healthy = field(session);
  healthy.playing = true;
  const badRender = vi.spyOn(bad, 'render').mockImplementation(() => {}),
    healthyRender = vi.spyOn(healthy, 'render').mockImplementation(() => {});
  vi.spyOn(bad, 'frameCompleted').mockImplementation(() => {});
  vi.spyOn(healthy, 'frameCompleted').mockImplementation(() => {});
  let failure: 'throw' | 'invalid' | 'valid' = 'throw',
    progress = NaN;
  const events: CustomEvent[] = [];
  bad.canvas.addEventListener('hgpu-error', (event) => events.push(event as CustomEvent));
  const properties = bindProperties(bad, () => {
    if (failure === 'throw') throw new Error('author source');
    return { amount: failure === 'invalid' ? NaN : 0.8 };
  });
  const timeline = bindTimeline(bad, () => progress);
  const removeBad = scheduler.add(bad),
    removeHealthy = scheduler.add(healthy);
  callback(0);
  callback(17);
  callback(34);
  expect(healthyRender).toHaveBeenCalledTimes(3);
  expect(healthy.frame.index).toBeGreaterThan(0);
  expect(properties.stats.errors).toEqual(['Error: author source']);
  expect(timeline.stats.errors).toHaveLength(1);
  expect(events).toHaveLength(2); // Repeated identical failures report once.
  expect(events[0]!.detail).toMatchObject({
    field: bad,
    driver: 'properties',
    error: expect.any(Error),
  });
  failure = 'invalid';
  callback(51);
  expect(bad.params.amount).toBe(0.2);
  expect(properties.stats.errors).toHaveLength(2);
  failure = 'valid';
  progress = 0.4;
  callback(68);
  expect(bad.params.amount).toBe(0.8);
  expect(bad.frame.time).toBe(0.4);
  expect(properties.stats.applied).toBe(1);
  expect(timeline.stats.applied).toBe(1);
  const rendered = badRender.mock.calls.length,
    submissions = submit.mock.calls.length;
  callback(85);
  callback(102);
  expect(badRender).toHaveBeenCalledTimes(rendered);
  expect(submit.mock.calls.length).toBe(submissions + 2); // Only the healthy playing field submits.
  expect(properties.stats.calls).toBe(7);
  timeline.dispose();
  expect(bad.polling).toBe(true);
  properties.dispose();
  expect(bad.polling).toBe(false);
  removeBad();
  removeHealthy();
  expect(scheduler.surfaceCount).toBe(0);
});
it('bounds distinct driver reports and retains public errors until reset', () => {
  const f = field({ state: 'ready', generation: 0, scheduler: { invalidate() {} } });
  let number = 0;
  const dispatch = vi.spyOn(f.canvas, 'dispatchEvent');
  const binding = bindProperties(f, () => {
    throw new Error(`failure ${number++}`);
  });
  for (let i = 0; i < 40; i++) f.beforeFrame();
  expect(binding.stats.calls).toBe(40);
  expect(binding.stats.errors).toHaveLength(16);
  expect(dispatch).toHaveBeenCalledTimes(16);
  binding.resetStats();
  expect(binding.stats).toEqual({ calls: 0, applied: 0, errors: [] });
  binding.dispose();
  f.beforeFrame();
  expect(binding.stats.calls).toBe(0);
});
it('settles unchanged timeline poses while validating clocks and respecting motion changes', () => {
  const invalidate = vi.fn(),
    f = field({ state: 'ready', generation: 0, scheduler: { invalidate } });
  f.timeline(0.6);
  invalidate.mockClear();
  for (let i = 0; i < 20; i++) f.timeline(0.6);
  expect(invalidate).not.toHaveBeenCalled();
  expect(() => f.timeline(NaN)).toThrow('Timeline progress');
  f.setReducedMotion(true);
  f.timeline(0.6);
  expect(f.frame.time).toBe(f.effect.reducedMotion.time);
  f.setReducedMotion(false);
  f.timeline(0.6);
  expect(f.frame.time).toBe(0.6);
  f.play();
  f.timeline(0.6);
  expect(f.playing).toBe(false);
  expect(f.requestedPlaying).toBe(false);
});
it('adapts paused rendered work using actual queue-completion samples without advancing simulation', async () => {
  let now = 0,
    finish!: () => void;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const queue = {
    onSubmittedWorkDone: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    ),
  };
  const f = field(
    { state: 'ready', generation: 0, scheduler: { invalidate() {} }, device: { queue } },
    true,
  );
  const resize = vi.fn();
  f.surface = { resolutionScale: 1, resize } as unknown as Surface;
  for (let sample = 0; sample < 126; sample++) {
    f.frameCompleted({ cpuMs: 0, intervalMs: 16.7 });
    now += 30;
    finish();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }
  expect(queue.onSubmittedWorkDone).toHaveBeenCalledTimes(126);
  expect(f.quality.state).toEqual({ stepScale: 0.25, resolutionScale: 0.75 });
  expect(f.surface.resolutionScale).toBe(0.75);
  expect(resize).toHaveBeenCalledTimes(1);
  expect(f.frame.index).toBe(0);
  expect(f.playing).toBe(false);
});
it('abandons obsolete quality samples without clearing a newer pending completion', async () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const finishes: (() => void)[] = [],
    queue = {
      onSubmittedWorkDone: vi.fn(() => new Promise<void>((resolve) => finishes.push(resolve))),
    };
  const f = field(
    { state: 'ready', generation: 0, scheduler: { invalidate() {} }, device: { queue } },
    true,
  );
  f.surface = { resolutionScale: 1, resize: vi.fn() } as unknown as Surface;
  f.frameCompleted({ cpuMs: 0, intervalMs: 16 });
  f.setAdaptiveQuality(false);
  f.setAdaptiveQuality(true);
  f.frameCompleted({ cpuMs: 0, intervalMs: 16 });
  now = 10000;
  finishes[0]!();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(f.quality.averageMs).toBe(0);
  f.frameCompleted({ cpuMs: 0, intervalMs: 16 });
  expect(queue.onSubmittedWorkDone).toHaveBeenCalledTimes(2);
  finishes[1]!();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(f.quality.state).toEqual({ resolutionScale: 0.25, stepScale: 0.25 });
});
