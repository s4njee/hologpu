# Firefox submission policy

The shared scheduler supports a bounded number of outstanding completion notifications through `session.scheduler.setSubmissionLimit(1…8)`. Queue completion notification latency and GPU execution time measure different boundaries. A slow notification can hold a healthy animation at a low cadence even when encoding and shader execution are cheap.

Run `node scripts/benchmark-firefox-submissions.mjs` against the development server at `http://127.0.0.1:5175` (`HOLOGPU_URL` overrides it). This host needs headed Firefox for its WebGPU adapter; a graphical session is required. `HOLOGPU_HEADLESS=1` is an explicit alternate environment, recorded in the output. Run GPU captures sequentially, with no other tests or builds from this task in progress.

The comparison uses six real T1 attachments: three `dot-matrix-field` and three `constellation` instances. Every host is 400×240 CSS pixels, completely above the fold, with DPR 1, resolution scale 1, fixed quality, seed 7 and native copy. Each of three captures alternates the bound order (1/8, 8/1, 1/8), warms up for 30 actual scheduler submissions, and measures 120 completed submissions.

The harness observes the production scheduler. It neither forces individual draws nor waits for each completion during capture, and it leaves the timestamp profiler disabled. [The raw report](benchmarks/firefox-submissions.json) records submitted and completed cadence, notified callback latency, encoding/submission cost, bounded pending notifications, renderer errors, actual field geometry and six post-capture pixel checks. Completed callbacks may arrive together; callback intervals and submission intervals are both retained. Observed pending notifications are not a measurement of physical GPU queue occupancy.

The recorded comparison on this Apple M1 Max Mac / Firefox 155 supports automatic bounded pipelining for T1-only sessions:

| Bound | Completed frames/sec, three captures | Notification p95   | Peak pending notifications |
| ----- | ------------------------------------ | ------------------ | -------------------------- |
| 1     | 9.56 / 9.65 / 9.65                   | 106 / 105 / 106 ms | 1                          |
| 8     | 118.41 / 121.55 / 122.18             | 12 / 12 / 14 ms    | 2 / 3 / 3                  |

All captures drained their pending work, produced non-empty pixels on all six fields, and recorded no GPU or page errors. The idle RAF cadence was approximately 120 Hz. This is a completion-notification pacing finding; it does not establish a shader execution-time improvement or guarantee these rates on other hardware.

The device scheduler now defaults to a maximum of eight outstanding notifications in native Firefox when **every registered surface and its dependency closure explicitly declare T1 pipelining**. `EffectField` declares it only for T1 definitions. Adding any T2–T5 or unknown surface returns the automatic bound to one and waits for already-issued work to drain before issuing the next batch. Chrome, Safari, WebKit, iOS Firefox (which uses WebKit), and unknown engines keep one. Existing `setSubmissionLimit(1…8)` calls override the automatic decision and remain bounded; this preserves the deliberate fluid/rain demo settings.

Mock-queue tests cover eight outstanding batches, joining a serial surface, conservative unknown surfaces, explicit overrides, invalid bounds, stale device completions and cleanup. Native browser checks validate the actual runtime separately. The physical Android and Intel-GPU matrix remains open; the measured Mac result is not presented as coverage for those devices.
