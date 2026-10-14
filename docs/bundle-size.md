# Public entry sizes

Run `node scripts/bundle-size.mjs` to regenerate [the bundle-size report](benchmarks/bundle-size.json). The tool uses the existing Vite dependency, builds in memory, and does not regenerate catalogue sources or change the application distribution. Run it outside GPU capture windows.

The report includes the core runtime, the DOM runtime and every exported `@mk7s/hologpu/effects/<id>` entry. Each independent browser ESM bundle retains all public exports, includes its transitive dependencies and shader strings, targets ES2022, uses Vite production minification, and compresses with gzip level 9. It reports emitted posters and other assets separately. These are complete entry footprints; a consumer that imports fewer exports may be smaller.

The final section 4 capture has 78 effect entries. Core is 39,292 gzip bytes, the DOM runtime is 32,391, and effect entries range from 6,596 to 15,450. The DOM runtime is smaller than the complete core entry because bundling removes unused core exports. Shared dependencies overlap between independent rows, so adding these numbers does not predict a real page's network transfer.

An additional `dom-with-catalogue-resolver` row measures the `@mk7s/hologpu/dom` convenience entry with its entire lazy effect-loader graph inlined. Its 152,317 gzip bytes describe that complete graph. Normal production builds retain lazy splitting, so loading that DOM entry does not transfer every effect upfront. The plain DOM runtime avoids that catalogue resolver and lets an author supply only the effects they use.
