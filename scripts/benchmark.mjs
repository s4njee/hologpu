import { chromium, firefox, webkit } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { platform, arch, release } from 'node:os';

const name = process.argv[2] ?? 'chrome';
const engines = { chrome: chromium, firefox, webkit, swiftshader: chromium };
if (!engines[name]) throw new Error('Expected chrome, firefox, webkit, or swiftshader.');
const browser = await engines[name].launch({
  ...(name === 'chrome' ? { channel: 'chrome' } : {}),
  ...(name === 'swiftshader'
    ? { args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader'] }
    : {}),
  headless: !process.argv.includes('--headed'),
});
const results = [];
try {
  for (const scenario of [
    { count: 1, mode: 'float' },
    { count: 6, mode: 'float' },
    { count: 6, mode: 'direct' },
  ]) {
    const page = await browser.newPage({
      viewport: { width: 1200, height: 900 },
      deviceScaleFactor: 2,
    });
    await page.goto(`http://127.0.0.1:5175/m0.html?count=${scenario.count}&mode=${scenario.mode}`);
    await page.locator('#status[data-state="ready"]').waitFor();
    const canvasProbe = await page.evaluate(() => window.m0.probeCanvas());
    for (let run = 1; run <= 3; run++) {
      const result = await page.evaluate(() => window.m0.benchmark(180, 30, true));
      if (result.errors.length) throw new Error(result.errors.join('\n'));
      results.push({ scenario, run, canvasProbe, ...result });
      console.log(
        `${name} ${scenario.count} ${scenario.mode} run ${run}: CPU ${result.cpuEncodeMs.mean.toFixed(3)}ms; rAF ${result.rafIntervalMs.mean.toFixed(3)}ms`,
      );
    }
    await page.close();
  }
  const record = {
    recordedOn: '2026-10-07',
    environment: {
      platform: platform(),
      arch: arch(),
      release: release(),
      browser: name,
      browserVersion: browser.version(),
      headless: !process.argv.includes('--headed'),
      softwareAdapter: name === 'swiftshader',
    },
    results,
  };
  await mkdir('docs/benchmarks', { recursive: true });
  const path = `docs/benchmarks/m0-${name}.json`;
  await writeFile(path, JSON.stringify(record, null, 2) + '\n');
  console.log(`Saved ${path}`);
} finally {
  await browser.close();
}
