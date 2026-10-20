// Boot sectors (uniqueness plan item 1): the run opens on a pick of 3 of the 5 boot sectors (seeded), each
// a 3-module single-tag cluster that switches its set-2 bonus on from wave 1; then the wave-1 protocol pick.
import { describe, expect, it } from 'vitest';
import { applyCommands, type Command, type LoggedCommand } from '../src/sim/commands';
import { clusterCounts } from '../src/sim/crystal';
import { DEFAULT_DATA as D, validateData } from '../src/sim/data';
import type { SimEvent } from '../src/sim/events';
import { hashWorld } from '../src/sim/hash';
import { geneKeep, geneWeight, nextMutationWave } from '../src/sim/mutations';
import { bootOpen, bootSector, isPickWave, pickDue } from '../src/sim/perks';
import { replay } from '../src/sim/replay';
import { restore, snapshot } from '../src/sim/snapshot';
import { createWorld, type World } from '../src/sim/state';
import { step } from '../src/sim/step';
import { ofType } from './helpers';

const apply = (w: World, ...cmds: Command[]): SimEvent[] => {
  const ev: SimEvent[] = [];
  applyCommands(w, D, cmds, ev);
  return ev;
};

describe('boot sectors', () => {
  it('a new run opens on a seeded boot offer of 3 distinct sectors (no protocol offer yet)', () => {
    const a = createWorld(D, { seed: 11, tier: 1 });
    const b = createWorld(D, { seed: 11, tier: 1 });
    expect(a.phase).toBe('pick');
    expect(bootOpen(a)).toBe(true);
    expect(a.offer).toEqual([]);
    expect(a.bootOffer).toHaveLength(D.boot.offerSize);
    expect(new Set(a.bootOffer).size).toBe(D.boot.offerSize);
    expect(b.bootOffer).toEqual(a.bootOffer);
    const seen = new Set<string>();
    let differ = false;
    for (let seed = 1; seed <= 60; seed++) {
      const w = createWorld(D, { seed, tier: 1 });
      for (const id of w.bootOffer) seen.add(id);
      differ ||= w.bootOffer.join() !== a.bootOffer.join();
    }
    expect(differ).toBe(true);
    expect(seen.size).toBe(D.boot.sectors.length);
  });

  it('no boot pick with boot: false or without protocols', () => {
    const w = createWorld(D, { seed: 1, tier: 1, boot: false });
    expect(w.bootOffer).toEqual([]);
    expect(w.offer).toHaveLength(D.perks.offer.size);
    const q = createWorld(D, { seed: 1, tier: 1, protocols: false });
    expect(q.bootOffer).toEqual([]);
    expect(q.phase).not.toBe('pick');
  });

  for (const s of D.boot.sectors) {
    it(`${s.id}: its 3 modules land on their slots as one ${s.tag} cluster, set 2 on; it stands in for the wave 1–3 picks`, () => {
      const w = createWorld(D, { seed: 3, tier: 1 });
      w.bootOffer = [s.id, ...w.bootOffer.filter((id) => id !== s.id)].slice(0, D.boot.offerSize);
      const ev = apply(w, { type: 'pickBoot', index: 0 });
      expect(ofType(ev, 'commandRejected')).toEqual([]);
      expect(ofType(ev, 'bootPicked')).toEqual([{ type: 'bootPicked', id: s.id, tag: s.tag, modules: s.modules.map((m) => m.slot) }]);
      expect(w.boot).toBe(s.id);
      expect(w.bootOffer).toEqual([]);
      expect(w.crystal.map((m) => [m.q, m.r])).toEqual(s.modules.map((m) => m.slot));
      expect(w.crystal.every((m) => m.tag === s.tag)).toBe(true);
      expect(clusterCounts(w, D)[s.tag]).toBe(s.modules.length);
      expect(w.setTiers[s.tag]).toBe(D.sets.tiers[0]);
      expect(w.picks).toBe(0);
      // No wave-1 protocol pick (boot.skipPicks); the run starts.
      expect(D.boot.skipPicks).toContain(1);
      expect(w.phase).toBe('pause');
      expect(w.offer).toEqual([]);
      expect(bootOpen(w)).toBe(false);
    });
  }

  it('rejects other pick commands during the boot pick, a bad index, and a second boot pick', () => {
    const w = createWorld(D, { seed: 5, tier: 1 });
    const before = JSON.stringify(w);
    const ev = apply(w, { type: 'pickPerk', index: 0 }, { type: 'reroll', via: 'ad' }, { type: 'boost' }, { type: 'pickBoot', index: 3 }, { type: 'pickBoot', index: -1 }, { type: 'pickBoot', index: 0.5 });
    expect(ofType(ev, 'commandRejected').map((e) => e.reason)).toEqual(['phase', 'phase', 'phase', 'index', 'index', 'index']);
    expect(JSON.stringify(w)).toBe(before);
    apply(w, { type: 'pickBoot', index: 1 });
    expect(ofType(apply(w, { type: 'pickBoot', index: 0 }), 'commandRejected')[0]!.reason).toBe('phase');
    expect(w.crystal).toHaveLength(3);
  });

  it('the world does not tick while the boot pick is open', () => {
    const w = createWorld(D, { seed: 5, tier: 1 });
    for (let i = 0; i < 50; i++) step(w, D, [], []);
    expect(w.tick).toBe(0);
    expect(bootOpen(w)).toBe(true);
  });

  it('a logged run with a boot pick replays to the same world', () => {
    const opts = { seed: 21, tier: 1 };
    const w = createWorld(D, opts);
    const log: LoggedCommand[] = [];
    for (let t = 0; t < 3000 && !w.dead; t++) {
      const cmds: Command[] = [];
      if (bootOpen(w)) cmds.push({ type: 'pickBoot', index: 2 });
      else if (w.phase === 'pick') cmds.push({ type: 'pickPerk', index: 0 });
      for (const cmd of cmds) log.push({ tick: w.tick, cmd });
      step(w, D, cmds, []);
    }
    expect(w.boot).not.toBe('');
    const r = replay(D, opts, log, w.tick);
    expect(hashWorld(r.world)).toBe(hashWorld(w));
  });

  it('a snapshot taken during the boot pick restores it and continues identically', () => {
    const a = createWorld(D, { seed: 8, tier: 1 });
    const b = restore(snapshot(a));
    expect(b.bootOffer).toEqual(a.bootOffer);
    for (const w of [a, b]) {
      apply(w, { type: 'pickBoot', index: 1 });
      for (let t = 0; t < 900; t++) step(w, D, w.phase === 'pick' ? [{ type: 'pickPerk', index: 0 }] : [], []);
    }
    expect(hashWorld(b)).toBe(hashWorld(a));
  });

  it('a taken boot sector stands in for the scheduled picks at boot.skipPicks; no boot keeps the full schedule', () => {
    const noBoot = createWorld(D, { seed: 3, tier: 1, boot: false });
    const booted = createWorld(D, { seed: 3, tier: 1 });
    apply(booted, { type: 'pickBoot', index: 0 });
    expect(booted.boot).not.toBe('');
    for (let wave = 1; wave <= 12; wave++) {
      expect(pickDue(noBoot, D, wave)).toBe(isPickWave(D, wave));
      expect(pickDue(booted, D, wave)).toBe(isPickWave(D, wave) && !D.boot.skipPicks.includes(wave));
    }
    expect(D.perks.schedule.waves.some((v) => v > Math.max(...D.boot.skipPicks))).toBe(true);
  });

  it('a v7 snapshot (before boot sectors) migrates: no boot pick open, none taken', () => {
    const w = createWorld(D, { seed: 1, tier: 1, protocols: false }) as Omit<Partial<World>, 'v'> & { v: number };
    delete w.bootOffer;
    delete w.boot;
    w.v = 7;
    const r = restore(JSON.stringify({ v: 7, world: w }));
    expect(r.v).toBe(8);
    expect(r.bootOffer).toEqual([]);
    expect(r.boot).toBe('');
    // A v8 snapshot with a pick phase but neither offer is malformed.
    const bad = createWorld(D, { seed: 1, tier: 1 });
    bad.bootOffer = [];
    expect(() => restore(snapshot(bad))).toThrow(/snapshot: malformed/);
  });

  it('boot data: every sector is valid; broken sectors are rejected', () => {
    for (const s of D.boot.sectors) expect(bootSector(D, s.id)).toBe(s);
    const bad = (f: (d: typeof D) => void) => {
      const d = structuredClone(D);
      f(d);
      return () => validateData(d);
    };
    expect(bad((d) => (d.boot.sectors[0]!.modules[0]!.perk = 'frostShot'))).toThrow(/boot/);
    expect(bad((d) => (d.boot.sectors[0]!.modules[1]!.slot = [9, 9]))).toThrow(/boot/);
    expect(bad((d) => (d.boot.sectors[1]!.id = d.boot.sectors[0]!.id))).toThrow(/boot/);
    expect(bad((d) => (d.boot.sectors[0]!.partner = d.boot.sectors[0]!.tag))).toThrow(/boot/);
    expect(bad((d) => (d.boot.offerSize = 9))).toThrow(/boot/);
  });
});

describe('early mutations (uniqueness plan item 3)', () => {
  it('the first mutation is at wave 5, then every 8 waves; level 1 is the softer step', () => {
    expect(D.mutations.startWave).toBe(5);
    expect(nextMutationWave(D, 1)).toBe(5);
    expect(nextMutationWave(D, 5)).toBe(13);
    expect(nextMutationWave(D, 12)).toBe(13);
    expect(nextMutationWave(D, 13)).toBe(21);
    expect(geneWeight(D, 0)).toBe(0);
    expect(geneWeight(D, 1)).toBe(D.mutations.firstLevelScale);
    expect(geneWeight(D, 2)).toBe(1 + D.mutations.firstLevelScale);
    const w = createWorld(D, { seed: 1, tier: 1, protocols: false });
    w.genome.overload = 1;
    expect(geneKeep(w, D, 'overload')).toBeCloseTo(1 - D.mutations.perLevel.overload * D.mutations.firstLevelScale, 12);
  });
});
