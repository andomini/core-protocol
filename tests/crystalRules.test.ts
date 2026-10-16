// Crystal combos v2, phase 1 (spec 2026-10-16 §1–§6): cluster-scoped links, Apex, Weld, Lattice, gene
// averaging, pair-aware auto-placement, the new World keys and their snapshot defaults.
import { describe, expect, it } from 'vitest';
import { autoSlot, crystalSlots, fusionLinkCounts, fusionTierAt, pairLinkSlots, type Module } from '../src/sim/crystal';
import { DEFAULT_DATA } from '../src/sim/data';
import type { SimEvent } from '../src/sim/events';
import { isNeighbour, ring } from '../src/sim/hex';
import { fusionKeys, TAGS, type Tag, validateSets } from '../src/sim/perkData';
import { accumulateCrystal, grantPerk, latticeMean, latticeMul, latticeNow, perkProfile, settleWeld } from '../src/sim/perks';
import { geneMean, mutate, resetGeneAcc } from '../src/sim/mutations';
import { restore, snapshot } from '../src/sim/snapshot';
import { createWorld, type World } from '../src/sim/state';
import { step } from '../src/sim/step';
import { latticeLine } from '../src/ui/perkText';
import { ofType, stepN, testData } from './helpers';

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
  it('Weld: a fusion rise applies after exactly weldTicks steps; a link change restarts it; a drop is immediate', () => {
    const W = D.sets.weldTicks;
    expect(W).toBe(5 * D.config.tickHz);
    const w = quiet();
    const ev: SimEvent[] = [];
    // A zipper: ⚡ on ring 2, 🔗 on ring 3 outside it.
    grantPerk(w, D, 'overclockRounds', ev, at(0));
    grantPerk(w, D, 'bounce', ev, o(0));
    expect(w.fusionTiers['overload+chain']).toBeUndefined();
    expect(w.fusionPending['overload+chain']).toEqual({ tier: 1, links: 1, sinceTick: w.tick });
    stepN(w, D, W - 1);
    expect(w.fusionTiers['overload+chain']).toBeUndefined();
    const last = stepN(w, D, 1);
    expect(w.fusionTiers['overload+chain']).toBe(1);
    expect(w.fusionPending).toEqual({});
    expect(ofType(last, 'fusion')).toEqual([{ type: 'fusion', key: 'overload+chain', tier: 1, prev: 0, a: at(0), b: o(0) }]);

    grantPerk(w, D, 'arc', ev, o(1));
    expect(w.fusionPending).toEqual({});
    grantPerk(w, D, 'burstFire', ev, at(1));
    const since = w.tick;
    expect(fusionLinkCounts(w, D)['overload+chain']).toBe(3);
    expect(w.fusionPending['overload+chain']).toEqual({ tier: 3, links: 3, sinceTick: since });
    // Ten ticks before it would settle, one more link (still tier II) restarts the weld.
    w.tick = since + W - 10;
    grantPerk(w, D, 'overchargeLink', ev, o(2));
    expect(w.fusionPending['overload+chain']).toEqual({ tier: 3, links: 4, sinceTick: since + W - 10 });
    w.tick = since + W;
    settleWeld(w, D, null);
    expect(w.fusionTiers['overload+chain']).toBe(1);
    w.tick = since + 2 * W - 11;
    settleWeld(w, D, null);
    expect(w.fusionTiers['overload+chain']).toBe(1);
    w.tick += 1;
    settleWeld(w, D, null);
    expect(w.fusionTiers['overload+chain']).toBe(3);
    // A drop: moving every 🔗 away ends the fusion at once, no pending entry.
    const drop: SimEvent[] = [];
    w.crystal = w.crystal.filter((m) => m.tag !== 'chain');
    grantPerk(w, D, 'split', drop, at(9));
    expect(w.fusionTiers['overload+chain']).toBeUndefined();
    expect(w.fusionPending['overload+chain']).toBeUndefined();
  });

  it('Weld: a rise that falls back before it settles never applies', () => {
    const w = quiet();
    grantPerk(w, D, 'overclockRounds', null, at(0));
    grantPerk(w, D, 'bounce', null, at(1));
    expect(w.fusionPending['overload+chain']?.tier).toBe(1);
    w.crystal = w.crystal.filter((m) => m.tag !== 'chain');
    grantPerk(w, D, 'split', null, at(9));
    expect(w.fusionPending).toEqual({});
    w.tick += D.sets.weldTicks * 2;
    settleWeld(w, D, null);
    expect(w.fusionTiers).toEqual({});
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
    // 3 ticks at II + I (3 points), 1 tick at III + Apex (3 + 4 = 7 points): mean 4.
    w.fusionTiers = { 'overload+chain': 3, 'cryo+mining': 1 };
    expect(latticeNow(w, D)).toBe(3);
    for (let i = 0; i < 3; i++) accumulateCrystal(w, D);
    w.fusionTiers = { 'overload+chain': 5, 'cryo+mining': 7 };
    expect(latticeNow(w, D)).toBe(7);
    accumulateCrystal(w, D);
    expect(latticeMean(w)).toBe(4);
    expect(latticeMul(w, D)).toBeCloseTo(1 + 4 * D.sets.latticeCoef, 12);
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

  it('Apex: links ≥ apexLinks and both set counts ≥ apexSet; never for firewall pairs', () => {
    const k = 'overload+chain';
    expect(D.sets.fusions[k]!.apexLinks).toBe(7);
    const four = counts({ overload: 4, chain: 4, firewall: 9 });
    expect(fusionTierAt(D, k, 7, four)).toBe(7);
    expect(fusionTierAt(D, k, 12, four)).toBe(7);
    expect(fusionTierAt(D, k, 6, four)).toBe(5);
    expect(fusionTierAt(D, k, 7, counts({ overload: 4, chain: 3 }))).toBe(5);
    for (const key of fusionKeys().filter((x) => x.endsWith('+firewall'))) {
      expect(D.sets.fusions[key]!.apex).toBeUndefined();
      const [a] = key.split('+') as [Tag, Tag];
      expect(fusionTierAt(D, key, 7, counts({ [a]: 9, firewall: 9 }))).toBe(fusionTierAt(D, key, 5, counts({ [a]: 9, firewall: 9 })));
    }
    for (const key of fusionKeys().filter((x) => !x.endsWith('+firewall'))) expect(D.sets.fusions[key]!.apex!.length).toBeGreaterThan(0);
    const bad = structuredClone(D.sets);
    bad.fusions['overload+firewall']!.apex = structuredClone(D.sets.fusions[k]!.apex);
    bad.fusions['overload+firewall']!.apexLinks = 7;
    expect(() => validateSets(bad)).toThrow(/firewall fusions have no apex/);
    const low = structuredClone(D.sets);
    low.fusions[k]!.apexLinks = 5;
    expect(() => validateSets(low)).toThrow(/apexLinks must be above/);
  });

  it('Apex: reached in the sim it is tier 7 with its own rules, and drops to III at once when a set falls below apexSet', () => {
    const w = quiet();
    w.cardTags = ['overload'];
    // ⚡ at(0..2), 🔗 at o(0..4): 7 links; ⚡ 3 modules + 1 card = 4, 🔗 5.
    ['overclockRounds', 'burstFire', 'hotBarrel'].forEach((id, i) => grantPerk(w, D, id, null, at(i)));
    ['bounce', 'arc', 'split', 'conductive', 'overchargeLink'].forEach((id, i) => grantPerk(w, D, id, null, o(i)));
    expect(fusionLinkCounts(w, D)['overload+chain']).toBe(7);
    w.tick += D.sets.weldTicks;
    settleWeld(w, D, null);
    expect(w.fusionTiers['overload+chain']).toBe(7);
    const three = structuredClone(w);
    three.fusionTiers['overload+chain'] = 5;
    expect(perkProfile(w, D).rules).not.toEqual(perkProfile(three, D).rules);
    w.cardTags = [];
    grantPerk(w, D, 'frostShot', null, at(9));
    expect(w.fusionTiers['overload+chain']).toBe(5);
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
    expect(w.fusionPending).toEqual({});
    expect(w.latticeSum).toBe(0);
    expect(w.latticeTicks).toBe(0);
    expect(w.geneTicks).toBe(0);
    expect(w.frost).toEqual({});
    expect(w.blueprint).toEqual([]);
    expect(w.marks).toEqual({ killed: 0, jackpots: 0, plan: [] });
    grantPerk(w, D, 'overclockRounds', null, at(0));
    const old = JSON.parse(snapshot(w)) as { world: Record<string, unknown> };
    for (const k of ['fusionPending', 'latticeSum', 'latticeTicks', 'geneAcc', 'geneTicks', 'tagCountsNow', 'frost', 'blueprint', 'marks']) delete old.world[k];
    const back = restore(JSON.stringify(old));
    expect(back.fusionPending).toEqual({});
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
    settleWeld(Object.assign(w, { tick: w.tick + D.sets.weldTicks }), D, null);
    const want = JSON.parse(snapshot(w)) as { world: World };
    // The old rules' leftovers: a fusion tier the crystal does not hold, its mod, and a stale set mod.
    w.fusionTiers['cryo+mining'] = 3;
    w.mods.push({ stat: 'damage', op: 'mul', value: 9, source: 'fusion:cryo+mining:3' }, { stat: 'damage', op: 'mul', value: 9, source: 'set:cryo:2' });
    const old = JSON.parse(snapshot(w)) as { world: Record<string, unknown> };
    for (const k of ['fusionPending', 'latticeSum', 'latticeTicks', 'geneAcc', 'geneTicks', 'tagCountsNow', 'frost', 'blueprint', 'marks', 'fusionBest']) delete old.world[k];
    const plain = restore(JSON.stringify(old));
    expect(plain.fusionTiers['cryo+mining']).toBe(3);
    const back = restore(JSON.stringify(old), D);
    expect(back.fusionTiers).toEqual(want.world.fusionTiers);
    expect(back.setTiers).toEqual(want.world.setTiers);
    expect(back.fusionPending).toEqual({});
    expect(back.mods.filter((m) => m.value === 9)).toEqual([]);
    expect([...back.mods].map((m) => m.source).sort()).toEqual([...want.world.mods].map((m) => m.source).sort());
  });
});
