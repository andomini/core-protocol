import { describe, expect, it } from 'vitest';
import { DEFAULT_DATA } from '../src/sim/data';
import { buyLab, labEffects, labState } from '../src/meta/labs';
import { DEFAULT_META_DATA } from '../src/meta/metaData';
import { buildRunOptions } from '../src/meta/runOptions';
import { offlineReward } from '../src/meta/offline';
import { settleRun } from '../src/meta/runEnd';
import { defaultMeta, validateMeta } from '../src/meta/state';
import { buyWorkshop, workshopCost } from '../src/meta/workshop';

const D = DEFAULT_DATA;
const M = DEFAULT_META_DATA;

describe('meta state', () => {
  it('defaults: tier 1 unlocked, nothing owned, first run pending', () => {
    const m = defaultMeta();
    expect(m.bits).toBe(0);
    expect(m.tierUnlocked).toBe(1);
    expect(m.labs).toEqual([]);
    expect(m.firstRunDone).toBe(false);
  });

  it('validateMeta fills missing fields and drops junk', () => {
    const m = validateMeta({ bits: 50, workshop: { damage: 3, bogus: 9 }, labs: ['speed3', 'nope'], tierUnlocked: 99 }, D, M);
    expect(m.bits).toBe(50);
    expect(m.workshop.damage).toBe(3);
    expect((m.workshop as Record<string, number>).bogus).toBeUndefined();
    expect(m.labs).toEqual(['speed3']);
    expect(m.tierUnlocked).toBe(D.tiers.length);
    expect(m.settings.sound).toBe(true);
    expect(() => validateMeta('garbage', D, M)).toThrow();
  });
});

describe('workshop', () => {
  it('costs grow geometrically and a purchase spends Bits and raises the level', () => {
    const m = defaultMeta();
    const c0 = workshopCost(m, M, 'damage');
    expect(c0).toBe(M.workshop.stats.damage!.base);
    m.bits = 1000;
    expect(buyWorkshop(m, D, M, 'damage')).toBe(true);
    expect(m.workshop.damage).toBe(1);
    expect(m.bits).toBe(1000 - c0);
    expect(workshopCost(m, M, 'damage')).toBe(Math.ceil(M.workshop.stats.damage!.base * M.workshop.stats.damage!.growth));
  });

  it('refuses without Bits, for a lab-locked stat, and past the stat cap', () => {
    const m = defaultMeta();
    expect(buyWorkshop(m, D, M, 'damage')).toBe(false);
    m.bits = 1e9;
    expect(buyWorkshop(m, D, M, 'multishot')).toBe(false);
    m.labs.push('multishot');
    expect(buyWorkshop(m, D, M, 'multishot')).toBe(true);
    m.workshop.critChance = D.stats.stats.critChance.maxLevel!;
    expect(buyWorkshop(m, D, M, 'critChance')).toBe(false);
  });
});

describe('labs', () => {
  it('a node needs its prerequisites and the Bits', () => {
    const m = defaultMeta();
    m.bits = 1e6;
    expect(labState(m, M, 'speed4')).toBe('locked');
    expect(buyLab(m, M, 'speed4')).toBe(false);
    expect(labState(m, M, 'speed3')).toBe('available');
    expect(buyLab(m, M, 'speed3')).toBe(true);
    expect(labState(m, M, 'speed3')).toBe('owned');
    expect(buyLab(m, M, 'speed3')).toBe(false);
    expect(labState(m, M, 'speed4')).toBe('available');
  });

  it('effects fold into speeds, unlocks, caps, protocol options, card slots and economy', () => {
    const m = defaultMeta();
    m.labs = ['speed3', 'speed4', 'multishot', 'maxAtkSpeed', 'perkChoice', 'freeReroll', 'rare1', 'pickEvery', 'slot3', 'presets', 'bits1', 'bits2', 'startEnergy', 'offline8'];
    const e = labEffects(m, M);
    expect(e.speeds).toEqual([1, 2, 3, 4]);
    expect(e.unlocked).toEqual(['multishot']);
    expect(e.maxLevelBonus).toEqual({ attackSpeed: 10 });
    expect(e.perkChoice && e.freeReroll && e.presets).toBe(true);
    expect(e.rareMul).toBe(1.5);
    expect(e.pickEvery).toBe(4);
    expect(e.cardSlots).toBe(3);
    expect(e.bitsMul).toBeCloseTo(1.21, 9);
    expect(e.startEnergy).toBe(40);
    expect(e.offlineCapHours).toBe(8);
  });
});

describe('run options', () => {
  it('carry workshop levels and lab effects into the sim', () => {
    const m = defaultMeta();
    m.workshop.damage = 4;
    m.labs = ['multishot', 'perkChoice', 'startEnergy'];
    const o = buildRunOptions(m, D, M, 2, 77);
    expect(o).toMatchObject({ seed: 77, tier: 2, extraPerkChoice: true, startEnergy: 40 });
    expect(o.workshop!.damage).toBe(4);
    expect(o.unlocked).toEqual(['multishot']);
  });
});

describe('run settlement', () => {
  it('pays Bits (× lab multiplier, × ad doubling), Keys, milestones once, best wave and tier unlocks', () => {
    const m = defaultMeta();
    m.labs = ['bits1'];
    const r = settleRun(m, D, M, { tier: 1, wave: 27, bits: 100, keys: 2, doubled: false });
    expect(r.bits).toBe(110);
    expect(r.milestones).toEqual([10, 25]);
    expect(r.keys).toBe(2 + M.milestones.keys[0]! + M.milestones.keys[1]!);
    expect(m.bits).toBe(110);
    expect(m.best['1']).toBe(27);
    expect(r.newBest).toBe(true);
    expect(m.firstRunDone).toBe(true);
    // Same milestones are not paid twice; the ad doubles the run's Bits.
    const r2 = settleRun(m, D, M, { tier: 1, wave: 26, bits: 100, keys: 0, doubled: true });
    expect(r2.milestones).toEqual([]);
    expect(r2.bits).toBe(220);
    expect(r2.newBest).toBe(false);
    expect(m.tierUnlocked).toBe(1);
    const r3 = settleRun(m, D, M, { tier: 1, wave: M.tiers.unlockWave, bits: 0, keys: 0, doubled: false });
    expect(r3.tierUnlocked).toBe(2);
    expect(m.tierUnlocked).toBe(2);
  });

  it('higher tiers pay extra Keys per milestone', () => {
    const m = defaultMeta();
    m.tierUnlocked = 3;
    const r = settleRun(m, D, M, { tier: 3, wave: 10, bits: 0, keys: 0, doubled: false });
    expect(r.keys).toBe(M.milestones.keys[0]! + 2 * M.milestones.keysPerTier);
  });
});

describe('offline income', () => {
  it('pays for time away, capped, scaled by the best wave on the highest tier', () => {
    const m = defaultMeta();
    m.best['1'] = 20;
    const t0 = 1_000_000;
    m.lastSeen = t0;
    const hour = 3600 * 1000;
    expect(offlineReward({ ...m, lastSeen: 0 }, D, M, t0 + 2 * hour).bits).toBe(0); // never seen: nothing
    const r = offlineReward(m, D, M, t0 + 2 * hour);
    expect(r.hours).toBeCloseTo(2, 9);
    expect(r.bits).toBe(Math.floor(20 * M.offline.bitsPerWaveHour * 2));
    expect(offlineReward(m, D, M, t0 + 100 * hour).hours).toBe(M.offline.capHours);
    m.labs = ['offline8'];
    expect(offlineReward(m, D, M, t0 + 100 * hour).hours).toBe(8);
    expect(offlineReward(m, D, M, t0 + 60 * 1000).bits).toBe(0);
    m.best = {};
    expect(offlineReward(m, D, M, t0 + 5 * hour).bits).toBe(0);
  });
});
