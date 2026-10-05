// Every protocol effect type and mechanic (spec §2.4): stat mods, on-hit slow/freeze/lightning, on-crit
// lightning, on-kill rewards, periodic set triggers, conditional damage/slow, rule changes.
import { describe, expect, it } from 'vitest';
import type { GameData } from '../src/sim/data';
import type { SimEvent } from '../src/sim/events';
import { grantPerk, perkProfile } from '../src/sim/perks';
import { createWorld, type World, worldStats } from '../src/sim/state';
import { combatStats, step } from '../src/sim/step';
import { spawnEnemy } from '../src/sim/waves';
import { type DeepPartial, ofType, type StatBases, stepN, mechanicsData } from './helpers';

/** A world in wave 1 with no regular spawns: enemies are placed by the test. */
function arena(patch: DeepPartial<GameData> = {}, bases: StatBases = {}, perks: string[] = []): { d: GameData; w: World } {
  const d = mechanicsData(patch, { health: 1e9, ...bases });
  const w = createWorld(d, { seed: 1, tier: 1, protocols: false });
  step(w, d, [], []);
  w.spawnQueue = [];
  w.enemies = [];
  for (const id of perks) grantPerk(w, d, id, null);
  return { d, w };
}

/** A sturdy basic enemy at (x, y) that does not move (speed 0 keeps distances fixed). */
function dummy(w: World, d: GameData, x: number, y: number, hp = 1000, kind: 'basic' | 'ranged' | 'boss' = 'basic') {
  const e = spawnEnemy(w, d, kind, x, y, []);
  e.hp = hp;
  e.maxHp = hp;
  return e;
}

const CHAIN6 = ['bounce', 'bounce', 'bounce', 'arc', 'arc', 'arc'];

describe('stat effects (statAdd / statMul) and the Interest cap', () => {
  it('statAdd and statMul land in World.mods and effectiveStats', () => {
    const { d, w } = arena();
    const s0 = worldStats(w, d);
    grantPerk(w, d, 'critSpike', null);
    grantPerk(w, d, 'bunker', null);
    const s1 = worldStats(w, d);
    expect(s1.critChance).toBeCloseTo(s0.critChance + 0.05, 12);
    expect(s1.health).toBeCloseTo(s0.health * 1.4, 6);
    expect(s1.range).toBeCloseTo(s0.range * 0.8, 9);
    expect(w.mods.map((m) => m.source)).toEqual(['perk:critSpike', 'perk:bunker', 'perk:bunker']);
  });

  it('Compound (×1.5) and the 💰 6-set (×2) raise the Interest cap paid at wave end', () => {
    const { d, w } = arena({}, {}, []);
    w.unlocked = ['interest'];
    const c0 = worldStats(w, d).interestCap;
    grantPerk(w, d, 'compound', null);
    expect(worldStats(w, d).interestCap).toBeCloseTo(c0 * 1.5, 9);
    for (const id of ['energySiphon', 'energySiphon', 'dataMine', 'dataMine', 'bounty']) grantPerk(w, d, id, null);
    expect(w.setTiers.mining).toBe(6);
    expect(worldStats(w, d).interestCap).toBeCloseTo(c0 * 1.5 * 2, 9);
    // Paid interest is capped by it.
    w.energy = 1e9;
    const ev = stepN(w, d, d.config.waveSeconds * d.config.tickHz);
    expect(ofType(ev, 'waveReward')[0]!.interest).toBeCloseTo(c0 * 3, 6);
  });
});

describe('slow and freeze', () => {
  it('Frost Shot slows a hit enemy by 20 % for 2 s; the 🧊 2-set adds 10 %', () => {
    for (const set of [false, true]) {
      const { d, w } = arena({}, {}, set ? ['frostShot', 'coldAura'] : ['frostShot']);
      const e = dummy(w, d, 280, 0);
      e.speed = 30;
      const ev = stepN(w, d, 15);
      expect(ofType(ev, 'hit').length).toBeGreaterThan(0);
      const expected = set ? 0.2 + 0.1 : 0.2;
      expect(e.slow).toBeCloseTo(0.2, 12);
      expect(e.slowUntil).toBeGreaterThan(w.tick);
      const x0 = e.x;
      // Outside the Cold Aura (inner 40 % of 300): only the on-hit slow (+ bonus) applies.
      w.core.fireCd = 1e9;
      step(w, d, [], []);
      expect(x0 - e.x).toBeCloseTo((30 * (1 - expected)) / d.config.tickHz, 9);
    }
  });

  it('the slow expires after its duration', () => {
    const { d, w } = arena({}, {}, ['frostShot']);
    const e = dummy(w, d, 280, 0);
    e.speed = 30;
    stepN(w, d, 10);
    w.core.fireCd = 1e9;
    stepN(w, d, 2 * d.config.tickHz + 1);
    const x0 = e.x;
    step(w, d, [], []);
    expect(x0 - e.x).toBeCloseTo(30 / d.config.tickHz, 9);
  });

  it('Cold Aura (conditional innerRange) slows only inside 40 % of the range; slows are capped', () => {
    const { d, w } = arena({}, {}, ['coldAura', 'coldAura', 'coldAura']);
    w.core.fireCd = 1e9;
    const inner = dummy(w, d, 100, 0);
    const outer = dummy(w, d, 0, 200);
    inner.speed = outer.speed = 30;
    step(w, d, [], []);
    const r = d.perks.rules;
    // 3 stacks × 15 % + the 🧊 2-set bonus (3 Cryo perks), under the cap.
    expect(w.setTiers.cryo).toBe(2);
    expect(100 - inner.x).toBeCloseTo((30 * (1 - Math.min(r.slowCap, 0.45 + 0.1))) / d.config.tickHz, 9);
    expect(200 - outer.y).toBeCloseTo(30 / d.config.tickHz, 9);
  });

  it('Permafrost freezes on hit: no move, no attack; Deep Freeze doubles the duration', () => {
    for (const deep of [false, true]) {
      const { d, w } = arena({ perks: { perks: { permafrost: { effects: [{ type: 'onHit', action: 'freeze', chance: 1, seconds: 1 }] } } } }, {}, deep ? ['permafrost', 'deepFreeze'] : ['permafrost']);
      const e = dummy(w, d, d.core.radius + d.enemies.basic.radius, 0);
      e.attackCd = 1e9;
      let ev: SimEvent[] = [];
      while (ofType(ev, 'freeze').length === 0) ev = stepN(w, d, 1);
      const until = e.frozenUntil;
      expect(until - w.tick).toBe((deep ? 2 : 1) * d.config.tickHz);
      e.attackCd = 1;
      w.core.fireCd = 1e9;
      const frozen = stepN(w, d, until - w.tick);
      expect(ofType(frozen, 'coreHit')).toHaveLength(0);
      expect(ofType(stepN(w, d, 2), 'coreHit')).toHaveLength(1);
    }
  });

  it('the 🧊 6-set freezes every enemy for 2 s every 20 s (only when enemies are present)', () => {
    const { d, w } = arena({}, {}, ['frostShot', 'frostShot', 'frostShot', 'coldAura', 'coldAura', 'coldAura']);
    expect(w.setTiers.cryo).toBe(6);
    w.core.fireCd = 1e9;
    stepN(w, d, 25 * d.config.tickHz); // empty arena: the trigger waits
    const a = dummy(w, d, 250, 0);
    const b = dummy(w, d, -250, 0);
    const ev = stepN(w, d, 1);
    expect(ofType(ev, 'freezeAll')).toEqual([{ type: 'freezeAll', count: 2, untilTick: w.tick + 2 * d.config.tickHz }]);
    expect(a.frozenUntil).toBe(w.tick + 60);
    expect(b.frozenUntil).toBe(w.tick + 60);
    expect(ofType(stepN(w, d, 20 * d.config.tickHz - 1), 'freezeAll')).toHaveLength(0);
    expect(ofType(stepN(w, d, 1), 'freezeAll')).toHaveLength(1);
  });
});

describe('conditional damage', () => {
  it('Shatter: +30 % damage to slowed enemies', () => {
    const { d, w } = arena({}, { critChance: 0 }, ['shatter']);
    const e = dummy(w, d, 150, 0);
    const plain = ofType(stepN(w, d, 10), 'hit')[0]!.damage;
    e.slow = 0.2;
    e.slowUntil = w.tick + 1000;
    w.core.fireCd = 0;
    const hits = ofType(stepN(w, d, 10), 'hit');
    expect(hits[0]!.damage).toBeCloseTo(plain * 1.3, 9);
  });

  it('🧊 4-set: frozen enemies take +50 % (and count as slowed for Shatter)', () => {
    const { d, w } = arena({}, { critChance: 0 }, ['shatter', 'frostShot', 'coldAura', 'coldAura']);
    expect(w.setTiers.cryo).toBe(4);
    const e = dummy(w, d, 280, 0);
    e.frozenUntil = w.tick + 1000;
    const st = worldStats(w, d);
    const hit = ofType(stepN(w, d, 12), 'hit')[0]!;
    expect(hit.damage).toBeCloseTo(st.damage * 1.3 * 1.5, 9);
  });

  it('every Nth shot (Hot Barrel): the 10th projectile is ×3 and flagged big', () => {
    const { d, w } = arena({}, { critChance: 0, attackSpeed: 30 }, ['hotBarrel']);
    dummy(w, d, 100, 0, 1e9);
    const ev = stepN(w, d, 20);
    const shots = ofType(ev, 'shot');
    expect(shots.filter((s) => s.big).length).toBe(Math.floor(w.core.shots / 10));
    expect(shots[9]!.big).toBe(true);
    expect(shots[8]!.big).toBe(false);
    const dmg = ofType(ev, 'hit').map((h) => h.damage);
    expect(Math.max(...dmg)).toBeCloseTo(worldStats(w, d).damage * 3, 9);
  });

  it('targetHpBelow (execute-style) multiplies damage on wounded enemies', () => {
    const { d, w } = arena({ perks: { perks: { shatter: { effects: [{ type: 'conditional', when: 'targetHpBelow', frac: 0.5, damageMul: 2 }] } } } }, { critChance: 0 }, ['shatter']);
    const e = dummy(w, d, 150, 0, 1000);
    const full = ofType(stepN(w, d, 10), 'hit')[0]!.damage;
    e.hp = 400;
    w.core.fireCd = 0;
    expect(ofType(stepN(w, d, 10), 'hit')[0]!.damage).toBeCloseTo(full * 2, 9);
  });
});

describe('lightning and bounce', () => {
  const ARC1 = { perks: { perks: { arc: { effects: [{ type: 'onHit', action: 'lightning', chance: 1 }] } } } } as DeepPartial<GameData>;

  it('Arc: lightning strikes the nearest 3 other enemies (spatial hash) for 50 %', () => {
    const { d, w } = arena(ARC1, { critChance: 0 }, ['arc']);
    const src = dummy(w, d, 80, 0); // nearest to the core: the first target
    const near = [dummy(w, d, 110, 0), dummy(w, d, 80, 45), dummy(w, d, 100, -35)];
    const far = dummy(w, d, 80, 160); // in lightning range, but further than the 3 nearest
    const outOfRange = dummy(w, d, -200, 0);
    const ev = stepN(w, d, 6);
    const l = ofType(ev, 'lightning')[0]!;
    expect(l.fromId).toBe(src.id);
    expect([...l.targets].sort()).toEqual(near.map((e) => e.id).sort());
    expect(l.targets).not.toContain(far.id);
    expect(l.targets).not.toContain(outOfRange.id);
    const shot = ofType(ev, 'hit').find((h) => h.source === 'shot')!;
    const bolts = ofType(ev, 'hit').filter((h) => h.source === 'lightning');
    expect(bolts).toHaveLength(3);
    for (const b of bolts) expect(b.damage).toBeCloseTo(shot.damage * 0.5, 9);
  });

  it('Conductive adds a target; the 🔗 6-set doubles the chain', () => {
    const { d, w } = arena(ARC1, { critChance: 0 }, ['arc', 'conductive']);
    expect(perkProfile(w, d).rules.lightningTargets).toBe(4);
    for (const id of ['bounce', 'bounce', 'bounce', 'arc']) grantPerk(w, d, id, null);
    expect(w.setTiers.chain).toBe(6);
    expect(perkProfile(w, d).rules.lightningTargets).toBe(8);
  });

  it('🔗 4-set: every crit throws lightning (onCrit)', () => {
    const { d, w } = arena({}, { critChance: 1 }, ['bounce', 'bounce', 'bounce', 'conductive']);
    expect(w.setTiers.chain).toBe(4);
    expect(perkProfile(w, d).critLightning).toBe(true);
    dummy(w, d, 100, 0);
    dummy(w, d, 120, 0);
    const ev = stepN(w, d, 6);
    expect(ofType(ev, 'lightning').length).toBeGreaterThan(0);
  });

  it('🔗 6-set: hits on the boss always throw lightning', () => {
    const { d, w } = arena({}, { critChance: 0 }, CHAIN6);
    const boss = dummy(w, d, 120, 0, 1e6, 'boss');
    dummy(w, d, 150, 0);
    const ev = stepN(w, d, 8);
    expect(ofType(ev, 'lightning').some((l) => l.fromId === boss.id)).toBe(true);
  });

  it('Bounce: the projectile retargets the nearest enemy it has not hit, at 70 % damage, and never ping-pongs', () => {
    const { d, w } = arena({}, { critChance: 0 }, ['bounce', 'bounce']);
    expect(perkProfile(w, d).rules.bounces).toBe(3); // 2 perks + the 🔗 2-set
    const a = dummy(w, d, 100, 0);
    const b = dummy(w, d, 160, 0);
    w.core.fireCd = 0;
    const ev = stepN(w, d, 12);
    w.core.fireCd = 1e9;
    const bounces = ofType(ev, 'bounce').filter((x) => x.fromId === a.id);
    expect(bounces[0]).toMatchObject({ fromId: a.id, toId: b.id });
    const first = ofType(ev, 'hit').filter((h) => h.source === 'shot');
    expect(first[1]!.enemyId).toBe(b.id);
    expect(first[1]!.damage).toBeCloseTo(first[0]!.damage * 0.7, 9);
    // With only two enemies the projectile stops after A → B (it never returns to A).
    const p0 = ofType(ev, 'shot')[0]!.projectileId;
    expect(ofType(ev, 'bounce').filter((x) => x.projectileId === p0)).toHaveLength(1);
  });

  it('on-hit procs fire on the first hit only: a bounced-to enemy is not slowed by Frost Shot', () => {
    const { d, w } = arena({}, { critChance: 0 }, ['bounce', 'frostShot']);
    const a = dummy(w, d, 100, 0);
    const b = dummy(w, d, 160, 0);
    w.core.fireCd = 0;
    const ev = stepN(w, d, 12);
    w.core.fireCd = 1e9;
    expect(ofType(ev, 'bounce').some((x) => x.fromId === a.id && x.toId === b.id)).toBe(true);
    expect(a.slow).toBeGreaterThan(0);
    expect(b.slow).toBe(0);
  });

  it('Overcharge Link: +2 bounces, each bounce −40 % damage', () => {
    const { d, w } = arena({}, {}, ['overchargeLink']);
    const r = perkProfile(w, d).rules;
    expect(r.bounces).toBe(2);
    expect(r.bounceDamage).toBeCloseTo(d.perks.rules.bounceDamage * 0.6, 12);
  });
});

describe('periodic set triggers', () => {
  it('⚡ 6-set Overdrive: every 30 s ×2 attack speed for 8 s', () => {
    const { d, w } = arena({}, {}, ['critSpike', 'critSpike', 'critSpike', 'critSpike', 'critSpike', 'burstFire']);
    expect(w.setTiers.overload).toBe(6);
    dummy(w, d, 200, 0, 1e12);
    w.core.fireCd = 1e9;
    const base = worldStats(w, d).attackSpeed;
    let ev: SimEvent[] = [];
    let n = 0;
    while (ofType(ev, 'overdrive').length === 0 && n++ < 40 * 30) ev = stepN(w, d, 1);
    const od = ofType(ev, 'overdrive')[0]!;
    expect(od.untilTick).toBe(w.tick + 8 * d.config.tickHz);
    const prof = perkProfile(w, d);
    expect(combatStats(w, d, prof).attackSpeed).toBeCloseTo(base * 2, 9);
    stepN(w, d, 8 * d.config.tickHz + 1);
    expect(combatStats(w, d, perkProfile(w, d)).attackSpeed).toBeCloseTo(base, 9);
  });

  it('🛡 6-set immunity: a hit that would drop HP below 50 % is blocked, then 3 s of immunity, recharging every 3 waves', () => {
    const { d, w } = arena({}, { health: 100, regen: 0 }, ['patch', 'patch', 'hardening', 'hardening', 'reflect', 'reflect']);
    expect(w.setTiers.firewall).toBe(6);
    w.core.fireCd = 1e9;
    const max = worldStats(w, d).health;
    w.core.hp = max * 0.55;
    const e = dummy(w, d, d.core.radius + d.enemies.basic.radius, 0);
    e.damage = max * 0.2;
    e.attackCd = 1;
    const ev = stepN(w, d, 1);
    expect(ofType(ev, 'immunity')).toHaveLength(1);
    expect(ofType(ev, 'coreHit')[0]).toMatchObject({ blocked: true, damage: 0 });
    expect(w.core.hp).toBeGreaterThanOrEqual(max * 0.55);
    // Still immune for 3 s, then exposed (the charge is spent until wave + 3).
    e.attackCd = 1;
    expect(ofType(stepN(w, d, 1), 'coreHit')[0]!.blocked).toBe(true);
    stepN(w, d, 3 * d.config.tickHz);
    e.attackCd = 1;
    const later = ofType(stepN(w, d, 1), 'coreHit')[0]!;
    expect(later.blocked).toBe(false);
    expect(later.damage).toBeGreaterThan(0);
    // Recharged 3 waves later.
    w.wave += 3;
    w.core.hp = max * 0.55;
    e.attackCd = 1;
    expect(ofType(stepN(w, d, 1), 'immunity')).toHaveLength(1);
  });
});

describe('on-kill rewards, Keys and rule changes', () => {
  it('Energy Siphon: +10 % Energy per kill per stack', () => {
    const run = (perks: string[]) => {
      const { d, w } = arena({}, { damage: 1e6 }, perks);
      dummy(w, d, 100, 0, 5);
      return ofType(stepN(w, d, 10), 'kill')[0]!.energy;
    };
    expect(run(['energySiphon'])).toBeCloseTo(run([]) * 1.1, 9);
  });

  it('bosses drop Keys; Bounty doubles their Energy and Bits; the 💰 6-set adds a Key', () => {
    const kill = (perks: string[]) => {
      const { d, w } = arena({}, { damage: 1e6 }, perks);
      dummy(w, d, 100, 0, 5, 'boss');
      const k = ofType(stepN(w, d, 10), 'kill')[0]!;
      return { k, keys: w.keys };
    };
    const plain = kill([]);
    expect(plain.k.keys).toBe(1);
    expect(plain.keys).toBe(1);
    const bounty = kill(['bounty']);
    expect(bounty.k.energy).toBeCloseTo(plain.k.energy * 2, 9);
    expect(bounty.k.bits).toBeCloseTo(plain.k.bits * 2, 9);
    const six = kill(['energySiphon', 'energySiphon', 'dataMine', 'dataMine', 'bounty', 'greedyProtocol']);
    expect(six.keys).toBe(2);
  });

  it('Greedy Protocol: +40 % Energy Bonus, enemies spawn with +15 % HP', () => {
    const { d, w } = arena();
    const a = spawnEnemy(w, d, 'basic', 300, 0, []);
    grantPerk(w, d, 'greedyProtocol', null);
    const b = spawnEnemy(w, d, 'basic', 300, 0, []);
    expect(b.maxHp).toBeCloseTo(a.maxHp * 1.15, 12);
    expect(worldStats(w, d).energyBonus).toBeCloseTo(0.4, 12);
  });

  it('🛡 4-set: Thorns also reflect ranged hits', () => {
    for (const set of [false, true]) {
      const { d, w } = arena({}, { thorns: 1 }, set ? ['reflect', 'reflect', 'reflect', 'reflect'] : ['reflect']);
      w.core.fireCd = 1e9;
      const r = dummy(w, d, d.enemies.ranged.standoff, 0, 1000, 'ranged');
      r.attackCd = 1;
      const ev = stepN(w, d, 1);
      expect(ofType(ev, 'coreHit')).toHaveLength(1);
      expect(ofType(ev, 'hit').filter((h) => h.source === 'thorns')).toHaveLength(set ? 1 : 0);
    }
  });

  it('💰 4-set: +25 % Bits at the end of the run', () => {
    const { d, w } = arena({}, { health: 1, regen: 0 }, ['energySiphon', 'energySiphon', 'dataMine', 'dataMine']);
    expect(w.setTiers.mining).toBe(4);
    w.bits = 100;
    const e = dummy(w, d, d.core.radius + d.enemies.basic.radius, 0);
    e.attackCd = 1;
    e.damage = 1e6;
    const death = ofType(stepN(w, d, 1), 'death')[0]!;
    expect(death.bonusBits).toBeCloseTo(25, 9);
    expect(w.bits).toBeCloseTo(125, 9);
  });
});
