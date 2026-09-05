// Kick/transient detection: compares current bass energy against a recent
// moving average and fires a short attack/decay "punch" envelope when bass
// significantly exceeds it. Time-based (not frame-based) so the same logic
// serves both the realtime preview (variable dt) and the deterministic
// per-frame export pass (fixed dt = 1/fps).

const AVERAGE_WINDOW_SEC = 0.35;
const REFRACTORY_SEC = 0.09;
const DECAY_TO_SEC = 0.22; // time to decay to ~2% after a trigger
const MIN_ABSOLUTE_DELTA = 0.015;

/** sensitivity 0..1 -> how far above the moving average bass must rise to trigger. */
function thresholdRatio(sensitivity: number): number {
  return 0.55 - sensitivity * 0.45; // 0 -> +55% required, 1 -> +10% required
}

function decayFactor(dtSec: number): number {
  return Math.pow(0.02, dtSec / DECAY_TO_SEC);
}

/** Stateful streaming transient tracker for live preview. */
export class TransientTracker {
  private history: number[] = [];
  private historySum = 0;
  private timeSinceLastTrigger = Infinity;
  private envelope = 0;

  /** Call once per animation frame with the current smoothed bass value. */
  update(bass: number, dtSec: number, sensitivity: number): number {
    const movingAvg = this.history.length > 0 ? this.historySum / this.history.length : bass;
    const exceeds =
      bass > movingAvg * (1 + thresholdRatio(sensitivity)) && bass - movingAvg > MIN_ABSOLUTE_DELTA;

    this.timeSinceLastTrigger += dtSec;

    if (exceeds && this.timeSinceLastTrigger >= REFRACTORY_SEC) {
      this.envelope = 1;
      this.timeSinceLastTrigger = 0;
    } else {
      this.envelope *= decayFactor(dtSec);
    }

    this.history.push(bass);
    this.historySum += bass;
    const maxHistoryFrames = Math.max(1, Math.round(AVERAGE_WINDOW_SEC / Math.max(dtSec, 1 / 240)));
    while (this.history.length > maxHistoryFrames) {
      this.historySum -= this.history.shift()!;
    }

    return this.envelope;
  }

  reset(): void {
    this.history = [];
    this.historySum = 0;
    this.timeSinceLastTrigger = Infinity;
    this.envelope = 0;
  }
}

/**
 * Deterministic batch version used for export pre-analysis: given the full
 * per-frame bass array and a fixed frame rate, returns the transient
 * envelope for every frame. Produces identical output every run.
 */
export function computeTransientEnvelope(
  bassFrames: number[],
  fps: number,
  sensitivity: number,
): number[] {
  const tracker = new TransientTracker();
  const dtSec = 1 / fps;
  return bassFrames.map((bass) => tracker.update(bass, dtSec, sensitivity));
}
