// Dev/local portal (from Merge Wall): localStorage saves and a fake ad overlay. Every SDK-style call is
// logged as `[local] <call>` (console.debug), which the UI smoke reads.
import type { Portal } from './Portal';
import { type KeyValue, localKV } from './storage';

/**
 * ok: the ad starts after ~300 ms and completes after 2 s. fail: SDK error, no ad. nofill: resolves at once
 * with no ad. hang: never resolves (PortalGuard's timeout ends it). none: ads unavailable (like adblock).
 */
export type FakeAdMode = 'ok' | 'fail' | 'nofill' | 'hang' | 'none';

const START_DELAY_MS = 300;
const AD_SECONDS = 2;

export function readAdMode(search: string): FakeAdMode {
  const m = new URLSearchParams(search).get('ads');
  return m === 'fail' || m === 'nofill' || m === 'hang' || m === 'none' ? m : 'ok';
}

export class LocalPortal implements Portal {
  readonly name = 'local' as const;
  adMode: FakeAdMode;
  private adStartedCb: () => void = () => {};
  private readonly kv = localKV();

  constructor(search = typeof location === 'undefined' ? '' : location.search) {
    this.adMode = readAdMode(search);
  }

  async init(): Promise<void> {}
  loadingFinished(): void {
    console.debug('[local] loadingFinished');
  }
  gameplayStart(): void {
    console.debug('[local] gameplayStart');
  }
  gameplayStop(): void {
    console.debug('[local] gameplayStop');
  }
  happytime(): void {
    console.debug('[local] happytime');
  }

  onAdStarted(cb: () => void): void {
    this.adStartedCb = cb;
  }

  midgameAd(): Promise<void> {
    return this.fakeAd('midgame').then(() => undefined);
  }

  rewardedAd(): Promise<boolean> {
    return this.fakeAd('rewarded');
  }

  storage(): KeyValue {
    return this.kv;
  }

  onMuteChange(cb: (muted: boolean) => void): void {
    cb(false);
  }

  adsAvailable(): boolean {
    return this.adMode !== 'none';
  }

  private fakeAd(kind: 'midgame' | 'rewarded'): Promise<boolean> {
    const mode = this.adMode;
    console.debug(`[local] ${kind}Ad requested (mode=${mode})`);
    if (mode === 'fail') return new Promise((_, reject) => setTimeout(() => reject(new Error('fake ad error')), 150));
    if (mode === 'none' || mode === 'nofill') return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const el = document.createElement('div');
      el.id = 'fake-ad';
      el.style.cssText =
        'position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
        'gap:24px;background:rgba(3,5,13,.92);color:#e8fbff;font:700 28px "Chakra Petch",sans-serif';
      const label = document.createElement('div');
      const skip = document.createElement('button');
      skip.textContent = 'Close early (no reward)';
      skip.style.cssText = 'font:700 20px "Chakra Petch",sans-serif;padding:10px 18px;border:2px solid #22e5ff;background:#0a1230;color:#e8fbff';
      el.append(label, skip);
      document.body.append(el);
      let left = AD_SECONDS;
      let timer = 0;
      let startTimer = 0;
      const render = (s: string) => (label.textContent = `Fake ${kind} ad — ${s}`);
      render('loading…');
      const finish = (ok: boolean) => {
        clearTimeout(startTimer);
        clearInterval(timer);
        el.remove();
        console.debug(`[local] ${kind}Ad ${ok ? 'finished' : 'closed'}`);
        resolve(ok);
      };
      skip.onclick = () => finish(false);
      if (mode === 'hang') {
        // Never resolves; the overlay goes away after PortalGuard's longest timeout.
        setTimeout(() => el.remove(), 61_000);
        return;
      }
      startTimer = window.setTimeout(() => {
        console.debug(`[local] ${kind}Ad started`);
        this.adStartedCb();
        render(`${left} s`);
        timer = window.setInterval(() => {
          left--;
          render(`${left} s`);
          if (left <= 0) finish(true);
        }, 1000);
      }, START_DELAY_MS);
    });
  }
}
