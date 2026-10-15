import { describe, expect, it } from 'vitest';
import { applyCommands } from '../src/sim/commands';
import { ring } from '../src/sim/hex';
import { hashWorld } from '../src/sim/hash';
import { SECTOR_DIRS, sectorOf } from '../src/sim/hex';
import { validateSets, validateEffect, type Effect } from '../src/sim/perkData';
import { fusionStructure, grantPerk, perkProfile } from '../src/sim/perks';
import { restore, snapshot } from '../src/sim/snapshot';
import { createWorld, worldStats, type Struct, type World } from '../src/sim/state';
import type { SimEvent } from '../src/sim/events';
import { breakSegment, prepareStructures, wallMaxHp, wallRadius } from '../src/sim/structures';
import { combatStats } from '../src/sim/step';
import { spawnEnemy } from '../src/sim/waves';
import { farMul, terrainFor } from '../src/sim/territory';
import { effectLine } from '../src/ui/perkText';
import { ofType, type StatBases, stepN, testData } from './helpers';

// No random spawns, a core that does not shoot or heal: only the viruses the test places.
function setup(tier: 0 | 1 | 3 | 5, core: StatBases = {}) {
  const data = testData({ config: { baseEnemiesPerWave: 0, enemiesPerWaveGrowth: 0 } }, { damage: 0, regen: 0, thorns: 0, ...core });
  const w = createWorld(data, { seed: 1, tier: 1, protocols: false });
  if (tier > 0) w.fusionTiers['cryo+firewall'] = tier;
  stepN(w, data, 1); // wave 1 starts: the ring is fixed and the segments are created
  return { data, w };
}

const seg = (w: World, slot: number) => w.structs.find((s) => s.kind === 'wall' && s.slot === slot)!;
/** A world point on the axis of sector `slot`, `d` from the core. */
const onAxis = (slot: number, d: number): [number, number] => [SECTOR_DIRS[slot]![0] * d, SECTOR_DIRS[slot]![1] * d];

describe('structures: the Ice Wall (spec 2026-10-15, phase 1)', () => {
  it('one cryo-firewall link builds six segments on the first wave tick, ids stable across a snapshot round trip', () => {
    const { data, w } = setup(1);
    expect(w.wallR).toBeGreaterThanOrEqual(data.structures.wall.minRadius);
    expect(w.structs.map((s) => [s.kind, s.slot, s.share])).toEqual([0, 1, 2, 3, 4, 5].map((i) => ['wall', i, 1]));
    const ids = w.structs.map((s) => s.id);
    stepN(w, data, 5);
    expect(w.structs.map((s) => s.id)).toEqual(ids);
    const back = restore(snapshot(w));
    stepN(back, data, 20);
    stepN(w, data, 20);
    expect(back.structs).toEqual(w.structs);
  });

  it('no link, no wall; wall arc i is the sector sectorOf gives for a virus on SECTOR_DIRS[i]', () => {
    const none = setup(0);
    expect(none.w.structs).toEqual([]);
    const { w } = setup(1);
    for (let i = 0; i < 6; i++) {
      const [x, y] = onAxis(i, w.wallR + 20);
      expect(sectorOf(x, y)).toBe(i);
      expect([seg(w, i).x, seg(w, i).y]).toEqual(onAxis(i, w.wallR));
    }
  });

  it('wall radius: base at the start, grows with the crystal, never past Range minus the margin', () => {
    const { data, w } = setup(1);
    const st = worldStats(w, data);
    expect(wallRadius(data, st, 1)).toBe(data.structures.wall.minRadius);
    expect(wallRadius(data, st, 1000)).toBeLessThanOrEqual(st.range - data.structures.wall.rangeMargin);
  });

  it('a melee virus stops at the wall and damages the segment, not the core', () => {
    const { data, w } = setup(1, { health: 100 });
    const [x, y] = onAxis(2, w.wallR + 14 + 3);
    const e = spawnEnemy(w, data, 'basic', x, y, []);
    const hits = ofType(stepN(w, data, 3), 'structHit');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: 'wall', sid: seg(w, 2).id, enemyId: e.id, ranged: false });
    expect(Math.hypot(e.x, e.y)).toBeCloseTo(w.wallR + e.radius, 6);
    expect(w.core.hp).toBe(100);
    expect(seg(w, 2).share).toBeCloseTo(1 - e.damage / (100 * 0.1), 6);
    expect(seg(w, 3).share).toBe(1);
  });

  it('a ranged virus stops at the wall too and shoots the segment', () => {
    const { data, w } = setup(1, { health: 100 });
    const [x, y] = onAxis(0, w.wallR + 13 + 2);
    const e = spawnEnemy(w, data, 'ranged', x, y, []);
    const hits = ofType(stepN(w, data, 3), 'structHit');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ enemyId: e.id, ranged: true });
    expect(w.core.hp).toBe(100);
  });

  it('a broken segment lets the virus through to the core, and only in its own sector', () => {
    const { data, w } = setup(1, { health: 100 });
    const [x, y] = onAxis(1, w.wallR + 14 + 1);
    spawnEnemy(w, data, 'basic', x, y, []);
    const events = stepN(w, data, 600);
    const down = ofType(events, 'structDown');
    expect(down).toHaveLength(1);
    expect(down[0]).toMatchObject({ kind: 'wall', sid: seg(w, 1).id });
    expect(seg(w, 1).share).toBe(0);
    expect(ofType(events, 'coreHit').length).toBeGreaterThan(0);
    expect(seg(w, 0).share).toBe(1);
  });

  it('a virus already inside the ring ignores a segment that appears behind it', () => {
    const { data, w } = setup(1, { health: 100 });
    const [x, y] = onAxis(4, data.core.radius + 14 + 1);
    spawnEnemy(w, data, 'basic', x, y, []);
    const events = stepN(w, data, 3);
    expect(ofType(events, 'structHit')).toHaveLength(0);
    expect(ofType(events, 'coreHit')).toHaveLength(1);
  });

  it('wave start repairs the segments no virus contests; a contested one keeps its damage', () => {
    const { data, w } = setup(1, { health: 100 });
    seg(w, 0).share = 0.3;
    seg(w, 3).share = 0;
    seg(w, 5).share = 0.4;
    const [x, y] = onAxis(0, w.wallR + 30);
    spawnEnemy(w, data, 'basic', x, y, []);
    const events: Parameters<typeof prepareStructures>[4] = [];
    const prof = perkProfile(w, data);
    prepareStructures(w, data, combatStats(w, data, prof), prof, events);
    expect(seg(w, 0).share).toBe(0.3);
    expect(seg(w, 3).share).toBe(1);
    expect(seg(w, 5).share).toBe(1);
    expect(events.filter((e) => e.type === 'structUp')).toHaveLength(1);
  });

  it('a ring that grew pushes a parked virus out to the new wall', () => {
    const { data, w } = setup(1, { health: 100 });
    const ring = w.wallR;
    w.wallR = 200; // as if the previous wave had a smaller ring
    const [x, y] = onAxis(2, 210);
    const e = spawnEnemy(w, data, 'basic', x, y, []);
    const prof = perkProfile(w, data);
    prepareStructures(w, data, combatStats(w, data, prof), prof, []);
    expect(w.wallR).toBe(ring);
    expect(Math.hypot(e.x, e.y)).toBeCloseTo(ring + e.radius, 6);
    expect(sectorOf(e.x, e.y)).toBe(2);
  });

  it('Thorns reflect on wall hits and thornsSlow slows the attacker (tier II)', () => {
    const { data, w } = setup(3, { health: 1000, thorns: 0.5 });
    const [x, y] = onAxis(2, w.wallR + 14 + 1);
    const e = spawnEnemy(w, data, 'basic', x, y, []);
    const before = e.hp;
    stepN(w, data, 2);
    expect(e.hp).toBeLessThan(before);
    expect(e.slow).toBeCloseTo(0.3, 6);
    expect(e.slowUntil).toBeGreaterThan(w.tick);
  });

  it('tier I: a broken segment stays down until the next uncontested wave start; tier II: it regrows after regrowSec', () => {
    for (const [tier, regrows] of [[1, false], [3, true]] as const) {
      const { data, w } = setup(tier, { health: 100 });
      const s = seg(w, 0);
      const id = s.id;
      const [x, y] = onAxis(0, w.wallR + 14 + 1);
      const e = spawnEnemy(w, data, 'basic', x, y, []);
      stepN(w, data, 90);
      expect(s.share, `tier ${tier} broke`).toBe(0);
      e.hp = 0;
      w.enemies = [];
      const secs = fusionStructure(w, data, 'wall')!.regrowSec;
      expect(secs !== undefined).toBe(regrows);
      // It broke within 3 s; ten more seconds is still wave 1 (regrowSec is 10).
      const events = stepN(w, data, 10 * data.config.tickHz + 5);
      expect(w.wave).toBe(1);
      expect(seg(w, 0).id).toBe(id);
      expect(seg(w, 0).share).toBe(regrows ? 1 : 0);
      expect(ofType(events, 'structUp').length > 0).toBe(regrows);
      if (!regrows) {
        // Nobody contests it: the next wave start rebuilds it.
        expect(ofType(stepN(w, data, 40 * data.config.tickHz), 'structUp').length).toBeGreaterThan(0);
        expect(seg(w, 0).share).toBe(1);
      }
    }
  });

  it('Shatter (tier III): a breaking segment freezes the viruses around it', () => {
    const { data, w } = setup(5, { health: 100 });
    const [x, y] = onAxis(0, w.wallR + 14 + 1);
    spawnEnemy(w, data, 'basic', x, y, []);
    const near = spawnEnemy(w, data, 'tank', ...onAxis(0, w.wallR + 40), []);
    const far = spawnEnemy(w, data, 'tank', ...onAxis(3, w.wallR + 200), []);
    seg(w, 0).share = 0.05;
    const events = stepN(w, data, 3);
    expect(ofType(events, 'structDown')).toHaveLength(1);
    expect(near.frozenUntil).toBeGreaterThan(w.tick);
    expect(far.frozenUntil).toBeLessThanOrEqual(w.tick);
  });

  it('unlinking turns a damaged segment into a destroyed one; an undamaged one waits dormant and returns intact', () => {
    const { data, w } = setup(1, { health: 100 });
    seg(w, 2).share = 0.5;
    w.fusionTiers['cryo+firewall'] = 0;
    const events = stepN(w, data, 2);
    expect(ofType(events, 'structDown').map((e) => e.sid)).toEqual([seg(w, 2).id]);
    expect(seg(w, 2).share).toBe(0);
    expect(seg(w, 1).share).toBe(1);
    // Dormant: nothing is in the way any more.
    const [x, y] = onAxis(1, w.wallR + 14 + 1);
    spawnEnemy(w, data, 'basic', x, y, []);
    expect(ofType(stepN(w, data, 3), 'structHit')).toHaveLength(0);
    w.fusionTiers['cryo+firewall'] = 1;
    stepN(w, data, 1);
    expect(seg(w, 1).share).toBe(1);
    expect(w.structs).toHaveLength(6);
  });

  it('wall HP is a share of the core Health, so Health purchases upgrade it', () => {
    const { data, w } = setup(1, { health: 100 });
    const st = worldStats(w, data);
    expect(wallMaxHp(st, fusionStructure(w, data, 'wall')!)).toBeCloseTo(10, 9);
  });

  it('an old save without structs/wallR restores to defaults and builds the wall on the next tick', () => {
    const { data, w } = setup(1);
    const raw = JSON.parse(snapshot(w)) as { world: Record<string, unknown> };
    delete raw.world.structs;
    delete raw.world.wallR;
    const old = restore(JSON.stringify(raw));
    expect(old.structs).toEqual([]);
    expect(old.wallR).toBe(0);
    stepN(old, data, 1);
    expect(old.structs).toEqual([]); // the ring is fixed at the next wave start
    expect(() => restore(JSON.stringify({ ...raw, world: { ...raw.world, structs: 5 } }))).toThrow(/snapshot/);
  });

  it('restore rejects a malformed structure entry instead of crashing the first tick', () => {
    const { w } = setup(1);
    const raw = JSON.parse(snapshot(w)) as { world: { structs: Record<string, unknown>[] } };
    const bad: [string, unknown][] = [
      ['slot', 9],
      ['slot', -1],
      ['slot', 1.5],
      ['kind', 'moat'],
      ['share', 1.5],
      ['share', -0.1],
      ['id', 'x'],
      ['x', undefined],
      ['downUntilTick', undefined],
      ['powered', 'on'],
    ];
    for (const [k, v] of bad) {
      const copy = structuredClone(raw);
      copy.world.structs[2]![k] = v;
      expect(() => restore(JSON.stringify(copy)), `${k}=${String(v)}`).toThrow(/snapshot/);
    }
    expect(() => restore(JSON.stringify(raw))).not.toThrow();
  });

  it('a snapshot with damaged and down segments restores exactly and keeps stepping identically', () => {
    for (const tier of [1, 3] as const) {
      const { data, w } = setup(tier, { health: 100 });
      seg(w, 1).share = 0.4;
      seg(w, 2).share = 0;
      seg(w, 2).downUntilTick = w.tick + 200;
      const back = restore(snapshot(w));
      expect(back.structs).toEqual(w.structs);
      stepN(w, data, 300);
      stepN(back, data, 300);
      expect(back.structs).toEqual(w.structs);
      expect(hashWorld(back)).toBe(hashWorld(w));
    }
  });

  it('a tier reached by a command on the tick a wave starts already sees this wave: six segments and its ring', () => {
    const data = testData({ config: { baseEnemiesPerWave: 0, enemiesPerWaveGrowth: 0 } }, { damage: 0, regen: 0, thorns: 0 });
    const w = createWorld(data, { seed: 1, tier: 1, protocols: false });
    const at = (i: number) => ring(2)[i]!;
    grantPerk(w, data, 'frostShot', null, at(0));
    grantPerk(w, data, 'patch', null, at(2));
    expect(w.fusionTiers['cryo+firewall'] ?? 0).toBe(0);
    expect(w.wave).toBe(0);
    // The first step starts wave 1; the move links the two modules in the same step, before the wave starts.
    const events: SimEvent[] = [];
    applyCommands(w, data, [{ type: 'moveModule', from: at(2), to: at(1) }], events);
    expect(w.fusionTiers['cryo+firewall']).toBe(1);
    stepN(w, data, 1);
    expect(w.wave).toBe(1);
    expect(w.wallR).toBeGreaterThanOrEqual(data.structures.wall.minRadius);
    expect(w.structs).toHaveLength(6);
    expect(w.structs.every((s) => s.share === 1)).toBe(true);
    // And through the command queue itself (the command and the wave start share the step).
    const w2 = createWorld(data, { seed: 1, tier: 1, protocols: false });
    grantPerk(w2, data, 'frostShot', null, at(0));
    grantPerk(w2, data, 'patch', null, at(2));
    stepN(w2, data, 1, [{ type: 'moveModule', from: at(2), to: at(1) }]);
    expect(w2.wave).toBe(1);
    expect(w2.wallR).toBe(w.wallR);
    expect(w2.structs).toHaveLength(6);
  });

  it('Wave Skip still fixes the ring and repairs the quiet segments', () => {
    const data = testData({}, { health: 1e9, damage: 0 });
    const card = { id: 'skip', effects: [{ type: 'waveSkip', chance: 1 } as Effect] };
    const w = createWorld(data, { seed: 1, tier: 1, protocols: false, cards: [card] });
    w.fusionTiers['cryo+firewall'] = 1;
    const first = stepN(w, data, 1);
    expect(ofType(first, 'waveSkip')).toHaveLength(1);
    expect(w.wallR).toBeGreaterThanOrEqual(data.structures.wall.minRadius);
    expect(w.structs).toHaveLength(6);
    seg(w, 4).share = 0.2;
    seg(w, 5).share = 0;
    const next = stepN(w, data, 2 * 900 + 60);
    expect(w.wave).toBeGreaterThanOrEqual(2);
    expect(ofType(next, 'waveSkip').length).toBeGreaterThan(0);
    expect(seg(w, 4).share).toBe(1);
    expect(seg(w, 5).share).toBe(1);
  });

  it('revive stands every segment up again (with an event only while the wall is linked)', () => {
    const { data, w } = setup(1, { health: 100 });
    seg(w, 0).share = 0.3;
    seg(w, 1).share = 0;
    w.dead = true;
    const events: SimEvent[] = [];
    applyCommands(w, data, [{ type: 'revive' }], events);
    expect(w.structs.map((s) => s.share)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(ofType(events, 'structUp').map((e) => e.sid)).toEqual([seg(w, 1).id]);
    // Link broken: dormant entries are restored quietly.
    const dormant = setup(1, { health: 100 });
    dormant.w.fusionTiers['cryo+firewall'] = 0;
    seg(dormant.w, 3).share = 0;
    dormant.w.dead = true;
    const quiet: SimEvent[] = [];
    applyCommands(dormant.w, dormant.data, [{ type: 'revive' }], quiet);
    expect(seg(dormant.w, 3).share).toBe(1);
    expect(ofType(quiet, 'structUp')).toHaveLength(0);
  });

  it('a segment that went down with the link regrows after regrowSec once the wall is back at tier II', () => {
    const { data, w } = setup(3, { health: 100 });
    seg(w, 2).share = 0.5;
    w.fusionTiers['cryo+firewall'] = 0;
    stepN(w, data, 2);
    expect(seg(w, 2).share).toBe(0);
    w.fusionTiers['cryo+firewall'] = 3;
    stepN(w, data, 2);
    expect(seg(w, 2).share).toBe(0);
    expect(seg(w, 2).downUntilTick).toBeGreaterThan(w.tick);
    const events = stepN(w, data, 10 * data.config.tickHz);
    expect(w.wave).toBe(1);
    expect(seg(w, 2).share).toBe(1);
    expect(ofType(events, 'structUp').map((e) => e.sid)).toEqual([seg(w, 2).id]);
  });

  it('the push-out leaves a virus alone in a sector whose segment is down', () => {
    const { data, w } = setup(1, { health: 100 });
    const ring0 = w.wallR;
    w.wallR = 200;
    seg(w, 2).share = 0;
    seg(w, 2).downUntilTick = w.tick + 1e6;
    const [x, y] = onAxis(2, 210);
    const [x1, y1] = onAxis(1, 210);
    const open = spawnEnemy(w, data, 'basic', x, y, []);
    const closed = spawnEnemy(w, data, 'basic', x1, y1, []);
    const prof = perkProfile(w, data);
    prepareStructures(w, data, combatStats(w, data, prof), prof, []);
    expect(w.wallR).toBe(ring0);
    expect(Math.hypot(open.x, open.y)).toBeCloseTo(210, 6);
    expect(Math.hypot(closed.x, closed.y)).toBeCloseTo(ring0 + closed.radius, 6);
  });

  it('no nest is planted inside the wall ring', () => {
    const { data, w } = setup(0);
    w.wave = data.config.arenaGrowEvery * 3 - 1;
    w.phase = 'pause';
    w.phaseTick = 1e6;
    stepN(w, data, 2);
    expect(w.wave % data.config.arenaGrowEvery).toBe(0);
    const ring = wallRadius(data, worldStats(w, data), w.wave) + data.structures.wall.contestDist;
    const g = terrainFor(data);
    for (const id of w.nests) expect(g.d2[id]!).toBeGreaterThanOrEqual(ring * ring);
  });
});

describe('structures: data and text', () => {
  it('the structure effect validates its kind, fields and ranges', () => {
    const ok: Effect = { type: 'structure', kind: 'wall', hpFrac: 0.1 };
    expect(() => validateEffect(ok, 'x', true)).not.toThrow();
    expect(() => validateEffect({ type: 'structure', kind: 'moat', hpFrac: 0.1 } as unknown as Effect, 'x', true)).toThrow(/kind/);
    expect(() => validateEffect({ type: 'structure', kind: 'wall', bogus: 1 } as unknown as Effect, 'x', true)).toThrow(/bogus/);
    expect(() => validateEffect({ type: 'structure', kind: 'wall', hpFrac: 0 }, 'x', true)).toThrow(/hpFrac/);
    expect(() => validateEffect({ type: 'structure', kind: 'wall', hpFrac: 1.5 }, 'x', true)).toThrow(/hpFrac/);
  });

  it('a ladder must set the wall HP at its first tier and never lower a field', () => {
    const { data } = setup(0);
    const noHp = structuredClone(data.sets);
    noHp.fusions['cryo+firewall']!.tiers['1'] = [{ type: 'statAdd', stat: 'defense', value: 0.01 }];
    noHp.fusions['cryo+firewall']!.tiers['3'] = [{ type: 'structure', kind: 'wall', regrowSec: 10 }];
    expect(() => validateSets(noHp)).toThrow(/cryo\+firewall/);
    const lower = structuredClone(data.sets);
    lower.fusions['cryo+firewall']!.tiers['3'] = [{ type: 'structure', kind: 'wall', hpFrac: 0.05 }];
    expect(() => validateSets(lower)).toThrow(/cryo\+firewall/);
  });

  it('a structure effect is rejected outside sets.fusions (perks, set bonuses, cards)', () => {
    const wall: Effect = { type: 'structure', kind: 'wall', hpFrac: 0.1 };
    expect(() => validateEffect(wall, 'perks.x.effects[0]')).toThrow(/fusions only/);
    const { data } = setup(0);
    const sets = structuredClone(data.sets);
    sets.sets.firewall!['2'] = [wall];
    expect(() => validateSets(sets)).toThrow(/fusions only/);
  });

  it('effectLine reads each ladder step as what it adds', () => {
    const { data } = setup(0);
    expect(effectLine(data, { type: 'structure', kind: 'wall', hpFrac: 0.1 })).toBe(
      '6 wall segments, 10% Health each; viruses must break through; quiet segments are repaired each wave',
    );
    expect(effectLine(data, { type: 'structure', kind: 'wall', hpFrac: 0.18, regrowSec: 10 })).toBe(
      '6 wall segments, 18% Health each; a broken segment regrows after 10s',
    );
    expect(effectLine(data, { type: 'structure', kind: 'wall', hpFrac: 0.28, shatterRadius: 80, shatterSec: 1.5 })).toBe(
      '6 wall segments, 28% Health each; Shatter: a breaking segment freezes viruses within 80px for 1.5s',
    );
  });
});

// A world with one firewall fusion at `tier`, a core with real Damage and tanky viruses placed by the test.
function setupFusion(key: string, tier: 1 | 3 | 5, core: StatBases = {}) {
  const data = testData({ config: { baseEnemiesPerWave: 0, enemiesPerWaveGrowth: 0 } }, { damage: 100, regen: 0, thorns: 0, health: 1000, ...core });
  const w = createWorld(data, { seed: 1, tier: 1, protocols: false });
  w.fusionTiers[key] = tier;
  stepN(w, data, 1);
  return { data, w };
}
const TANK = 1e9;
const turrets = (w: World) => w.structs.filter((s) => s.kind === 'turret');
const mines = (w: World) => w.structs.filter((s) => s.kind === 'mine');

describe('structures: the Bastion (spec 2026-10-15, phase 2)', () => {
  it('tier I: one turret on the ring hits the nearest virus in range for its share of Damage, no projectile', () => {
    const { data, w } = setupFusion('overload+firewall', 1);
    expect(turrets(w)).toHaveLength(1);
    expect(w.structs.some((s) => s.kind === 'wall')).toBe(false);
    const t = turrets(w)[0]!;
    expect([t.x, t.y]).toEqual(onAxis(0, w.wallR));
    const e = spawnEnemy(w, data, 'basic', ...onAxis(0, w.wallR + 80), [], TANK);
    const ev = stepN(w, data, 2);
    const shots = ofType(ev, 'turretShot');
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({ sid: t.id, targetIds: [e.id] });
    const hit = ofType(ev, 'hit').find((h) => h.source === 'turret')!;
    expect(hit.enemyId).toBe(e.id);
    expect(hit.damage).toBeCloseTo(worldStats(w, data).damage * 0.2, 6);
  });

  it('a virus out of range is left alone; the turret waits at its cooldown', () => {
    const { data, w } = setupFusion('overload+firewall', 1);
    spawnEnemy(w, data, 'basic', ...onAxis(3, w.wallR + 300), [], TANK);
    expect(ofType(stepN(w, data, 3), 'turretShot')).toHaveLength(0);
  });

  it('Frenzy: below the Health threshold the turrets fire faster', () => {
    const shotsIn = (w: World, data: ReturnType<typeof setupFusion>['data']) => {
      spawnEnemy(w, data, 'basic', ...onAxis(0, w.wallR + 80), [], TANK).speed = 0;
      return ofType(stepN(w, data, 90), 'turretShot').length;
    };
    const calm = setupFusion('overload+firewall', 3);
    expect(turrets(calm.w)).toHaveLength(2);
    const base = shotsIn(calm.w, calm.data);
    const hurt = setupFusion('overload+firewall', 3);
    hurt.w.core.hp = worldStats(hurt.w, hurt.data).health * 0.4;
    expect(shotsIn(hurt.w, hurt.data)).toBeGreaterThan(base);
  });

  it('tier V: three turrets spread round the ring, each hitting two viruses', () => {
    const { data, w } = setupFusion('overload+firewall', 5);
    expect(turrets(w)).toHaveLength(3);
    expect(new Set(turrets(w).map((t) => sectorOf(t.x, t.y))).size).toBe(3);
    spawnEnemy(w, data, 'basic', ...onAxis(0, w.wallR + 60), [], TANK);
    spawnEnemy(w, data, 'basic', ...onAxis(0, w.wallR + 90), [], TANK);
    const shot = ofType(stepN(w, data, 2), 'turretShot').find((e) => e.targetIds.length === 2);
    expect(shot).toBeDefined();
  });

  it('turret kills pay Energy', () => {
    const { data, w } = setupFusion('overload+firewall', 1);
    const e = spawnEnemy(w, data, 'basic', ...onAxis(0, w.wallR + 80), [], 1e-9);
    e.speed = 0;
    const e0 = w.energy;
    const ev = stepN(w, data, 2);
    const kill = ofType(ev, 'kill').find((k) => k.enemyId === e.id)!;
    expect(kill.energy).toBeGreaterThan(0);
    expect(w.energy).toBeCloseTo(e0 + kill.energy, 6);
  });

  it('Frenzy also starts when a wall segment is down', () => {
    const shotsIn = (broken: boolean) => {
      const { data, w } = setupFusion('overload+firewall', 3);
      w.fusionTiers['cryo+firewall'] = 1;
      stepN(w, data, 1);
      expect(w.structs.filter((s) => s.kind === 'wall')).toHaveLength(6);
      if (broken) breakSegment(w, data, perkProfile(w, data), seg(w, 4), []);
      spawnEnemy(w, data, 'basic', ...onAxis(0, w.wallR + 80), [], TANK).speed = 0;
      return ofType(stepN(w, data, 150), 'turretShot').length;
    };
    const intact = shotsIn(false);
    expect(intact).toBeGreaterThan(0);
    expect(shotsIn(true)).toBeGreaterThanOrEqual(intact * 1.5);
  });

  it('a tier drop that lowers the count leaves the surplus turrets inert', () => {
    const { data, w } = setupFusion('overload+firewall', 5);
    expect(turrets(w)).toHaveLength(3);
    const [t0, t1, t2] = turrets(w) as [Struct, Struct, Struct];
    // Turrets keep their sector as the Bastion grows or shrinks.
    expect([t0, t1, t2].map((t) => sectorOf(t.x, t.y))).toEqual([0, 2, 4]);
    w.fusionTiers['overload+firewall'] = 1;
    stepN(w, data, 1);
    expect([t0, t1, t2].map((t) => sectorOf(t.x, t.y))).toEqual([0, 2, 4]);
    spawnEnemy(w, data, 'basic', ...onAxis(2, w.wallR + 60), [], TANK).speed = 0;
    spawnEnemy(w, data, 'basic', ...onAxis(4, w.wallR + 60), [], TANK).speed = 0;
    expect(ofType(stepN(w, data, 90), 'turretShot')).toHaveLength(0);
    spawnEnemy(w, data, 'basic', ...onAxis(0, w.wallR + 60), [], TANK).speed = 0;
    const shots = ofType(stepN(w, data, 90), 'turretShot');
    expect(shots.length).toBeGreaterThan(0);
    expect(new Set(shots.map((e) => e.sid))).toEqual(new Set([t0.id]));
  });

  it('losing the link takes the turrets off the field', () => {
    const { data, w } = setupFusion('overload+firewall', 1);
    delete w.fusionTiers['overload+firewall'];
    stepN(w, data, 2);
    expect(ofType(stepN(w, data, 30), 'turretShot')).toHaveLength(0);
  });
});

describe('structures: the Minefield (spec 2026-10-15, phase 2)', () => {
  it('plants perWave mines in the band outside the ring at wave start, replayable from the seed', () => {
    const a = setupFusion('chain+firewall', 1);
    expect(mines(a.w)).toHaveLength(2);
    const [near, far] = a.data.structures.mine.band;
    for (const m of mines(a.w)) {
      const d = Math.hypot(m.x, m.y);
      expect(d).toBeGreaterThanOrEqual(a.w.wallR + near - 1e-6);
      expect(d).toBeLessThanOrEqual(a.w.wallR + far + 1e-6);
    }
    const b = setupFusion('chain+firewall', 1);
    expect(mines(b.w)).toEqual(mines(a.w));
    const back = restore(snapshot(a.w));
    stepN(back, a.data, 30);
    stepN(a.w, a.data, 30);
    expect(hashWorld(back)).toBe(hashWorld(a.w));
  });

  it('no Minefield link, no mines', () => {
    expect(mines(setup(0).w)).toHaveLength(0);
    expect(mines(setup(1).w)).toHaveLength(0);
  });

  it('a virus on a mine sets it off: blast damage to the nearest few, the mine is spent', () => {
    const { data, w } = setupFusion('chain+firewall', 1);
    const m = mines(w)[0]!;
    const e = spawnEnemy(w, data, 'basic', m.x, m.y, [], TANK);
    e.speed = 0;
    const ev = stepN(w, data, 2);
    const blast = ofType(ev, 'mineBlast');
    expect(blast).toHaveLength(1);
    expect(blast[0]).toMatchObject({ x: m.x, y: m.y, r: 40 });
    expect(mines(w).some((s) => s.id === m.id)).toBe(false);
    const hit = ofType(ev, 'hit').find((h) => h.source === 'mine')!;
    expect(hit.enemyId).toBe(e.id);
    expect(hit.damage).toBeCloseTo(worldStats(w, data).damage * 1.5, 6);
  });

  it('the blast stops at its target count; tier II arcs lightning on from the first victim', () => {
    const { data, w } = setupFusion('chain+firewall', 3);
    const m = mines(w)[0]!;
    const near: number[] = [];
    for (let i = 0; i < 5; i++) {
      const e = spawnEnemy(w, data, 'basic', m.x + (i === 0 ? 0 : 10 + i), m.y, [], TANK);
      e.speed = 0;
      near.push(e.id);
    }
    const ev = stepN(w, data, 2);
    expect(ofType(ev, 'hit').filter((h) => h.source === 'mine')).toHaveLength(3);
    const arcs = ofType(ev, 'hit').filter((h) => h.source === 'lightning');
    expect(arcs.length).toBeGreaterThan(0);
    // Arcs use the core's Damage as their base, like a shot's lightning (not the 150 % blast).
    expect(arcs[0]!.damage).toBeCloseTo(worldStats(w, data).damage * perkProfile(w, data).rules.lightningDamage, 6);
  });

  it('surviving mines are renumbered when the next wave plants more', () => {
    const { data, w } = setupFusion('chain+firewall', 3);
    const first = mines(w)[0]!;
    w.structs.splice(w.structs.indexOf(first), 1);
    w.wave += 1;
    prepareStructures(w, data, worldStats(w, data), perkProfile(w, data), []);
    expect(mines(w).map((m) => m.slot)).toEqual(mines(w).map((_, i) => i));
  });

  it('a mine kill pays no far-from-core bonus; a turret kill at the same spot does', () => {
    const killAt = (key: string, kindOfShot: 'mine' | 'turret') => {
      const { data, w } = setupFusion(key, 1);
      const [x, y] = onAxis(0, 400);
      if (kindOfShot === 'mine') {
        const m = mines(w)[0]!;
        m.x = x;
        m.y = y;
      }
      const e = spawnEnemy(w, data, 'basic', x, y, [], 1e-9);
      e.speed = 0;
      const ev = stepN(w, data, 2);
      const src = ofType(ev, 'hit').find((h) => h.enemyId === e.id)!.source;
      expect(src).toBe(kindOfShot);
      return { kill: ofType(ev, 'kill').find((k) => k.enemyId === e.id)!, far: farMul(data, x, y) };
    };
    const mine = killAt('chain+firewall', 'mine');
    const turret = killAt('overload+firewall', 'turret');
    expect(turret.far).toBeGreaterThan(1.05);
    expect(mine.kill.energy).toBeGreaterThan(0);
    expect(turret.kill.energy / mine.kill.energy).toBeCloseTo(turret.far, 6);
    expect(turret.kill.bits / mine.kill.bits).toBeCloseTo(turret.far, 6);
  });

  it('a mine far from any virus stays put', () => {
    const { data, w } = setupFusion('chain+firewall', 1);
    const before = mines(w).length;
    stepN(w, data, 30);
    expect(mines(w)).toHaveLength(before);
  });

  it('mines stop planting at max', () => {
    const { data, w } = setupFusion('chain+firewall', 1);
    for (let i = 0; i < 6; i++) {
      w.wave += 1;
      prepareStructures(w, data, worldStats(w, data), perkProfile(w, data), []);
    }
    expect(mines(w)).toHaveLength(6);
  });
});

describe('structures: phase 2 data and text', () => {
  it('retaliate is gone as an effect type', () => {
    expect(() => validateEffect({ type: 'retaliate', value: 1 } as unknown as Effect, 'x', true)).toThrow();
  });

  it('effectLine reads the Bastion and Minefield steps', () => {
    const { data } = setup(0);
    const bastion = effectLine(data, { type: 'structure', kind: 'turret', count: 2, frenzyBelow: 0.5, frenzyMul: 2 });
    expect(bastion).toMatch(/2 turrets/);
    expect(bastion).toMatch(/Frenzy/i);
    const mine = effectLine(data, { type: 'structure', kind: 'mine', perWave: 2, max: 6, dmgMul: 1.5, blast: 40, targets: 3 });
    expect(mine).toMatch(/2 mines per wave \(up to 6\)/);
  });
});
