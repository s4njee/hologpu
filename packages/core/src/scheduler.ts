export interface Clock {
  request(callback: (time: number) => void): number;
  cancel(id: number): void;
  now(): number;
}
export interface Tick {
  time: number;
  delta: number;
  index: number;
}
export interface SchedulerOptions {
  /** Default bound for a device containing only stateless pipelined surfaces. */
  pipelinedSubmissionLimit?: number;
}
export interface ScheduledSurface {
  readonly submissionPipelining?: boolean;
  visible: boolean;
  playing: boolean;
  dirty: boolean;
  polling?: boolean;
  beforeFrame?(): void;
  shouldRender?(): boolean;
  update(frame: Tick): void;
  render(frame: Tick): void;
  dependencies?(): readonly ScheduledSurface[];
  frameCompleted?(stats: { cpuMs: number; intervalMs: number }): void;
}
const browserClock: Clock = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (id) => cancelAnimationFrame(id),
  now: () => performance.now(),
};
/** One scheduler per device session. Fixed steps are bounded to avoid a catch-up spiral. */
export class Scheduler {
  readonly #clock: Clock;
  readonly #surfaces = new Set<ScheduledSurface>();
  readonly #submit: () => void;
  readonly #completion: (() => Promise<void>) | undefined;
  #submissions = new Set<object>();
  #submissionLimit: number | null = null;
  readonly #pipelinedSubmissionLimit: number;
  #resumeAfterWait = false;
  #raf = 0;
  #previous: number | null = null;
  #accumulator = 0;
  #time = 0;
  #index = 0;
  #hidden = false;
  cpuFrameMs = 0;
  constructor(
    submit: () => void,
    clock: Clock = browserClock,
    completion?: () => Promise<void>,
    options: SchedulerOptions = {},
  ) {
    const limit = options.pipelinedSubmissionLimit ?? 1;
    if (!Number.isInteger(limit) || limit < 1 || limit > 8)
      throw new RangeError('Pipelined submission limit must be an integer from 1 to 8');
    this.#pipelinedSubmissionLimit = limit;
    this.#submit = submit;
    this.#clock = clock;
    this.#completion = completion;
  }
  add(surface: ScheduledSurface) {
    this.#surfaces.add(surface);
    this.invalidate();
    return () => {
      this.#surfaces.delete(surface);
      if (!this.#surfaces.size) this.stop();
      else this.invalidate();
    };
  }
  invalidate() {
    if (
      !this.#raf &&
      this.#submissions.size < this.submissionLimit &&
      !this.#hidden &&
      [...this.#surfaces].some((s) => s.visible && (s.dirty || s.playing || s.polling))
    )
      this.#raf = this.#clock.request(this.#tick);
  }
  setHidden(hidden: boolean) {
    this.#hidden = hidden;
    this.#previous = null;
    this.#accumulator = 0;
    if (hidden) this.stop();
    else this.invalidate();
  }
  stop() {
    this.#clock.cancel(this.#raf);
    this.#raf = 0;
    this.#previous = null;
  }
  /** A device generation ended: an obsolete queue promise must not block its replacement. */
  resetSubmission() {
    this.#submissions.clear();
    this.#previous = null;
    this.#accumulator = 0;
    this.#resumeAfterWait = false;
  }
  get submissionPending() {
    return this.#submissions.size > 0;
  }
  get submissionLimit() {
    if (this.#submissionLimit !== null) return this.#submissionLimit;
    if (!this.#surfaces.size || this.#pipelinedSubmissionLimit === 1) return 1;
    const seen = new Set<ScheduledSurface>();
    const safe = (surface: ScheduledSurface): boolean => {
      if (seen.has(surface)) return true;
      seen.add(surface);
      return surface.submissionPipelining === true && (surface.dependencies?.() ?? []).every(safe);
    };
    return [...this.#surfaces].every(safe) ? this.#pipelinedSubmissionLimit : 1;
  }
  /** Bounded pipelining for engines whose completion notifications arrive in batches. */
  setSubmissionLimit(limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 8)
      throw new RangeError('Submission limit must be an integer from 1 to 8');
    this.#submissionLimit = limit;
    this.invalidate();
  }
  get surfaceCount() {
    return this.#surfaces.size;
  }
  readonly #tick = (now: number) => {
    this.#raf = 0;
    if (this.#hidden || this.#submissions.size >= this.submissionLimit) return;
    const start = this.#clock.now();
    const delta =
      this.#previous === null
        ? 0
        : Math.min(
            this.#resumeAfterWait ? 1 / 60 : 0.1,
            Math.max(0, (now - this.#previous) / 1000),
          );
    this.#resumeAfterWait = false;
    this.#previous = now;
    this.#accumulator += delta;
    const active: ScheduledSurface[] = [],
      seen = new Set<ScheduledSurface>();
    const visit = (surface: ScheduledSurface) => {
      if (seen.has(surface)) return;
      seen.add(surface);
      for (const source of surface.dependencies?.() ?? []) visit(source);
      active.push(surface);
    };
    for (const surface of this.#surfaces)
      if (surface.visible && (surface.dirty || surface.playing || surface.polling)) visit(surface);
    for (const surface of active) surface.beforeFrame?.();
    let steps = 0;
    while (this.#accumulator >= 1 / 60 && steps < 6) {
      this.#time += 1 / 60;
      this.#index++;
      const frame = { time: this.#time, delta: 1 / 60, index: this.#index };
      for (const surface of active) if (surface.playing) surface.update(frame);
      this.#accumulator -= 1 / 60;
      steps++;
    }
    const rendered: ScheduledSurface[] = [];
    for (const surface of active) {
      // Uniform drivers may poll while a paused/reduced-motion field keeps its settled image.
      // Check here, in dependency order: a source render can dirty its later consumers.
      if (!surface.dirty && !surface.playing) continue;
      if (surface.shouldRender && !surface.shouldRender()) continue;
      surface.render({ time: this.#time, delta, index: this.#index });
      surface.dirty = false;
      rendered.push(surface);
    }
    if (rendered.length) {
      this.#submit();
      if (this.#completion) {
        const lease = {},
          start = this.#clock.now();
        this.#submissions.add(lease);
        const completed = () => {
          if (!this.#submissions.delete(lease)) return;
          // GPU stalls do not become six expensive catch-up updates on recovery.
          if (!this.#submissions.size && this.#clock.now() - start > 100) {
            this.#accumulator = 0;
            this.#resumeAfterWait = true;
          }
          this.invalidate();
        };
        try {
          void this.#completion().then(completed, completed);
        } catch {
          completed();
        }
      }
    }
    this.cpuFrameMs = this.#clock.now() - start;
    for (const surface of rendered)
      surface.frameCompleted?.({ cpuMs: this.cpuFrameMs, intervalMs: delta * 1000 });
    if (active.some((s) => s.playing || s.polling)) this.invalidate();
    else this.#previous = null;
  };
}
