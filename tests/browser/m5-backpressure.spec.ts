import { expect, test } from '@playwright/test';
import type {} from './effects.spec.ts';

test('The actual six Family H fields share one unfinished scheduled batch and resume fairly', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.routeWebSocket(/.*/, (socket) => socket.close());
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(
    '/?effect=border-energy&mode=in-page&playing=false&quality=fixed&resolution=1&seed=7',
  );
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.addStyleTag({
    content:
      '#stage.dom-mode{height:760px}.m5-cards{grid-template-columns:repeat(3,minmax(0,1fr));padding-bottom:1000px}.m5-card{height:220px;min-height:220px}',
  });
  const result = await page.evaluate(async () => {
    const stage = Reflect.get(window.hologpu, 'domStage'),
      fields = stage.fields as import('../../packages/core/src/index.ts').EffectField[],
      session = fields[0]!.session;
    session.scheduler.setHidden(true);
    await Promise.all(fields.map((field) => field.whenInputsReady()));
    await session.device.queue.onSubmittedWorkDone();
    const frames = async (count: number) => {
      for (let i = 0; i < count; i++)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    };
    await frames(4);
    for (const field of fields) {
      field.setAdaptiveQuality(false);
      field.setReducedMotion(false);
      field.reset(7);
      field.play();
    }
    const queue = session.device.queue,
      original = queue.onSubmittedWorkDone.bind(queue),
      submit = session.submit;
    let release!: () => void,
      entered!: () => void,
      submissions = 0,
      heldOnce = false;
    const hold = new Promise<void>((resolve) => (release = resolve)),
      first = new Promise<void>((resolve) => (entered = resolve));
    // Delay admission only after genuine submitted commands finish. Quality is fixed:
    // the artificial hold is a correctness probe, never a performance observation.
    queue.onSubmittedWorkDone = async () => {
      await original();
      if (!heldOnce) {
        heldOnce = true;
        entered();
        await hold;
      }
    };
    session.submit = function () {
      submissions++;
      return submit.call(this);
    };
    const renders = fields.map(() => 0),
      updates = fields.map(() => 0),
      removes: (() => void)[] = [];
    const originals = fields.map((field) => field.instance!.update);
    fields.forEach((field, i) => {
      removes.push(field.onRendered(() => renders[i]!++));
      field.instance!.update = function (frame) {
        updates[i]!++;
        originals[i]!.call(this, frame);
      };
    });
    session.scheduler.setHidden(false);
    await first;
    const before = {
      submissions,
      renders: [...renders],
      updates: [...updates],
      pending: session.scheduler.submissionPending,
    };
    fields.forEach((field) => field.invalidate());
    await frames(4);
    const held = {
      submissions,
      renders: [...renders],
      updates: [...updates],
      pending: session.scheduler.submissionPending,
    };
    release();
    for (let i = 0; i < 20 && !renders.every((value) => value >= 2); i++) await frames(1);
    session.scheduler.setHidden(true);
    await original();
    const resumed = [...renders],
      visible = fields.every((field) => field.visible),
      ids = fields.map((field) => field.effect.id),
      errors = [...session.errors];
    queue.onSubmittedWorkDone = original;
    session.submit = submit;
    removes.forEach((remove) => remove());
    fields.forEach((field, i) => {
      field.instance!.update = originals[i]!;
    });
    stage.destroy();
    return {
      before,
      held,
      resumed,
      visible,
      ids,
      errors,
      surfaces: session.scheduler.surfaceCount,
    };
  });
  expect(result.ids).toEqual([
    'border-energy',
    'spotlight',
    'image-hover',
    'text-dissolve',
    'audio-spectrum',
    'scroll-scene',
  ]);
  expect(result.visible).toBe(true);
  expect(result.before.submissions).toBe(1);
  expect(result.before.renders).toEqual([1, 1, 1, 1, 1, 1]);
  expect(result.before.pending).toBe(true);
  expect(result.held).toEqual(result.before);
  expect(result.resumed.every((value) => value >= 2)).toBe(true);
  expect(result.surfaces).toBe(0);
  expect(result.errors).toEqual([]);
});
