// Poki SDK (v2 loader) adapter (from Merge Wall). API per sdk.poki.com/html5: commercialBreak and
// rewardedBreak take an optional callback fired when the ad really starts (audio mutes from then on).
// Poki has no cloud save (localStorage in try/catch) and no mute signal. If an ad blocker stops the core
// script, the loader's stubbed init() may never settle: ads are skipped until init() has settled, and
// init() is raced against a timeout so the game always starts.
import type { Portal } from './Portal';
import { type KeyValue, localKV } from './storage';

interface PokiSdk {
  init(): Promise<void>;
  gameLoadingFinished(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  commercialBreak(onStart?: () => void): Promise<void>;
  rewardedBreak(onStart?: () => void): Promise<boolean>;
}

declare global {
  interface Window {
    PokiSDK?: PokiSdk;
  }
}

const INIT_TIMEOUT_MS = 5000;

export class PokiPortal implements Portal {
  readonly name = 'poki' as const;
  private sdk: PokiSdk | null = null;
  /** init() settled successfully: ads may be requested. */
  private ready = false;
  private adStartedCb: () => void = () => {};
  private readonly kv = localKV();

  async init(): Promise<void> {
    const sdk = window.PokiSDK;
    if (!sdk) return;
    this.sdk = sdk;
    const settled = sdk.init().then(
      () => {
        this.ready = true;
      },
      (e) => console.debug('[poki] init rejected; continuing without ads', e),
    );
    await Promise.race([settled, new Promise<void>((r) => setTimeout(r, INIT_TIMEOUT_MS))]);
  }

  loadingFinished(): void {
    this.call((s) => s.gameLoadingFinished());
  }

  gameplayStart(): void {
    this.call((s) => s.gameplayStart());
  }

  gameplayStop(): void {
    this.call((s) => s.gameplayStop());
  }

  happytime(): void {
    /* not part of the Poki SDK */
  }

  adsAvailable(): boolean {
    return this.sdk !== null && this.ready;
  }

  onAdStarted(cb: () => void): void {
    this.adStartedCb = cb;
  }

  async midgameAd(): Promise<void> {
    if (!this.sdk || !this.ready) return;
    try {
      await this.sdk.commercialBreak(() => this.adStartedCb());
    } catch {
      /* treat as no ad */
    }
  }

  async rewardedAd(): Promise<boolean> {
    if (!this.sdk || !this.ready) return false;
    try {
      return (await this.sdk.rewardedBreak(() => this.adStartedCb())) === true;
    } catch {
      return false;
    }
  }

  storage(): KeyValue {
    return this.kv;
  }

  onMuteChange(cb: (muted: boolean) => void): void {
    cb(false); // no platform mute signal on Poki
  }

  private call(fn: (s: PokiSdk) => void): void {
    if (!this.sdk) return;
    try {
      fn(this.sdk);
    } catch (e) {
      console.debug('[poki]', e);
    }
  }
}
