import { chromium, firefox, webkit } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const results = [];
for (const [name, engine, options] of [
  ['chrome', chromium, { channel: 'chrome' }],
  ['firefox', firefox, { headless: false }],
  ['webkit', webkit, {}],
]) {
  const browser = await engine.launch(options);
  try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:5175/?count=1');
    await page.locator('#status[data-state="ready"]').waitFor();
    const probes = await page.evaluate(async () => {
      let compatibility;
      try {
        const adapter = await navigator.gpu.requestAdapter({ featureLevel: 'compatibility' });
        if (adapter) {
          const device = await adapter.requestDevice();
          compatibility = {
            adapterReturned: true,
            coreFeatureAvailable: adapter.features.has('core-features-and-limits'),
            coreFeatureEnabled: device.features.has('core-features-and-limits'),
            maxColorAttachments: device.limits.maxColorAttachments,
            maxStorageBuffersPerShaderStage: device.limits.maxStorageBuffersPerShaderStage,
          };
          device.destroy();
        } else compatibility = { adapterReturned: false };
      } catch (error) {
        compatibility = { error: String(error) };
      }
      return {
        capabilities: window.m0.report,
        canvas: await window.m0.probeCanvas(),
        pressureObserverPresent: 'PressureObserver' in globalThis,
        htmlInCanvas: {
          copyElementImageToTexture: 'copyElementImageToTexture' in window.m0.device.queue,
          drawElementImageToTexture: 'drawElementImageToTexture' in window.m0.device.queue,
          layoutsubtree: 'layoutsubtree' in HTMLCanvasElement.prototype,
        },
        compatibility,
        wgslLanguageFeatures: [...navigator.gpu.wgslLanguageFeatures],
      };
    });
    results.push({ browser: name, version: browser.version(), ...probes });
  } finally {
    await browser.close();
  }
}
await writeFile(
  'docs/benchmarks/m0-probes.json',
  JSON.stringify({ recordedOn: '2026-10-07', results }, null, 2) + '\n',
);
console.log('Saved docs/benchmarks/m0-probes.json');
