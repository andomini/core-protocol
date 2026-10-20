// The four uniqueness-plan viruses (item 7, notes in docs/superpowers/plans/2026-10-20-uniqueness-notes-b2.md): Leech
// steals and pays back Bits, Spore splits once, Carrier shields its neighbours, Phage hunts structures.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DATA, ENEMY_KINDS, type GameData, validateData } from '../src/sim/data';
import type { SimEvent } from '../src/sim/events';
import { hashWorld } from '../src/sim/hash';
import { SECTOR_DIRS } from '../src/sim/hex';
import { fusionStructure, perkProfile } from '../src/sim/perks';
import { hitEnemy } from '../src/sim/projectiles';
import { restore, snapshot } from '../src/sim/snapshot';
import { createWorld, type Enemy, type World, worldStats } from '../src/sim/state';
import { scaleForWave, spawnEnemy } from '../src/sim/waves';
import { ofType, type StatBases, stepN, testData } from './helpers';

function setup(core: StatBases = {}, wallTier = 0) {
  const data = testData({ config: { baseEnemiesPerWave: 0, enemiesPerWaveGrowth: 0 } }, { damage: 0, regen: 0, thorns: 0, health: 1000, ...core });
  const w = createWorld(data, { seed: 1, tier: 1, protocols: false });
  if (wallTier > 0) w.fusionTiers['cryo+firewall'] = wallTier;
  stepN(w, data, 1);
  return { data, w };
}

function strike(w: World, data: GameData, e: Enemy, damage: number): SimEvent[] {
  const events: SimEvent[] = [];
  hitEnemy(w, data, worldStats(w, data), perkProfile(w, data), e, damage, false, 'shot', events);
  return events;
}
const kill = (w: World, data: GameData, e: Enemy) => strike(w, data, e, e.hp * 10);

describe('new virus kinds: data', () => {
  it('all four are in ENEMY_KINDS, spawn after wave 1, and basic keeps the largest weight', () => {
    for (const k of ['leech', 'spore', 'carrier', 'phage'] as const) {
      expect(ENEMY_KINDS).toContain(k);
      expect(DEFAULT_DATA.enemies[k].firstWave).toBeGreaterThan(1);
      expect(DEFAULT_DATA.enemies[k].weight).toBeLessThan(DEFAULT_DATA.enemies.basic.weight);
    }
  });

  it('a half-specified or out-of-range mechanic is rejected and names the kind', () => {
    const d = structuredClone(DEFAULT_DATA);
    delete d.enemies.spore.splitShare;
    expect(() => validateData(d)).toThrow(/spore/);
    expect(() => testData({ enemies: { carrier: { auraReduce: 1.2 } } })).toThrow(/carrier/);
    expect(() => testData({ enemies: { leech: { steal: -1 } } })).toThrow(/leech/);
  });
});

describe('leech', () => {
  it('steals wave-scaled Bits per core hit, never below 0, and pays them back ×returnMul on its kill', () => {
    const { data, w } = setup();
    w.bits = 100;
    const stopAt = data.core.radius + data.enemies.leech.radius;
    const e = spawnEnemy(w, data, 'leech', stopAt + 1, 0, []);
    const ev = stepN(w, data, 3);
    const want = scaleForWave(data.enemies.leech.steal!, data.tiers[0]!.bitsMul, data.config.bitsGrowth, 1);
    expect(ofType(ev, 'steal')).toEqual([{ type: 'steal', enemyId: e.id, bits: want, carried: want }]);
    expect(w.bits).toBeCloseTo(100 - want, 9);
    expect(e.carried).toBeCloseTo(want, 9);

    w.bits = want / 4; // less than one steal: it takes what is there, not more
    stepN(w, data, e.attackIntervalTicks);
    expect(w.bits).toBe(0);
    expect(e.carried).toBeCloseTo(want * 1.25, 9);

    const k = ofType(kill(w, data, e), 'kill')[0]!;
    expect(k.returned).toBeCloseTo(want * 1.25 * data.enemies.leech.returnMul!, 9);
    expect(w.bits).toBeCloseTo(k.bits, 9);
    expect(k.bits).toBeGreaterThan(k.returned!);
  });

  it('a kill without a theft has no `returned` field', () => {
    const { data, w } = setup();
    const e = spawnEnemy(w, data, 'leech', 300, 0, []);
    expect(ofType(kill(w, data, e), 'kill')[0]).not.toHaveProperty('returned');
  });
});

describe('spore', () => {
  it('splits into splitCount smaller copies once; the copies do not split again', () => {
    const { data, w } = setup();
    const def = data.enemies.spore;
    const e = spawnEnemy(w, data, 'spore', 300, 0, []);
    const ev = kill(w, data, e);
    const split = ofType(ev, 'split');
    expect(split).toHaveLength(1);
    expect(split[0]!.ids).toHaveLength(def.splitCount!);
    expect(ofType(ev, 'spawn')).toHaveLength(def.splitCount!);
    const kids = w.enemies.filter((x) => split[0]!.ids.includes(x.id));
    expect(kids).toHaveLength(def.splitCount!);
    for (const c of kids) {
      expect(c.kind).toBe('spore');
      expect(c.gen).toBe(1);
      expect(c.maxHp).toBeCloseTo(e.maxHp * def.splitShare!, 9);
      expect(c.radius).toBeCloseTo(e.radius * def.splitRadius!, 9);
      expect(c.bits).toBeCloseTo(e.bits * def.splitShare!, 9);
      expect(Math.hypot(c.x - e.x, c.y - e.y)).toBeCloseTo(e.radius * 0.7, 6);
    }
    expect(new Set(kids.map((c) => `${c.x.toFixed(3)},${c.y.toFixed(3)}`)).size).toBe(kids.length);
    for (const c of kids) {
      const again = kill(w, data, c);
      expect(ofType(again, 'split')).toHaveLength(0);
      expect(ofType(again, 'spawn')).toHaveLength(0);
    }
  });
});

describe('carrier', () => {
  it('viruses inside its aura take auraReduce less damage; outside, the carrier itself and after its death: full', () => {
    const { data, w } = setup();
    const def = data.enemies.carrier;
    const c = spawnEnemy(w, data, 'carrier', 300, 0, []);
    const inside = spawnEnemy(w, data, 'tank', 300, def.auraRadius! - 5, []);
    const outside = spawnEnemy(w, data, 'tank', 300, def.auraRadius! + 30, []);
    const dmg = (e: Enemy) => ofType(strike(w, data, e, 5), 'hit')[0]!.damage;
    expect(dmg(inside)).toBeCloseTo(5 * (1 - def.auraReduce!), 9);
    expect(dmg(outside)).toBe(5);
    expect(dmg(c)).toBe(5);
    kill(w, data, c);
    expect(dmg(inside)).toBe(5);
  });
});

describe('phage', () => {
  it('with no structure it stops at its standoff and shoots the core', () => {
    const { data, w } = setup();
    const e = spawnEnemy(w, data, 'phage', data.enemies.phage.standoff + 1, 0, []);
    const hits = ofType(stepN(w, data, 3), 'coreHit');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ enemyId: e.id, ranged: true });
    expect(e.x).toBeCloseTo(data.enemies.phage.standoff, 6);
  });

  it('goes for the nearest wall segment, latches on and hits it ×structureMul in melee', () => {
    const { data, w } = setup({}, 1);
    const seg = w.structs.find((s) => s.kind === 'wall' && s.slot === 2)!;
    const d = w.wallR + 260; // outside the standoff: a plain ranged virus would stop and shoot from further out
    const e = spawnEnemy(w, data, 'phage', SECTOR_DIRS[2]![0] * d, SECTOR_DIRS[2]![1] * d, []);
    let hit: Extract<SimEvent, { type: 'structHit' }> | undefined;
    for (let i = 0; i < 1200 && !hit; i++) hit = ofType(stepN(w, data, 1), 'structHit')[0];
    expect(hit).toMatchObject({ kind: 'wall', sid: seg.id, enemyId: e.id, ranged: false });
    expect(Math.hypot(e.x - seg.x, e.y - seg.y)).toBeLessThanOrEqual(e.radius + data.enemies.phage.latch! + 1e-6);
    expect(w.core.hp).toBe(1000);
    const hpFrac = fusionStructure(w, data, 'wall')!.hpFrac!;
    expect(seg.share).toBeCloseTo(1 - (e.damage * data.enemies.phage.structureMul!) / (1000 * hpFrac), 6);
  });
});

describe('determinism', () => {
  it('a run with every new kind replays to the same hash across a snapshot round trip', () => {
    const run = (cut: boolean) => {
      const data = testData({}, { health: 5000 });
      let w = createWorld(data, { seed: 77, tier: 1, protocols: false });
      w.fusionTiers['cryo+firewall'] = 1;
      stepN(w, data, 1);
      for (const [i, k] of (['leech', 'spore', 'carrier', 'phage', 'spore', 'leech'] as const).entries()) {
        const [x, y] = DEFAULT_DATA.directions[i * 10]!;
        spawnEnemy(w, data, k, x * 420, y * 420, []);
      }
      stepN(w, data, 600);
      if (cut) w = restore(snapshot(w), data);
      stepN(w, data, 600);
      return hashWorld(w);
    };
    expect(run(true)).toBe(run(false));
  });
});
