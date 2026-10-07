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
export interface ScheduledSurface {
  visible: boolean;
  playing: boolean;
  dirty: boolean;
  update(frame: Tick): void;
  render(frame: Tick): void;
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
  #raf = 0;
  #previous: number | null = null;
  #accumulator = 0;
  #time = 0;
  #index = 0;
  #hidden = false;
  cpuFrameMs = 0;
  constructor(submit: () => void, clock: Clock = browserClock) {
    this.#submit = submit;
    this.#clock = clock;
  }
  add(surface: ScheduledSurface) {
    this.#surfaces.add(surface);
    this.invalidate();
    return () => {
      this.#surfaces.delete(surface);
      if (!this.#surfaces.size) this.stop();
    };
  }
  invalidate() {
    if (
      !this.#raf &&
      !this.#hidden &&
      [...this.#surfaces].some((s) => s.visible && (s.dirty || s.playing))
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
  get surfaceCount() {
    return this.#surfaces.size;
  }
  readonly #tick = (now: number) => {
    this.#raf = 0;
    if (this.#hidden) return;
    const start = this.#clock.now();
    const delta =
      this.#previous === null ? 0 : Math.min(0.1, Math.max(0, (now - this.#previous) / 1000));
    this.#previous = now;
    this.#accumulator += delta;
    const active = [...this.#surfaces].filter((s) => s.visible && (s.dirty || s.playing));
    let steps = 0;
    while (this.#accumulator >= 1 / 60 && steps < 6) {
      this.#time += 1 / 60;
      this.#index++;
      const frame = { time: this.#time, delta: 1 / 60, index: this.#index };
      for (const surface of active) if (surface.playing) surface.update(frame);
      this.#accumulator -= 1 / 60;
      steps++;
    }
    for (const surface of active) {
      surface.render({ time: this.#time, delta, index: this.#index });
      surface.dirty = false;
    }
    if (active.length) this.#submit();
    this.cpuFrameMs = this.#clock.now() - start;
    for (const surface of active)
      surface.frameCompleted?.({ cpuMs: this.cpuFrameMs, intervalMs: delta * 1000 });
    if (active.some((s) => s.playing)) this.invalidate();
    else this.#previous = null;
  };
}
