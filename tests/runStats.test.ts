import { describe, expect, it } from 'vitest';
import { addRunToLifetime, emptyLifetime, emptyRunStats, recordEvent, totalDamage, totalKills, validateLifetime, validateRunStats } from '../src/meta/runStats';
import { RunSession } from '../src/render/RunSession';
import { testData } from './helpers';

describe('run stats', () => {
  it('fold events: damage by source (no overkill), crits, kills, damage taken, purchases', () => {
    const s = emptyRunStats();
    recordEvent(s, { type: 'hit', enemyId: 1, damage: 50, dealt: 30, crit: true, source: 'shot', healed: 2 });
    recordEvent(s, { type: 'hit', enemyId: 2, damage: 10, dealt: 10, crit: false, source: 'bounce', healed: 0 });
    recordEvent(s, { type: 'hit', enemyId: 2, damage: 5, dealt: 5, crit: false, source: 'thorns', healed: 0 });
    recordEvent(s, { type: 'kill', enemyId: 1, kind: 'tank', energy: 7, bits: 3, keys: 0 });
    recordEvent(s, { type: 'coreHit', enemyId: 3, damage: 4, ranged: true, blocked: false, absorbed: 6 });
    recordEvent(s, { type: 'coreHit', enemyId: 4, damage: 0, ranged: false, blocked: true, absorbed: 0 });
    recordEvent(s, { type: 'buy', stat: 'damage', levels: 3, level: 3, cost: 40, free: false });
    recordEvent(s, { type: 'buy', stat: 'damage', levels: 1, level: 4, cost: 0, free: true });
    expect(s.damage.shot).toBe(30);
    expect(totalDamage(s)).toBe(45);
    expect([s.crits, s.critDamage, s.maxHit, s.healedLifesteal]).toEqual([1, 30, 50, 2]);
    expect(s.kills.tank).toBe(1);
    expect(totalKills(s.kills)).toBe(1);
    expect([s.takenRanged, s.takenMelee, s.absorbed, s.blocked, s.hitsTaken]).toEqual([4, 0, 6, 1, 2]);
    expect([s.energySpent, s.levelsBought, s.freeUpgrades]).toEqual([40, 4, 1]);
  });

  it('a real session: every kill and the dealt damage are counted', () => {
    const data = testData({}, { health: 1e6 });
    const sess = new RunSession(data, { seed: 3, tier: 1, protocols: false });
    const s = emptyRunStats();
    sess.advance(30 * 120, (e) => recordEvent(s, e));
    expect(totalKills(s.kills)).toBe(sess.world.kills);
    expect(totalDamage(s)).toBeGreaterThan(0);
    expect(s.energyFromKills).toBeCloseTo(sess.world.energy, 6); // nothing bought; wave bonuses are 0 at level 0
  });

  it('stored blobs are normalised; lifetime totals add up', () => {
    const s = validateRunStats({ hits: 5, kills: { basic: 2 }, damage: { shot: 9 }, junk: 1 });
    expect([s.hits, s.kills.basic, s.damage.shot, s.kills.boss]).toEqual([5, 2, 9, 0]);
    const l = validateLifetime(null);
    addRunToLifetime(l, s, { waves: 7, simTicks: 900, bits: 40, keys: 2, energyEarned: 100 });
    addRunToLifetime(l, s, { waves: 3, simTicks: 100, bits: 10, keys: 0, energyEarned: 5 });
    expect([l.runs, l.waves, l.kills.basic, l.damage, l.bitsEarned]).toEqual([2, 10, 4, 18, 50]);
    expect(emptyLifetime().runs).toBe(0);
  });
});
