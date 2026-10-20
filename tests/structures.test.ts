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
import { powInt } from '../src/sim/num';
import { breakSegment, destroyStation, prepareStructures, wallMaxHp, wallRadius } from '../src/sim/structures';
import { combatStats } from '../src/sim/step';
import { scaleForWave, spawnEnemy } from '../src/sim/waves';
import { farMul, terrainFor } from '../src/sim/territory';
import { effectLine } from '../src/ui/perkText';
import { ofType, type StatBases, stepN, testData } from './helpers';
import { DEFAULT_DATA, type GameData, validateData } from '../src/sim/data';
import type { StructureKind } from '../src/sim/perkData';
import { structLevel, structUpgradeCost } from '../src/sim/structLevels';

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
    const { data, w } = setup(1, { health: 1000 });
    const [x, y] = onAxis(2, w.wallR + 14 + 3);
    const e = spawnEnemy(w, data, 'basic', x, y, []);
    const hits = ofType(stepN(w, data, 3), 'structHit');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: 'wall', sid: seg(w, 2).id, enemyId: e.id, ranged: false });
    expect(Math.hypot(e.x, e.y)).toBeCloseTo(w.wallR + e.radius, 6);
    expect(w.core.hp).toBe(1000);
    expect(seg(w, 2).share).toBeCloseTo(1 - e.damage / (1000 * fusionStructure(w, data, 'wall')!.hpFrac!), 6);
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
    expect(wallMaxHp(st, fusionStructure(w, data, 'wall')!)).toBeCloseTo(100 * fusionStructure(w, data, 'wall')!.hpFrac!, 9);
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

  it('a pre-feature save drops the old firewall fusion mods and tiers, keeps the other fusions', () => {
    const { w } = setup(1);
    w.fusionTiers['cryo+firewall'] = 3;
    w.fusionTiers['overload+cryo'] = 1;
    w.mods.push({ stat: 'defense', op: 'add', value: 0.05, source: 'fusion:chain+firewall:5' });
    w.mods.push({ stat: 'thorns', op: 'add', value: 0.25, source: 'fusion:cryo+firewall:3' });
    w.mods.push({ stat: 'damage', op: 'mul', value: 1.1, source: 'fusion:overload+cryo:1' });
    w.timers['fusion:mining+firewall:3:0'] = { next: 10, until: -1 };
    w.timers['fusion:overload+cryo:1:0'] = { next: 10, until: -1 };
    const raw = JSON.parse(snapshot(w)) as { world: Record<string, unknown> };
    delete raw.world.structs;
    delete raw.world.wallR;
    const old = restore(JSON.stringify(raw));
    expect(old.mods.map((m) => m.source).filter((src) => src.includes('firewall'))).toEqual([]);
    expect(old.mods.some((m) => m.source === 'fusion:overload+cryo:1')).toBe(true);
    expect(Object.keys(old.timers).filter((k) => k.includes('firewall'))).toEqual([]);
    expect('fusion:overload+cryo:1:0' in old.timers).toBe(true);
    expect(old.fusionTiers).toEqual({ 'overload+cryo': 1 });
    // A save that already has structures is left alone.
    expect(restore(snapshot(w)).mods.some((m) => m.source === 'fusion:chain+firewall:5')).toBe(true);
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

  it('a tier welded on the tick a wave starts already sees this wave: six segments and its ring', () => {
    const data = testData({ config: { baseEnemiesPerWave: 0, enemiesPerWaveGrowth: 0 }, sets: { weldTicks: 1 } }, { damage: 0, regen: 0, thorns: 0 });
    const w = createWorld(data, { seed: 1, tier: 1, protocols: false });
    const at = (i: number) => ring(2)[i]!;
    grantPerk(w, data, 'frostShot', null, at(0));
    grantPerk(w, data, 'patch', null, at(2));
    expect(w.fusionTiers['cryo+firewall'] ?? 0).toBe(0);
    expect(w.wave).toBe(0);
    // The first step starts wave 1; the move links the two modules, and the (1-tick) weld settles in that step before the wave starts.
    const events: SimEvent[] = [];
    applyCommands(w, data, [{ type: 'moveModule', from: at(2), to: at(1) }], events);
    expect(w.fusionPending['cryo+firewall']?.tier).toBe(1);
    stepN(w, data, 1);
    expect(w.fusionTiers['cryo+firewall']).toBe(1);
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
    // Link broken: a kind that is not on the field is left as it was (a destroyed segment stays destroyed).
    const dormant = setup(1, { health: 100 });
    dormant.w.fusionTiers['cryo+firewall'] = 0;
    seg(dormant.w, 3).share = 0;
    dormant.w.dead = true;
    const quiet: SimEvent[] = [];
    applyCommands(dormant.w, dormant.data, [{ type: 'revive' }], quiet);
    expect(seg(dormant.w, 3).share).toBe(0);
    expect(ofType(quiet, 'structUp')).toHaveLength(0);
  });

  it('revive leaves a surplus station and a destroyed-by-unlink kind as they were', () => {
    const { data, w } = setupFusion(MINING, 5, { health: 100 });
    w.fusionTiers[MINING] = 3;
    const [a, , c] = stations(w) as [Struct, Struct, Struct];
    a.share = 0.3;
    c.share = 0.4; // dormant surplus above the count of 2
    w.dead = true;
    const events: SimEvent[] = [];
    applyCommands(w, data, [{ type: 'revive' }], events);
    expect([a.share, c.share]).toEqual([1, 0.4]);
    // The kind is unlinked: nothing is brought back.
    const { data: d2, w: w2 } = setupFusion(MINING, 3, { health: 100 });
    const s0 = stations(w2)[0]!;
    destroyStation(w2, d2, perkProfile(w2, d2), s0, []);
    w2.fusionTiers[MINING] = 0;
    w2.dead = true;
    const ev2: SimEvent[] = [];
    applyCommands(w2, d2, [{ type: 'revive' }], ev2);
    expect(s0.share).toBe(0);
    expect(ofType(ev2, 'structUp')).toHaveLength(0);
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
    const { data, w } = setup(1);
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
    lower.fusions['cryo+firewall']!.tiers['3'] = [{ type: 'structure', kind: 'wall', hpFrac: 0.02 }];
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
    expect(hit.damage).toBeCloseTo(worldStats(w, data).damage * fusionStructure(w, data, 'turret')!.dmgFrac!, 6);
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

  it('a lone tank or boss that sets a mine off from outside the blast radius still takes the blast', () => {
    for (const kind of ['tank', 'boss'] as const) {
      const { data, w } = setupFusion('chain+firewall', 1);
      const m = mines(w)[0]!;
      const r = data.enemies[kind].radius;
      const reach = data.structures.mine.trigger + r - 0.5;
      // Past the blast radius by centre distance, inside trigger + radius.
      expect(reach).toBeGreaterThan(40);
      const e = spawnEnemy(w, data, kind, m.x + reach, m.y, [], TANK);
      e.speed = 0;
      const ev = stepN(w, data, 2);
      expect(ofType(ev, 'mineBlast'), kind).toHaveLength(1);
      const hits = ofType(ev, 'hit').filter((h) => h.source === 'mine');
      expect(hits.map((h) => h.enemyId), kind).toEqual([e.id]);
    }
  });

  it('a small virus beyond the blast does not crowd out a big one inside it', () => {
    const { data, w } = setupFusion('chain+firewall', 1);
    const m = mines(w)[0]!;
    const boss = spawnEnemy(w, data, 'boss', m.x + data.structures.mine.trigger + data.enemies.boss.radius - 0.5, m.y, [], TANK);
    boss.speed = 0;
    // Three small viruses nearer by centre than the boss but outside the blast (40 + their radius) are not hit.
    const smalls = [0, 1, 2].map((i) => {
      const e = spawnEnemy(w, data, 'basic', m.x - 60 - i, m.y + (i - 1) * 3, [], TANK);
      e.speed = 0;
      return e;
    });
    const hits = ofType(stepN(w, data, 2), 'hit').filter((h) => h.source === 'mine');
    expect(hits.map((h) => h.enemyId)).toEqual([boss.id]);
    expect(smalls.every((e) => e.hp === e.maxHp)).toBe(true);
  });

  it('a lowered cap trims the oldest mines at the next planting', () => {
    const { data, w } = setupFusion('chain+firewall', 5);
    for (let i = 0; i < 5; i++) {
      w.wave += 1;
      prepareStructures(w, data, worldStats(w, data), perkProfile(w, data), []);
    }
    expect(mines(w)).toHaveLength(12);
    const ids = mines(w).map((m) => m.id);
    w.fusionTiers['chain+firewall'] = 1;
    w.wave += 1;
    prepareStructures(w, data, worldStats(w, data), perkProfile(w, data), []);
    expect(mines(w)).toHaveLength(6);
    expect(mines(w).map((m) => m.id)).toEqual(ids.slice(6));
    expect(mines(w).map((m) => m.slot)).toEqual([0, 1, 2, 3, 4, 5]);
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

const MINING = 'mining+firewall';
const stations = (w: World) => w.structs.filter((s) => s.kind === 'station');
/** Steps one tick at a time until wave `n` has just started; returns every event on the way. */
function untilWave(w: World, data: ReturnType<typeof testData>, n: number): SimEvent[] {
  const all: SimEvent[] = [];
  while (w.wave < n) all.push(...stepN(w, data, 1));
  return all;
}
/** A world point `d` from station `s`, straight out from the core. */
const beyond = (s: Struct, d: number): [number, number] => {
  const r = Math.hypot(s.x, s.y);
  return [s.x + (s.x / r) * d, s.y + (s.y / r) * d];
};

describe('structures: Relay Stations (spec 2026-10-15, phase 3)', () => {
  it('one mining-firewall link builds a station on the first wave tick, inside the ring; three stand 120° apart', () => {
    const { data, w } = setupFusion(MINING, 1);
    expect(stations(w)).toHaveLength(1);
    expect(Math.hypot(stations(w)[0]!.x, stations(w)[0]!.y)).toBeCloseTo(w.wallR - data.structures.station.inset, 6);
    const ids = stations(w).map((s) => s.id);
    stepN(w, data, 5);
    expect(stations(w).map((s) => s.id)).toEqual(ids);
    const big = setupFusion(MINING, 5);
    const [a, b, c] = stations(big.w);
    expect(stations(big.w)).toHaveLength(3);
    const d = (p: Struct, q: Struct) => Math.hypot(p.x - q.x, p.y - q.y);
    expect(d(a!, b!)).toBeCloseTo(d(b!, c!), 6);
    expect(d(b!, c!)).toBeCloseTo(d(a!, c!), 6);
    // No link, no station.
    expect(setupFusion(MINING, 1).w.structs.every((s) => s.kind === 'station')).toBe(true);
    const none = setup(0);
    expect(none.w.structs).toEqual([]);
  });

  it('a melee virus within aggro turns to the station, stops at its radius, hits it (Defense, Thorns); the core is left alone', () => {
    const { data, w } = setupFusion(MINING, 1, { damage: 0, health: 1000, defense: 0, thorns: 0.5 });
    const s = stations(w)[0]!;
    const [x, y] = beyond(s, 50);
    const e = spawnEnemy(w, data, 'basic', x, y, []);
    const events = stepN(w, data, 120);
    const hits = ofType(events, 'structHit');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toMatchObject({ kind: 'station', sid: s.id, enemyId: e.id, ranged: false });
    expect(Math.hypot(e.x - s.x, e.y - s.y)).toBeCloseTo(data.structures.station.radius + e.radius, 6);
    expect(ofType(events, 'coreHit')).toHaveLength(0);
    expect(w.core.hp).toBe(1000);
    expect(s.share).toBeCloseTo(1 - (hits.length * e.damage) / (1000 * fusionStructure(w, data, 'station')!.hpFrac!), 6);
    expect(e.hp).toBeLessThan(e.maxHp);
  });

  it('a virus outside the aggro distance walks on to the core', () => {
    const { data, w } = setupFusion(MINING, 1, { damage: 0, health: 1000, defense: 0 });
    const s = stations(w)[0]!;
    const [x, y] = onAxis(3, w.wallR); // the far side of the ring from a station at 30°
    expect(Math.hypot(x - s.x, y - s.y)).toBeGreaterThan(data.structures.station.aggro);
    const e = spawnEnemy(w, data, 'basic', x, y, []);
    const before = Math.hypot(e.x, e.y);
    const events = stepN(w, data, 60);
    expect(ofType(events, 'structHit')).toHaveLength(0);
    expect(Math.hypot(e.x, e.y)).toBeLessThan(before);
    expect(e.y).toBeCloseTo(0, 6);
  });

  it('a ranged virus within aggro shoots the station', () => {
    const { data, w } = setupFusion(MINING, 1, { damage: 0, health: 1000, defense: 0 });
    const s = stations(w)[0]!;
    const [x, y] = beyond(s, 60);
    const e = spawnEnemy(w, data, 'ranged', x, y, []);
    const hits = ofType(stepN(w, data, 60), 'structHit');
    expect(hits[0]).toMatchObject({ kind: 'station', sid: s.id, enemyId: e.id, ranged: true });
    expect(w.core.hp).toBe(1000);
  });

  it('an intact wall segment holds the virus first: the station behind it is untouched; a broken one lets it through to the station', () => {
    const { data, w } = setupFusion(MINING, 1, { damage: 0, health: 1000, defense: 0 });
    w.fusionTiers['cryo+firewall'] = 1;
    stepN(w, data, 1);
    const s = stations(w)[0]!;
    const sector = sectorOf(s.x, s.y);
    const [x, y] = onAxis(sector, w.wallR + 14 + 3);
    spawnEnemy(w, data, 'basic', x, y, []);
    const first = ofType(stepN(w, data, 60), 'structHit');
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((h) => h.kind === 'wall')).toBe(true);
    expect(s.share).toBe(1);
    // Break the segment: the next virus at the same spot walks through the gap and is drawn to the station.
    seg(w, sector).share = 0;
    seg(w, sector).downUntilTick = w.tick + 100000;
    const [x2, y2] = beyond(s, 40);
    spawnEnemy(w, data, 'basic', x2, y2, []);
    const second = ofType(stepN(w, data, 120), 'structHit');
    expect(second.some((h) => h.kind === 'station' && h.sid === s.id)).toBe(true);
  });

  it('a station that runs out of HP is destroyed: rubble, streak lost, and the virus walks on to the core', () => {
    const { data, w } = setupFusion(MINING, 1, { damage: 0, health: 10, defense: 0, thorns: 0 });
    const s = stations(w)[0]!;
    s.streak = 4;
    const [x, y] = beyond(s, 50);
    spawnEnemy(w, data, 'basic', x, y, []);
    const events = stepN(w, data, 400);
    const down = ofType(events, 'structDown');
    expect(down[0]).toMatchObject({ kind: 'station', sid: s.id });
    expect(s.share).toBe(0);
    expect(s.streak).toBe(0);
    expect(s.downUntilTick).toBeGreaterThan(w.tick);
    expect(ofType(events, 'coreHit').length).toBeGreaterThan(0);
  });

  it('rubble lasts rebuildWaves full waves: lost mid wave 1, still down through wave 4, rebuilt at the start of wave 5', () => {
    const { data, w } = setupFusion(MINING, 1, { health: 1000 });
    stepN(w, data, 10);
    const prof = perkProfile(w, data);
    const events: SimEvent[] = [];
    destroyStation(w, data, prof, stations(w)[0]!, events);
    expect(ofType(events, 'structDown')).toHaveLength(1);
    untilWave(w, data, 4);
    expect(stations(w)[0]!.share).toBe(0);
    const up = untilWave(w, data, 5);
    expect(stations(w)[0]!.share).toBe(1);
    expect(ofType(up, 'structUp').map((e) => e.sid)).toEqual([stations(w)[0]!.id]);
  });

  it('a damaged station that still stands is repaired at the next wave start', () => {
    const { data, w } = setupFusion(MINING, 1, { health: 1000 });
    stations(w)[0]!.share = 0.4;
    untilWave(w, data, 2);
    expect(stations(w)[0]!.share).toBe(1);
  });

  it('pays Energy at wave end: energy × energyGrowth^wave × Energy bonus, once, and nothing before', () => {
    const { data, w } = setupFusion(MINING, 1);
    const st = worldStats(w, data);
    const expected = fusionStructure(w, data, 'station')!.energy! * powInt(data.config.energyGrowth, 1) * (1 + st.energyBonus);
    const mid = stepN(w, data, 700);
    expect(ofType(mid, 'stationPay')).toHaveLength(0);
    const pay = ofType(stepN(w, data, 100), 'stationPay');
    expect(pay).toHaveLength(1);
    expect(pay[0]!.energy).toBeCloseTo(expected, 9);
    expect(pay[0]!.bits).toBe(0);
    expect(pay[0]).toMatchObject({ sid: stations(w)[0]!.id });
    expect(stations(w)[0]!.powered).toBe(0);
    expect(stations(w)[0]!.streak).toBe(0); // tier I defines no streak
  });

  it('pays only for the share of the wave it was powered: unlinking for half the wave halves the pay', () => {
    const full = setupFusion(MINING, 1);
    const fullPay = ofType(stepN(full.w, full.data, 800), 'stationPay')[0]!.energy;
    const { data, w } = setupFusion(MINING, 1);
    w.fusionTiers[MINING] = 0;
    stepN(w, data, 389);
    w.fusionTiers[MINING] = 1;
    const pay = ofType(stepN(w, data, 410), 'stationPay');
    expect(pay).toHaveLength(1);
    expect(pay[0]!.energy / fullPay).toBeGreaterThan(0.49);
    expect(pay[0]!.energy / fullPay).toBeLessThan(0.52);
  });

  it('a destroyed station pays nothing that wave', () => {
    const { data, w } = setupFusion(MINING, 1);
    destroyStation(w, data, perkProfile(w, data), stations(w)[0]!, []);
    expect(ofType(stepN(w, data, 800), 'stationPay')).toHaveLength(0);
  });

  it('streak (tier II): +10 % per wave survived up to the cap; a loss resets it', () => {
    const { data, w } = setupFusion(MINING, 3);
    const st = worldStats(w, data);
    const base = (wave: number) => fusionStructure(w, data, 'station')!.energy! * powInt(data.config.energyGrowth, wave) * (1 + st.energyBonus);
    const one = ofType(untilWaveEnd(w, data, 1), 'stationPay');
    expect(one.map((e) => e.energy)).toEqual([base(1), base(1)].map((v) => expect.closeTo(v, 9)));
    const two = ofType(untilWaveEnd(w, data, 2), 'stationPay');
    expect(two[0]!.energy).toBeCloseTo(base(2) * 1.1, 9);
    for (const s of stations(w)) s.streak = 50;
    const capped = ofType(untilWaveEnd(w, data, 3), 'stationPay');
    expect(capped[0]!.energy).toBeCloseTo(base(3) * 2, 9);
    // Tier I has no streak at all.
    const t1 = setupFusion(MINING, 1);
    stations(t1.w)[0]!.streak = 50;
    expect(ofType(untilWaveEnd(t1.w, t1.data, 1), 'stationPay')[0]!.energy).toBeCloseTo(fusionStructure(t1.w, t1.data, 'station')!.energy! * 1.02 * (1 + worldStats(t1.w, t1.data).energyBonus), 9);
  });

  it('tier I builds no streak: the waves survived there do not boost the pay once tier II is reached', () => {
    const { data, w } = setupFusion(MINING, 1);
    untilWaveEnd(w, data, 1);
    untilWaveEnd(w, data, 2);
    expect(stations(w)[0]!.streak).toBe(0);
    w.fusionTiers[MINING] = 3;
    const st = worldStats(w, data);
    const pay = ofType(untilWaveEnd(w, data, 3), 'stationPay');
    expect(pay[0]!.energy).toBeCloseTo(fusionStructure(w, data, 'station')!.energy! * powInt(data.config.energyGrowth, 3) * (1 + st.energyBonus), 9);
  });

  it('tier III also pays Bits like a kill: scaleForWave of the tier', () => {
    const { data, w } = setupFusion(MINING, 5);
    const pay = ofType(untilWaveEnd(w, data, 1), 'stationPay');
    expect(pay).toHaveLength(3);
    expect(pay[0]!.bits).toBeCloseTo(scaleForWave(4, data.tiers[0]!.bitsMul, data.config.bitsGrowth, 1), 9);
    expect(w.bits).toBeCloseTo(3 * pay[0]!.bits, 6);
  });

  it('unlinking: a damaged station counts as destroyed (rubble, streak 0), an undamaged one returns intact', () => {
    const { data, w } = setupFusion(MINING, 3);
    const [a, b] = stations(w);
    a!.share = 0.5;
    a!.streak = 3;
    b!.streak = 3;
    w.fusionTiers[MINING] = 0;
    const events = stepN(w, data, 2);
    expect(ofType(events, 'structDown').map((e) => e.sid)).toEqual([a!.id]);
    expect(a!.share).toBe(0);
    expect(a!.downUntilTick).toBeGreaterThan(w.tick);
    expect([a!.streak, b!.streak]).toEqual([0, 0]);
    expect(b!.share).toBe(1);
    // Dormant: a virus next to it is left to walk to the core.
    const [x, y] = beyond(b!, 40);
    spawnEnemy(w, data, 'basic', x, y, []);
    expect(ofType(stepN(w, data, 30), 'structHit')).toHaveLength(0);
    w.fusionTiers[MINING] = 3;
    stepN(w, data, 1);
    expect(b!.share).toBe(1);
    expect(a!.share).toBe(0);
    expect(stations(w)).toHaveLength(2);
  });

  it('a tier drop that lowers the count leaves the surplus station inert', () => {
    const { data, w } = setupFusion(MINING, 5);
    w.fusionTiers[MINING] = 3;
    const third = stations(w)[2]!;
    const [x, y] = beyond(third, 40);
    spawnEnemy(w, data, 'basic', x, y, []);
    const hits = ofType(stepN(w, data, 30), 'structHit');
    expect(hits.every((h) => h.sid !== third.id)).toBe(true);
  });

  it('revive rebuilds a station in rubble (event only while linked) and repairs a damaged one', () => {
    const { data, w } = setupFusion(MINING, 3, { health: 100 });
    const [a, b] = stations(w);
    destroyStation(w, data, perkProfile(w, data), a!, []);
    b!.share = 0.3;
    w.dead = true;
    const events: SimEvent[] = [];
    applyCommands(w, data, [{ type: 'revive' }], events);
    expect([a!.share, b!.share]).toEqual([1, 1]);
    expect(a!.downUntilTick).toBe(0);
    expect(ofType(events, 'structUp').map((e) => e.sid)).toEqual([a!.id]);
  });

  it('a snapshot with damaged, down and streaking stations restores exactly and keeps stepping identically', () => {
    const { data, w } = setupFusion(MINING, 5);
    const [a, b, c] = stations(w);
    a!.share = 0.5;
    a!.powered = 7;
    b!.streak = 2;
    destroyStation(w, data, perkProfile(w, data), c!, []);
    stepN(w, data, 40);
    const back = restore(snapshot(w));
    expect(back.structs).toEqual(w.structs);
    stepN(back, data, 900);
    stepN(w, data, 900);
    expect(hashWorld(back)).toBe(hashWorld(w));
  });

  it('Insurance is gone: tier I still carries the 5 % shield, no run-end Bits rule is left on the ladder', () => {
    const { data, w } = setupFusion(MINING, 5);
    expect(perkProfile(w, data).shieldFrac).toBeCloseTo(0.05, 9);
    expect(perkProfile(w, data).rules.runEndBits).toBe(1);
    expect(data.sets.fusions[MINING]!.name).toBe('Relay Stations');
  });

  it('with several stations in aggro a virus goes for the nearest, whatever its id', () => {
    // A wide aggro so one virus reaches two stations (they stand ~357 px apart).
    const data = testData({ config: { baseEnemiesPerWave: 0, enemiesPerWaveGrowth: 0 }, structures: { station: { aggro: 400 } } }, { damage: 0, regen: 0, thorns: 0, health: 1000, defense: 0 });
    for (const [near, far] of [[1, 0], [0, 1]] as const) {
      const w = createWorld(data, { seed: 1, tier: 1, protocols: false });
      w.fusionTiers[MINING] = 3;
      stepN(w, data, 1);
      const [a, b] = [stations(w)[near]!, stations(w)[far]!];
      expect(a.id).not.toBe(b.id);
      const k = 40 / Math.hypot(b.x - a.x, b.y - a.y);
      spawnEnemy(w, data, 'basic', a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, []);
      const hits = ofType(stepN(w, data, 200), 'structHit');
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every((h) => h.sid === a.id)).toBe(true);
    }
  });

  it('a ranged virus parked at its standoff from the core is drawn to a station within aggro, not the core', () => {
    const { data, w } = setupFusion(MINING, 1, { damage: 0, health: 1000, defense: 0 });
    const s = stations(w)[0]!;
    const standoff = data.enemies.ranged.standoff;
    const r = Math.hypot(s.x, s.y);
    spawnEnemy(w, data, 'ranged', (s.x / r) * standoff, (s.y / r) * standoff, []);
    expect(standoff - r).toBeLessThanOrEqual(data.structures.station.aggro);
    const events = stepN(w, data, 240);
    expect(ofType(events, 'structHit')[0]).toMatchObject({ kind: 'station', sid: s.id, ranged: true });
    expect(ofType(events, 'coreHit')).toHaveLength(0);
  });

  it('the rewarded boost multiplies the station pay like any wave Energy', () => {
    const plain = setupFusion(MINING, 1);
    const base = ofType(untilWaveEnd(plain.w, plain.data, 1), 'stationPay')[0]!.energy;
    const { data, w } = setupFusion(MINING, 1);
    w.boost = { from: 1, until: 3 };
    const boosted = ofType(untilWaveEnd(w, data, 1), 'stationPay')[0]!.energy;
    expect(data.perks.boost.energyMul).toBeGreaterThan(1);
    expect(boosted).toBeCloseTo(base * data.perks.boost.energyMul, 9);
  });

  it('the ladder is validated: a station without its required fields at tier I is rejected', () => {
    const { data } = setup(0);
    const bad = structuredClone(data.sets);
    bad.fusions[MINING]!.tiers['1'] = [{ type: 'structure', kind: 'station', count: 1, hpFrac: 0.1 }];
    expect(() => validateSets(bad)).toThrow(/energy/);
    const lowered = structuredClone(data.sets);
    lowered.fusions[MINING]!.tiers['3'] = [{ type: 'structure', kind: 'station', count: 0 }];
    expect(() => validateSets(lowered)).toThrow(/count/);
    // A streak step without a cap would leave the multiplier at 1 for ever.
    const uncapped = structuredClone(data.sets);
    uncapped.fusions[MINING]!.tiers['3'] = [{ type: 'structure', kind: 'station', count: 2, streakStep: 0.1 }];
    expect(() => validateSets(uncapped)).toThrow(/streakMax/);
  });

  it('effectLine reads each station ladder step as what it adds', () => {
    const { data } = setup(0);
    expect(effectLine(data, { type: 'structure', kind: 'station', count: 1, hpFrac: 0.1, energy: 12, rebuildWaves: 3, bits: 0 })).toBe(
      '1 station inside the wall (10% Health): +12 Energy × wave growth at wave end while standing; viruses attack it, rebuilds after 3 waves',
    );
    expect(effectLine(data, { type: 'structure', kind: 'station', count: 2, streakStep: 0.1, streakMax: 2 })).toBe(
      '2 stations; survival streak: +10%/wave, up to ×2',
    );
    expect(effectLine(data, { type: 'structure', kind: 'station', count: 3, bits: 4 })).toBe('3 stations; each station also pays 4 Bits × wave growth');
  });
});

/** Steps until the end of wave `n` (its waveEnd event) and returns every event on the way. */
function untilWaveEnd(w: World, data: ReturnType<typeof testData>, n: number): SimEvent[] {
  const all: SimEvent[] = [];
  for (let guard = 0; guard < 5000; guard++) {
    const ev = stepN(w, data, 1);
    all.push(...ev);
    if (ev.some((e) => e.type === 'waveEnd' && e.wave === n)) return all;
  }
  throw new Error('wave did not end');
}

// C4 (uniqueness plan phase 3): structure upgrades, per kind, bought with Energy.
describe('structures: upgrades (C4)', () => {
  const T = 'overload+firewall'; // Bastion: turrets
  function built(energy = 1e6) {
    const { data, w } = setup(1); // Ice Wall at I
    w.fusionTiers[T] = 1;
    w.energy = energy;
    return { data, w };
  }
  const up = (w: World, data: GameData, kind: StructureKind) => {
    const ev: SimEvent[] = [];
    applyCommands(w, data, [{ type: 'upgradeStruct', kind }], ev);
    return ev;
  };

  it('the cost ladder is ceil(cost · costGrowth^L) up to max, then Infinity', () => {
    const data = testData();
    const u = data.structures.upgrades!.turret!;
    for (let L = 0; L < u.max; L++) expect(structUpgradeCost(data, 'turret', L)).toBe(Math.ceil(u.cost * powInt(u.costGrowth, L)));
    expect(structUpgradeCost(data, 'turret', u.max)).toBe(Infinity);
    for (let L = 1; L < u.max; L++) expect(structUpgradeCost(data, 'turret', L)).toBeGreaterThan(structUpgradeCost(data, 'turret', L - 1));
  });

  it('levels fold into the values the sim, the renderer and the HUD read; atMax adds the extra target', () => {
    const { data, w } = built();
    const base = fusionStructure(w, data, 'turret')!;
    const wall0 = fusionStructure(w, data, 'wall')!;
    const u = data.structures.upgrades!.turret!;
    w.structLevels = { turret: 2, wall: 1 };
    const v = fusionStructure(w, data, 'turret')!;
    expect(v.dmgFrac).toBeCloseTo(base.dmgFrac! * (1 + u.perLevel.dmgFrac! * 2), 12);
    expect(v.targets).toBe(base.targets);
    expect(perkProfile(w, data).structures.turret).toEqual(v);
    expect(fusionStructure(w, data, 'wall')!.hpFrac).toBeCloseTo(wall0.hpFrac! * (1 + data.structures.upgrades!.wall!.perLevel.hpFrac!), 12);
    w.structLevels = { turret: u.max };
    expect(fusionStructure(w, data, 'turret')!.targets).toBe(base.targets! + u.atMax!.targets!);
    // A level on an unbuilt kind changes nothing; a bad saved level reads as the nearest valid one.
    w.structLevels = { mine: 3, turret: 99 };
    expect(fusionStructure(w, data, 'mine')).toBeUndefined();
    expect(structLevel(w, data, 'turret')).toBe(u.max);
    w.structLevels = { turret: -2 };
    expect(fusionStructure(w, data, 'turret')).toEqual(base);
  });

  it('upgradeStruct: Energy goes, the level rises, a structUpgrade event; rejects when nothing is built, Energy is short, maxed, dead or unknown', () => {
    const { data, w } = built(0);
    expect(ofType(up(w, data, 'mine'), 'structUpgradeRejected')[0]!.reason).toBe('locked');
    expect(ofType(up(w, data, 'turret'), 'structUpgradeRejected')[0]!.reason).toBe('funds');
    expect(w.structLevels).toBeUndefined();
    const c0 = structUpgradeCost(data, 'turret', 0);
    w.energy = c0 + 5;
    expect(ofType(up(w, data, 'turret'), 'structUpgrade')).toEqual([{ type: 'structUpgrade', kind: 'turret', level: 1, cost: c0 }]);
    expect(w.energy).toBe(5);
    expect(w.structLevels).toEqual({ turret: 1 });
    w.energy = 1e9;
    for (let i = 1; i < data.structures.upgrades!.turret!.max; i++) up(w, data, 'turret');
    expect(ofType(up(w, data, 'turret'), 'structUpgradeRejected')[0]!.reason).toBe('maxed');
    expect(ofType(up(w, data, 'bogus' as StructureKind), 'structUpgradeRejected')[0]!.reason).toBe('unknown');
    w.dead = true;
    expect(ofType(up(w, data, 'wall'), 'structUpgradeRejected')[0]!.reason).toBe('dead');
  });

  it('deterministic, and a snapshot round trip keeps the levels (present and absent)', () => {
    const run = (levels: boolean) => {
      const { data, w } = built();
      if (levels) {
        up(w, data, 'turret');
        up(w, data, 'wall');
      }
      const a = restore(snapshot(w));
      expect(a.structLevels).toEqual(levels ? { turret: 1, wall: 1 } : undefined);
      stepN(w, data, 300);
      stepN(a, data, 300);
      expect(hashWorld(a)).toBe(hashWorld(w));
      return hashWorld(w);
    };
    expect(run(true)).toBe(run(true));
    expect(run(false)).toBe(run(false));
    expect(run(true)).not.toBe(run(false));
  });

  it('data: unknown kinds and fields, perLevel on a whole-number field, a shrink to 0 and a falling curve are rejected', () => {
    const bad = (u: Record<string, unknown>) => () => {
      const d = structuredClone(DEFAULT_DATA);
      (d.structures as { upgrades: unknown }).upgrades = u;
      validateData(d);
    };
    expect(bad({ turret: { max: 3, cost: 10, costGrowth: 1.5, perLevel: { dmgFrac: 0.1 } } })).not.toThrow();
    expect(bad({ tower: { max: 3, cost: 10, costGrowth: 1.5, perLevel: {} } })).toThrow(/unknown structure kind/);
    expect(bad({ turret: { max: 3, cost: 10, costGrowth: 1.5, perLevel: { blast: 0.1 } } })).toThrow(/not a turret field/);
    expect(bad({ turret: { max: 3, cost: 10, costGrowth: 1.5, perLevel: { targets: 0.1 } } })).toThrow(/whole-number/);
    expect(bad({ wall: { max: 5, cost: 10, costGrowth: 1.5, perLevel: { regrowSec: -0.2 } } })).toThrow(/1 \+ frac/);
    expect(bad({ turret: { max: 3, cost: 10, costGrowth: 0.9, perLevel: { dmgFrac: 0.1 } } })).toThrow(/costGrowth/);
    expect(bad({ turret: { max: 3, cost: 10, costGrowth: 1.5, perLevel: { dmgFrac: 0.1 }, atMax: { targets: 0.5 } } })).toThrow(/atMax/);
  });
});
