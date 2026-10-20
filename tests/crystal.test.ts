import { describe, expect, it } from 'vitest';
import { applyCommands } from '../src/sim/commands';
import { autoSlot, clusterCounts, crystalConnected, crystalShape, freeSlots, moduleSector, movePreview, sectorTags, slotGains } from '../src/sim/crystal';
import { DEFAULT_DATA } from '../src/sim/data';
import type { SimEvent } from '../src/sim/events';
import { hexDist, hexToPixel, isNeighbour, pixelToHex, ring, SQRT3, sectorOf } from '../src/sim/hex';
import { dominantTag, isMutationWave } from '../src/sim/mutations';
import { grantPerk, perkProfile, tagCounts } from '../src/sim/perks';
import { hitEnemy } from '../src/sim/projectiles';
import { restore, snapshot } from '../src/sim/snapshot';
import { createWorld, worldStats } from '../src/sim/state';
import { combatStats, step } from '../src/sim/step';
import { arenaRadius, cellAt, crystalRing, farMul, initialTerrain, ownedShare, terrainFor } from '../src/sim/territory';
import { spawnEnemy } from '../src/sim/waves';
import { ofType, stepN, testData } from './helpers';

const D = DEFAULT_DATA;
const quiet = () => createWorld(D, { seed: 7, tier: 1, protocols: false });

describe('hex math', () => {
  it('pixelToHex inverts hexToPixel; ring k has 6k hexes at distance k', () => {
    for (let k = 1; k <= 5; k++) {
      const hs = ring(k);
      expect(hs).toHaveLength(6 * k);
      for (const [q, r] of hs) {
        expect(hexDist(q, r)).toBe(k);
        const [x, y] = hexToPixel(q, r, 16);
        expect(pixelToHex(x, y, 16)).toEqual([q, r]);
        expect(pixelToHex(x + 5, y - 4, 16)).toEqual([q, r]);
      }
    }
  });

  it('sectorOf picks the nearest of the six hex directions', () => {
    expect(sectorOf(10, 0)).toBe(0);
    expect(sectorOf(-10, 0.1)).toBe(3);
    expect(sectorOf(1, 10)).toBe(5);
  });
});

describe('crystal (spec 2026-10-14 §A)', () => {
  it('a new perk adds a module next to the core; a stack upgrades it without a new hex', () => {
    const w = quiet();
    expect(freeSlots(w, D)).toHaveLength(12);
    grantPerk(w, D, 'overclockRounds', null);
    expect(w.crystal).toHaveLength(1);
    expect(hexDist(w.crystal[0]!.q, w.crystal[0]!.r)).toBe(D.crystal.coreRing + 1);
    grantPerk(w, D, 'overclockRounds', null);
    expect(w.crystal).toHaveLength(1);
    expect(tagCounts(w, D).overload).toBe(2);
  });

  it('auto-placement clusters a tag, so a bot keeps its set counts', () => {
    const w = quiet();
    for (const id of ['overclockRounds', 'frostShot', 'burstFire', 'critSpike', 'coldAura']) grantPerk(w, D, id, null);
    expect(tagCounts(w, D)).toMatchObject({ overload: 3, cryo: 2 });
    expect(w.setTiers.overload).toBe(2);
  });

  it('sets count only the largest connected cluster', () => {
    const w = quiet();
    // Opposite sides of the core: not adjacent.
    grantPerk(w, D, 'overclockRounds', null, [2, 0]);
    grantPerk(w, D, 'burstFire', null, [-2, 0]);
    expect(clusterCounts(w, D).overload).toBe(1);
    expect(w.setTiers.overload).toBe(0);
    grantPerk(w, D, 'critSpike', null, [2, -1]);
    expect(clusterCounts(w, D).overload).toBe(2);
    expect(w.setTiers.overload).toBe(2);
  });

  it('pickPerk with a slot places the module there; a bad slot rejects the pick', () => {
    const w = createWorld(D, { seed: 3, tier: 1, boot: false });
    expect(w.phase).toBe('pick');
    const ev: SimEvent[] = [];
    applyCommands(w, D, [{ type: 'pickPerk', index: 0, slot: [9, 9] }], ev);
    expect(ofType(ev, 'commandRejected')[0]?.reason).toBe('slot');
    expect(w.phase).toBe('pick');
    applyCommands(w, D, [{ type: 'pickPerk', index: 0, slot: [0, -2] }], ev);
    expect(w.phase).toBe('pause');
    expect(w.crystal[0]).toMatchObject({ q: 0, r: -2 });
    expect(ofType(ev, 'perkPicked')[0]?.module).toEqual([0, -2]);
  });

  it('sectors take their modules\' tag; melee viruses stop at the crystal reach; shots leave from its tip', () => {
    const w = quiet();
    grantPerk(w, D, 'frostShot', null, [2, 0]);
    const tags = sectorTags(w, D);
    expect(tags[0]).toBe('cryo');
    expect(tags.filter((t) => t !== null)).toHaveLength(1);
    const shape = crystalShape(w, D);
    expect(shape.reach[0]).toBeGreaterThan(D.core.radius);
    expect(shape.reach[3]).toBe(D.core.radius);
    const data = testData({ config: { baseEnemiesPerWave: 0, enemiesPerWaveGrowth: 0 } });
    const w2 = createWorld(data, { seed: 1, tier: 1, protocols: false });
    grantPerk(w2, data, 'frostShot', null, [2, 0]);
    const e = spawnEnemy(w2, data, 'tank', 200, 0, []);
    e.hp = e.maxHp = 1e12;
    stepN(w2, data, 400);
    const [tipX] = crystalShape(w2, data).tips[0]!;
    expect(e.x).toBeGreaterThan(crystalShape(w2, data).reach[0]! + e.radius - 1);
    expect(tipX).toBeGreaterThan(0);
  });

  it('the crystal survives a snapshot', () => {
    const w = quiet();
    grantPerk(w, D, 'bounce', null);
    expect(restore(snapshot(w)).crystal).toEqual(w.crystal);
  });
});

describe('territory (spec 2026-10-14 §B)', () => {
  it('starts owned inside startRadius and infected outside', () => {
    const t = initialTerrain(D);
    const g = terrainFor(D);
    expect(t).toHaveLength(g.x.length);
    expect(t[cellAt(D, 0, 0)]).toBe(1);
    expect(t[cellAt(D, 0, D.config.spawnRadius - 10)]).toBe(0);
    expect(ownedShare(quiet(), D)).toBeGreaterThan(0.2);
  });

  it('a virus infects its cell; a frozen one does not; a kill cleanses it and its ring', () => {
    const data = testData({ config: { baseEnemiesPerWave: 0, enemiesPerWaveGrowth: 0 } }, { attackSpeed: 1e-9 });
    const w = createWorld(data, { seed: 1, tier: 1, protocols: false });
    const e = spawnEnemy(w, data, 'basic', 100, 0, []);
    e.speed = 1e-9;
    const id = cellAt(data, 100, 0);
    expect(w.terrain[id]).toBe(1);
    e.frozenUntil = 1e9;
    stepN(w, data, data.territory.infectEvery * 2);
    expect(w.terrain[id]).toBe(1);
    e.frozenUntil = 0;
    stepN(w, data, data.territory.infectEvery);
    expect(w.terrain[id]).toBe(0);
    const prof = perkProfile(w, data);
    hitEnemy(w, data, worldStats(w, data), prof, e, 1e9, false, 'shot', []);
    expect(w.terrain[id]).toBe(1);
    for (const n of terrainFor(data).nbr[id]!) expect(w.terrain[n]).toBe(1);
  });

  it('⚡ ground amplifies hits; owned share scales kill Energy', () => {
    const w = quiet();
    grantPerk(w, D, 'overclockRounds', null, [2, 0]);
    const prof = perkProfile(w, D);
    const st = worldStats(w, D);
    const on = spawnEnemy(w, D, 'tank', 80, 0, []);
    const off = spawnEnemy(w, D, 'tank', -80, 0, []);
    hitEnemy(w, D, st, prof, on, 10, false, 'shot', []);
    hitEnemy(w, D, st, prof, off, 10, false, 'shot', []);
    expect(on.maxHp - on.hp).toBeCloseTo(10 * D.territory.overloadDamage, 9);
    expect(off.maxHp - off.hp).toBeCloseTo(10, 9);
    const ev: SimEvent[] = [];
    const k = spawnEnemy(w, D, 'basic', -60, 0, []);
    hitEnemy(w, D, st, prof, k, 1e9, false, 'shot', ev);
    const share = prof.owned;
    expect(ofType(ev, 'kill')[0]!.energy).toBeCloseTo(k.energy * (D.territory.energyBase + D.territory.energyPerOwned * share), 9);
  });
});

describe('the breach widens', () => {
  it('the spawn ring grows every arenaGrowEvery waves up to the cap; new land starts infected and counts only once inside', () => {
    const c = D.config;
    expect(arenaRadius(D, 1)).toBe(c.spawnRadius);
    expect(arenaRadius(D, c.arenaGrowEvery)).toBe(c.spawnRadius + c.arenaGrowStep);
    expect(arenaRadius(D, 10_000)).toBe(c.arenaMaxRadius);
    const w = quiet();
    expect(w.terrain[cellAt(D, c.arenaMaxRadius - 10, 0)]).toBe(0);
    const s0 = ownedShare(w, D);
    w.wave = 10_000;
    expect(ownedShare(w, D)).toBeLessThan(s0);
    const ev: SimEvent[] = [];
    w.wave = c.arenaGrowEvery - 1;
    w.phase = 'pause';
    w.phaseTick = 1e9;
    step(w, D, [], ev);
    expect(ofType(ev, 'arenaGrow')[0]).toMatchObject({ type: 'arenaGrow', radius: c.spawnRadius + c.arenaGrowStep, nests: D.territory.nestsPerGrow });
    expect(w.nests).toHaveLength(D.territory.nestsPerGrow);
  });
});

describe('breach rewards', () => {
  it('far kills pay more; the crystal gains rings up to the cap and offers the new slots', () => {
    const t = D.territory;
    expect(farMul(D, t.farFrom, 0)).toBe(1);
    expect(farMul(D, t.farFrom + 100, 0)).toBeCloseTo(1 + t.farPer100, 9);
    expect(crystalRing(D, 1)).toBe(D.crystal.maxRing);
    expect(crystalRing(D, D.crystal.ringEvery)).toBe(D.crystal.maxRing + 1);
    expect(crystalRing(D, 1e6)).toBe(D.crystal.maxRingCap);
    const w = quiet();
    for (const [q, r] of [[2, 0], [3, 0]] as const) grantPerk(w, D, ['frostShot', 'coldAura'][q - 2]!, null, [q, r]);
    expect(freeSlots(w, D).some(([q, r]) => hexDist(q, r) === D.crystal.maxRing + 1)).toBe(false);
    w.wave = D.crystal.ringEvery;
    expect(freeSlots(w, D).some(([q, r]) => q === 4 && r === 0)).toBe(true);
  });

  it('uncontested ground regrows one ring per pass from our edge; a virus or a nest holds its cell', () => {
    const data = testData({ config: { baseEnemiesPerWave: 0, enemiesPerWaveGrowth: 0 } }, { attackSpeed: 1e-9 });
    const w = createWorld(data, { seed: 1, tier: 1, protocols: false });
    const g = terrainFor(data);
    const edge = cellAt(data, data.territory.startRadius + 12, 0);
    const deep = cellAt(data, data.config.spawnRadius - 10, 0);
    const held = cellAt(data, 0, data.territory.startRadius + 12);
    const nest = cellAt(data, -data.territory.startRadius - 12, 0);
    w.nests = [nest];
    const e = spawnEnemy(w, data, 'basic', g.x[held]!, g.y[held]!, []);
    e.speed = 1e-9;
    expect([w.terrain[edge], w.terrain[deep], w.terrain[held], w.terrain[nest]]).toEqual([0, 0, 0, 0]);
    const share = ownedShare(w, data);
    stepN(w, data, data.territory.regrowEvery);
    expect(w.terrain[edge]).toBe(1);
    expect(w.terrain[deep]).toBe(0);
    expect(ownedShare(w, data)).toBeGreaterThan(share);
    stepN(w, data, data.territory.regrowEvery * 12);
    expect(w.terrain[deep]).toBe(1);
    expect(w.terrain[held]).toBe(0);
    expect(w.terrain[nest]).toBe(0);
    // Ground beyond the current arena waits for the breach to widen.
    expect(w.terrain[cellAt(data, data.config.spawnRadius + 3 * data.territory.cellSize, 0)]).toBe(0);
  });

  it('a nest spawns its kind during a wave while infected; reclaiming its cell destroys it and pays', () => {
    const data = testData({ config: { baseEnemiesPerWave: 0, enemiesPerWaveGrowth: 0 } });
    const w = createWorld(data, { seed: 1, tier: 1, protocols: false });
    const g = terrainFor(data);
    const id = cellAt(data, 400, 0);
    w.nests = [id];
    w.phase = 'wave';
    w.phaseTick = 1;
    w.wave = 1;
    stepN(w, data, data.territory.nestEvery);
    expect(w.enemies.some((e) => e.kind === data.territory.nestKind && Math.abs(e.x - g.x[id]!) < 60)).toBe(true);
    w.terrain[id] = 1;
    const e0 = w.energy;
    const ev: SimEvent[] = [];
    step(w, data, [], ev);
    expect(w.nests).toEqual([]);
    expect(ofType(ev, 'nestDestroyed')).toHaveLength(1);
    expect(w.energy).toBeGreaterThan(e0);
  });
});

describe('mutations (spec 2026-10-14 §C)', () => {
  it('from startWave the genome learns the dominant tag; Armor shrinks the crit bonus', () => {
    const w = quiet();
    for (const id of ['overclockRounds', 'burstFire', 'frostShot']) grantPerk(w, D, id, null);
    expect(dominantTag(w, D, tagCounts(w, D))).toBe('overload');
    expect(isMutationWave(D, D.mutations.startWave)).toBe(true);
    expect(isMutationWave(D, D.mutations.startWave + 1)).toBe(false);
    const before = combatStats(w, D, perkProfile(w, D)).critFactor;
    w.wave = D.mutations.startWave - 1;
    w.phase = 'pause';
    w.phaseTick = 1e9;
    const ev: SimEvent[] = [];
    step(w, D, [], ev);
    expect(ofType(ev, 'mutation')).toEqual([{ type: 'mutation', tag: 'overload', level: 1 }]);
    const after = combatStats(w, D, perkProfile(w, D)).critFactor;
    // Level 1 is the softer first step: perLevel × firstLevelScale.
    expect(after - 1).toBeCloseTo((before - 1) * (1 - D.mutations.perLevel.overload * D.mutations.firstLevelScale), 9);
  });
});

describe('moving modules and previews (spec 2026-10-15 §2–3)', () => {
  const at = (i: number): [number, number] => ring(2)[i]!;
  const mod = (q: number, r: number) => ({ q, r, perk: 'patch', tag: 'firewall' as const });

  it('crystalConnected: every module reaches ring 2 through touching modules', () => {
    expect(crystalConnected([], D)).toBe(true);
    const outer = ring(3).find(([q, r]) => isNeighbour(q, r, ...at(0)))!;
    expect(crystalConnected([mod(...outer)], D)).toBe(false);
    expect(crystalConnected([mod(...at(0)), mod(...outer)], D)).toBe(true);
    expect(crystalConnected([mod(...at(6)), mod(...outer)], D)).toBe(false);
  });

  it('movePreview shows the set that breaks and the wedge that changes, without touching the world', () => {
    const w = quiet();
    grantPerk(w, D, 'patch', null, at(0));
    grantPerk(w, D, 'hardening', null, at(1));
    const before = JSON.stringify(w);
    const d = movePreview(w, D, at(1), at(6))!;
    expect(d.sets).toEqual([{ tag: 'firewall', from: 2, to: 1, tierFrom: 2, tierTo: 0 }]);
    expect(d.fusions).toEqual([]);
    expect(d.sectors).toContainEqual({ sector: moduleSector(D, ...at(6)), from: null, to: 'firewall' });
    expect(JSON.stringify(w)).toBe(before);
    expect(movePreview(w, D, at(5), at(6))).toBeNull();
    expect(movePreview(w, D, at(0), [0, 0])).toBeNull();
    // A swap of two same-tag modules changes nothing.
    expect(movePreview(w, D, at(0), at(1))).toEqual({ sets: [], fusions: [], sectors: [] });
  });

  it('slotGains: the set and links a new module would add at a hex; an upgrade adds a stack', () => {
    const w = quiet();
    grantPerk(w, D, 'patch', null, at(0));
    expect(slotGains(w, D, 'hardening', at(1))!.sets).toEqual([{ tag: 'firewall', from: 1, to: 2, tierFrom: 0, tierTo: 2 }]);
    expect(slotGains(w, D, 'hardening', at(6))!.sets).toEqual([]);
    expect(slotGains(w, D, 'bounce', at(1))!.fusions).toEqual([{ key: 'chain+firewall', from: 0, to: 1, tierFrom: 0, tierTo: 1 }]);
    expect(slotGains(w, D, 'hardening', at(0))).toBeNull();
    expect(slotGains(w, D, 'patch')!.sets).toEqual([{ tag: 'firewall', from: 1, to: 2, tierFrom: 0, tierTo: 2 }]);
  });

  it('autoSlot: a hex touching another tag (a link) wins over an equal hex that touches nothing', () => {
    const w = quiet();
    grantPerk(w, D, 'patch', null, at(0));
    const s = autoSlot(w, D, 'chain')!;
    expect(isNeighbour(...s, ...at(0))).toBe(true);
    const noLink = testData({ crystal: { auto: { link: 0, linkNear: 0 } } });
    const w2 = createWorld(noLink, { seed: 7, tier: 1, protocols: false });
    grantPerk(w2, noLink, 'patch', null, at(0));
    expect(isNeighbour(...autoSlot(w2, noLink, 'chain')!, ...at(0))).toBe(false);
  });

  it('cellSize fits: the full crystal plus one territory cell stays inside the breach at every ring step', () => {
    const c = D.crystal;
    for (let wave = 0; wave <= c.ringEvery * (c.maxRingCap - c.maxRing); wave++) {
      const k = crystalRing(D, wave);
      expect((k * SQRT3 + 1) * c.cellSize + D.territory.cellSize, `wave ${wave}`).toBeLessThanOrEqual(arenaRadius(D, wave));
    }
  });
});
