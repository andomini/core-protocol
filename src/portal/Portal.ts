import type { KeyValue } from './storage';

export type PortalName = 'local' | 'crazygames' | 'poki';

/**
 * Thin adapter over a portal SDK (adapted from Merge Wall). Implementations may fail or never resolve;
 * the game talks to them only through PortalGuard, which adds timeouts, de-duplication, first-input
 * gating, late-init replay and ad pause/mute handling.
 */
export interface Portal {
  readonly name: PortalName;
  init(): Promise<void>;
  loadingFinished(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  midgameAd(): Promise<void>;
  /** Resolves true only if the ad played to completion. */
  rewardedAd(): Promise<boolean>;
  happytime(): void;
  /**
   * Key-value storage with the localStorage API: CrazyGames' data module where it works, else
   * localStorage, else memory. Never throws.
   */
  storage(): KeyValue;
  /** Portal-level mute (e.g. CrazyGames settings). Called immediately with the current value. */
  onMuteChange(cb: (muted: boolean) => void): void;
  /**
   * False when ads can't work at all (SDK blocked, disabled environment, adblock, init not settled).
   * Rewarded buttons are hidden then, so none sits there doing nothing.
   */
  adsAvailable(): boolean;
  /**
   * If the portal reports the moment an ad actually starts playing, it calls this; audio is then muted
   * only from that moment (CrazyGames rule). Portals without the signal leave it unset and audio mutes
   * at request time.
   */
  onAdStarted?: (cb: () => void) => void;
}
