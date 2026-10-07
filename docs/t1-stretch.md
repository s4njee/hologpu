# Family A T1 stretch validation

The three Family A stretches extend the frozen T1 contract without runtime or playground changes. Catalogue discovery supplies individual public exports, generated controls, presets, composed Source and research Notes. All nine Family A effects are now implemented; the other M7 families remain outstanding.

## Techniques

| Effect                          | Research technique                                                                                                                               | Scope and limits                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Truchet](notes/truchet.md)     | Signed cell coordinates, integer hashes and bit operations select square and hex arc motifs; five/eight plane waves form quasiperiodic contours. | Quasi-crystal mode is an interference illustration with no Penrose topology or matching rules. Derivative smoothing estimates local coverage.                                 |
| [Caustics](notes/caustics.md)   | Eight analytic water waves drive refraction; fragment derivatives estimate a normalized projected-map Jacobian.                                  | Bounded source-coordinate focusing proxy, without receiver inversion, branch accumulation or energy conservation.                                                             |
| [Starfield](notes/starfield.md) | Stable world-cell hashes, bounded 3×3 neighbourhoods, continuous parallax/twinkle and domain-warped noise.                                       | Folded hashing avoids the tested XOR symmetry; this is not a statistical RNG certification. Pixel coverage is approximate and the shared nebula hash retains its limitations. |

Each effect has two presets, schema ranges/groups/descriptions, declared inputs/features/quality, a reduced-motion time-zero pose and a CSS fallback. Each uses one `rgba16float` target and the shared SDR resolve; destruction releases the target, buffers and resource leases. None requires optional adapter features or persistent simulation state.

## Verification

Recorded 2026-10-07. Eighteen new software snapshots cover the default and both presets at DPR 1 and 2. Tests compile every enum path without warnings, read deterministic pixels at fixed time/seed, and verify disposal. Additional probes check continuous motion and identical zero-speed frames for all three effects; the starfield probe also disables twinkle for the static comparison.

Flat water and zero receiver depth both produce the unit-Jacobian diagnostic colour, within one SDR code value. A compute probe calls the actual composed star hash over 64 signed diagonal coordinates and compares every result to a CPU unsigned-integer reference. Folded mode produces 64 distinct keys; seed-zero XOR mode produces one. These bounded probes establish those cases, without guaranteeing all parameter combinations or general hash quality.

The new-effect suite passes 16 tests on SwiftShader across DPR 1/2 and 16 tests on Chrome/Metal and Playwright WebKit/Apple. Native Safari/Firefox whole-catalogue passes and additional device classes remain M8 work. Software snapshots establish repeatability, not hardware performance.

## Measurements

The [Chrome record](benchmarks/m1-stretch-chrome.json) and [WebKit record](benchmarks/m1-stretch-webkit.json) preserve three runs per effect at defaults, seed 7 and 512×320 physical pixels, DPR 1. Each run discards 30 warm-up frames and measures 120 explicit encode/submits at a fixed 1/60 s clock inside rAF. A production preview avoids development reloads. The research notes include generated per-effect rows linked to these records.

CPU encoding/submission and rAF cadence exclude GPU execution time. Timestamp timing remains deferred to M3. Device state and load are uncontrolled. Logical target allocation is 1,310,720 bytes per field plus uniform buffers, not driver VRAM. Earlier six-effect M1 records are retained separately.

## Completion checks

- `pnpm check` passes: formatting, workspace/test types, 15 unit tests, the 19-line discovery criterion, package/static builds and all 54 SwiftShader browser tests.
- Chrome/Metal and Playwright WebKit/Apple pass all 16 new-effect tests; the six caustics checks were repeated after tuning its defaults and presets.
- Visual inspection at 768×512 covers square, hex and quasi-crystal contours, focused caustic folds and the star/nebula field, with no shader diagnostics or page errors.
- All three individual `@mk7s/hologpu/effects/<id>` imports resolve from the built facade, retain `core: false` and expose two presets.
- Both final hardware records contain nine runs with no GPU errors. All caustics rows match the tuned defaults.
- Production preview smoke verifies all three effects, generated controls/presets, composed Source, two rendered note tables and downloadable JSON links returning HTTP 200. Each linked record contains three matching-parameter runs for the selected effect.
- `git diff --check` passes. Changes are recorded in a local checkpoint; remote hosting and registry publication remain unconfigured.
