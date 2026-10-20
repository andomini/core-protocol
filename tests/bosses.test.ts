// Tier bosses and the FINALE unlock (uniqueness plan item 8, c1; notes in
// docs/superpowers/plans/2026-10-20-uniqueness-notes-c1.md).
import { describe, expect, it } from 'vitest';
import { DEFAULT_META_DATA, unlockWaveFor } from '../src/meta/metaData';
import { settleRun, unlockByFinale } from '../src/meta/runEnd';
import { defaultMeta } from '../src/meta/state';
import { bossShielded, isFinaleWave, shieldPhase } from '../src/sim/bosses';
import { DEFAULT_DATA, type GameData, validateData } from '../src/sim/data';
import type { SimEvent } from '../src/sim/events';
import { hashWorld } from '../src/sim/hash';
import { perkProfile } from '../src/sim/perks';
import { hitEnemy } from '../src/sim/projectiles';
import { restore, snapshot } from '../src/sim/snapshot';
import { createWorld, type Enemy, type World, worldStats } from '../src/sim/state';
import { isBossWave, scaleForWave, spawnEnemy } from '../src/sim/waves';
import { ofType, stepN, testData } from './helpers';

const D = DEFAULT_DATA;
const B = D.bosses.bosses;

function setup(tier = 1) {
  const data = testData({ config: { baseEnemiesPerWave: 0, enemiesPerWaveGrowth: 0 } }, { damage: 0, regen: 0, thorns: 0, health: 1e6 });
  const w = createWorld(data, { seed: 1, tier, protocols: false });
  stepN(w, data, 1);
  return { data, w };
}

function strike(w: World, data: GameData, e: Enemy, damage: number): SimEvent[] {
  const events: SimEvent[] = [];
  hitEnemy(w, data, worldStats(w, data), perkProfile(w, data), e, damage, false, 'shot', events);
  return events;
}

/** A boss far outside the core's range (so it neither attacks nor gets shot). */
const farBoss = (w: World, data: GameData, events: SimEvent[] = []) => spawnEnemy(w, data, 'boss', 0, 3000, events);

describe('bosses: data', () => {
  it('every tier names a distinct boss; tiers 1–5 have a FINALE at their meta unlock wave', () => {
    const ids = D.tiers.map((t) => t.boss);
    expect(ids.every((id) => id !== undefined && B[id] !== undefined)).toBe(true);
    expect(new Set(ids).size).toBe(D.tiers.length);
    for (let t = 1; t < D.tiers.length; t++) expect(D.tiers[t - 1]!.finale).toBe(unlockWaveFor(DEFAULT_META_DATA, t));
    expect(D.tiers.at(-1)!.finale).toBeUndefined();
  });

  it('every tier boss is larger than its tier\'s threat (the largest regular virus)', () => {
    const biggest = Math.max(...Object.entries(D.enemies).filter(([k]) => k !== 'boss').map(([, e]) => e.radius));
    for (const id of Object.keys(B)) expect(B[id]!.radius).toBeGreaterThan(biggest);
  });

  it('rejects an unknown boss, a half mechanic, a boss brood and a bad FINALE', () => {
    const bad = (f: (d: GameData) => void) => {
      const d = structuredClone(D);
      f(d);
      return () => validateData(d);
    };
    expect(bad((d) => (d.tiers[0]!.boss = 'nope'))).toThrow(/tiers\[0\]\.boss/);
    expect(bad((d) => delete d.bosses.bosses.overseer!.shieldSec)).toThrow(/overseer/);
    expect(bad((d) => (d.bosses.bosses.overseer!.shieldSec = 9))).toThrow(/overseer/);
    expect(bad((d) => (d.bosses.bosses.broodmother!.broodKind = 'boss'))).toThrow(/broodmother/);
    expect(bad((d) => (d.bosses.bosses.siphon!.drainHeal = 1))).toThrow(/siphon/);
    expect(bad((d) => (d.bosses.bosses.swarmlord!.auraReduce = 0))).toThrow(/swarmlord/);
    expect(bad((d) => (d.bosses.bosses.mutagen!.enrageAt = 1.5))).toThrow(/mutagen/);
    expect(bad((d) => (d.bosses.bosses.mutagen!.hint = ''))).toThrow(/mutagen/);
    expect(bad((d) => (d.tiers[0]!.finale = 49.5))).toThrow(/finale/);
    expect(bad((d) => (d.bosses.finaleHpMul = 0.5))).toThrow(/finaleHpMul/);
  });
});

describe('bosses: spawn and boss waves', () => {
  it('the boss of a tier gets its id, HP, radius and speed from bosses.json', () => {
    for (let tier = 1; tier <= D.tiers.length; tier++) {
      const { data, w } = setup(tier);
      w.wave = 10;
      const e = farBoss(w, data);
      const id = data.tiers[tier - 1]!.boss!;
      const t = data.tiers[tier - 1]!;
      const base = scaleForWave(data.enemies.boss.hp, t.hpMul, t.hpGrowth, 10) * perkProfile(w, data).rules.enemyHp;
      expect(e.boss).toBe(id);
      expect(e.finale).toBeUndefined();
      expect(e.maxHp).toBeCloseTo(base * B[id]!.hpMul, 6);
      expect(e.radius).toBe(B[id]!.radius);
    }
  });

  it('the FINALE wave is a boss wave even off the boss cadence; its boss has × finaleHpMul HP', () => {
    const d = structuredClone(D);
    d.tiers[0]!.finale = 13;
    expect(isBossWave(validateData(d), 13, 1)).toBe(true);
    expect(isBossWave(D, 13, 1)).toBe(false);
    expect(isFinaleWave(D, 50, 1)).toBe(true);
    const { data, w } = setup(1);
    w.wave = 50;
    const fin = farBoss(w, data);
    expect(fin.finale).toBe(true);
    // The same wave without a FINALE: the plain tier boss.
    const plain = structuredClone(data);
    delete plain.tiers[0]!.finale;
    const reg = farBoss(w, plain);
    expect(reg.finale).toBeUndefined();
    expect(fin.maxHp / reg.maxHp).toBeCloseTo(data.bosses.finaleHpMul, 9);
  });

  it('waveStart of a boss wave names the tier boss and flags the FINALE', () => {
    const { data, w } = setup(1);
    w.wave = 49;
    let start: Extract<SimEvent, { type: 'waveStart' }> | undefined;
    for (let i = 0; i < 3000 && start === undefined; i++) start = ofType(stepN(w, data, 1), 'waveStart')[0];
    expect(start).toEqual({ type: 'waveStart', wave: 50, boss: true, bossId: 'overseer', finale: true });
  });
});

describe('bosses: mechanics', () => {
  it('Overseer: telegraph, then a shield that blocks every hit, on a fixed clock', () => {
    const { data, w } = setup(1);
    const e = farBoss(w, data);
    const b = B.overseer!;
    const hz = data.config.tickHz;
    const ev = stepN(w, data, Math.floor(b.shieldEvery! * hz));
    const mechs = ofType(ev, 'bossMech').map((m) => m.mech);
    expect(mechs).toEqual(['shieldWarn', 'shieldUp', 'shieldDown']);
    const up = ofType(ev, 'bossMech').find((m) => m.mech === 'shieldUp')!;
    expect(up.boss).toBe('overseer');
    // The shield goes up `shieldWarn` s after the telegraph.
    expect(shieldPhase(data, b, Math.floor((b.shieldEvery! - b.shieldSec!) * hz))).toBe(2);
    expect(shieldPhase(data, b, Math.floor((b.shieldEvery! - b.shieldSec!) * hz) - 1)).toBe(1);
    // While shielded a hit does nothing.
    e.bt = Math.floor((b.shieldEvery! - 1) * hz);
    expect(bossShielded(data, e)).toBe(true);
    const hp = e.hp;
    expect(ofType(strike(w, data, e, hp / 2), 'hit')).toEqual([]);
    expect(e.hp).toBe(hp);
    e.bt = 0;
    strike(w, data, e, hp / 2);
    expect(e.hp).toBeCloseTo(hp / 2, 6);
  });

  it('Broodmother: every 25% of HP lost releases a brood of non-splitting spores', () => {
    const { data, w } = setup(2);
    const e = farBoss(w, data);
    const b = B.broodmother!;
    const n0 = w.enemies.length;
    const ev1 = strike(w, data, e, e.maxHp * 0.3);
    expect(ofType(ev1, 'bossMech').map((m) => [m.mech, m.value])).toEqual([['brood', 1]]);
    expect(w.enemies.length).toBe(n0 + b.broodCount!);
    const brood = w.enemies.slice(n0);
    expect(brood.every((c) => c.kind === b.broodKind && c.gen === data.enemies.spore.splitGens)).toBe(true);
    // A big hit pays every step it crossed; the kill itself releases none.
    const ev2 = strike(w, data, e, e.maxHp * 0.5);
    expect(ofType(ev2, 'bossMech').map((m) => m.value)).toEqual([2, 3]);
    const n1 = w.enemies.length;
    const ev3 = strike(w, data, e, e.hp * 2);
    expect(ofType(ev3, 'bossMech')).toEqual([]);
    expect(ofType(ev3, 'bossDown')).toMatchObject([{ boss: 'broodmother', finale: false, tier: 2 }]);
    expect(w.enemies.length).toBe(n1);
    // A brood spore does not split.
    expect(ofType(strike(w, data, brood[0]!, brood[0]!.hp * 2), 'split')).toEqual([]);
  });

  it('Siphon: a landed core hit drains wave-scaled Energy and heals; the kill pays it back × drainReturn', () => {
    const { data, w } = setup(3);
    const e = farBoss(w, data);
    const twin = farBoss(w, data);
    e.x = data.core.radius + e.radius + 1;
    e.y = 0;
    e.hp = e.maxHp / 2;
    w.energy = 1000;
    const ev = stepN(w, data, 4);
    const b = B.siphon!;
    const want = scaleForWave(b.drainEnergy!, 1, data.config.energyGrowth, w.wave);
    const drains = ofType(ev, 'bossMech').filter((m) => m.mech === 'drain');
    expect(drains).toHaveLength(1);
    expect(drains[0]!.value).toBeCloseTo(want, 9);
    expect(e.drained).toBeCloseTo(want, 9);
    expect(e.hp).toBeGreaterThan(e.maxHp / 2 + e.maxHp * b.drainHeal! * 0.99);
    twin.x = e.x; // same ground and distance: only the drain differs
    twin.y = e.y;
    const k1 = ofType(strike(w, data, e, e.hp * 2), 'kill')[0]!;
    const k2 = ofType(strike(w, data, twin, twin.hp * 2), 'kill')[0]!;
    expect(k1.energy - k2.energy).toBeCloseTo(want * b.drainReturn!, 6);
    // No Energy to take: no drain and no heal.
    const { data: d2, w: w2 } = setup(3);
    const f = farBoss(w2, d2);
    f.x = d2.core.radius + f.radius + 1;
    f.y = 0;
    f.hp = f.maxHp / 2;
    w2.energy = 0;
    const ev2 = stepN(w2, d2, 4);
    expect(ofType(ev2, 'bossMech')).toEqual([]);
    expect(ofType(ev2, 'coreHit').length).toBeGreaterThan(0);
  });

  it('Swarm Lord: viruses within its aura take auraReduce less damage, those outside and the lord itself full', () => {
    const { data, w } = setup(4);
    const lord = farBoss(w, data);
    const b = B.swarmlord!;
    const near = spawnEnemy(w, data, 'basic', lord.x + b.auraRadius! - 1, lord.y, []);
    const far = spawnEnemy(w, data, 'basic', lord.x + b.auraRadius! + 1, lord.y, []);
    const hit = (e: Enemy) => ofType(strike(w, data, e, 1), 'hit')[0]!.damage;
    expect(hit(near)).toBeCloseTo(1 - b.auraReduce!, 9);
    expect(hit(far)).toBe(1);
    expect(hit(lord)).toBe(1);
  });

  it('Artillery: stands off far from the core and fires at its own interval (× the tier ranged rate)', () => {
    const { data, w } = setup(5);
    const e = farBoss(w, data);
    const b = B.artillery!;
    expect(e.standoff).toBe(b.standoff);
    expect(e.attackIntervalTicks).toBe((b.attackInterval! * data.config.tickHz) / (data.tiers[4]!.rangedRateMul ?? 1));
    expect(e.standoff).toBeGreaterThan(data.stats.stats.range.base);
  });

  it('Mutagen: forces a mutation on arrival and enrages once below enrageAt', () => {
    const { data, w } = setup(6);
    w.geneTicks = 0;
    w.tagCountsNow.chain = 2;
    const before = w.genome.chain;
    const ev: SimEvent[] = [];
    const e = farBoss(w, data, ev);
    expect(w.genome.chain).toBe(before + B.mutagen!.mutations!);
    expect(ofType(ev, 'mutation')).toEqual([{ type: 'mutation', tag: 'chain', level: before + 1 }]);
    expect(ofType(ev, 'bossMech').map((m) => m.mech)).toEqual(['mutate']);
    const speed = e.speed;
    e.hp = e.maxHp * (B.mutagen!.enrageAt! - 0.01);
    const ev2 = stepN(w, data, 3);
    expect(ofType(ev2, 'bossMech').map((m) => m.mech)).toEqual(['enrage']);
    expect(e.enraged).toBe(true);
    expect(e.speed).toBeCloseTo(speed * B.mutagen!.enrageSpeed!, 9);
  });

  it('the mechanics are deterministic: the same run twice gives the same events and hash', () => {
    const run = () => {
      const { data, w } = setup(2);
      w.wave = 9;
      const evs: SimEvent[] = [];
      for (let i = 0; i < 1500; i++) {
        const ev = stepN(w, data, 1);
        evs.push(...ev);
        const boss = w.enemies.find((x) => x.boss !== undefined && x.hp > 0);
        if (boss !== undefined && i % 20 === 0) evs.push(...strike(w, data, boss, boss.maxHp * 0.07));
      }
      return { evs: JSON.stringify(evs), hash: hashWorld(w), broods: ofType(evs, 'bossMech').length };
    };
    const a = run();
    const b = run();
    expect(a.broods).toBeGreaterThan(0);
    expect(a.evs).toBe(b.evs);
    expect(a.hash).toBe(b.hash);
  });
});

describe('bosses: snapshot', () => {
  it('boss state survives a snapshot round-trip and the run continues identically', () => {
    const { data, w } = setup(3);
    const e = farBoss(w, data);
    e.bt = 123;
    e.brood = 2;
    e.drained = 45.5;
    e.enraged = true;
    e.finale = true;
    const copy = restore(snapshot(w), data);
    const c = copy.enemies.find((x) => x.id === e.id)!;
    expect(c).toEqual(e);
    stepN(w, data, 200);
    stepN(copy, data, 200);
    expect(hashWorld(copy)).toBe(hashWorld(w));
  });
});

describe('bosses: FINALE unlock', () => {
  it('a FINALE kill emits bossDown with finale and the tier', () => {
    const { data, w } = setup(1);
    w.wave = 50;
    const e = farBoss(w, data);
    const down = ofType(strike(w, data, e, e.hp * 2), 'bossDown');
    expect(down).toMatchObject([{ boss: 'overseer', finale: true, tier: 1 }]);
  });

  it('unlockByFinale opens the next tier at once, only from the highest tier, never past the last', () => {
    const m = defaultMeta();
    expect(m.tierUnlocked).toBe(1);
    expect(unlockByFinale(m, D, 1)).toBe(2);
    expect(m.tierUnlocked).toBe(2);
    expect(unlockByFinale(m, D, 1)).toBe(0);
    m.tierUnlocked = D.tiers.length;
    expect(unlockByFinale(m, D, D.tiers.length)).toBe(0);
    expect(m.tierUnlocked).toBe(D.tiers.length);
  });

  it('settleRun reports the FINALE unlock once; surviving to the wave still unlocks as before', () => {
    const md = DEFAULT_META_DATA;
    const wave = unlockWaveFor(md, 1);
    const m = defaultMeta();
    const t = unlockByFinale(m, D, 1);
    const s = settleRun(m, D, md, { tier: 1, wave, bits: 0, keys: 0, doubled: false, finaleUnlocked: t });
    expect(s.tierUnlocked).toBe(2);
    expect(m.tierUnlocked).toBe(2);
    const m2 = defaultMeta();
    const s2 = settleRun(m2, D, md, { tier: 1, wave, bits: 0, keys: 0, doubled: false });
    expect(s2.tierUnlocked).toBe(2);
    expect(m2.tierUnlocked).toBe(2);
    const m3 = defaultMeta();
    expect(settleRun(m3, D, md, { tier: 1, wave: wave - 1, bits: 0, keys: 0, doubled: false }).tierUnlocked).toBe(0);
  });
});
