// Fixed-step accumulator (from Last Tower): the sim ticks at tickHz regardless of frame rate.
// speed scales sim time (×1, ×2, ×5 dev); speed 0 = paused (the interpolation alpha freezes).

export class FixedLoop {
  private acc = 0;
  private readonly tickMs: number;

  constructor(
    tickHz: number,
    private readonly maxTicksPerFrame: number,
  ) {
    this.tickMs = 1000 / tickHz;
  }

  /** Returns how many ticks to run this frame. */
  frame(dtMs: number, speed: number): number {
    this.acc += Math.min(dtMs, 250) * speed;
    let n = Math.floor(this.acc / this.tickMs);
    const cap = this.maxTicksPerFrame * Math.max(1, speed);
    if (n > cap) {
      // Spiral-of-death guard (e.g. after the tab slept): drop the backlog.
      n = cap;
      this.acc = 0;
    } else {
      this.acc -= n * this.tickMs;
    }
    return n;
  }

  /** Interpolation factor between the previous and current tick, 0..1. */
  alpha(): number {
    return Math.min(1, this.acc / this.tickMs);
  }

  reset(): void {
    this.acc = 0;
  }
}
