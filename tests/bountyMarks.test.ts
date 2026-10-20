import { describe, expect, it } from 'vitest';
import { DEFAULT_META_DATA } from '../src/meta/metaData';
import { settleRun } from '../src/meta/runEnd';
import { defaultMeta, validateMeta } from '../src/meta/state';
import { DEFAULT_DATA } from '../src/sim/data';
import { scaleForWave } from '../src/sim/economy';
import type { SimEvent } from '../src/sim/events';
import { hashWorld } from '../src/sim/hash';
import { perkProfile } from '../src/sim/perks';
import { hitEnemy } from '../src/sim/projectiles';
import { restore, snapshot } from '../src/sim/snapshot';
import { createWorld, type World } from '../src/sim/state';
import { combatStats, step } from '../src/sim/step';
import { markPlan, spawnEnemy } from '../src/sim/waves';
import { ofType } from './helpers';

const D = DEFAULT_DATA;
const M = DEFAULT_META_DATA;
const KEY = 'overload+mining';
const quiet = (seed = 7) => createWorld(D, { seed, tier: 1, protocols: false });

/** Kill `e` with one blow and return [energy, bits] it paid. */
function kill(w: World, kind: 'basic' | 'boss', marked: boolean, crit = false, events: SimEvent[] = []): [number, number] {
  w.wave = Math.max(1, w.wave);
  const e = spawnEnemy(w, D, kind, 50, 0, []);
  if (marked) e.marked = true;
  const prof = perkProfile(w, D);
  const st = combatStats(w, D, prof);
  const e0 = w.energy;
  const b0 = w.bits;
  hitEnemy(w, D, st, prof, e, e.hp * 2, crit, 'shot', events);
  return [w.energy - e0, w.bits - b0];
}

describe('Bounty Marks (spec 2026-10-16 phase 2)', () => {
  it('the Mark plan is drawn from its own stream: same seed + wave → same Marks, distinct, in range', () => {
    const a = markPlan(11, 5, 20, 3);
    expect(markPlan(11, 5, 20, 3)).toEqual(a);
    expect(new Set(a).size).toBe(3);
    for (const x of a) expect(x >= 1 && x <= 20).toBe(true);
    expect(markPlan(11, 6, 20, 3)).not.toEqual(a);
    expect(markPlan(11, 5, 2, 3)).toHaveLength(2);
  });

  it('runs are deterministic with Marks and the Marks do not touch the other streams', () => {
    const run = (fusion: boolean): { w: World; marked: number } => {
      const w = quiet(21);
      if (fusion) w.fusionTiers[KEY] = 1;
      w.core.hp = 1e12;
      let marked = 0;
      const seen = new Set<number>();
      for (let i = 0; i < 1200; i++) {
        step(w, D, [], []);
        for (const e of w.enemies) if (e.marked === true && !seen.has(e.id)) {
          seen.add(e.id);
          marked++;
        }
      }
      return { w, marked };
    };
    const a = run(true);
    const b = run(true);
    expect(hashWorld(a.w)).toBe(hashWorld(b.w));
    expect(a.marked).toBeGreaterThan(0);
    const off = run(false);
    expect(off.marked).toBe(0);
    // Same spawn stream: the same viruses came in the same order.
    expect(off.w.nextId).toBe(a.w.nextId);
  });

  it('I: a Marked kill pays ×4 Energy and ×4 Bits; unmarked kills are unchanged', () => {
    const w = quiet();
    w.fusionTiers[KEY] = 1;
    const [e1, b1] = kill(w, 'basic', false);
    const [e2, b2] = kill(w, 'basic', true);
    expect(e2).toBeCloseTo(e1 * 4, 6);
    expect(b2).toBeCloseTo(b1 * 4, 6);
    expect(w.marks.killed).toBe(1);
  });

  it('II: a crit kill on a Mark pays ×2 more; III: the boss Mark pays ×2 Bits', () => {
    const w = quiet();
    w.fusionTiers[KEY] = 3;
    const [e1] = kill(w, 'basic', true, false);
    const [e2] = kill(w, 'basic', true, true);
    // The crit kill also gets the Headhunter ×1.5 crit Energy.
    expect(e2).toBeCloseTo(e1 * 2 * 1.5, 6);
    const v = quiet();
    v.fusionTiers[KEY] = 5;
    const [, bb1] = kill(v, 'boss', false);
    const [, bb2] = kill(v, 'boss', true);
    expect(bb2).toBeCloseTo(bb1 * 2, 6);
  });

  it('III: a jackpot every 12 Marks, capped at 2 per run', () => {
    const w = quiet();
    w.fusionTiers[KEY] = 5;
    w.wave = 10;
    const ev: SimEvent[] = [];
    for (let i = 0; i < 12 * 4; i++) kill(w, 'basic', true, false, ev);
    const jp = ofType(ev, 'bountyJackpot');
    expect(jp).toHaveLength(2);
    expect(w.marks.jackpots).toBe(2);
    expect(jp[0]!.bits).toBeCloseTo(scaleForWave(100, D.tiers[0]!.bitsMul, D.config.bitsGrowth, 10), 6);
    expect(ofType(ev, 'markKill')).toHaveLength(48);
  });

  it('old snapshots get an empty Mark plan and fusionBest from fusionTiers', () => {
    const w = quiet();
    w.fusionTiers[KEY] = 3;
    const old = JSON.parse(snapshot(w)) as { world: Record<string, unknown> };
    delete old.world.fusionBest;
    delete (old.world.marks as Record<string, unknown>).plan;
    const back = restore(JSON.stringify(old));
    expect(back.marks.plan).toEqual([]);
    expect(back.fusionBest).toEqual({ [KEY]: 3 });
  });
});

describe('Fusion Codex', () => {
  it('records the best tier per pair and pays codex Bits once, the first time a pair reaches III', () => {
    const m = defaultMeta();
    const r1 = settleRun(m, D, M, { tier: 1, wave: 5, bits: 0, keys: 0, doubled: false, fusionsReached: { [KEY]: 3 } });
    expect(r1.codexBits).toBe(0);
    expect(r1.codexNew).toEqual([KEY]);
    expect(m.codex[KEY]).toBe(2);
    const r2 = settleRun(m, D, M, { tier: 1, wave: 5, bits: 0, keys: 0, doubled: true, fusionsReached: { [KEY]: 5, 'cryo+mining': 1 } });
    expect(r2.codexBits).toBe(M.codex.bits);
    expect(r2.bits).toBe(M.codex.bits);
    expect(m.codex[KEY]).toBe(3);
    const r3 = settleRun(m, D, M, { tier: 1, wave: 5, bits: 0, keys: 0, doubled: false, fusionsReached: { [KEY]: 5 } });
    expect(r3.codexBits).toBe(0);
    expect(r3.codexNew).toEqual([]);
    expect(m.codex[KEY]).toBe(3);
    expect(m.keys).toBe(0);
  });

  it('an old save without codex validates to an empty Codex; junk is dropped', () => {
    expect(validateMeta({ bits: 5 }, D, M).codex).toEqual({});
    const m = validateMeta({ codex: { [KEY]: 3, 'bogus+pair': 2, 'cryo+mining': 'x', 'overload+cryo': 9 } }, D, M);
    expect(m.codex).toEqual({ [KEY]: 3, 'overload+cryo': 4 });
  });
});
