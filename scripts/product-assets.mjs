import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Original vector fixtures. Depth silhouettes use the exact product coordinates.
const root = resolve(import.meta.dirname, '..');
const destination = resolve(root, 'apps/playground/public/media/products');
await mkdir(destination, { recursive: true });
const svg = (body, width = 1200, height = 800) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
const definitions = `<defs>
  <linearGradient id="body" x2=".8" y2="1"><stop stop-color="#526063"/><stop offset="1" stop-color="#202a2b"/></linearGradient>
  <linearGradient id="back" x2="1" y2="1"><stop stop-color="#d6ded9"/><stop offset="1" stop-color="#a8bcb0"/></linearGradient>
  <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="24" stdDeviation="18" flood-color="#192f28" flood-opacity=".22"/></filter>
</defs>`;
const knobs = Array.from({ length: 6 }, (_, i) => {
  const x = 355 + i * 97;
  return `<circle cx="${x}" cy="499" r="28" fill="#152021"/><circle cx="${x}" cy="496" r="24" fill="#687673"/><path d="M ${x} 476 v12" stroke="#dae5dc" stroke-width="3" stroke-linecap="round"/>`;
}).join('');
const consoleShape = `<rect x="262" y="220" width="676" height="364" rx="34"/>`;
const consoleProduct = `<g filter="url(#shadow)">
  <rect x="262" y="220" width="676" height="364" rx="34" fill="url(#body)" stroke="#ffffff" stroke-opacity=".32" stroke-width="2"/>
  <rect x="296" y="256" width="608" height="168" rx="16" fill="#102323"/>
  <g fill="#9fcca9" font-family="Arial,sans-serif"><text x="323" y="294" font-size="15" letter-spacing="4">SIGNAL / 01</text><text x="323" y="387" font-size="44">Stay in flow.</text></g>
  <path d="M 663 342 q 24 -55 48 0 t48 0 t48 0 t48 0" fill="none" stroke="#c9f0c0" stroke-width="3"/>
  ${knobs}<g fill="#b6c5bd" font-family="Arial,sans-serif" font-size="11" letter-spacing="2"><text x="326" y="551">INPUT</text><text x="820" y="551">OUTPUT</text></g>
</g>`;
const moduleShapes = [
  { x: 235, y: 360, w: 720, h: 174, depth: 140, label: 'BASE / ROUTER' },
  { x: 320, y: 272, w: 580, h: 162, depth: 195, label: 'CORE / COMPUTE' },
  { x: 406, y: 195, w: 410, h: 138, depth: 245, label: 'LINK / CONNECT' },
];
const modules = moduleShapes
  .map(
    (s, n) => `<g filter="url(#shadow)">
  <rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="24" fill="${['#354a48', '#51706b', '#80928a'][n]}" stroke="#ffffff" stroke-opacity=".3" stroke-width="2"/>
  <text x="${s.x + 32}" y="${s.y + 48}" fill="#e4eee5" font-family="Arial,sans-serif" font-size="14" letter-spacing="3">${s.label}</text>
  ${Array.from({ length: 4 }, (_, i) => `<rect x="${s.x + 32 + i * 47}" y="${s.y + 78}" width="28" height="15" rx="5" fill="#162928"/>`).join('')}
  <circle cx="${s.x + s.w - 42}" cy="${s.y + 43}" r="5" fill="#ddf4bc"/>
</g>`,
  )
  .join('');
const screenshot = `<rect width="1200" height="750" rx="24" fill="#11191c"/>
  <rect x="1" y="1" width="1198" height="748" rx="23" fill="none" stroke="#627478" stroke-opacity=".4"/>
  <path d="M 220 0 v750 M 220 84 H1200" stroke="#ffffff" stroke-opacity=".08"/>
  <g font-family="Arial,sans-serif" fill="#d9e7e3">
    <text x="32" y="52" font-size="24" letter-spacing="4">SIGNAL</text>
    <text x="32" y="150" font-size="14" fill="#b7d9c0">Overview</text><text x="32" y="206" font-size="14" fill="#6f8784">Activity</text><text x="32" y="262" font-size="14" fill="#6f8784">Connections</text><text x="32" y="318" font-size="14" fill="#6f8784">Settings</text>
    <text x="260" y="51" font-size="16">Workspace / Overview</text><text x="260" y="141" font-size="26">Everything, connected.</text><text x="260" y="174" font-size="14" fill="#6f8784">A quiet view of your team's daily rhythm.</text>
    ${['Uptime', 'Events today', 'Latency'].map((label, i) => `<rect x="${260 + i * 302}" y="207" width="278" height="125" rx="14" fill="#1a282b"/><text x="${282 + i * 302}" y="242" font-size="13" fill="#8da8a1">${label}</text><text x="${282 + i * 302}" y="293" font-size="32">${['99.98%', '24,680', '18 ms'][i]}</text>`).join('')}
    <rect x="260" y="360" width="882" height="302" rx="16" fill="#182428"/><text x="286" y="402" font-size="16">Throughput</text><text x="1036" y="402" font-size="12" fill="#8da8a1">Last 24h</text>
    <path d="M 286 464 H1114 M286 520 H1114 M286 576 H1114" stroke="#354549" stroke-width="1"/>
    <path d="M286 582 L340 573 L389 546 L448 552 L500 520 L555 530 L616 489 L680 501 L739 470 L806 486 L870 451 L938 462 L1000 427 L1058 441 L1114 413" fill="none" stroke="#b7f0bc" stroke-width="4" stroke-linecap="round"/>
    <text x="286" y="630" font-size="12" fill="#6f8784">00:00</text><text x="1047" y="630" font-size="12" fill="#6f8784">23:59</text>
  </g>`;
const assets = {
  console: svg(
    `${definitions}<rect width="1200" height="800" fill="url(#back)"/>${consoleProduct}`,
  ),
  'console-depth': svg(
    `<rect width="1200" height="800" fill="black"/><g fill="#dadada">${consoleShape}</g><rect x="296" y="256" width="608" height="168" rx="16" fill="#ededed"/>${Array.from({ length: 6 }, (_, i) => `<circle cx="${355 + i * 97}" cy="499" r="28" fill="white"/>`).join('')}`,
  ),
  'console-cutout': svg(`${definitions}${consoleProduct}`),
  modules: svg(`${definitions}<rect width="1200" height="800" fill="url(#back)"/>${modules}`),
  'modules-depth': svg(
    `<rect width="1200" height="800" fill="black"/>${moduleShapes.map((s) => `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="24" fill="rgb(${s.depth} ${s.depth} ${s.depth})"/>`).join('')}`,
  ),
  screenshot: svg(screenshot, 1200, 750),
};
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  for (const [name, source] of Object.entries(assets)) {
    await writeFile(resolve(destination, `${name}.svg`), source);
    const png = await page.evaluate(async (source) => {
      const image = new Image();
      image.src = 'data:image/svg+xml;base64,' + btoa(source);
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext('2d').drawImage(image, 0, 0);
      return canvas.toDataURL('image/png').split(',')[1];
    }, source);
    await writeFile(resolve(destination, `${name}.png`), Buffer.from(png, 'base64'));
  }
} finally {
  await browser.close();
}
console.log('Generated six original product, depth and screenshot assets.');
