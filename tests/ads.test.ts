import { describe, expect, it, vi } from 'vitest';
import { MidgamePolicy } from '../src/portal/adPolicy';
import { Ads } from '../src/portal/ads';
import type { Portal } from '../src/portal/Portal';
import { PortalGuard } from '../src/portal/PortalGuard';
import { memoryKV } from '../src/portal/storage';

function setup(over: Partial<Portal> = {}, rules = { minGapSeconds: 180, skipFirstBreaks: 1 }) {
  const calls: string[] = [];
  const portal: Portal = {
    name: 'local',
    init: async () => {},
    loadingFinished: () => {},
    gameplayStart: () => calls.push('start'),
    gameplayStop: () => calls.push('stop'),
    midgameAd: async () => void calls.push('midgame'),
    rewardedAd: async () => (calls.push('rewarded'), true),
    happytime: () => {},
    storage: () => memoryKV(),
    onMuteChange: (cb) => cb(false),
    adsAvailable: () => true,
    ...over,
  };
  const clock = { t: 0 };
  const events: { type: string; [k: string]: unknown }[] = [];
  const toasts: string[] = [];
  const guard = new PortalGuard(portal, { midgameTimeoutMs: 1000, rewardedTimeoutMs: 1000 });
  const ads = new Ads({
    guard,
    policy: new MidgamePolicy(rules, () => clock.t),
    telemetry: { emit: (type, p = {}) => void events.push({ type, ...p }) },
    toast: (t) => toasts.push(t),
    toastText: 'No ad right now',
    now: () => clock.t,
  });
  return { ads, guard, calls, clock, events, toasts };
}

describe('Ads.rewarded', () => {
  it('true on a completed ad; telemetry request + result; no toast', async () => {
    const s = setup();
    expect(await s.ads.rewarded('revive')).toBe(true);
    expect(s.toasts).toEqual([]);
    expect(s.events).toEqual([
      { type: 'ad_request', kind: 'rewarded', placement: 'revive' },
      { type: 'ad_result', kind: 'rewarded', placement: 'revive', result: 'completed', ms: 0 },
    ]);
  });

  it('false + toast when the ad fails, is skipped or throws', async () => {
    for (const rewardedAd of [async () => false, () => Promise.reject(new Error('x'))]) {
      const s = setup({ rewardedAd });
      expect(await s.ads.rewarded('doubleBits')).toBe(false);
      expect(s.toasts).toEqual(['No ad right now']);
      expect(s.events[1]).toMatchObject({ type: 'ad_result', result: 'failed' });
    }
  });

  it('false + toast without calling the SDK when ads are unavailable', async () => {
    const s = setup({ adsAvailable: () => false });
    expect(s.ads.available).toBe(false);
    expect(await s.ads.rewarded('freePack')).toBe(false);
    expect(s.calls).toEqual([]);
    expect(s.toasts).toHaveLength(1);
    expect(s.events[1]).toMatchObject({ result: 'unavailable' });
  });

  it('a hanging ad resolves false after the timeout, with a toast', async () => {
    vi.useFakeTimers();
    const s = setup({ rewardedAd: () => new Promise(() => {}) });
    const p = s.ads.rewarded('boost');
    await vi.advanceTimersByTimeAsync(1001);
    expect(await p).toBe(false);
    expect(s.toasts).toHaveLength(1);
    expect(s.ads.running).toBe(false);
    vi.useRealTimers();
  });

  it('a double tap does not request a second ad', async () => {
    const s = setup();
    const [a, b] = await Promise.all([s.ads.rewarded('reroll'), s.ads.rewarded('reroll')]);
    expect([a, b]).toEqual([true, false]);
    expect(s.calls.filter((c) => c === 'rewarded')).toHaveLength(1);
  });

  it('onAvailable reports now and on change', async () => {
    let avail = true;
    const s = setup({ adsAvailable: () => avail });
    const seen: boolean[] = [];
    s.ads.onAvailable((a) => seen.push(a));
    s.guard.checkAvailability();
    avail = false;
    s.guard.checkAvailability();
    expect(seen).toEqual([true, false]);
  });
});

describe('Ads.midgame', () => {
  it('follows the policy: not on the first death, then only ≥ 180 s after the last ad', async () => {
    const s = setup();
    s.clock.t = 400_000;
    expect(await s.ads.midgame('restart')).toBe(false); // first death
    expect(await s.ads.midgame('restart')).toBe(true);
    s.clock.t += 60_000;
    expect(await s.ads.midgame('restart')).toBe(false); // too soon
    expect(s.calls.filter((c) => c === 'midgame')).toHaveLength(1);
    expect(s.toasts).toEqual([]);
  });

  it('a rewarded ad pushes the next midgame back', async () => {
    const s = setup({}, { minGapSeconds: 180, skipFirstBreaks: 0 });
    s.clock.t = 170_000;
    await s.ads.rewarded('revive');
    s.clock.t = 200_000;
    expect(await s.ads.midgame('restart')).toBe(false);
  });

  it('a failed midgame is silent and resolves false; it does not reset the gap', async () => {
    const s = setup({ midgameAd: () => Promise.reject(new Error('x')) }, { minGapSeconds: 180, skipFirstBreaks: 0 });
    s.clock.t = 200_000;
    expect(await s.ads.midgame('restart')).toBe(false);
    expect(s.toasts).toEqual([]);
    expect(s.events.map((e) => e.type)).toEqual(['ad_request', 'ad_result']);
    expect(s.events[1]).toMatchObject({ kind: 'midgame', result: 'failed' });
  });

  it('pauses gameplay during the ad and resumes after', async () => {
    const s = setup({}, { minGapSeconds: 0, skipFirstBreaks: 0 });
    s.guard.noteInput();
    s.guard.gameplayStart();
    await s.ads.midgame('restart');
    expect(s.calls).toEqual(['start', 'stop', 'midgame', 'start']);
  });
});
