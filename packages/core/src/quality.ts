export interface QualityState {
  resolutionScale: number;
  stepScale: number;
}
/** Queue completion is a wall-time load proxy, not a GPU timestamp. */
export class QualityController {
  readonly budgetMs: number;
  readonly minResolution: number;
  readonly maxResolution: number;
  state: QualityState;
  #samples = 0;
  #slow = 0;
  #fast = 0;
  #average = 0;
  constructor(maxResolution = 1, minResolution = 0.25, budgetMs = 1000 / 60) {
    if (!(minResolution > 0 && maxResolution >= minResolution && maxResolution <= 1))
      throw new RangeError('Invalid quality resolution range');
    if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new RangeError('Invalid frame budget');
    this.maxResolution = maxResolution;
    this.minResolution = minResolution;
    this.budgetMs = budgetMs;
    this.state = { resolutionScale: maxResolution, stepScale: 1 };
  }
  get averageMs() {
    return this.#average;
  }
  observe(workMs: number): QualityState | null {
    if (!Number.isFinite(workMs) || workMs < 0) return null;
    this.#average = this.#samples ? this.#average * 0.9 + workMs * 0.1 : workMs;
    this.#samples++;
    // Warm up after every change; separate thresholds and streak lengths avoid oscillation.
    if (this.#samples <= 30) return null;
    this.#slow = this.#average > this.budgetMs * 1.15 ? this.#slow + 1 : 0;
    this.#fast = this.#average < this.budgetMs * 0.6 ? this.#fast + 1 : 0;
    let next: QualityState | null = null;
    if (this.#slow >= 12) {
      if (this.state.stepScale > 0.25)
        next = { ...this.state, stepScale: Math.max(0.25, this.state.stepScale * 0.5) };
      else if (this.state.resolutionScale > this.minResolution)
        next = {
          ...this.state,
          resolutionScale: Math.max(this.minResolution, this.state.resolutionScale - 0.25),
        };
    } else if (this.#fast >= 120) {
      if (this.state.resolutionScale < this.maxResolution)
        next = {
          ...this.state,
          resolutionScale: Math.min(this.maxResolution, this.state.resolutionScale + 0.25),
        };
      else if (this.state.stepScale < 1)
        next = { ...this.state, stepScale: Math.min(1, this.state.stepScale * 2) };
    }
    if (!next) return null;
    this.state = next;
    this.#samples = this.#slow = this.#fast = 0;
    return { ...next };
  }
}
