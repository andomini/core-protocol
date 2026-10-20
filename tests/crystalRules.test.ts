// Crystal combos v2 (spec 2026-10-16 §1–§6), after the uniqueness-plan simplification (no Weld, no Apex):
// cluster-scoped links, immediate tiers, Lattice, gene averaging, pair-aware auto-placement, snapshot defaults.
import { describe, expect, it } from 'vitest';
import { autoSlot, crystalSlots, fusionLinkCounts, fusionTierAt, pairLinkSlots, type Module } from '../src/sim/crystal';
import { DEFAULT_DATA } from '../src/sim/data';
import type { SimEvent } from '../src/sim/events';
import { isNeighbour, ring } from '../src/sim/hex';
import { fusionKeys, TAGS, type Tag, validateSets } from '../src/sim/perkData';
import { accumulateCrystal, grantPerk, latticeMean, latticeMul, latticeNow, perkProfile } from '../src/sim/perks';
import { geneMean, mutate, resetGeneAcc } from '../src/sim/mutations';
import { restore, snapshot } from '../src/sim/snapshot';
import { createWorld, type World } from '../src/sim/state';
import { step } from '../src/sim/step';
import { latticeLine } from '../src/ui/perkText';
import { ofType, testData } from './helpers';

const D = DEFAULT_DATA;
const quiet = (data = D) => createWorld(data, { seed: 7, tier: 1, protocols: false });
const R2 = ring(2);
const at = (i: number): [number, number] => R2[i]!;
const R3 = ring(3);
const o = (i: number): [number, number] => R3[i]!;
const counts = (v: Partial<Record<Tag, number>>): Record<Tag, number> => {
  const c = {} as Record<Tag, number>;
  for (const t of TAGS) c[t] = v[t] ?? 0;
  return c;
};

describe('crystal rules v2 (spec 2026-10-16)', () => {
  it('a fusion rise applies at once, as a drop does (no Weld)', () => {
    const w = quiet();
    const ev: SimEvent[] = [];
    // A zipper: ⚡ on ring 2, 🔗 on ring 3 outside it.
    grantPerk(w, D, 'overclockRounds', ev, at(0));
    grantPerk(w, D, 'bounce', ev, o(0));
    expect(w.fusionTiers['overload+chain']).toBe(1);
    expect(ofType(ev, 'fusion')).toEqual([{ type: 'fusion', key: 'overload+chain', tier: 1, prev: 0, a: at(0), b: o(0) }]);
    grantPerk(w, D, 'arc', ev, o(1));
    grantPerk(w, D, 'burstFire', ev, at(1));
    expect(fusionLinkCounts(w, D)['overload+chain']).toBe(3);
    expect(w.fusionTiers['overload+chain']).toBe(3);
    expect('fusionPending' in w).toBe(false);
    // A drop: moving every 🔗 away ends the fusion at once.
    w.crystal = w.crystal.filter((m) => m.tag !== 'chain');
    grantPerk(w, D, 'split', null, at(9));
    expect(w.fusionTiers['overload+chain']).toBeUndefined();
  });

  it('cluster scope: only the largest cluster of each tag links (ties → lowest module index)', () => {
    const w = quiet();
    grantPerk(w, D, 'overclockRounds', null, at(0));
    grantPerk(w, D, 'burstFire', null, at(1));
    grantPerk(w, D, 'bounce', null, o(1));
    expect(fusionLinkCounts(w, D)).toEqual({ 'overload+chain': 2 });
    // A stray 1-stack ⚡ next to a 🔗 elsewhere links nothing.
    grantPerk(w, D, 'arc', null, at(6));
    grantPerk(w, D, 'hotBarrel', null, at(7));
    expect(fusionLinkCounts(w, D)).toEqual({ 'overload+chain': 2 });
  });

  it('Lattice: the tick average of Σ fusion tier indices multiplies run-end Bits', () => {
    const w = quiet();
    expect(latticeMean(w)).toBe(0);
    expect(latticeMul(w, D)).toBe(1);
    // The index runs I=1 … III=3. 2 ticks at II + I (3 points), 2 ticks at III + III (3 + 3 = 6 points): mean 4.5.
    w.fusionTiers = { 'overload+chain': 3, 'cryo+mining': 1 };
    expect(latticeNow(w, D)).toBe(3);
    for (let i = 0; i < 2; i++) accumulateCrystal(w, D);
    w.fusionTiers = { 'overload+chain': 5, 'cryo+mining': 5 };
    expect(latticeNow(w, D)).toBe(6);
    for (let i = 0; i < 2; i++) accumulateCrystal(w, D);
    expect(latticeMean(w)).toBe(4.5);
    expect(latticeMul(w, D)).toBeCloseTo(1 + 4.5 * D.sets.latticeCoef, 12);
    // The death branch: Bits × runEndBits × the Lattice (one more tick accumulated first).
    w.fusionTiers = {};
    w.latticeSum = 990;
    w.latticeTicks = 99;
    w.bits = 1000;
    w.core.hp = 0;
    const ev: SimEvent[] = [];
    step(w, D, [], ev);
    const death = ofType(ev, 'death')[0]!;
    expect(w.dead).toBe(true);
    const mul = perkProfile(w, D).rules.runEndBits * (1 + D.sets.latticeCoef * (990 / 100));
    expect(w.bits / (w.bits - death.bonusBits)).toBeCloseTo(mul, 9);
    expect(death.bonusBits).toBeGreaterThan(0);
  });

  it('Lattice: the run-end Bits bonus is capped at latticeMax', () => {
    const w = quiet();
    w.latticeSum = 1e6;
    w.latticeTicks = 10;
    expect(D.sets.latticeCoef * latticeMean(w)).toBeGreaterThan(D.sets.latticeMax);
    expect(latticeMul(w, D)).toBe(1 + D.sets.latticeMax);
    expect(latticeLine(D, w)).toMatch(new RegExp(`\\+${Math.round(D.sets.latticeMax * 1000) / 10} % Bits$`));
  });

  it('the ladder is fusionTiers only: no Apex tier, and the shelved keys are rejected', () => {
    const k = 'overload+chain';
    expect(D.sets.fusionTiers).toEqual([1, 3, 5]);
    expect(fusionTierAt(D, 0)).toBe(0);
    expect(fusionTierAt(D, 2)).toBe(1);
    expect(fusionTierAt(D, 5)).toBe(5);
    expect(fusionTierAt(D, 12)).toBe(5);
    for (const key of fusionKeys()) {
      expect(Object.keys(D.sets.fusions[key]!.tiers).sort()).toEqual(['1', '3', '5']);
      expect('apex' in D.sets.fusions[key]!).toBe(false);
    }
    expect(() => validateSets(structuredClone(D.sets))).not.toThrow();
    const reject = (patch: (s: Record<string, unknown>) => void, msg: RegExp) => {
      const bad = structuredClone(D.sets) as unknown as Record<string, unknown>;
      patch(bad);
      expect(() => validateSets(bad as unknown as typeof D.sets)).toThrow(msg);
    };
    reject((s) => (s.weldTicks = 150), /weldTicks/);
    reject((s) => (s.apexSet = 4), /apexSet/);
    reject((s) => ((s.fusions as Record<string, Record<string, unknown>>)[k]!.apex = []), /apex/);
    reject((s) => ((s.fusions as Record<string, Record<string, unknown>>)[k]!.apexLinks = 7), /apexLinks/);
  });

  it('planarity: random crystals never link more than 9 of the 10 pairs', () => {
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return (seed >>> 8) % n;
    };
    const perks = Object.entries(D.perks.perks).filter(([, p]) => p.tag !== undefined);
    const slots = crystalSlots(D, 4);
    let most = 0;
    for (let trial = 0; trial < 400; trial++) {
      const free = [...slots];
      const w = quiet();
      w.perks = {};
      const mods: Module[] = [];
      for (const [id, p] of perks) {
        const [q, r] = free.splice(rnd(free.length), 1)[0]!;
        mods.push({ q, r, perk: id, tag: p.tag });
        w.perks[id] = 1 + rnd(3);
      }
      // Compact layouts touch more: half the trials use only the inner rings.
      w.crystal = trial % 2 === 0 ? mods : mods.map((m, i) => ({ ...m, q: slots[i]![0], r: slots[i]![1] }));
      const n = Object.values(fusionLinkCounts(w, D)).filter((x) => x > 0).length;
      expect(n).toBeLessThanOrEqual(9);
      most = Math.max(most, n);
    }
    expect(most).toBeGreaterThanOrEqual(7);
  });

  it('genes: accumulators average the tag counts over the wave; mutate reads the mean', () => {
    const data = testData({ mutations: { startWave: 1, every: 1 } });
    const w = quiet(data);
    expect(geneMean(w)).toEqual(w.tagCountsNow);
    w.tagCountsNow = counts({ overload: 4 });
    for (let i = 0; i < 3; i++) accumulateCrystal(w, data);
    w.tagCountsNow = counts({ cryo: 10 });
    accumulateCrystal(w, data);
    expect(geneMean(w)).toEqual(counts({ overload: 3, cryo: 2.5 }));
    // A last-second rearrangement to cryo does not win the gene: the mean does.
    w.wave = 1;
    const ev: SimEvent[] = [];
    mutate(w, data, geneMean(w), ev);
    expect(ofType(ev, 'mutation')).toEqual([{ type: 'mutation', tag: 'overload', level: 1 }]);
    resetGeneAcc(w);
    expect(w.geneTicks).toBe(0);
    expect(geneMean(w)).toEqual(w.tagCountsNow);
  });

  it('auto-place is pair-aware: a large linkNear picks a slot that lifts a fusion tier', () => {
    const w = quiet();
    for (const [id, s] of [
      ['overclockRounds', at(0)],
      ['burstFire', at(1)],
      ['hotBarrel', at(2)],
      ['bounce', o(1)],
    ] as const)
      grantPerk(w, D, id, null, s);
    expect(fusionLinkCounts(w, D)['overload+chain']).toBe(2);
    const plain = testData({ crystal: { auto: { linkNear: 0 } } });
    const eager = testData({ crystal: { auto: { linkNear: 1000 } } });
    const s = autoSlot(w, eager, 'chain')!;
    const probe = structuredClone(w);
    probe.crystal.push({ q: s[0], r: s[1], perk: 'arc', tag: 'chain' });
    probe.perks.arc = 1;
    expect(fusionLinkCounts(probe, D)['overload+chain']).toBeGreaterThanOrEqual(3);
    expect(autoSlot(w, plain, 'chain')).not.toBeNull();
    // The pair-chip glow lists exactly the free hexes that add a link to the pair.
    const glow = pairLinkSlots(w, D, 'overload+chain');
    expect(glow.length).toBeGreaterThan(0);
    expect(glow.some(([q, r]) => q === s[0] && r === s[1])).toBe(true);
    for (const [q, r] of glow) expect(w.crystal.some((m) => isNeighbour(q, r, m.q, m.r))).toBe(true);
    expect(pairLinkSlots(w, D, 'cryo+mining')).toEqual([]);
  });

  it('auto-place avoids a slot that makes another same-tag cluster the counted one (fusion drop)', () => {
    // ⚡A (3 stacks) links to 🔗; ⚡B (3 stacks, later index) touches nothing. A module next to B would make B the
    // counted ⚡ cluster (4 > 3) and drop Overcharge I at once.
    const w = quiet();
    for (let i = 0; i < 3; i++) grantPerk(w, D, 'overclockRounds', null, i === 0 ? at(0) : undefined);
    grantPerk(w, D, 'bounce', null, at(1));
    for (let i = 0; i < 3; i++) grantPerk(w, D, 'hotBarrel', null, i === 0 ? at(6) : undefined);
    expect(fusionLinkCounts(w, D)['overload+chain']).toBe(1);
    const linksAfter = (data: typeof D): number => {
      const p = structuredClone(w);
      const s = autoSlot(p, data, 'overload')!;
      p.crystal.push({ q: s[0], r: s[1], perk: 'burstFire', tag: 'overload' });
      p.perks.burstFire = 1;
      return fusionLinkCounts(p, D)['overload+chain'] ?? 0;
    };
    expect(linksAfter(testData({ crystal: { auto: { linkNear: 0 } } }))).toBe(0);
    expect(linksAfter(D)).toBeGreaterThanOrEqual(1);
  });

  it('new World keys have defaults and old snapshots migrate to them', () => {
    const w = quiet();
    expect(w.latticeSum).toBe(0);
    expect(w.latticeTicks).toBe(0);
    expect(w.geneTicks).toBe(0);
    expect(w.frost).toEqual({});
    expect(w.blueprint).toEqual([]);
    expect(w.marks).toEqual({ killed: 0, jackpots: 0, plan: [] });
    grantPerk(w, D, 'overclockRounds', null, at(0));
    const old = JSON.parse(snapshot(w)) as { world: Record<string, unknown> };
    for (const k of ['latticeSum', 'latticeTicks', 'geneAcc', 'geneTicks', 'tagCountsNow', 'frost', 'blueprint', 'marks']) delete old.world[k];
    const back = restore(JSON.stringify(old));
    expect(back.latticeSum).toBe(0);
    expect(back.latticeTicks).toBe(0);
    expect(back.geneTicks).toBe(0);
    expect(back.tagCountsNow).toEqual(w.tagCountsNow);
    expect(back.tagCountsNow.overload).toBe(1);
    expect(back.frost).toEqual({});
    expect(back.blueprint).toEqual([]);
    expect(back.marks).toEqual({ killed: 0, jackpots: 0, plan: [] });
    expect(JSON.parse(snapshot(back))).toEqual(JSON.parse(snapshot(w)));
  });

  it('a pre-v2 snapshot restored with data rebuilds its tiers and mods under the new rules', () => {
    const w = quiet();
    for (const [id, s] of [
      ['overclockRounds', at(0)],
      ['burstFire', at(1)],
      ['bounce', o(1)],
    ] as const)
      grantPerk(w, D, id, null, s);
    const want = JSON.parse(snapshot(w)) as { world: World };
    // The old rules' leftovers: a fusion tier the crystal does not hold, its mod, and a stale set mod.
    w.fusionTiers['cryo+mining'] = 3;
    w.mods.push({ stat: 'damage', op: 'mul', value: 9, source: 'fusion:cryo+mining:3' }, { stat: 'damage', op: 'mul', value: 9, source: 'set:cryo:2' });
    const old = JSON.parse(snapshot(w)) as { world: Record<string, unknown> };
    for (const k of ['latticeSum', 'latticeTicks', 'geneAcc', 'geneTicks', 'tagCountsNow', 'frost', 'blueprint', 'marks', 'fusionBest']) delete old.world[k];
    const plain = restore(JSON.stringify(old));
    expect(plain.fusionTiers['cryo+mining']).toBe(3);
    const back = restore(JSON.stringify(old), D);
    expect(back.fusionTiers).toEqual(want.world.fusionTiers);
    expect(back.setTiers).toEqual(want.world.setTiers);
    expect('fusionPending' in back).toBe(false);
    expect(back.mods.filter((m) => m.value === 9)).toEqual([]);
    expect([...back.mods].map((m) => m.source).sort()).toEqual([...want.world.mods].map((m) => m.source).sort());
  });

  it('a v8 snapshot migrates to v9: fusionPending is dropped and its waiting rise applies at once', () => {
    const w = quiet();
    grantPerk(w, D, 'overclockRounds', null, at(0));
    grantPerk(w, D, 'bounce', null, o(0));
    expect(w.fusionTiers['overload+chain']).toBe(1);
    const want = JSON.parse(snapshot(w)) as { world: World };
    // The same run saved by v8 while Overcharge I was still welding.
    const old = JSON.parse(snapshot(w)) as { v: number; world: Record<string, unknown> & World };
    old.v = 8;
    old.world.v = 8 as World['v'];
    old.world.fusionTiers = {};
    old.world.mods = old.world.mods.filter((m) => !m.source.startsWith('fusion:'));
    old.world.fusionPending = { 'overload+chain': { tier: 1, links: 1, sinceTick: w.tick } };
    const back = restore(JSON.stringify(old), D);
    expect(back.v).toBe(9);
    expect('fusionPending' in back).toBe(false);
    expect(back.fusionTiers).toEqual(want.world.fusionTiers);
    expect([...back.mods].map((m) => m.source).sort()).toEqual([...want.world.mods].map((m) => m.source).sort());
    // Without data the field is still dropped; the rise waits for the next crystal change.
    const plain = restore(JSON.stringify(old));
    expect('fusionPending' in plain).toBe(false);
    expect(plain.fusionTiers).toEqual({});
    expect(() => restore(JSON.stringify({ ...old, v: 6 }))).toThrow(/unsupported version/);
  });
});
