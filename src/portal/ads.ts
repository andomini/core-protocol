// The ad API for gameplay code (M3 perks reroll/boost, M4 revive/×2 Bits/free pack/offline ×2). Every ad
// goes through PortalGuard (pause at request, mute at the real ad start, timeouts, one ad at a time).
//
//   const ok = await services.ads.rewarded('revive');   // true only if the ad played to the end
//   services.ads.onAvailable((a) => button.setVisible(a)); // hide rewarded buttons when ads can't work
//   await services.ads.midgame('restart');               // at a natural break; the policy may skip it
//
// A failed or unavailable rewarded ad shows the "No ad right now" toast (never a popup) and resolves
// false. A skipped or failed midgame is silent: the player did not ask for it.
import type { TelemetrySink } from '../telemetry/Telemetry';
import type { MidgamePolicy } from './adPolicy';
import type { PortalGuard } from './PortalGuard';

export const REWARDED_PLACEMENTS = ['revive', 'doubleBits', 'reroll', 'freePack', 'boost', 'offlineDouble'] as const;
export type RewardedPlacement = (typeof REWARDED_PLACEMENTS)[number];
export type MidgameTrigger = 'restart';

export interface AdsDeps {
  guard: PortalGuard;
  policy: MidgamePolicy;
  telemetry: TelemetrySink | null;
  toast: (text: string) => void;
  toastText: string;
  now?: () => number;
}

export class Ads {
  private readonly now: () => number;
  private busy = false;

  constructor(private readonly d: AdsDeps) {
    this.now = d.now ?? (() => performance.now());
  }

  /** Whether rewarded buttons should be shown right now. */
  get available(): boolean {
    return this.d.guard.adsAvailable();
  }

  /** Calls `cb` now with the current availability and again on every change; returns an unsubscribe. */
  onAvailable(cb: (available: boolean) => void): () => void {
    this.d.guard.checkAvailability(); // settle the guard's baseline so `cb` hears only real changes
    cb(this.available);
    return this.d.guard.onAvailability(cb);
  }

  /** An ad is in progress (from request to settle): gameplay must be paused and input ignored. */
  get running(): boolean {
    return this.d.guard.isAdRunning;
  }

  /** Subscribe to ad start/end (pause/resume the game); returns an unsubscribe. */
  onAd(cb: (running: boolean) => void): () => void {
    return this.d.guard.onAd(cb);
  }

  /**
   * A rewarded ad for `placement`. Resolves true only if it played to the end: grant the reward then.
   * Never rejects; resolves false at once if another ad is running (double tap).
   */
  async rewarded(placement: RewardedPlacement): Promise<boolean> {
    if (this.busy || this.d.guard.isAdRunning) return false;
    const t0 = this.now();
    this.emit('ad_request', { kind: 'rewarded', placement });
    if (!this.available) {
      this.result('rewarded', placement, 'unavailable', t0);
      this.d.toast(this.d.toastText);
      return false;
    }
    this.busy = true;
    let ok = false;
    try {
      ok = await this.d.guard.rewardedAd();
    } finally {
      this.busy = false;
    }
    this.result('rewarded', placement, ok ? 'completed' : 'failed', t0);
    if (ok) this.d.policy.noteAdPlayed();
    else this.d.toast(this.d.toastText);
    return ok;
  }

  /**
   * Offers a midgame ad at a natural break. The policy (src/data/ads.json) decides whether one is
   * requested; resolves true if an ad played, false if skipped, unavailable or failed. Never rejects.
   */
  async midgame(trigger: MidgameTrigger): Promise<boolean> {
    if (this.busy || this.d.guard.isAdRunning) return false;
    if (!this.d.policy.offer()) return false;
    if (!this.available) return false;
    const t0 = this.now();
    this.emit('ad_request', { kind: 'midgame', placement: trigger });
    this.busy = true;
    let ok = false;
    try {
      ok = await this.d.guard.midgameAd();
    } finally {
      this.busy = false;
    }
    this.result('midgame', trigger, ok ? 'completed' : 'failed', t0);
    if (ok) this.d.policy.noteAdPlayed();
    return ok;
  }

  private result(kind: string, placement: string, result: 'completed' | 'failed' | 'unavailable', t0: number): void {
    this.emit('ad_result', { kind, placement, result, ms: Math.round(this.now() - t0) });
  }

  private emit(type: 'ad_request' | 'ad_result', payload: Record<string, unknown>): void {
    try {
      this.d.telemetry?.emit(type, payload);
    } catch {
      /* never */
    }
  }
}
