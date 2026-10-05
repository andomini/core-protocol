import { afterEach, describe, expect, it, vi } from 'vitest';
import { CrazyGamesPortal } from '../src/portal/CrazyGamesPortal';
import { PortalGuard } from '../src/portal/PortalGuard';

type AdCbs = { adStarted: () => void; adFinished: () => void; adError: (e: { code: string; message: string }) => void };

function fakeSdk(opts: { dataThrows?: boolean; initDelayMs?: number; adblock?: boolean; environment?: string; muted?: boolean } = {}) {
  const data = new Map<string, string>();
  const ads: { type: string; cb: AdCbs }[] = [];
  const dataOp = () => {
    if (opts.dataThrows) throw new Error('dataModuleDisabled');
  };
  const sdk = {
    environment: opts.environment ?? 'crazygames',
    init: () => new Promise<void>((r) => setTimeout(r, opts.initDelayMs ?? 0)),
    game: {
      loadingStart: vi.fn(),
      loadingStop: vi.fn(),
      gameplayStart: vi.fn(),
      gameplayStop: vi.fn(),
      happytime: vi.fn(),
      settings: { muteAudio: !!opts.muted },
      addSettingsChangeListener: vi.fn(),
    },
    ad: {
      requestAd: vi.fn((type: string, cb: AdCbs) => void ads.push({ type, cb })),
      hasAdblock: async () => !!opts.adblock,
    },
    data: {
      getItem: (k: string) => (dataOp(), data.get(k) ?? null),
      setItem: (k: string, v: string) => (dataOp(), void data.set(k, v)),
      removeItem: (k: string) => (dataOp(), void data.delete(k)),
    },
  };
  return { sdk, data, ads };
}

const local = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => local.get(k) ?? null,
  setItem: (k: string, v: string) => void local.set(k, v),
  removeItem: (k: string) => void local.delete(k),
});

afterEach(() => {
  local.clear();
  delete (globalThis as { window?: unknown }).window;
});

function install(sdk: unknown) {
  (globalThis as { window?: unknown }).window = { CrazyGames: { SDK: sdk } };
}

const KEY = 'core-protocol.meta';

describe('CrazyGamesPortal storage', () => {
  it('reads and writes SDK.data when the data module works', async () => {
    const { sdk, data } = fakeSdk();
    data.set(KEY, '{"v":1,"data":7}');
    install(sdk);
    const p = new CrazyGamesPortal();
    await p.init();
    const kv = p.storage();
    expect(kv.getItem(KEY)).toBe('{"v":1,"data":7}');
    kv.setItem(KEY, '{"v":1,"data":8}');
    expect(data.get(KEY)).toBe('{"v":1,"data":8}');
    expect(local.has(KEY)).toBe(false);
  });

  it('falls back to localStorage when the data module throws', async () => {
    const { sdk } = fakeSdk({ dataThrows: true });
    local.set(KEY, 'L3');
    install(sdk);
    const p = new CrazyGamesPortal();
    await p.init();
    expect(p.storage().getItem(KEY)).toBe('L3');
    p.storage().setItem(KEY, 'L4');
    expect(local.get(KEY)).toBe('L4');
  });

  it('never overwrites cloud data with a save read before init finished', async () => {
    const { sdk, data } = fakeSdk({ initDelayMs: 50 });
    data.set(KEY, 'cloud9');
    install(sdk);
    const p = new CrazyGamesPortal();
    const init = p.init(); // still pending, like a slow SDK past the boot cap
    expect(p.storage().getItem(KEY)).toBeNull(); // read from (empty) localStorage
    await init;
    p.storage().setItem(KEY, 'fresh1');
    expect(data.get(KEY)).toBe('cloud9'); // cloud progress intact
    expect(local.get(KEY)).toBe('fresh1');
  });

  it('works with no SDK at all (script blocked)', async () => {
    (globalThis as { window?: unknown }).window = {};
    const p = new CrazyGamesPortal();
    await p.init();
    expect(p.adsAvailable()).toBe(false);
    expect(await p.rewardedAd()).toBe(false);
    p.storage().setItem(KEY, 'x');
    expect(p.storage().getItem(KEY)).toBe('x');
    expect(() => p.gameplayStart()).not.toThrow();
  });
});

describe('CrazyGamesPortal SDK lifecycle and ads', () => {
  it('a disabled environment or adblock means no ads', async () => {
    const off = fakeSdk({ environment: 'disabled' });
    install(off.sdk);
    const a = new CrazyGamesPortal();
    await a.init();
    expect(a.adsAvailable()).toBe(false);
    a.gameplayStart();
    expect(off.sdk.game.gameplayStart).not.toHaveBeenCalled();

    const blocked = fakeSdk({ adblock: true });
    install(blocked.sdk);
    const b = new CrazyGamesPortal();
    await b.init();
    expect(b.adsAvailable()).toBe(false);
  });

  it('pauses at request time, mutes only on adStarted, resolves on adFinished / adError', async () => {
    const { sdk, ads } = fakeSdk();
    install(sdk);
    const p = new CrazyGamesPortal();
    await p.init();
    const g = new PortalGuard(p);
    const audio: boolean[] = [];
    const running: boolean[] = [];
    g.onAdAudio((m) => audio.push(m));
    g.onAd((r) => running.push(r));
    g.noteInput();
    g.gameplayStart();
    const mid = g.midgameAd();
    await Promise.resolve();
    expect(ads[0]!.type).toBe('midgame');
    expect(running).toEqual([true]);
    expect(sdk.game.gameplayStop).toHaveBeenCalledTimes(1);
    expect(audio).toEqual([]);
    ads[0]!.cb.adStarted();
    expect(audio).toEqual([true]);
    ads[0]!.cb.adFinished();
    expect(await mid).toBe(true);
    expect(audio).toEqual([true, false]);
    expect(running).toEqual([true, false]);
    expect(sdk.game.gameplayStart).toHaveBeenCalledTimes(2);

    const rew = g.rewardedAd();
    await Promise.resolve();
    ads[1]!.cb.adError({ code: 'unfilled', message: '' });
    expect(await rew).toBe(false);
    expect(audio).toEqual([true, false]); // never started → never muted
  });

  it('late init: loading start/stop pair up after the guard replays', async () => {
    const { sdk } = fakeSdk({ initDelayMs: 50 });
    install(sdk);
    const p = new CrazyGamesPortal();
    const g = new PortalGuard(p);
    const init = p.init();
    g.loadingFinished(); // boot cap passed: SDK not ready, call lost
    g.noteInput();
    g.gameplayStart();
    expect(sdk.game.loadingStop).not.toHaveBeenCalled();
    await init;
    expect(sdk.game.loadingStart).toHaveBeenCalledTimes(1);
    g.portalReady();
    expect(sdk.game.loadingStop).toHaveBeenCalledTimes(1);
    expect(sdk.game.gameplayStart).toHaveBeenCalledTimes(1);
  });

  it('reports the platform mute setting', async () => {
    const { sdk } = fakeSdk({ muted: true });
    install(sdk);
    const p = new CrazyGamesPortal();
    const seen: boolean[] = [];
    p.onMuteChange((m) => seen.push(m)); // subscribed before init: told "not muted", then the truth
    await p.init();
    expect(seen).toEqual([false, true]);
  });
});
