import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const core = '/@fs' + fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url));
test('native Firefox chooses eight only for T1 sessions and keeps explicit bounds', async ({
  page,
}) => {
  await page.route('**/__submission_policy', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><canvas style="width:160px;height:100px"></canvas><canvas style="width:160px;height:100px"></canvas>',
    }),
  );
  await page.goto('/__submission_policy');
  const result = await page.evaluate(async (source) => {
    const { createEffect, fragmentEffect, defineEffect } = await import(source);
    const definition = fragmentEffect({
      id: 'submission-policy-test',
      title: 'Policy fixture',
      params: {},
      wgsl: 'fn effect(uv:vec2f)->vec4f{return vec4f(uv,0.25,1);}',
    });
    const canvases = document.querySelectorAll('canvas');
    const t1 = await createEffect(canvases[0], definition, {
      playing: false,
      reducedMotion: false,
    });
    const scheduler = t1.session.scheduler;
    const pure = scheduler.submissionLimit;
    const serial = await createEffect(canvases[1], defineEffect({ ...definition, tier: 'T2' }), {
      playing: false,
      reducedMotion: false,
    });
    const mixed = scheduler.submissionLimit;
    serial.destroy();
    const restored = scheduler.submissionLimit;
    scheduler.setSubmissionLimit(2);
    const explicit = scheduler.submissionLimit;
    t1.drawAt(0, 7);
    await t1.session.device.queue.onSubmittedWorkDone();
    const errors = [...t1.session.errors];
    t1.destroy();
    return {
      pure,
      mixed,
      restored,
      explicit,
      errors,
      firefox: /Firefox\/\d/.test(navigator.userAgent),
    };
  }, core);
  expect(result.pure).toBe(result.firefox ? 8 : 1);
  expect(result.mixed).toBe(1);
  expect(result.restored).toBe(result.pure);
  expect(result.explicit).toBe(2);
  expect(result.errors).toEqual([]);
});
