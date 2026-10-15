import { describe, expect, it } from 'vitest';
import { applyCommands, type Command, type LoggedCommand } from '../src/sim/commands';
import { fusionLinkCounts, fusionLinks } from '../src/sim/crystal';
import { DEFAULT_DATA } from '../src/sim/data';
import type { SimEvent } from '../src/sim/events';
import { hashWorld } from '../src/sim/hash';
import { isNeighbour, ring } from '../src/sim/hex';
import { fusionKey, fusionKeys, validateSets } from '../src/sim/perkData';
import { grantPerk, perkProfile } from '../src/sim/perks';
import { hitEnemy } from '../src/sim/projectiles';
import { replay } from '../src/sim/replay';
import { restore, snapshot } from '../src/sim/snapshot';
import { createWorld, worldStats } from '../src/sim/state';
import { combatStats, step } from '../src/sim/step';
import { spawnEnemy } from '../src/sim/waves';
import { ofType } from './helpers';

const D = DEFAULT_DATA;
const quiet = () => createWorld(D, { seed: 7, tier: 1, protocols: false });
type W = ReturnType<typeof quiet>;
// Ring 2 is the inner module ring: every hex there touches the core block, and consecutive hexes touch.
const R2 = ring(2);
const at = (i: number): [number, number] => R2[i]!;

function grant(w: W, id: string, slot: [number, number], times = 1, events: SimEvent[] | null = null): void {
  for (let i = 0; i < times; i++) grantPerk(w, D, id, events, i === 0 ? slot : undefined);
}

function move(w: W, from: [number, number], to: [number, number]): SimEvent[] {
  const ev: SimEvent[] = [];
  applyCommands(w, D, [{ type: 'moveModule', from, to }], ev);
  return ev;
}

describe('fusions: links between touching modules of two tags (spec 2026-10-15 §1)', () => {
  it('data: one 1 / 3 / 5 ladder per tag pair, keyed in tag order; validation names the bad entry', () => {
    expect(D.sets.fusionTiers).toEqual([1, 3, 5]);
    expect(Object.keys(D.sets.fusions).sort()).toEqual(fusionKeys().sort());
    expect(fusionKeys()).toHaveLength(10);
    expect(fusionKey('chain', 'overload')).toBe('overload+chain');
    for (const k of fusionKeys()) expect(Object.keys(D.sets.fusions[k]!.tiers).sort()).toEqual(['1', '3', '5']);
    const swapped = structuredClone(D.sets);
    swapped.fusions['chain+overload'] = swapped.fusions['overload+chain']!;
    expect(() => validateSets(swapped)).toThrow(/sets\.fusions\.chain\+overload/);
    const missing = structuredClone(D.sets);
    delete missing.fusions['overload+cryo']!.tiers['3'];
    expect(() => validateSets(missing)).toThrow(/sets\.fusions\.overload\+cryo\.tiers\.3/);
    const extra = structuredClone(D.sets);
    extra.fusions['overload+cryo']!.tiers['2'] = [{ type: 'shield', frac: 0.1 }];
    expect(() => validateSets(extra)).toThrow(/tiers\.2 is not a fusion tier/);
    const order = structuredClone(D.sets);
    order.fusionTiers = [3, 1, 5];
    expect(() => validateSets(order)).toThrow(/sets\.fusionTiers must be increasing/);
  });

  it('every shared edge is one link: two touching modules = 1, one module between two of the other tag = 2', () => {
    expect(isNeighbour(...at(0), ...at(1)) && isNeighbour(...at(1), ...at(2)) && !isNeighbour(...at(0), ...at(2))).toBe(true);
    const w = quiet();
    grant(w, 'overclockRounds', at(0));
    grant(w, 'bounce', at(1));
    expect(fusionLinks(w, D)).toEqual([{ a: 0, b: 1, key: 'overload+chain' }]);
    expect(fusionLinkCounts(w, D)).toEqual({ 'overload+chain': 1 });
    grant(w, 'burstFire', at(2));
    expect(fusionLinkCounts(w, D)).toEqual({ 'overload+chain': 2 });
    // Same-tag neighbours are a set cluster, not a link.
    grant(w, 'arc', at(11));
    grant(w, 'conductive', at(10));
    expect(fusionLinkCounts(w, D)).toEqual({ 'overload+chain': 3 });
  });

  it('tiers I / II / III at 1 / 3 / 5 links, one event per change, effects add up', () => {
    const w = quiet();
    const ev: SimEvent[] = [];
    const base = perkProfile(w, D).rules;
    // Alternating ⚡ 🔗 ⚡ 🔗 ⚡ 🔗 along ring 2: each new module adds one link (no two ⚡ touch: no set).
    const seq = ['overclockRounds', 'bounce', 'burstFire', 'arc', 'hotBarrel', 'overchargeLink'];
    const tiers: number[] = [];
    seq.forEach((id, i) => {
      grant(w, id, at(i), 1, ev);
      tiers.push(w.fusionTiers['overload+chain'] ?? 0);
    });
    expect(tiers).toEqual([0, 1, 1, 3, 3, 5]);
    expect(ofType(ev, 'fusion')).toEqual([
      { type: 'fusion', key: 'overload+chain', tier: 1, prev: 0, a: at(0), b: at(1) },
      { type: 'fusion', key: 'overload+chain', tier: 3, prev: 1, a: at(0), b: at(1) },
      { type: 'fusion', key: 'overload+chain', tier: 5, prev: 3, a: at(0), b: at(1) },
    ]);
    expect(ofType(ev, 'setTier')).toEqual([]);
    const p = perkProfile(w, D);
    // The ⚡/🔗 perks change no lightning rules themselves, so the ratios are the fusion's alone.
    expect(p.rules.lightningDamage).toBeCloseTo(base.lightningDamage * 1.3, 12);
    expect(p.rules.lightningTargets).toBeCloseTo(base.lightningTargets + 1, 12);
    expect(p.periodic.filter((x) => x.key === 'fusion:overload+chain:5:0').map((x) => x.e.action)).toEqual(['tesla']);
    expect(w.timers['fusion:overload+chain:5:0']).toEqual({ next: Math.round(10 * D.config.tickHz), until: -1 });
  });

  it('live: a move that takes links away lowers the tier (mods and timers go), moving back restores it once', () => {
    const w = quiet();
    // ⚡ 💰 ⚡ 💰 → 3 links: Headhunter II adds +5 % Crit Chance as a stat mod.
    ['overclockRounds', 'energySiphon', 'burstFire', 'dataMine'].forEach((id, i) => grant(w, id, at(i)));
    expect(w.fusionTiers['overload+mining']).toBe(3);
    const crit = worldStats(w, D).critChance;
    expect(w.mods.filter((m) => m.source === 'fusion:overload+mining:3')).toHaveLength(1);
    // 💰 at hex 3 goes to the far side of the ring: 2 links left → tier I.
    let ev = move(w, at(3), at(8));
    expect(ofType(ev, 'commandRejected')).toEqual([]);
    expect(w.fusionTiers['overload+mining']).toBe(1);
    expect(ofType(ev, 'fusion')).toEqual([{ type: 'fusion', key: 'overload+mining', tier: 1, prev: 3, a: at(0), b: at(1) }]);
    expect(w.mods.filter((m) => m.source.startsWith('fusion:overload+mining:3'))).toEqual([]);
    expect(worldStats(w, D).critChance).toBeCloseTo(crit - 0.05, 12);
    ev = move(w, at(8), at(3));
    expect(w.fusionTiers['overload+mining']).toBe(3);
    expect(ofType(ev, 'fusion')).toHaveLength(1);
    expect(w.mods.filter((m) => m.source === 'fusion:overload+mining:3')).toHaveLength(1);
    expect(worldStats(w, D).critChance).toBeCloseTo(crit, 12);
    // Every module of one tag away from the other: the fusion is gone, with a tier-0 event and no link hexes.
    move(w, at(1), at(6));
    ev = move(w, at(3), at(7));
    expect(w.fusionTiers).toEqual({});
    expect(ofType(ev, 'fusion')).toEqual([{ type: 'fusion', key: 'overload+mining', tier: 0, prev: 1, a: null, b: null }]);
    expect(w.mods.some((m) => m.source.startsWith('fusion:'))).toBe(false);
  });

  it('live sets too: breaking a cluster switches the set off (its HP mod goes, HP stays within max)', () => {
    const w = quiet();
    const ev: SimEvent[] = [];
    grant(w, 'patch', at(0), 1, ev);
    grant(w, 'hardening', at(1), 1, ev);
    expect(w.setTiers.firewall).toBe(2);
    expect(ofType(ev, 'setTier')).toEqual([{ type: 'setTier', tag: 'firewall', tier: 2, prev: 0 }]);
    w.core.hp = worldStats(w, D).health;
    const off = move(w, at(1), at(6));
    expect(w.setTiers.firewall).toBe(0);
    expect(ofType(off, 'setTier')).toEqual([{ type: 'setTier', tag: 'firewall', tier: 0, prev: 2 }]);
    expect(w.mods.some((m) => m.source.startsWith('set:'))).toBe(false);
    expect(w.core.hp).toBeLessThanOrEqual(worldStats(w, D).health);
    const on = move(w, at(6), at(1));
    expect(ofType(on, 'setTier')).toEqual([{ type: 'setTier', tag: 'firewall', tier: 2, prev: 0 }]);
    expect(w.mods.filter((m) => m.source === 'set:firewall:2')).toHaveLength(1);
  });

  it('moves never heal: a Health bonus switched off and on keeps the HP share (a full core stays full)', () => {
    const w = quiet();
    grant(w, 'patch', at(0));
    grant(w, 'hardening', at(1));
    const max = worldStats(w, D).health;
    w.core.hp = max * 0.3;
    for (let i = 0; i < 5; i++) {
      move(w, at(1), at(6));
      expect(w.core.hp).toBeCloseTo(worldStats(w, D).health * 0.3, 9);
      move(w, at(6), at(1));
    }
    expect(w.core.hp).toBeCloseTo(max * 0.3, 9);
    w.core.hp = max;
    move(w, at(1), at(6));
    move(w, at(6), at(1));
    expect(w.core.hp).toBe(max);
  });

  it('a dropped tier stops its periodic effects; rebuilding it does not recharge a spent immunity', () => {
    const w = quiet();
    ['overclockRounds', 'bounce', 'burstFire', 'arc', 'hotBarrel', 'overchargeLink'].forEach((id, i) => grant(w, id, at(i)));
    const tesla = 'fusion:overload+chain:5:0';
    expect(perkProfile(w, D).periodic.map((x) => x.key)).toContain(tesla);
    move(w, at(5), at(9));
    expect(w.fusionTiers['overload+chain']).toBe(3);
    expect(w.timers[tesla]).toBeUndefined();
    expect(perkProfile(w, D).periodic.map((x) => x.key)).not.toContain(tesla);
    move(w, at(9), at(5));
    expect(w.timers[tesla]).toEqual({ next: w.tick + Math.round(10 * D.config.tickHz), until: -1 });

    const f = quiet();
    grant(f, 'patch', at(0), 5);
    grant(f, 'reflect', at(1));
    expect(f.setTiers.firewall).toBe(6);
    const shield = 'set:firewall:6:0';
    expect(f.timers[shield]).toEqual({ next: 0, until: -1 });
    f.timers[shield] = { next: f.wave + 3, until: -1 }; // spent this wave
    move(f, at(1), at(6));
    expect(f.setTiers.firewall).toBe(4);
    expect(perkProfile(f, D).periodic.map((x) => x.key)).not.toContain(shield);
    move(f, at(6), at(1));
    expect(f.setTiers.firewall).toBe(6);
    expect(f.timers[shield]).toEqual({ next: f.wave + 3, until: -1 });
  });

  it('moveModule rejects: dead core, no module at from, a hex outside the crystal or itself, a crystal that would come apart', () => {
    const w = quiet();
    grant(w, 'patch', at(0));
    // A ring-3 module held on only by the ring-2 module at hex 0.
    const outer = ring(3).find(([q, r]) => isNeighbour(q, r, ...at(0)) && !isNeighbour(q, r, ...at(1)) && !isNeighbour(q, r, ...at(11)))!;
    grant(w, 'reflect', outer);
    const reasons = (cmds: Command[]): string[] => {
      const ev: SimEvent[] = [];
      applyCommands(w, D, cmds, ev);
      return ofType(ev, 'commandRejected').map((e) => e.reason);
    };
    const before = JSON.stringify(w.crystal);
    expect(reasons([{ type: 'moveModule', from: at(5), to: at(6) }])).toEqual(['empty']);
    expect(reasons([{ type: 'moveModule', from: at(0), to: at(0) }])).toEqual(['slot']);
    expect(reasons([{ type: 'moveModule', from: at(0), to: [0, 0] }])).toEqual(['slot']);
    expect(reasons([{ type: 'moveModule', from: at(0), to: ring(4)[0]! }])).toEqual(['slot']);
    expect(reasons([{ type: 'moveModule', from: at(0), to: 'x' } as unknown as Command])).toEqual(['slot']);
    expect(reasons([{ type: 'moveModule', from: at(0), to: at(6) }])).toEqual(['link']);
    expect(JSON.stringify(w.crystal)).toBe(before);
    // A swap keeps every hex occupied, so it is always fine; the module list keeps its order.
    expect(reasons([{ type: 'moveModule', from: at(0), to: outer }])).toEqual([]);
    expect(w.crystal.map((m) => [m.perk, m.q, m.r])).toEqual([
      ['patch', ...outer],
      ['reflect', ...at(0)],
    ]);
    w.dead = true;
    expect(reasons([{ type: 'moveModule', from: at(0), to: outer }])).toEqual(['dead']);
  });

  it('Cold Storage I: a frozen kill pays ×1.5 Energy', () => {
    const pay = (fused: boolean): number => {
      const w = quiet();
      grant(w, 'frostShot', at(0), 2);
      grant(w, fused ? 'dataMine' : 'energySiphon', fused ? at(1) : at(6), 2);
      w.wave = 1;
      const e = spawnEnemy(w, D, 'basic', 50, 0, []);
      e.frozenUntil = w.tick + 100;
      const prof = perkProfile(w, D);
      const st = combatStats(w, D, prof);
      const e0 = w.energy;
      hitEnemy(w, D, st, prof, e, e.hp * 2, false, 'shot', []);
      return (w.energy - e0) / (1 + st.energyBonus + prof.killEnergy);
    };
    expect(pay(true)).toBeCloseTo(pay(false) * 1.5, 9);
  });

  it('old saves (no fusionTiers, or the first-pass fusions list) restore with none and nothing left over', () => {
    const w = quiet();
    const s = JSON.parse(snapshot(w)) as { world: Record<string, unknown> & { mods: { source: string }[]; timers: Record<string, unknown> } };
    delete s.world.fusionTiers;
    s.world.fusions = ['overload+chain'];
    s.world.mods.push({ stat: 'damage', op: 'mul', value: 2, source: 'fusion:overload+chain' } as never);
    s.world.timers['fusion:overload+chain:0'] = { next: 1, until: -1 };
    const r = restore(JSON.stringify(s));
    expect(r.fusionTiers).toEqual({});
    expect('fusions' in r).toBe(false);
    expect(r.mods.some((m) => m.source.startsWith('fusion:'))).toBe(false);
    expect(Object.keys(r.timers).some((k) => k.startsWith('fusion:'))).toBe(false);
    const bad = JSON.parse(snapshot(w)) as { world: Record<string, unknown> };
    bad.world.fusionTiers = { 'overload+chain': -1 };
    expect(() => restore(JSON.stringify(bad))).toThrow(/snapshot: malformed world/);
  });

  it('moves are commands: a run with swaps at its picks replays to the same world', () => {
    const opts = { seed: 12, tier: 1 };
    const w = createWorld(D, opts);
    const log: LoggedCommand[] = [];
    const events: SimEvent[] = [];
    let moves = 0;
    while (w.tick < 4000 && !w.dead) {
      const cmds: Command[] = [];
      if (w.phase === 'pick') {
        if (w.crystal.length >= 2) {
          const a = w.crystal[0]!;
          const b = w.crystal[w.crystal.length - 1]!;
          cmds.push({ type: 'moveModule', from: [a.q, a.r], to: [b.q, b.r] });
          moves++;
        }
        cmds.push({ type: 'pickPerk', index: 0 });
      }
      for (const cmd of cmds) log.push({ tick: w.tick, cmd });
      step(w, D, cmds, events);
    }
    expect(moves).toBeGreaterThan(0);
    expect(ofType(events, 'commandRejected')).toEqual([]);
    const r = replay(D, opts, log, w.tick, 1000);
    expect(hashWorld(r.world)).toBe(hashWorld(w));
    expect(r.world.crystal).toEqual(w.crystal);
  });
});
