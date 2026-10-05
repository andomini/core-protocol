// CrazyGames HTML5 SDK v3 adapter (from Merge Wall). API per docs.crazygames.com/sdk (intro, game,
// video-ads, data). Every SDK call is guarded: if the script is blocked, init fails or the environment is
// "disabled", the adapter degrades to no-ops and localStorage, and ads report "not available".
import type { Portal } from './Portal';
import { type KeyValue, localKV } from './storage';

interface CgAdCallbacks {
  adStarted: () => void;
  adFinished: () => void;
  adError: (e: { code: string; message: string }) => void;
}

interface CgSdk {
  init(): Promise<void>;
  environment: 'local' | 'crazygames' | 'disabled';
  game: {
    loadingStart(): void;
    loadingStop(): void;
    gameplayStart(): void;
    gameplayStop(): void;
    happytime(): void;
    settings: { muteAudio: boolean };
    addSettingsChangeListener(cb: (s: { muteAudio: boolean }) => void): void;
  };
  ad: {
    requestAd(type: 'midgame' | 'rewarded', cb: CgAdCallbacks): void;
    hasAdblock(): Promise<boolean>;
  };
  data: { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };
}

declare global {
  interface Window {
    CrazyGames?: { SDK: CgSdk };
  }
}

export class CrazyGamesPortal implements Portal {
  readonly name = 'crazygames' as const;
  private sdk: CgSdk | null = null;
  private adblock = false;
  private muteCbs: ((m: boolean) => void)[] = [];
  private adStartedCb: () => void = () => {};
  private readonly local = localKV();
  /**
   * Where each key was read from. We only ever write a key to SDK.data if its value in memory came from
   * SDK.data: a late init or a disabled data module must never overwrite cloud progress with a fresh
   * local save. A key that was never read goes to localStorage.
   */
  private readonly source = new Map<string, 'sdk' | 'local'>();
  private readonly kv: KeyValue = {
    getItem: (k) => {
      if (this.sdk) {
        try {
          const v = this.sdk.data.getItem(k);
          this.source.set(k, 'sdk');
          return v;
        } catch (e) {
          console.debug('[crazygames] data module unavailable; using localStorage', e);
        }
      }
      this.source.set(k, 'local');
      return this.local.getItem(k);
    },
    setItem: (k, v) => {
      if (this.source.get(k) === 'sdk' && this.sdk) {
        try {
          this.sdk.data.setItem(k, v);
          return;
        } catch {
          /* fall through to localStorage */
        }
      }
      this.local.setItem(k, v);
    },
    removeItem: (k) => {
      if (this.source.get(k) === 'sdk' && this.sdk) {
        try {
          this.sdk.data.removeItem(k);
        } catch {
          /* ignore */
        }
      }
      this.local.removeItem(k);
    },
  };

  async init(): Promise<void> {
    const sdk = window.CrazyGames?.SDK;
    if (!sdk) return; // script blocked or missing
    try {
      await sdk.init();
    } catch (e) {
      console.debug('[crazygames] init failed', e);
      return;
    }
    if (sdk.environment === 'disabled') return; // every call would throw
    this.sdk = sdk;
    try {
      sdk.game.loadingStart();
    } catch {
      /* ignore */
    }
    try {
      sdk.game.addSettingsChangeListener((s) => this.muteCbs.forEach((cb) => cb(!!s.muteAudio)));
    } catch {
      /* ignore */
    }
    // Late subscribers were told "not muted"; tell them the real setting now.
    const muted = this.portalMuted();
    if (muted) this.muteCbs.forEach((cb) => cb(true));
    try {
      this.adblock = await sdk.ad.hasAdblock();
    } catch {
      this.adblock = false;
    }
  }

  loadingFinished(): void {
    this.call((s) => s.game.loadingStop());
  }

  gameplayStart(): void {
    this.call((s) => s.game.gameplayStart());
  }

  gameplayStop(): void {
    this.call((s) => s.game.gameplayStop());
  }

  happytime(): void {
    this.call((s) => s.game.happytime());
  }

  adsAvailable(): boolean {
    return this.sdk !== null && !this.adblock;
  }

  onAdStarted(cb: () => void): void {
    this.adStartedCb = cb;
  }

  async midgameAd(): Promise<void> {
    await this.request('midgame');
  }

  rewardedAd(): Promise<boolean> {
    return this.request('rewarded');
  }

  /** adFinished = success; adError (unfilled, adblock, cooldown, other) = no reward. */
  private request(type: 'midgame' | 'rewarded'): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const sdk = this.sdk;
      if (!sdk) return resolve(false);
      try {
        sdk.ad.requestAd(type, {
          adStarted: () => this.adStartedCb(),
          adFinished: () => resolve(true),
          adError: (e) => {
            console.debug('[crazygames] ad error', e?.code);
            resolve(false);
          },
        });
      } catch {
        resolve(false);
      }
    });
  }

  storage(): KeyValue {
    return this.kv;
  }

  onMuteChange(cb: (muted: boolean) => void): void {
    this.muteCbs.push(cb);
    cb(this.portalMuted());
  }

  private portalMuted(): boolean {
    try {
      return !!this.sdk?.game.settings.muteAudio;
    } catch {
      return false;
    }
  }

  private call(fn: (s: CgSdk) => void): void {
    if (!this.sdk) return;
    try {
      fn(this.sdk);
    } catch (e) {
      console.debug('[crazygames]', e);
    }
  }
}
