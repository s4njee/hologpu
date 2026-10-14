import { test, expect, type Page } from '@playwright/test';
async function start(page: Page, id: string, params: Record<string, unknown> = {}) {
  await page.routeWebSocket(/.*/, (s) => s.close());
  await page.goto(
    '/?' +
      new URLSearchParams({
        effect: id,
        playing: 'false',
        quality: 'fixed',
        params: JSON.stringify(params),
      }),
  );
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready', { timeout: 30000 });
  await page.locator('#stage').evaluate((el: HTMLElement) => {
    el.style.width = '162px';
    el.style.height = '162px';
  });
  await expect
    .poll(() => page.evaluate(() => window.hologpu.field!.surface!.size[0]))
    .toBe(await page.evaluate(() => 160 * devicePixelRatio));
}
test('bundles equal direct draws at 1x/4x; visible/hidden occlusion query uses actual depth', async ({
  page,
}) => {
  await start(page, 'instances', { count: 64 });
  const result = await page.evaluate(async () => {
    const f = window.hologpu.field!,
      rows = [];
    for (const msaa of ['off', '4x']) {
      f.store.patch({ msaa, draw: 'direct' });
      f.drawAt(0.75, 7);
      const direct = Array.from((await f.readPixels()).pixels);
      f.params.draw = 'bundle';
      f.drawAt(0.75, 7);
      const bundled = Array.from((await f.readPixels()).pixels);
      const tap = f.bufferTaps.occlusion!,
        device = f.session.device,
        buffer = device.createBuffer({
          size: 16,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
      try {
        const encoder = device.createCommandEncoder();
        encoder.copyBufferToBuffer(tap.buffer, 0, buffer, 0, 16);
        device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);
        const query = Array.from(new BigUint64Array(buffer.getMappedRange()), (v) => Number(v));
        rows.push({ equal: JSON.stringify(direct) === JSON.stringify(bundled), query });
      } finally {
        buffer.destroy();
      }
    }
    return { rows, errors: f.session.errors };
  });
  expect(result.errors).toEqual([]);
  for (const row of result.rows) {
    expect(row.equal).toBe(true);
    expect(row.query[0]).toBeGreaterThan(0);
    expect(row.query[1]).toBe(0);
  }
});
test('cube source matches analytic radiance on all faces; GGX mips conserve constant alpha and broaden highlights', async ({
  page,
}) => {
  await start(page, 'material-ball');
  const result = await page.evaluate(async () => {
    const f = window.hologpu.field!;
    f.advance(0);
    const faces = [],
      mips = [];
    for (let face = 0; face < 6; face++) {
      const raw = await f.readTap(`environment-face-${face}`);
      faces.push({ width: raw.width, values: Array.from(raw.values) });
      const levels = [];
      for (let mip = 0; mip < 7; mip++) {
        const r = await f.readTap(`specular-${face}-mip-${mip}`);
        let max = 0,
          alphaError = 0;
        for (let i = 0; i < r.values.length; i += 4) {
          max = Math.max(max, r.values[i]!, r.values[i + 1]!, r.values[i + 2]!);
          alphaError = Math.max(alphaError, Math.abs(r.values[i + 3]! - 1));
        }
        levels.push({ width: r.width, max, alphaError });
      }
      mips.push(levels);
    }
    return { faces, mips, errors: f.session.errors };
  });
  expect(result.errors).toEqual([]);
  const normalize = (v: number[]) => {
      const len = Math.hypot(...v);
      return v.map((x) => x / len);
    },
    dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0),
    smooth = (a: number, b: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
  for (let face = 0; face < 6; face++) {
    const r = result.faces[face]!;
    for (const [x, y] of [
      [0, 0],
      [31, 31],
      [63, 63],
      [11, 45],
    ]) {
      const u = ((x! + 0.5) / r.width) * 2 - 1,
        v = ((y! + 0.5) / r.width) * 2 - 1,
        d = normalize(
          [
            [1, -v, -u],
            [-1, -v, u],
            [u, 1, v],
            [u, -1, -v],
            [u, -v, 1],
            [-u, -v, -1],
          ][face]!,
        );
      const mix = smooth(-0.2, 1, d[1]!);
      const warm = Math.max(0, dot(d, normalize([-0.7, 0.6, 0.4]))) ** 80,
        cool = Math.max(0, dot(d, normalize([0.8, 0.2, -0.6]))) ** 45,
        strip = Math.exp(-(((d[1]! - 0.45) * 20) ** 2)) * smooth(0.7, 0.85, d[2]!);
      const expected = [0.025, 0.035, 0.055].map(
        (base, k) =>
          base * (1 - mix) +
          [0.25, 0.38, 0.58][k]! * mix +
          [8, 5.4, 3][k]! * warm +
          [1.5, 3, 6][k]! * cool +
          3 * strip,
      );
      expected.forEach((e, k) => expect(r.values[(y! * r.width + x!) * 4 + k]).toBeCloseTo(e, 2));
    }
  }
  for (const levels of result.mips) {
    expect(levels.map((l) => l.width)).toEqual([64, 32, 16, 8, 4, 2, 1]);
    levels.forEach((l) => {
      expect(l.alphaError).toBe(0);
      expect(Number.isFinite(l.max)).toBe(true);
    });
  }
  expect(Math.max(...result.mips.map((l) => l[6]!.max))).toBeLessThan(
    Math.max(...result.mips.map((l) => l[0]!.max)),
  );
});
test('glass IOR=1/absorption=0 reproduces capture; dispersion changes RGB through a mesh', async ({
  page,
}) => {
  await start(page, 'glass', { ior: 1, dispersion: 0, absorption: 0 });
  const result = await page.evaluate(async () => {
    const f = window.hologpu.field!;
    f.drawAt(0, 7);
    const capture = await f.readTap('sceneCapture'),
      glass = await f.readTap('glassLayer');
    let maxError = 0,
      covered = 0;
    for (let i = 0; i < glass.values.length; i += 4)
      if (glass.values[i + 3] === 1) {
        covered++;
        for (let c = 0; c < 3; c++)
          maxError = Math.max(maxError, Math.abs(glass.values[i + c]! - capture.values[i + c]!));
      }
    f.store.patch({ ior: 1.9, dispersion: 0 });
    f.drawAt(0, 7);
    const a = Array.from((await f.readPixels()).pixels);
    f.params.dispersion = 0.15;
    f.drawAt(0, 7);
    const b = Array.from((await f.readPixels()).pixels);
    return {
      covered,
      maxError,
      changed: a.filter((v, i) => v !== b[i]).length,
      errors: f.session.errors,
    };
  });
  expect(result.errors).toEqual([]);
  expect(result.covered).toBeGreaterThan(100);
  expect(result.maxError).toBeLessThan(0.002);
  expect(result.changed).toBeGreaterThan(10);
});

test('opt-in HDR canvas presents a real bloom output with extended tone mapping and P3', async ({
  page,
}, info) => {
  await start(page, 'bloom');
  const result = await page.evaluate(async () => {
    const { createHDRCanvas } = window.hologpu;
    const f = window.hologpu.field!,
      canvas = document.createElement('canvas');
    canvas.width = f.surface!.size[0];
    canvas.height = f.surface!.size[1];
    document.body.append(canvas);
    let hdr: Awaited<ReturnType<typeof createHDRCanvas>> | undefined;
    try {
      hdr = await createHDRCanvas(f.session, canvas);
      f.drawAt(0, 7);
      const encoder = f.session.device.createCommandEncoder();
      hdr.draw(encoder, f.output!);
      f.session.device.queue.submit([encoder.finish()]);
      await f.session.device.queue.onSubmittedWorkDone();
      // Check the canvas transfer function and extended range through actual GPU readback.
      const fixture = f.session.device.createTexture({
        size: [canvas.width, canvas.height],
        format: 'rgba16float',
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });
      const staging = f.session.device.createBuffer({
        size: 256,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      let encoded: number[] = [];
      try {
        f.session.device.queue.writeTexture(
          { texture: fixture },
          new Uint16Array([0x3400, 0x4000, 0x4400, 0x3c00]),
          { bytesPerRow: 8 },
          [1, 1],
        );
        const commands = f.session.device.createCommandEncoder();
        const output = hdr.draw(commands, {
          texture: fixture,
          format: 'rgba16float',
          width: canvas.width,
          height: canvas.height,
          kind: 'float',
        });
        commands.copyTextureToBuffer(
          { texture: output },
          { buffer: staging, bytesPerRow: 256 },
          [1, 1],
        );
        f.session.device.queue.submit([commands.finish()]);
        await staging.mapAsync(GPUMapMode.READ);
        encoded = Array.from(new Uint16Array(staging.getMappedRange()).slice(0, 4), (bits) => {
          const exponent = (bits >>> 10) & 31,
            fraction = bits & 1023;
          return exponent === 0
            ? (2 ** -14 * fraction) / 1024
            : 2 ** (exponent - 15) * (1 + fraction / 1024);
        });
      } finally {
        fixture.destroy();
        staging.destroy();
      }
      return {
        supported: true,
        format: hdr.configuration.format,
        encoded,
        tone: hdr.configuration.toneMapping?.mode,
        colorSpace: hdr.configuration.colorSpace,
        errors: f.session.errors,
      };
    } catch (error) {
      return { supported: false, reason: String(error) };
    } finally {
      hdr?.dispose();
      canvas.remove();
    }
  });
  if (info.project.name === 'firefox-hardware') {
    expect(result.supported).toBe(false);
    expect(result.reason).toMatch(/rgba16float|not supported/i);
    return;
  }
  expect(result.supported, result.reason).toBe(true);
  expect(result.format).toBe('rgba16float');
  expect(result.tone).toBe('extended');
  expect(result.colorSpace).toBe('display-p3');
  const linear = [
    0.82259287 * 0.25 + 0.17753395 * 2,
    0.03319951 * 0.25 + 0.9667835 * 2,
    0.01708535 * 0.25 + 0.07239572 * 2 + 0.91030148 * 4,
  ];
  linear.forEach((value, i) =>
    expect(result.encoded![i]).toBeCloseTo(
      value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055,
      2,
    ),
  );
  expect(result.encoded![2]).toBeGreaterThan(1);
  expect(result.errors).toEqual([]);
});

test('terrain r32float remap matches CPU smoothstep and invalidates on parameter and seed changes', async ({
  page,
}) => {
  await start(page, 'terrain', { segments: 16, height: 1, sculpt: 0 });
  const result = await page.evaluate(async () => {
    const f = window.hologpu.field!;
    f.drawAt(0, 7);
    const raw = Array.from((await f.readTap('heightField')).values);
    f.params.sculpt = 1;
    f.drawAt(0, 7);
    const sculpted = Array.from((await f.readTap('heightField')).values);
    f.params.height = 2;
    f.drawAt(0, 7);
    const scaled = Array.from((await f.readTap('heightField')).values);
    f.drawAt(0, 13);
    const reseeded = Array.from((await f.readTap('heightField')).values);
    return {
      raw,
      sculpted,
      scaled,
      reseeded,
      readWrite: !!navigator.gpu.wgslLanguageFeatures?.has(
        'readonly_and_readwrite_storage_textures',
      ),
      hasReadWriteSource: Object.values(f.sources).some((s) =>
        s.code.includes('texture_storage_2d<r32float,read_write>'),
      ),
      errors: f.session.errors,
    };
  });
  expect(result.errors).toEqual([]);
  expect(result.raw).toHaveLength(17 * 17);
  expect(result.hasReadWriteSource).toBe(result.readWrite);
  result.raw.forEach((h, i) => {
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(1);
    expect(result.sculpted[i]).toBeCloseTo(h * h * (3 - 2 * h), 5);
    expect(result.scaled[i]).toBeCloseTo(result.sculpted[i]! * 2, 5);
  });
  expect(result.reseeded).not.toEqual(result.scaled);
});
