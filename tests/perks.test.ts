import { describe, expect, it } from 'vitest';
import type { Command } from '../src/sim/commands';
import { DEFAULT_DATA, type GameData } from '../src/sim/data';
import type { SimEvent } from '../src/sim/events';
import { hashWorld } from '../src/sim/hash';
import { applyCommands } from '../src/sim/commands';
import {
  applySetTiers,
  enterPick,
  generateOffer,
  grantPerk,
  heldTags,
  isPickWave,
  offerHasRarePlus,
  perkIds,
  perkProfile,
  tagCounts,
} from '../src/sim/perks';
import { restore, snapshot } from '../src/sim/snapshot';
import { createWorld, type RunOptions, type World, worldStats } from '../src/sim/state';
import { step } from '../src/sim/step';
import { mechanicsData, ofType } from './helpers';

const data = mechanicsData({}, { health: 1e9 });
const P = data.perks.perks;

/** Steps `ticks`, taking card `pickIndex` whenever an offer is open; `extra(w)` adds commands per step. */
function play(w: World, d: GameData, ticks: number, extra: (w: World) => Command[] = () => [], pickIndex = 0): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    const cmds = [...extra(w)];
    if (w.phase === 'pick') cmds.push({ type: 'pickPerk', index: pickIndex });
    step(w, d, cmds, all);
  }
  return all;
}

function apply(w: World, d: GameData, ...cmds: Command[]): SimEvent[] {
  const ev: SimEvent[] = [];
  step(w, d, cmds, ev);
  return ev;
}

describe('pick schedule (spec §2.4)', () => {
  it('picks at waves 1, 2, 3, 5, 8, 10, then every 5', () => {
    const yes = [1, 2, 3, 5, 8, 10, 15, 20, 25, 100];
    const no = [4, 6, 7, 9, 11, 12, 13, 14, 16, 19, 21];
    for (const w of yes) expect(isPickWave(DEFAULT_DATA, w), `wave ${w}`).toBe(true);
    for (const w of no) expect(isPickWave(DEFAULT_DATA, w), `wave ${w}`).toBe(false);
  });

  it('the wave-1 pick opens the run at tick 0, before any spawn (B1), and the world waits for it', () => {
    const w = createWorld(data, { seed: 1, tier: 1 });
    expect(w.phase).toBe('pick');
    expect(w.offer).toHaveLength(3);
    expect(new Set(w.offer).size).toBe(3);
    const before = JSON.stringify(w);
    for (let i = 0; i < 50; i++) step(w, data, [], []);
    expect(JSON.stringify(w)).toBe(before);
  });

  it('a pick resolves into the pause and the same step ticks (wave 1 starts at once)', () => {
    const w = createWorld(data, { seed: 1, tier: 1 });
    const id = w.offer[1]!;
    const ev = apply(w, data, { type: 'pickPerk', index: 1 });
    expect(ofType(ev, 'perkPicked')).toEqual([{ type: 'perkPicked', id, stacks: 1 }]);
    expect(w.perks[id]).toBe(1);
    expect(w.tick).toBe(1);
    expect(w.wave).toBe(1);
    expect(w.phase).toBe('wave');
    expect(w.offer).toEqual([]);
  });

  it('later picks open when waves 3, 5, 8, 10, 15, 20 end ("WAVE N CLEARED")', () => {
    const w = createWorld(data, { seed: 2, tier: 1 });
    const ev = play(w, data, 21 * 30 * data.config.tickHz);
    const offers = ofType(ev, 'pickOffer');
    expect(offers.map((o) => o.wave)).toEqual([3, 5, 8, 10, 15, 20]);
    expect(offers.map((o) => o.pick)).toEqual([2, 3, 4, 5, 6, 7]);
    // Each opens right after that wave's reward, then the break follows.
    const i = ev.findIndex((e) => e.type === 'pickOffer');
    expect(ev[i - 1]).toMatchObject({ type: 'waveReward', wave: 3 });
    expect(w.picks).toBe(7);
  });

  it('protocols: false never opens a pick', () => {
    const w = createWorld(data, { seed: 2, tier: 1, protocols: false });
    expect(w.phase).toBe('pause');
    expect(ofType(play(w, data, 6 * 30 * 30), 'pickOffer')).toHaveLength(0);
  });

  it('4 cards with the lab node', () => {
    const w = createWorld(data, { seed: 3, tier: 1, extraPerkChoice: true });
    expect(w.offer).toHaveLength(4);
    expect(new Set(w.offer).size).toBe(4);
  });
});

describe('offers: rarity, pity, tag weighting, locked perks', () => {
  it('rarity split is Common 70 / Rare 25 / Epic 5 (first offers, no weighting)', () => {
    const n = { common: 0, rare: 0, epic: 0 };
    for (let seed = 1; seed <= 2000; seed++) {
      for (const id of createWorld(DEFAULT_DATA, { seed, tier: 1 }).offer) n[P[id]!.rarity]++;
    }
    const total = n.common + n.rare + n.epic;
    expect(n.common / total).toBeGreaterThan(0.67);
    expect(n.common / total).toBeLessThan(0.73);
    expect(n.rare / total).toBeGreaterThan(0.22);
    expect(n.rare / total).toBeLessThan(0.28);
    expect(n.epic / total).toBeGreaterThan(0.035);
    expect(n.epic / total).toBeLessThan(0.065);
  });

  it('pity: after 3 picks without a Rare+, the 4th offer has one (offers chained through real picks)', () => {
    let forced = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const w = createWorld(DEFAULT_DATA, { seed, tier: 1 });
      const history: boolean[] = [];
      for (let k = 0; k < 10 && w.phase === 'pick'; k++) {
        history.push(offerHasRarePlus(DEFAULT_DATA, w.offer));
        applyCommands(w, DEFAULT_DATA, [{ type: 'pickPerk', index: seed % w.offer.length }], []);
        enterPick(w, DEFAULT_DATA, null);
      }
      for (let k = 3; k < history.length; k++) {
        if (!history[k - 1] && !history[k - 2] && !history[k - 3]) {
          expect(history[k], `seed ${seed} pick ${k + 1}`).toBe(true);
          forced++;
        }
      }
    }
    expect(forced).toBeGreaterThan(5);
  });

  it('pity set directly forces a Rare+ card into every offer', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const w = createWorld(DEFAULT_DATA, { seed, tier: 1 });
      w.pity = DEFAULT_DATA.perks.offer.pityAfter;
      expect(offerHasRarePlus(DEFAULT_DATA, generateOffer(w, DEFAULT_DATA, 0))).toBe(true);
    }
  });

  it('pity counter: +1 after a Common-only offer, 0 after one with a Rare+', () => {
    const w = createWorld(DEFAULT_DATA, { seed: 1, tier: 1 });
    w.offer = ['overclockRounds', 'burstFire', 'patch'];
    apply(w, DEFAULT_DATA, { type: 'pickPerk', index: 0 });
    expect(w.pity).toBe(1);
    w.phase = 'pick';
    w.offer = ['overclockRounds', 'hotBarrel', 'patch'];
    apply(w, DEFAULT_DATA, { type: 'pickPerk', index: 0 });
    expect(w.pity).toBe(0);
  });

  it('tag weighting: with held tags, every offer carries at least one held tag', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const w = createWorld(DEFAULT_DATA, { seed, tier: 1 });
      grantPerk(w, DEFAULT_DATA, seed % 2 === 0 ? 'bounce' : 'patch', null);
      const held = heldTags(w, DEFAULT_DATA);
      for (let r = 0; r < 3; r++) {
        const offer = generateOffer(w, DEFAULT_DATA, r);
        expect(offer.some((id) => held.includes(P[id]!.tag)), `seed ${seed} reroll ${r}`).toBe(true);
      }
    }
  });

  it('card tags alone also weight the very first offer', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const w = createWorld(DEFAULT_DATA, { seed, tier: 1, cardTags: ['cryo'] });
      expect(w.offer.some((id) => P[id]!.tag === 'cryo'), `seed ${seed}`).toBe(true);
    }
  });

  it('perks that need a locked stat stay out of the pool until it is unlocked', () => {
    const locked = ['split', 'leech', 'compound'];
    const seen = new Set<string>();
    for (let seed = 1; seed <= 1500; seed++) {
      const w = createWorld(DEFAULT_DATA, { seed, tier: 1 });
      w.pity = 9; // force Rare+ slots: all three are Rare
      for (const id of generateOffer(w, DEFAULT_DATA, 0)) seen.add(id);
    }
    for (const id of locked) expect(seen.has(id), id).toBe(false);
    const unlockedSeen = new Set<string>();
    for (let seed = 1; seed <= 1500; seed++) {
      const w = createWorld(DEFAULT_DATA, { seed, tier: 1, unlocked: ['multishot', 'lifesteal', 'interest'] });
      w.pity = 9;
      for (const id of generateOffer(w, DEFAULT_DATA, 0)) unlockedSeen.add(id);
    }
    for (const id of locked) expect(unlockedSeen.has(id), id).toBe(true);
    expect(unlockedSeen.size).toBe(25);
  });

  it('a perk at max stacks is never offered again', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const w = createWorld(DEFAULT_DATA, { seed, tier: 1 });
      grantPerk(w, DEFAULT_DATA, 'glassCannon', null);
      w.pity = 9;
      expect(generateOffer(w, DEFAULT_DATA, 0)).not.toContain('glassCannon');
    }
  });

  it('an exhausted pool gives no pick (the run simply continues)', () => {
    const w = createWorld(data, { seed: 1, tier: 1, protocols: false });
    for (const id of perkIds(data)) w.perks[id] = P[id]!.maxStacks;
    w.protocols = true;
    expect(generateOffer(w, data, 0)).toEqual([]);
    const ev = play(w, data, 4 * 30 * 30);
    expect(ofType(ev, 'pickOffer')).toHaveLength(0);
    expect(w.wave).toBeGreaterThanOrEqual(3);
  });
});

describe('offer determinism (Weekly-style)', () => {
  /** Offers of the first 6 picks with a given buy log (same picks: index 0; an ad reroll on pick 3). */
  function offersWith(buys: (w: World) => Command[]): string[][] {
    const w = createWorld(data, { seed: 424242, tier: 1 });
    const offers: string[][] = [w.offer.slice()];
    const ev: SimEvent[] = [];
    for (let t = 0; t < 20 * 30 * 30 && w.picks < 6; t++) {
      const cmds = buys(w);
      if (w.phase === 'pick') {
        if (w.picks === 2 && w.rerolls === 0) cmds.push({ type: 'reroll', via: 'ad' });
        else cmds.push({ type: 'pickPerk', index: 0 });
      }
      step(w, data, cmds, ev);
    }
    for (const o of ofType(ev, 'pickOffer')) offers.push(o.offer);
    return offers;
  }

  it('two different purchase logs with one seed produce identical offers', () => {
    const a = offersWith((w) => (w.tick % 97 === 0 ? [{ type: 'buy', stat: 'damage', count: 'max' }] : []));
    const b = offersWith((w) => (w.tick % 41 === 0 ? [{ type: 'buy', stat: 'health', count: 1 }, { type: 'buy', stat: 'attackSpeed', count: 'max' }] : []));
    expect(a.length).toBeGreaterThanOrEqual(7);
    expect(b).toEqual(a);
  });

  it('a different seed gives different offers', () => {
    const a = createWorld(data, { seed: 1, tier: 1 }).offer;
    const differ = [2, 3, 4, 5, 6].some((s) => JSON.stringify(createWorld(data, { seed: s, tier: 1 }).offer) !== JSON.stringify(a));
    expect(differ).toBe(true);
  });
});

describe('rerolls and boost', () => {
  it('a free reroll needs the lab flag and is spent once; ad rerolls always work', () => {
    const w = createWorld(data, { seed: 5, tier: 1 });
    expect(ofType(apply(w, data, { type: 'reroll', via: 'free' }), 'commandRejected')).toEqual([{ type: 'commandRejected', cmd: 'reroll', reason: 'noReroll' }]);
    const f = createWorld(data, { seed: 5, tier: 1, freeReroll: true });
    expect(f.freeRerolls).toBe(1);
    const first = f.offer.slice();
    const ev = apply(f, data, { type: 'reroll', via: 'free' });
    expect(ofType(ev, 'pickOffer')).toEqual([{ type: 'pickOffer', pick: 1, wave: 0, offer: f.offer, rerolls: 1 }]);
    expect(f.offer).not.toEqual(first);
    expect(f.freeRerolls).toBe(0);
    expect(ofType(apply(f, data, { type: 'reroll', via: 'free' }), 'commandRejected')[0]!.reason).toBe('noReroll');
    apply(f, data, { type: 'reroll', via: 'ad' });
    expect(f.rerolls).toBe(2);
    expect(f.phase).toBe('pick');
    expect(f.tick).toBe(0);
  });

  it('pick commands outside a pick, bad indexes and unknown commands are rejected without changes', () => {
    const w = createWorld(data, { seed: 5, tier: 1 });
    const before = JSON.stringify(w);
    const ev: SimEvent[] = [];
    step(w, data, [{ type: 'pickPerk', index: 3 }, { type: 'pickPerk', index: -1 }, { type: 'pickPerk', index: 0.5 } as Command, { type: 'reroll', via: 'gift' } as unknown as Command], ev);
    expect(ofType(ev, 'commandRejected').map((e) => e.reason)).toEqual(['index', 'index', 'index', 'index']);
    expect(JSON.stringify(w)).toBe(before);
    apply(w, data, { type: 'pickPerk', index: 0 });
    expect(ofType(apply(w, data, { type: 'pickPerk', index: 0 }), 'commandRejected')[0]!.reason).toBe('phase');
    expect(ofType(apply(w, data, { type: 'boost' }), 'commandRejected')[0]!.reason).toBe('phase');
  });

  it('boost: ×2 Energy for the next 5 waves, at most once every 10 waves', () => {
    const w = createWorld(data, { seed: 6, tier: 1 });
    expect(ofType(apply(w, data, { type: 'boost' }, { type: 'pickPerk', index: 0 }), 'boost')).toEqual([{ type: 'boost', from: 1, until: 5 }]);
    const ev = play(w, data, 6 * 30 * 30, () => []);
    const kills = ofType(ev, 'kill').filter((k) => k.kind === 'basic');
    // Same base reward per wave; boosted waves pay twice the unboosted ones (energyGrowth aside).
    expect(kills.length).toBeGreaterThan(10);
    // Picks after wave 3 and 5: still on cooldown.
    const w2 = createWorld(data, { seed: 6, tier: 1 });
    apply(w2, data, { type: 'boost' }, { type: 'pickPerk', index: 0 });
    let rejected = 0;
    let accepted: SimEvent[] = [];
    for (let t = 0; t < 16 * 30 * 30; t++) {
      const cmds: Command[] = w2.phase === 'pick' ? [{ type: 'boost' }, { type: 'pickPerk', index: 0 }] : [];
      const e: SimEvent[] = [];
      step(w2, data, cmds, e);
      rejected += ofType(e, 'commandRejected').length;
      accepted = accepted.concat(ofType(e, 'boost'));
    }
    // Wave-3, 5, 8 and 15 picks are inside the cooldown; the wave-10 pick boosts waves 11–15.
    expect(rejected).toBe(4);
    expect(accepted).toEqual([{ type: 'boost', from: 11, until: 15 }]);
  });

  it('boosted kills pay ×2 Energy (same wave, same enemy)', () => {
    const run = (boost: boolean) => {
      const w = createWorld(data, { seed: 8, tier: 1 });
      apply(w, data, ...(boost ? [{ type: 'boost' } as Command] : []), { type: 'pickPerk', index: 0 });
      return ofType(play(w, data, 20 * 30), 'kill')[0]!.energy;
    };
    expect(run(true)).toBeCloseTo(run(false) * DEFAULT_DATA.perks.boost.energyMul, 9);
  });
});

describe('tags, sets and modifiers', () => {
  it('tag counts: 1 per perk stack plus 1 per card tag', () => {
    const w = createWorld(DEFAULT_DATA, { seed: 1, tier: 1, cardTags: ['chain', 'mining', 'nonsense'] });
    grantPerk(w, DEFAULT_DATA, 'bounce', null);
    grantPerk(w, DEFAULT_DATA, 'bounce', null);
    grantPerk(w, DEFAULT_DATA, 'patch', null);
    expect(tagCounts(w, DEFAULT_DATA)).toEqual({ overload: 0, cryo: 0, chain: 3, mining: 1, firewall: 1 });
    expect(w.cardTags).toEqual(['chain', 'mining']);
  });

  it('two card tags of one kind complete its 2-set at run start', () => {
    const w = createWorld(data, { seed: 1, tier: 1, cardTags: ['chain', 'chain'] });
    expect(w.setTiers.chain).toBe(2);
    expect(perkProfile(w, data).rules.bounces).toBe(data.perks.rules.bounces + 1);
  });

  it('set tiers switch on at 2, 4 and 6 with one event each; stat bonuses apply once', () => {
    const w = createWorld(data, { seed: 1, tier: 1 });
    const base = worldStats(w, data).damage;
    const tiers: number[] = [];
    const seq = ['critSpike', 'critSpike', 'critSpike', 'critSpike', 'critSpike', 'hotBarrel'];
    seq.forEach((id, i) => {
      const ev: SimEvent[] = [];
      grantPerk(w, data, id, ev);
      for (const e of ofType(ev, 'setTier')) tiers.push(e.tier);
      expect(w.setTiers.overload).toBe(i + 1 >= 6 ? 6 : i + 1 >= 4 ? 4 : i + 1 >= 2 ? 2 : 0);
    });
    expect(tiers).toEqual([2, 4, 6]);
    const st = worldStats(w, data);
    expect(st.damage).toBeCloseTo(base * 1.1, 9);
    expect(st.critFactor).toBeCloseTo(data.stats.stats.critFactor.base * 1.5, 9);
    expect(perkProfile(w, data).periodic.map((p) => p.e.action)).toEqual(['overdrive']);
    expect(w.mods.filter((m) => m.source.startsWith('set:'))).toHaveLength(2);
  });

  it('no double application: a perk adds its modifiers once; recomputing (twice, or after a restore) changes nothing', () => {
    const w = createWorld(data, { seed: 1, tier: 1 });
    const n0 = w.mods.length;
    const d0 = worldStats(w, data).damage;
    grantPerk(w, data, 'overclockRounds', null);
    expect(w.mods).toHaveLength(n0 + 1);
    const a = worldStats(w, data);
    const b = worldStats(w, data);
    expect(b).toEqual(a);
    expect(a.damage).toBeCloseTo(d0 * 1.15, 12);
    applySetTiers(w, data, null);
    applySetTiers(w, data, null);
    expect(w.mods).toHaveLength(n0 + 1);
    expect(perkProfile(w, data)).toEqual(perkProfile(w, data));
    expect(worldStats(restore(snapshot(w)), data)).toEqual(a);
  });

  it('stacks compound: two Overclock Rounds = ×1.15² (and the ⚡ 2-set ×1.1 they complete)', () => {
    const w = createWorld(data, { seed: 1, tier: 1 });
    const d0 = worldStats(w, data).damage;
    grantPerk(w, data, 'overclockRounds', null);
    grantPerk(w, data, 'overclockRounds', null);
    expect(w.perks.overclockRounds).toBe(2);
    expect(worldStats(w, data).damage).toBeCloseTo(d0 * 1.15 * 1.15 * 1.1, 12);
  });

  it('max HP perks keep HP consistent: Bunker adds the new HP, Glass Cannon clamps it', () => {
    const w = createWorld(data, { seed: 1, tier: 1 });
    const h0 = worldStats(w, data).health;
    w.core.hp = h0 - 10;
    grantPerk(w, data, 'bunker', null);
    expect(w.core.hp).toBeCloseTo(h0 * 1.4 - 10, 9);
    grantPerk(w, data, 'glassCannon', null);
    expect(w.core.hp).toBeCloseTo(h0 * 1.4 * 0.75, 9);
  });
});

describe('snapshots in the pick phase', () => {
  const opts: RunOptions = { seed: 99, tier: 1 };

  it('the opening offer survives a round trip and the run continues identically', () => {
    const straight = createWorld(data, opts);
    play(straight, data, 4000);
    const first = createWorld(data, opts);
    const resumed = restore(snapshot(first));
    expect(resumed.phase).toBe('pick');
    expect(resumed.offer).toEqual(first.offer);
    play(resumed, data, 4000);
    expect(hashWorld(resumed)).toBe(hashWorld(straight));
  });

  it('a snapshot taken while a mid-run offer is open (after wave 3) restores and continues identically', () => {
    const straight = createWorld(data, opts);
    play(straight, data, 9000);
    const w = createWorld(data, opts);
    while (!(w.phase === 'pick' && w.wave === 3)) step(w, data, w.phase === 'pick' ? [{ type: 'pickPerk', index: 0 }] : [], []);
    const r = restore(snapshot(w));
    expect(r.offer).toEqual(w.offer);
    // Count the steps used so far: every non-pick step ticked once, every pick step too.
    const used = w.tick + 0;
    play(r, data, 9000 - used);
    expect(r.tick).toBe(straight.tick);
    expect(hashWorld(r)).toBe(hashWorld(straight));
  });
});
