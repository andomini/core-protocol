// When a midgame (interstitial) ad may be requested at a natural break. Pure; the clock is injected.
// Rules (src/data/ads.json): never at the session's first break (the first death), and at least
// `minGapSeconds` since the last ad that played — counted from session start, so no midgame lands in
// the first minutes (CrazyGames "protect day-1 retention"). CrazyGames' SDK paces midgames to ≤ 1 per
// 3 min on its own and Poki's commercialBreak is paced by Poki; this policy is the game-side floor that
// holds on every portal and in the local build.

export interface MidgameRules {
  minGapSeconds: number;
  skipFirstBreaks: number;
}

export class MidgamePolicy {
  private breaks = 0;
  private lastAdAt: number;

  constructor(
    private readonly rules: MidgameRules,
    private readonly now: () => number,
  ) {
    this.lastAdAt = now();
  }

  /** Breaks offered so far this session. */
  get breakCount(): number {
    return this.breaks;
  }

  /** Counts a natural break (e.g. RESTART after death) and says whether to request a midgame ad there. */
  offer(): boolean {
    this.breaks++;
    if (this.breaks <= this.rules.skipFirstBreaks) return false;
    return this.now() - this.lastAdAt >= this.rules.minGapSeconds * 1000;
  }

  /** An ad (midgame or rewarded) actually played to the end: the gap restarts. */
  noteAdPlayed(): void {
    this.lastAdAt = this.now();
  }
}
