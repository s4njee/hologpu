import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { Attachment } from '../../packages/dom/src/index.ts';
import type { EffectField } from '../../packages/core/src/index.ts';

const modulePath = (path: string) => '/@fs' + fileURLToPath(new URL(path, import.meta.url));
const paths = {
  core: modulePath('../../packages/core/src/index.ts'),
  dom: modulePath('../../packages/dom/src/index.ts'),
  panel: modulePath('../../packages/effects/src/panel-refraction/index.ts'),
  readback: modulePath('./fixtures/panel-readback.ts'),
};
type PanelWindow = Window & {
  hero: Attachment;
  panel: Attachment;
  checker: EffectField;
  glass: EffectField;
  fallback: Attachment;
};

async function fixture(page: Page) {
  await page.route('**/__v2_panel', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><style>
        body{margin:0;min-height:2000px;background:#101622;color:white}
        #scene{position:relative;margin:100px 40px;width:320px;height:240px}
        #hero{position:absolute;inset:0}
        #panel{position:absolute;left:72px;top:58px;width:128px;height:96px;border-radius:16px}
        #fallback{width:128px;height:96px;border-radius:16px}
        button{font:16px sans-serif}
        canvas.direct{display:block;width:160px;height:120px}
      </style><main id="scene"><section id="hero"></section><section id="panel"><button>Real control</button></section></main><section id="fallback"><button>Fallback control</button></section><canvas class="direct" id="checker"></canvas><canvas class="direct" id="glass"></canvas>`,
    }),
  );
  await page.goto('/__v2_panel');
}

const checkerCode = `fn effect(uv:vec2f)->vec4f {
  let p=uv*frame.resolution/max(frame.dpr,0.001);
  let check=(u32(floor(p.x/8.0))+u32(floor(p.y/8.0)))%2u;
  let a=0.6;
  return vec4f(vec3f(0.1+uv.x*0.4+frame.time*0.01,0.1+uv.y*0.4,select(0.2,0.8,check!=0u))*a,a);
}`;

test('Panel filter preserves linear premultiplied samples, masks corners and owns no hero resources', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(
    async ({ paths, checkerCode }) => {
      const { createEffect, fragmentEffect } = (await import(
        paths.core
      )) as typeof import('../../packages/core/src/index.ts');
      const { default: panel } = (await import(paths.panel)) as {
        default: import('../../packages/core/src/index.ts').EffectDefinition;
      };
      const { readFieldLinear } = (await import(
        paths.readback
      )) as typeof import('./fixtures/panel-readback.ts');
      const source = fragmentEffect({
        id: 'checker-hero',
        title: 'Checker hero',
        params: {},
        wgsl: checkerCode,
      });
      const checker = await createEffect(document.querySelector('#checker')!, source, {
        playing: false,
        adaptiveQuality: false,
      });
      const glass = await createEffect(document.querySelector('#glass')!, panel, {
        playing: false,
        adaptiveQuality: false,
        params: {
          rect: [0.1, 0.1, 0.8, 0.8],
          sourceRect: [0.1, 0.1, 0.8, 0.8],
          radius: 16,
          blur: 0,
          refraction: 0,
          intensity: 0,
        },
      });
      checker.session.scheduler.setHidden(true);
      await new Promise(requestAnimationFrame);
      checker.drawAt(0, 7);
      const ownBytes = glass.memory().textureBytes;
      await glass.bindInput('image', checker);
      glass.drawAt(0, 7);
      checker.session.submit();
      if (!checker.output || !glass.output)
        throw new Error(
          JSON.stringify({
            checker: checker.state,
            glass: glass.state,
            session: checker.session.state,
            errors: checker.session.errors,
            diagnostics: glass.diagnostics,
          }),
        );
      const hero = await readFieldLinear(checker);
      const plain = await readFieldLinear(glass);
      const borrowedRead = await glass.readTap('input:image');
      const heroRead = await glass.readTap('hero');
      let interiorDifference = 0;
      for (let y = Math.floor(plain.height * 0.3); y < plain.height * 0.7; y++)
        for (let x = Math.floor(plain.width * 0.3); x < plain.width * 0.7; x++)
          for (let c = 0; c < 4; c++)
            interiorDifference = Math.max(
              interiorDifference,
              Math.abs(
                plain.values[(y * plain.width + x) * 4 + c]! -
                  hero.values[(y * hero.width + x) * 4 + c]!,
              ),
            );
      const alphaAt = (x: number, y: number) =>
        plain.values[
          (Math.floor(y * plain.height) * plain.width + Math.floor(x * plain.width)) * 4 + 3
        ]!;
      glass.store.patch({ blur: 3, refraction: 2, intensity: 0.25, brand: '#ffcc99' });
      glass.drawAt(0.25, 9);
      glass.session.submit();
      const frost = await readFieldLinear(glass);
      glass.drawAt(50, 9);
      glass.session.submit();
      const repeat = await readFieldLinear(glass);
      const memory = glass.memory();
      const borrowedIdentity = glass.inputTexture('image')!.texture === checker.output!.texture;
      const heroBytes = checker.memory().textureBytes;
      const errors = [...glass.session.errors];
      const diagnostics = [...glass.diagnostics];
      glass.destroy();
      checker.drawAt(1, 7);
      checker.session.submit();
      const surviving = await readFieldLinear(checker);
      const result = {
        tier: panel.tier,
        features: panel.features,
        noCapture: !panel.inputs.includes('element'),
        borrowedIdentity,
        noInputAllocation: memory.textureBytes === ownBytes,
        borrowedReadback: borrowedRead.values.every((value, i) => value === hero.values[i]),
        heroReadback: heroRead.values.every((value, i) => value === hero.values[i]),
        interiorDifference,
        outside: alphaAt(0.02, 0.5),
        roundedCorner: alphaAt(0.105, 0.105),
        interiorAlpha: alphaAt(0.5, 0.5),
        deterministic: frost.values.every((value, i) => value === repeat.values[i]),
        changed: frost.values.some((value, i) => value !== plain.values[i]),
        bufferBytes: memory.bufferBytes,
        heroBytesPreserved: checker.memory().textureBytes === heroBytes,
        heroStillReadable: surviving.values.some((value) => value > 0),
        errors,
        diagnostics,
      };
      checker.destroy();
      return result;
    },
    { paths, checkerCode },
  );
  expect(result).toMatchObject({
    tier: 'T4',
    features: [],
    noCapture: true,
    borrowedIdentity: true,
    noInputAllocation: true,
    borrowedReadback: true,
    heroReadback: true,
    outside: 0,
    roundedCorner: 0,
    deterministic: true,
    changed: true,
    heroBytesPreserved: true,
    heroStillReadable: true,
    errors: [],
    diagnostics: [],
  });
  expect(result.interiorDifference).toBeLessThan(0.0003);
  expect(result.interiorAlpha).toBeCloseTo(0.6, 3);
  // Frame and schema buffers are the only per-panel buffers; no blur targets are allocated.
  expect(result.bufferBytes).toBeLessThan(1024);
});

async function attachPanels(page: Page) {
  await page.evaluate(
    async ({ paths, checkerCode }) => {
      const { fragmentEffect } = (await import(
        paths.core
      )) as typeof import('../../packages/core/src/index.ts');
      const { attach } = (await import(
        paths.dom
      )) as typeof import('../../packages/dom/src/index.ts');
      const { default: panelEffect } = (await import(paths.panel)) as {
        default: import('../../packages/core/src/index.ts').EffectDefinition;
      };
      const w = window as unknown as PanelWindow;
      const checker = fragmentEffect({
        id: 'checker-hero',
        title: 'Checker hero',
        params: {},
        wgsl: checkerCode,
        reducedMotion: { time: 0.25 },
      });
      w.hero = await attach(document.getElementById('hero')!, checker, {
        playing: false,
        adaptiveQuality: false,
        resolutionScale: 1,
      });
      w.panel = await attach(document.getElementById('panel')!, panelEffect, {
        playing: false,
        adaptiveQuality: false,
        resolutionScale: 1,
        params: { blur: 0, refraction: 0, intensity: 0 },
      });
      await w.panel.bindBackdrop(w.hero);
      w.hero.field!.session.scheduler.setHidden(true);
    },
    { paths, checkerCode },
  );
}

async function alignment(page: Page) {
  return page.evaluate(async (readback) => {
    const { readFieldLinear } = (await import(
      readback
    )) as typeof import('./fixtures/panel-readback.ts');
    const w = window as unknown as PanelWindow;
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    const hero = w.hero.field!,
      panel = w.panel.field!;
    hero.beforeFrame();
    panel.beforeFrame();
    hero.drawAt(0, 7);
    panel.drawAt(0, 7);
    hero.session.submit();
    if (!hero.output || !panel.output)
      throw new Error(
        JSON.stringify({
          hero: hero.state,
          panel: panel.state,
          session: hero.session.state,
          errors: hero.session.errors,
          diagnostics: panel.diagnostics,
        }),
      );
    const source = await readFieldLinear(hero);
    const target = await readFieldLinear(panel);
    const sourceBounds = hero.canvas.getBoundingClientRect();
    const targetBounds = panel.canvas.getBoundingClientRect();
    const cardBounds = w.panel.host.getBoundingClientRect();
    const sourceUV = (x: number, y: number) => [
      (targetBounds.left + ((x + 0.5) / target.width) * targetBounds.width - sourceBounds.left) /
        sourceBounds.width,
      (targetBounds.top + ((y + 0.5) / target.height) * targetBounds.height - sourceBounds.top) /
        sourceBounds.height,
    ];
    const sample = (u: number, v: number, channel: number) => {
      const x = u * source.width - 0.5,
        y = v * source.height - 0.5;
      const bx = Math.floor(x),
        by = Math.floor(y),
        fx = x - bx,
        fy = y - by;
      const at = (x: number, y: number) =>
        source.values[
          (Math.max(0, Math.min(source.height - 1, y)) * source.width +
            Math.max(0, Math.min(source.width - 1, x))) *
            4 +
            channel
        ]!;
      return (
        (at(bx, by) * (1 - fx) + at(bx + 1, by) * fx) * (1 - fy) +
        (at(bx, by + 1) * (1 - fx) + at(bx + 1, by + 1) * fx) * fy
      );
    };
    let physicalError = 0,
      checkerError = 0;
    for (let y = Math.ceil(target.height * 0.25); y < target.height * 0.75; y += 3)
      for (let x = Math.ceil(target.width * 0.25); x < target.width * 0.75; x += 3) {
        const [u, v] = sourceUV(x, y) as [number, number];
        const offset = (y * target.width + x) * 4;
        physicalError = Math.max(
          physicalError,
          (Math.abs(target.values[offset]! - sample(u, v, 0)) * source.width) / 0.24,
          (Math.abs(target.values[offset + 1]! - sample(u, v, 1)) * source.height) / 0.24,
        );
        checkerError = Math.max(
          checkerError,
          Math.abs(target.values[offset + 2]! - sample(u, v, 2)),
        );
      }
    return {
      physicalError,
      checkerError,
      sourceRect: panel.store.snapshot()['sourceRect'],
      expectedRect: [
        (cardBounds.left - sourceBounds.left) / sourceBounds.width,
        (cardBounds.top - sourceBounds.top) / sourceBounds.height,
        cardBounds.width / sourceBounds.width,
        cardBounds.height / sourceBounds.height,
      ],
      heroSize: [source.width, source.height],
      panelSize: [target.width, target.height],
      errors: [...hero.session.errors],
      borrowedIdentity: panel.inputTexture('image')!.texture === hero.output!.texture,
    };
  }, paths.readback);
}

test('Borrowed hero remains aligned within one physical pixel through drag, scroll and resize', async ({
  page,
}) => {
  await fixture(page);
  await attachPanels(page);
  const check = async () => {
    const result = await alignment(page);
    expect(result.physicalError).toBeLessThanOrEqual(1);
    expect(result.checkerError).toBeLessThan(0.001);
    (result.sourceRect as number[]).forEach((value, i) =>
      expect(value).toBeCloseTo(result.expectedRect[i]!, 6),
    );
    expect(result.errors).toEqual([]);
    expect(result.borrowedIdentity).toBe(true);
    return result;
  };
  const initial = await check();
  expect(initial.heroSize).toEqual(
    await page.evaluate(() => [320 * devicePixelRatio, 240 * devicePixelRatio]),
  );
  await page.locator('#panel').evaluate((node: HTMLElement) => {
    node.style.transform = 'translate(25.5px, 13.5px)';
  });
  const dragged = await check();
  expect(dragged.sourceRect).not.toEqual(initial.sourceRect);
  await page.evaluate(() => window.scrollTo(0, 70));
  await check();
  await page.locator('#scene').evaluate((node: HTMLElement) => {
    node.style.width = '400px';
    node.style.height = '280px';
  });
  const resized = await check();
  expect(resized.heroSize).not.toEqual(initial.heroSize);
  expect(resized.sourceRect).not.toEqual(dragged.sourceRect);
  await page.evaluate(() => (window as unknown as PanelWindow).panel.setPadding(8));
  const padded = await check();
  expect(padded.panelSize[0]).toBeGreaterThan(resized.panelSize[0]!);
  const css = await page.evaluate(() => {
    const panel = (window as unknown as PanelWindow).panel;
    panel.host.style.setProperty('--hgpu-brand', '#f08050');
    panel.host.style.setProperty('--hgpu-intensity', '0.3');
    panel.field!.beforeFrame();
    return panel.field!.store.snapshot();
  });
  expect(css['intensity']).toBe(0.3);
  expect(css['brand']).toBe('rgb(240, 128, 80)');
  const disposed = await page.evaluate(async (readback) => {
    const { readFieldLinear } = (await import(
      readback
    )) as typeof import('./fixtures/panel-readback.ts');
    const w = window as unknown as PanelWindow;
    const hero = w.hero.field!,
      panel = w.panel.field!,
      session = hero.session;
    const bytes = panel.memory().textureBytes;
    const clients = session.clients;
    w.hero.destroy();
    panel.drawAt(1, 7);
    const surviving = await readFieldLinear(panel);
    const result = {
      clients: session.clients,
      expectedClients: clients - 1,
      bytes: panel.memory().textureBytes,
      expectedBytes: bytes,
      borrowedReleased: panel.inputTexture('image') === undefined,
      targetStillReadable: surviving.values.some((value) => value > 0),
      errors: [...session.errors],
    };
    w.panel.destroy();
    return result;
  }, paths.readback);
  expect(disposed.clients).toBe(disposed.expectedClients);
  expect(disposed.bytes).toBe(disposed.expectedBytes);
  expect(disposed.borrowedReleased).toBe(true);
  expect(disposed.targetStillReadable).toBe(true);
  expect(disposed.errors).toEqual([]);
});

test('Panel inherits the hero frozen pose and restores its motion setting', async ({ page }) => {
  await fixture(page);
  await attachPanels(page);
  const result = await page.evaluate(async (readback) => {
    const { readFieldLinear } = (await import(
      readback
    )) as typeof import('./fixtures/panel-readback.ts');
    const w = window as unknown as PanelWindow;
    const hero = w.hero.field!,
      panel = w.panel.field!;
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    hero.play();
    hero.setReducedMotion(true);
    panel.beforeFrame();
    hero.render();
    panel.render();
    hero.session.submit();
    const first = await readFieldLinear(panel);
    hero.session.scheduler.setHidden(false);
    await new Promise((resolve) => setTimeout(resolve, 150));
    hero.session.scheduler.setHidden(true);
    panel.beforeFrame();
    hero.render();
    panel.render();
    hero.session.submit();
    const frozen = await readFieldLinear(panel);
    const reduced = {
      hero: hero.reducedMotion,
      panel: panel.reducedMotion,
      heroTime: hero.frame.time,
      same: first.values.every((value, i) => value === frozen.values[i]),
    };
    hero.setReducedMotion(false);
    panel.beforeFrame();
    const restored = {
      hero: hero.reducedMotion,
      panel: panel.reducedMotion,
      playing: hero.playing,
    };
    const errors = [...hero.session.errors];
    w.panel.destroy();
    w.hero.destroy();
    return { reduced, restored, errors };
  }, paths.readback);
  expect(result.reduced).toEqual({ hero: true, panel: true, heroTime: 0.25, same: true });
  expect(result.restored).toEqual({ hero: false, panel: false, playing: true });
  expect(result.errors).toEqual([]);
});

test('Panel glass fallback preserves real controls without a GPU or captured DOM image', async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(async ({ dom, panel }) => {
    const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
    const { default: effect } = (await import(panel)) as {
      default: import('../../packages/core/src/index.ts').EffectDefinition;
    };
    const host = document.getElementById('fallback')!;
    const button = host.querySelector('button')!;
    button.onclick = () => (button.textContent = 'Still interactive');
    (window as unknown as PanelWindow).fallback = await attach(host, effect, {
      forceFallback: true,
    });
  }, paths);
  await expect(page.locator('#fallback')).toHaveAttribute('data-hgpu-state', 'fallback');
  const result = await page.evaluate(() => {
    const attachment = (window as unknown as PanelWindow).fallback;
    const root = attachment.host.shadowRoot!;
    const shape = root.querySelector('.hgpu-card-fallback')!;
    const style = getComputedStyle(shape);
    return {
      noField: attachment.field === null,
      filter: style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter'),
      posterVisible: [...root.querySelectorAll('img')].some((image) => !image.hidden),
    };
  });
  expect(result.noField).toBe(true);
  expect(result.filter).toContain('blur(');
  expect(result.posterVisible).toBe(false);
  await page.locator('#fallback button').click();
  await expect(page.locator('#fallback button')).toHaveText('Still interactive');
  await page.evaluate(() => (window as unknown as PanelWindow).fallback.destroy());
  await expect(page.locator('#fallback button')).toHaveText('Still interactive');
});

test('Registered unset CSS tokens preserve fallback parameters and responsive card geometry', async ({
  page,
}) => {
  await fixture(page);
  // Register brand/intensity through a real attachment before forcing a second host to CSS.
  await attachPanels(page);
  const initial = await page.evaluate(async ({ dom, panel }) => {
    const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
    const { default: effect } = (await import(panel)) as {
      default: import('../../packages/core/src/index.ts').EffectDefinition;
    };
    const host = document.getElementById('fallback')!;
    host.style.width = '50vw';
    host.style.height = '15vh';
    const unsetBrand = getComputedStyle(host).getPropertyValue('--hgpu-brand').trim();
    const attachment = await attach(host, effect, {
      forceFallback: true,
      params: { brand: '#ff6600', blur: 0 },
    });
    (window as unknown as PanelWindow).fallback = attachment;
    const shape = host.shadowRoot!.querySelector<HTMLElement>('.hgpu-card-fallback')!;
    const style = getComputedStyle(shape);
    const swatch = document.createElement('canvas');
    swatch.width = swatch.height = 1;
    const paint = swatch.getContext('2d')!;
    paint.fillStyle = style.backgroundColor;
    paint.fillRect(0, 0, 1, 1);
    return {
      unsetBrand,
      rgba: Array.from(paint.getImageData(0, 0, 1, 1).data),
      filter: style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter'),
      width: shape.getBoundingClientRect().width,
      height: shape.getBoundingClientRect().height,
    };
  }, paths);
  expect(initial.unsetBrand).toBe('none');
  expect(initial.rgba[0]).toBeGreaterThan(240);
  expect(initial.rgba[1]).toBeGreaterThan(80);
  expect(initial.rgba[1]).toBeLessThan(120);
  expect(initial.rgba[2]).toBeLessThan(10);
  expect(initial.rgba[3]).toBeGreaterThan(0);
  expect(initial.filter).toBe('blur(0px)');
  await page.setViewportSize({ width: 800, height: 700 });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const attachment = (window as unknown as PanelWindow).fallback;
        const shape =
          attachment.host.shadowRoot!.querySelector<HTMLElement>('.hgpu-card-fallback')!;
        const hostBounds = attachment.host.getBoundingClientRect();
        const shapeBounds = shape.getBoundingClientRect();
        return {
          host: [hostBounds.width, hostBounds.height],
          shape: [shapeBounds.width, shapeBounds.height],
        };
      }),
    )
    .toEqual({ host: [400, 105], shape: [400, 105] });
  expect(initial.width).not.toBe(400);
  expect(initial.height).not.toBe(105);
  await page.evaluate(() => {
    const w = window as unknown as PanelWindow;
    w.fallback.destroy();
    w.panel.destroy();
    w.hero.destroy();
  });
});

test('Rejected backdrop replacement preserves the original source layout updater', async ({
  page,
}) => {
  await fixture(page);
  await attachPanels(page);
  const initial = await alignment(page);
  const failure = await page.evaluate(
    async ({ core, checkerCode }) => {
      const { createEffect, fragmentEffect } = (await import(
        core
      )) as typeof import('../../packages/core/src/index.ts');
      const w = window as unknown as PanelWindow;
      const replacement = await createEffect(
        document.querySelector('#checker')!,
        fragmentEffect({
          id: 'disposed-hero',
          title: 'Disposed replacement',
          params: {},
          wgsl: checkerCode,
        }),
        { playing: false },
      );
      replacement.destroy();
      let rejected = '';
      try {
        await w.panel.bindBackdrop(replacement);
      } catch (error) {
        rejected = String(error);
      }
      return {
        rejected,
        originalDependency: w.panel.field!.dependencies().includes(w.hero.field!),
        originalTexture:
          w.panel.field!.inputTexture('image')!.texture === w.hero.field!.output!.texture,
      };
    },
    { core: paths.core, checkerCode },
  );
  expect(failure.rejected).toContain('ready');
  expect(failure.originalDependency).toBe(true);
  expect(failure.originalTexture).toBe(true);
  await page.locator('#panel').evaluate((host: HTMLElement) => {
    host.style.transform = 'translate(19.5px, 7.5px)';
  });
  const moved = await alignment(page);
  expect(moved.sourceRect).not.toEqual(initial.sourceRect);
  (moved.sourceRect as number[]).forEach((value, i) =>
    expect(value).toBeCloseTo(moved.expectedRect[i]!, 6),
  );
  expect(moved.physicalError).toBeLessThanOrEqual(1);
  expect(moved.errors).toEqual([]);
  await page.evaluate(() => {
    const w = window as unknown as PanelWindow;
    w.panel.destroy();
    w.hero.destroy();
  });
});

test('A playing panel sleeps with its paused hero and wakes for fresh source output', async ({
  page,
}) => {
  await fixture(page);
  await attachPanels(page);
  const result = await page.evaluate(async () => {
    const w = window as unknown as PanelWindow;
    const hero = w.hero.field!,
      panel = w.panel.field!;
    panel.play();
    hero.session.scheduler.setHidden(false);
    // Let initial canvas observations and the first presentation settle before counting.
    await new Promise((resolve) => setTimeout(resolve, 300));
    let rendered = 0;
    const remove = panel.onRendered(() => rendered++);
    const startTime = panel.frame.time;
    await new Promise((resolve) => setTimeout(resolve, 250));
    const idle = {
      rendered,
      clockAdvanced: panel.frame.time > startTime,
      sourceTime: hero.frame.time,
    };
    hero.drawAt(0.75, 7);
    for (let i = 0; i < 20 && rendered === 0; i++) await new Promise(requestAnimationFrame);
    const wake = {
      rendered,
      borrowedVersion: panel.inputTexture('image')!.version,
      sourceVersion: hero.output!.version,
    };
    await new Promise((resolve) => setTimeout(resolve, 250));
    const settled = rendered;
    const errors = [...hero.session.errors];
    remove();
    w.panel.destroy();
    w.hero.destroy();
    return { idle, wake, settled, errors };
  });
  expect(result.idle).toEqual({ rendered: 0, clockAdvanced: true, sourceTime: 0 });
  expect(result.wake.rendered).toBeGreaterThan(0);
  expect(result.wake.borrowedVersion).toBe(result.wake.sourceVersion);
  expect(result.settled).toBe(result.wake.rendered);
  expect(result.errors).toEqual([]);
});
