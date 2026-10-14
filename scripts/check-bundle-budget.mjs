#!/usr/bin/env node
// M4 story 4.8: enforce the JS gzip budget for every public entry.
//
//   pnpm bundle:size && node scripts/check-bundle-budget.mjs
//   node scripts/check-bundle-budget.mjs --update   # rewrite the budget from current numbers
//
// The budget is the committed `bundle-budget.json`. Every entry in
// `docs/benchmarks/bundle-size.json` must have a ceiling and stay under it; a new effect with no
// ceiling fails until the maintainer runs `--update` (which sets the ceiling to the measured size
// plus a little headroom). Assets (posters) are reported by `bundle:size` but not budgeted here.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const reportIndex = process.argv.indexOf('--report');
const reportPath =
  reportIndex >= 0
    ? path.resolve(process.argv[reportIndex + 1])
    : path.join(root, 'docs/benchmarks/bundle-size.json');
const budgetPath = path.join(root, 'bundle-budget.json');
const update = process.argv.includes('--update');
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

if (!existsSync(reportPath)) {
  console.error(`Missing ${path.relative(root, reportPath)}. Run \`pnpm bundle:size\` first.`);
  process.exit(1);
}
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const headroomBytes = 1536;
const limitFor = (bytes) => Math.ceil((bytes + headroomBytes) / 1024) * 1024;

if (update) {
  const entries = {};
  for (const row of [...report.entries].sort((a, b) => a.id.localeCompare(b.id)))
    entries[row.id] = limitFor(row.jsGzipBytes);
  writeFileSync(
    budgetPath,
    JSON.stringify(
      {
        $comment:
          'JS gzip ceilings per public entry, from docs/benchmarks/bundle-size.json. Regenerate with `pnpm bundle:size && node scripts/check-bundle-budget.mjs --update`.',
        headroomBytes,
        entries,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Wrote ${path.relative(root, budgetPath)} for ${report.entries.length} entries.`);
  process.exit(0);
}

const budget = JSON.parse(readFileSync(budgetPath, 'utf8'));
const over = [];
const missing = [];
for (const row of report.entries) {
  const limit = budget.entries[row.id];
  if (!limit) {
    missing.push(row.id);
    continue;
  }
  if (row.jsGzipBytes > limit) over.push(`${row.id}: ${kb(row.jsGzipBytes)} > ${kb(limit)} budget`);
}
const stale = Object.keys(budget.entries).filter(
  (id) => !report.entries.some((row) => row.id === id),
);

if (over.length || missing.length || stale.length) {
  if (over.length) console.error(`Over budget:\n  ${over.join('\n  ')}`);
  if (missing.length)
    console.error(`No budget (add a ceiling in bundle-budget.json):\n  ${missing.join('\n  ')}`);
  if (stale.length)
    console.error(`Budget for an entry that no longer exists:\n  ${stale.join('\n  ')}`);
  process.exit(1);
}
console.log(`Bundle budgets pass for ${report.entries.length} entries.`);
