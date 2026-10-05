import { describe, expect, it, vi } from 'vitest';
import type { Portal } from '../src/portal/Portal';
import { PortalGuard } from '../src/portal/PortalGuard';
import { memoryKV } from '../src/portal/storage';

function fakePortal(over: Partial<Portal> = {}): Portal & { calls: string[] } {
  const calls: string[] = [];
  return {
    name: 'local',
    calls,
    init: async () => {},
    loadingFinished: () => calls.push('loadingFinished'),
    gameplayStart: () => calls.push('start'),
    gameplayStop: () => calls.push('stop'),
    midgameAd: async () => {},
    rewardedAd: async () => true,
    happytime: () => {},
    storage: () => memoryKV(),
    onMuteChange: (cb) => cb(false),
    adsAvailable: () => true,
    ...over,
  };
}

describe('PortalGuard', () => {
  it('gameplayStart waits for the first input', () => {
    const p = fakePortal();
    const g = new PortalGuard(p);
    g.gameplayStart();
    expect(p.calls).toEqual([]);
    g.noteInput();
    expect(p.calls).toEqual(['start']);
    g.noteInput();
    expect(p.calls).toEqual(['start']);
  });

  it('gameplayStart/Stop are idempotent', () => {
    const p = fakePortal();
    const g = new PortalGuard(p);
    g.noteInput();
    g.gameplayStart();
    g.gameplayStart();
    g.gameplayStop();
    g.gameplayStop();
    expect(p.calls).toEqual(['start', 'stop']);
  });

  it('rewarded resolves true only on success', async () => {
    expect(await new PortalGuard(fakePortal()).rewardedAd()).toBe(true);
    expect(await new PortalGuard(fakePortal({ rewardedAd: async () => false })).rewardedAd()).toBe(false);
    expect(await new PortalGuard(fakePortal({ rewardedAd: () => Promise.reject(new Error('x')) })).rewardedAd()).toBe(false);
    expect(
      await new PortalGuard(fakePortal({ rewardedAd: () => { throw new Error('sync'); } })).rewardedAd(),
    ).toBe(false);
  });

  it('a hanging ad times out as a failure', async () => {
    vi.useFakeTimers();
    const g = new PortalGuard(fakePortal({ rewardedAd: () => new Promise(() => {}) }), { rewardedTimeoutMs: 1000 });
    const p = g.rewardedAd();
    await vi.advanceTimersByTimeAsync(1001);
    expect(await p).toBe(false);
    expect(g.isAdRunning).toBe(false);
    vi.useRealTimers();
  });

  it('stops gameplay during an ad, restores it after, and blocks concurrent ads', async () => {
    let finish!: (v: boolean) => void;
    const p = fakePortal({ rewardedAd: () => new Promise((r) => (finish = r)) });
    const g = new PortalGuard(p);
    const events: boolean[] = [];
    g.onAd((r) => events.push(r));
    g.noteInput();
    g.gameplayStart();
    const first = g.rewardedAd();
    await Promise.resolve();
    expect(g.isAdRunning).toBe(true);
    expect(await g.rewardedAd()).toBe(false);
    g.gameplayStart(); // ignored while an ad runs
    finish(true);
    expect(await first).toBe(true);
    expect(p.calls).toEqual(['start', 'stop', 'start']);
    expect(events).toEqual([true, false]);
  });

  it('mutes at request time unless the portal reports the real ad start', async () => {
    let started!: () => void;
    let finish!: (v: boolean) => void;
    const p = fakePortal({
      rewardedAd: () => new Promise((r) => (finish = r)),
      onAdStarted: (cb) => (started = cb),
    });
    const g = new PortalGuard(p);
    const audio: boolean[] = [];
    g.onAdAudio((m) => audio.push(m));
    const ad = g.rewardedAd();
    await Promise.resolve();
    expect(audio).toEqual([]); // requested, not started: not muted yet
    started();
    expect(audio).toEqual([true]);
    finish(true);
    await ad;
    expect(audio).toEqual([true, false]);

    const plain = new PortalGuard(fakePortal());
    const audio2: boolean[] = [];
    plain.onAdAudio((m) => audio2.push(m));
    await plain.rewardedAd();
    expect(audio2).toEqual([true, false]);
  });

  it('midgameAd resolves true when the ad completes, false on failure or timeout', async () => {
    expect(await new PortalGuard(fakePortal()).midgameAd()).toBe(true);
    expect(await new PortalGuard(fakePortal({ midgameAd: () => Promise.reject(new Error('x')) })).midgameAd()).toBe(false);
    vi.useFakeTimers();
    const g = new PortalGuard(fakePortal({ midgameAd: () => new Promise(() => {}) }), { midgameTimeoutMs: 500 });
    const p = g.midgameAd();
    await vi.advanceTimersByTimeAsync(501);
    expect(await p).toBe(false);
    vi.useRealTimers();
  });

  it('replays loadingFinished and gameplayStart when the portal becomes ready late', () => {
    const p = fakePortal();
    const g = new PortalGuard(p);
    g.loadingFinished();
    g.loadingFinished();
    g.noteInput();
    g.gameplayStart();
    expect(p.calls).toEqual(['loadingFinished', 'start']);
    g.portalReady(); // init settled after the boot cap: the SDK missed both calls
    expect(p.calls).toEqual(['loadingFinished', 'start', 'loadingFinished', 'start']);
    g.gameplayStop();
    g.portalReady();
    expect(p.calls.slice(4)).toEqual(['stop', 'loadingFinished']);
  });

  it('portalReady before anything happened replays nothing', () => {
    const p = fakePortal();
    new PortalGuard(p).portalReady();
    expect(p.calls).toEqual([]);
  });

  it('reports availability changes only', async () => {
    let avail = false;
    const g = new PortalGuard(fakePortal({ adsAvailable: () => avail }));
    const seen: boolean[] = [];
    g.onAvailability((a) => seen.push(a));
    g.checkAvailability();
    g.checkAvailability();
    avail = true;
    g.portalReady();
    await g.rewardedAd(); // re-checked after every ad
    avail = false;
    await g.rewardedAd();
    expect(seen).toEqual([false, true, false]);
    expect(new PortalGuard(fakePortal({ adsAvailable: () => { throw new Error('x'); } })).adsAvailable()).toBe(false);
  });

  it('a throwing SDK call never escapes', () => {
    const p = fakePortal({ gameplayStart: () => { throw new Error('sdk'); }, loadingFinished: () => { throw new Error('sdk'); } });
    const g = new PortalGuard(p);
    expect(() => {
      g.loadingFinished();
      g.noteInput();
      g.gameplayStart();
    }).not.toThrow();
    expect(g.isPlaying).toBe(true);
  });
});
