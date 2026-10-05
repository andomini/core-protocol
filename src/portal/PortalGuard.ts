import type { Portal } from './Portal';

export interface GuardOptions {
  midgameTimeoutMs: number;
  rewardedTimeoutMs: number;
}

const DEFAULTS: GuardOptions = { midgameTimeoutMs: 30_000, rewardedTimeoutMs: 60_000 };

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/**
 * Wraps a Portal so the game can never hang or double-call the SDK (from Merge Wall):
 * - the game states whether gameplay *should* be running; the guard forwards gameplayStart/Stop only on
 *   real transitions, never before the player's first input (Poki rule) and never while an ad is showing;
 * - ads always resolve (rewarded → false on any failure or timeout);
 * - only one ad at a time; listeners are told when an ad starts/ends so input and the sim can pause
 *   (at request time) and audio can mute (at the portal's real ad start, CrazyGames rule);
 * - a portal whose init settles late (after the boot cap) gets the lifecycle replayed: loadingFinished
 *   and the current gameplay state, which its SDK missed while it was not ready.
 */
export class PortalGuard {
  private loaded = false;
  private playing = false;
  private wantPlaying = false;
  private inputSeen = false;
  private adRunning = false;
  private adListeners: ((running: boolean) => void)[] = [];
  private audioListeners: ((muted: boolean) => void)[] = [];
  private availListeners: ((available: boolean) => void)[] = [];
  private adAudioMuted = false;
  private lastAvailable: boolean | null = null;
  private readonly opts: GuardOptions;

  constructor(
    readonly portal: Portal,
    opts: Partial<GuardOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
    // Portals that report the real ad start mute audio only from then on.
    portal.onAdStarted?.(() => {
      if (this.adRunning) this.setAdAudio(true);
    });
  }

  /** Whether rewarded buttons should be offered at all. */
  adsAvailable(): boolean {
    try {
      return this.portal.adsAvailable();
    } catch {
      return false;
    }
  }

  /** Called whenever ads availability may have changed (after init, after each ad); only real changes reach `cb`. */
  onAvailability(cb: (available: boolean) => void): () => void {
    this.availListeners.push(cb);
    return () => {
      this.availListeners = this.availListeners.filter((l) => l !== cb);
    };
  }

  /** Re-reads adsAvailable() and notifies on a change. */
  checkAvailability(): void {
    const now = this.adsAvailable();
    if (now === this.lastAvailable) return;
    this.lastAvailable = now;
    for (const cb of this.availListeners) this.safe(() => cb(now));
  }

  /**
   * Call once the portal's init() has settled, however late. Replays what the SDK may have missed while
   * it was not ready: loadingFinished (if already reported) and gameplayStart (if gameplay is running).
   */
  portalReady(): void {
    if (this.loaded) this.safe(() => this.portal.loadingFinished());
    if (this.playing) this.safe(() => this.portal.gameplayStart());
    this.checkAvailability();
  }

  /** Audio should be muted for an ad (separate from pausing, which starts at request time). */
  onAdAudio(cb: (muted: boolean) => void): () => void {
    this.audioListeners.push(cb);
    return () => {
      this.audioListeners = this.audioListeners.filter((l) => l !== cb);
    };
  }

  private setAdAudio(muted: boolean): void {
    if (muted === this.adAudioMuted) return;
    this.adAudioMuted = muted;
    for (const cb of this.audioListeners) this.safe(() => cb(muted));
  }

  get isAdRunning(): boolean {
    return this.adRunning;
  }

  get isAdAudioMuted(): boolean {
    return this.adAudioMuted;
  }

  /** The SDK has been told gameplay is running. */
  get isPlaying(): boolean {
    return this.playing;
  }

  /** Subscribe to ad start/end (request → settle); returns an unsubscribe function. */
  onAd(cb: (running: boolean) => void): () => void {
    this.adListeners.push(cb);
    return () => {
      this.adListeners = this.adListeners.filter((l) => l !== cb);
    };
  }

  /** Report that loading is done and gameplay is visible. Only the first call reaches the SDK. */
  loadingFinished(): void {
    if (this.loaded) return;
    this.loaded = true;
    this.safe(() => this.portal.loadingFinished());
  }

  /** Call on the first pointer/key input; a pending gameplayStart is sent then. */
  noteInput(): void {
    if (this.inputSeen) return;
    this.inputSeen = true;
    this.sync();
  }

  gameplayStart(): void {
    this.wantPlaying = true;
    this.sync();
  }

  gameplayStop(): void {
    this.wantPlaying = false;
    this.sync();
  }

  private sync(): void {
    const should = this.wantPlaying && this.inputSeen && !this.adRunning;
    if (should === this.playing) return;
    this.playing = should;
    this.safe(() => (should ? this.portal.gameplayStart() : this.portal.gameplayStop()));
  }

  async midgameAd(): Promise<boolean> {
    return this.runAd(() => this.portal.midgameAd().then(() => true), this.opts.midgameTimeoutMs);
  }

  async rewardedAd(): Promise<boolean> {
    return this.runAd(() => this.portal.rewardedAd().then((ok) => ok === true), this.opts.rewardedTimeoutMs);
  }

  happytime(): void {
    this.safe(() => this.portal.happytime());
  }

  private async runAd(start: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
    if (this.adRunning) return false;
    this.adRunning = true;
    this.sync(); // gameplayStop before the ad, if it was running
    this.emit(true);
    if (!this.portal.onAdStarted) this.setAdAudio(true);
    let ok = false;
    try {
      ok = await withTimeout(Promise.resolve().then(start), timeoutMs, false);
    } finally {
      this.adRunning = false;
      this.setAdAudio(false);
      this.emit(false);
      this.sync(); // gameplayStart again if the game still wants it
      this.checkAvailability();
    }
    return ok;
  }

  private emit(running: boolean): void {
    for (const cb of this.adListeners) this.safe(() => cb(running));
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      console.debug('[portal]', e);
    }
  }
}
