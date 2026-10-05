import { describe, expect, it } from 'vitest';
import adsJson from '../src/data/ads.json';
import { MidgamePolicy } from '../src/portal/adPolicy';

const clock = () => {
  const c = { t: 1000, now: () => c.t };
  return c;
};

describe('MidgamePolicy', () => {
  it('ships the portal rules: skip the first death, ≥ 3 min apart', () => {
    expect(adsJson.midgame.skipFirstBreaks).toBe(1);
    expect(adsJson.midgame.minGapSeconds).toBeGreaterThanOrEqual(180);
  });

  it('never on the first break, even long after session start', () => {
    const c = clock();
    const p = new MidgamePolicy({ minGapSeconds: 180, skipFirstBreaks: 1 }, c.now);
    c.t += 3_600_000;
    expect(p.offer()).toBe(false);
    expect(p.offer()).toBe(true);
    expect(p.breakCount).toBe(2);
  });

  it('counts the gap from session start, then from the last ad that played', () => {
    const c = clock();
    const p = new MidgamePolicy({ minGapSeconds: 180, skipFirstBreaks: 1 }, c.now);
    c.t += 30_000;
    expect(p.offer()).toBe(false); // first death
    c.t += 60_000;
    expect(p.offer()).toBe(false); // 90 s into the session
    c.t += 90_000;
    expect(p.offer()).toBe(true); // 180 s
    p.noteAdPlayed();
    c.t += 179_999;
    expect(p.offer()).toBe(false);
    c.t += 1;
    expect(p.offer()).toBe(true);
  });

  it('an offered ad that did not play does not restart the gap', () => {
    const c = clock();
    const p = new MidgamePolicy({ minGapSeconds: 180, skipFirstBreaks: 0 }, c.now);
    c.t += 200_000;
    expect(p.offer()).toBe(true); // …but no fill: noteAdPlayed is not called
    c.t += 1000;
    expect(p.offer()).toBe(true);
  });

  it('a rewarded ad also restarts the gap', () => {
    const c = clock();
    const p = new MidgamePolicy({ minGapSeconds: 180, skipFirstBreaks: 0 }, c.now);
    c.t += 170_000;
    p.noteAdPlayed();
    c.t += 20_000;
    expect(p.offer()).toBe(false);
  });

  it('zero rules (dev ?midgame=always) offer every break', () => {
    const p = new MidgamePolicy({ minGapSeconds: 0, skipFirstBreaks: 0 }, () => 0);
    expect([p.offer(), p.offer(), p.offer()]).toEqual([true, true, true]);
  });
});
