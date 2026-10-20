// Pulse (uniqueness plan 2026-10-20, item 4): cooldown, per-tag effects, autoPulse, replay, snapshot migration.
import { describe, expect, it } from 'vitest';
import { applyCommands, type Command, type LoggedCommand } from '../src/sim/commands';
import type { GameData } from '../src/sim/data';
import type { SimEvent } from '../src/sim/events';
import { hashWorld } from '../src/sim/hash';
import type { Tag } from '../src/sim/perkData';
import { pulseCharge, pulseCooldownTicks, pulseRadius, pulseReady, pulseTag } from '../src/sim/pulse';
import { replay } from '../src/sim/replay';
import { restore, snapshot } from '../src/sim/snapshot';
import { createWorld, type Enemy, type RunOptions, type World, worldStats } from '../src/sim/state';
import { step } from '../src/sim/step';
import { spawnEnemy } from '../src/sim/waves';
import { ofType, stepN, testData } from './helpers';

const quiet = () => testData({ config: { baseEnemiesPerWave: 0, enemiesPerWaveGrowth: 0 } });

function world(d: GameData, opts: Partial<RunOptions> = {}): World {
  return createWorld(d, { seed: 5, tier: 1, protocols: false, ...opts });
}

/** A tough virus at distance `dist` on the +x axis (it survives the pulse unless `hp` says otherwise). */
function virus(w: World, d: GameData, dist: number, hp = 1e9): Enemy {
  const e = spawnEnemy(w, d, 'basic', dist, 0, []);
  e.hp = hp;
  e.maxHp = hp;
  return e;
}

function pulse(w: World, d: GameData): SimEvent[] {
  const ev: SimEvent[] = [];
  applyCommands(w, d, [{ type: 'pulse' }], ev);
  return ev;
}

function dominant(w: World, tag: Tag, count = 2): void {
  w.tagCountsNow[tag] = count;
}

describe('pulse: cooldown', () => {
  it('fires when ready, is refused on cooldown, and is ready again after the cooldown', () => {
    const d = quiet();
    const w = world(d);
    expect(pulseReady(w)).toBe(true);
    const ev = pulse(w, d);
    expect(ofType(ev, 'pulse')).toHaveLength(1);
    expect(w.pulseCount).toBe(1);
    const cd = pulseCooldownTicks(w, d, null);
    expect(cd).toBe(d.pulse.cooldownSec * d.config.tickHz);
    expect(w.pulseReadyTick).toBe(w.tick + cd);
    const again = pulse(w, d);
    expect(ofType(again, 'pulse')).toHaveLength(0);
    expect(ofType(again, 'commandRejected')).toEqual([{ type: 'commandRejected', cmd: 'pulse', reason: 'cooldown' }]);
    expect(w.pulseCount).toBe(1);
    stepN(w, d, cd - 1);
    expect(pulseReady(w)).toBe(false);
    expect(pulseCharge(w, d)).toBeGreaterThan(0.9);
    stepN(w, d, 1);
    expect(pulseReady(w)).toBe(true);
    expect(pulseCharge(w, d)).toBe(1);
    expect(ofType(pulse(w, d), 'pulse')).toHaveLength(1);
  });

  it('is refused while a protocol pick is open and after death', () => {
    const d = quiet();
    const picking = createWorld(d, { seed: 5, tier: 1 });
    expect(picking.phase).toBe('pick');
    expect(ofType(pulse(picking, d), 'commandRejected')[0]!.reason).toBe('phase');
    const dead = world(d);
    dead.dead = true;
    expect(ofType(pulse(dead, d), 'commandRejected')[0]!.reason).toBe('dead');
  });

  it('a set tier shortens the cooldown and strengthens the effect', () => {
    const d = quiet();
    const w = world(d);
    dominant(w, 'overload', 4);
    w.setTiers.overload = 4;
    expect(pulseCooldownTicks(w, d, 'overload')).toBe(Math.round(d.pulse.cooldownSec * d.config.tickHz * (1 - 2 * d.pulse.tierCooldown)));
    const e = virus(w, d, 50);
    pulse(w, d);
    expect(e.maxHp - e.hp).toBeCloseTo(worldStats(w, d).damage * d.pulse.overload.damageMul * (1 + 2 * d.pulse.tierPower), 6);
  });
});

describe('pulse: effect by dominant tag', () => {
  it('the dominant tag is the highest set count (ties in TAGS order), none below minCount', () => {
    const d = quiet();
    const w = world(d);
    expect(pulseTag(w, d)).toBeNull();
    w.tagCountsNow.cryo = 2;
    w.tagCountsNow.mining = 2;
    expect(pulseTag(w, d)).toBe('cryo');
    w.tagCountsNow.mining = 3;
    expect(pulseTag(w, d)).toBe('mining');
  });

  it('no tag: a weak ring that damages and knocks back only what is inside the radius', () => {
    const d = quiet();
    const w = world(d);
    const r = pulseRadius(d, worldStats(w, d));
    const near = virus(w, d, r * 0.5);
    const far = virus(w, d, r * 1.2);
    const ev = pulse(w, d);
    expect(ofType(ev, 'pulse')[0]).toMatchObject({ tag: null, radius: r, targets: 1 });
    expect(near.maxHp - near.hp).toBeCloseTo(worldStats(w, d).damage * d.pulse.none.damageMul, 6);
    expect(near.x).toBeGreaterThan(r * 0.5);
    expect(far.hp).toBe(far.maxHp);
    expect(far.x).toBe(r * 1.2);
  });

  it('overload: × damage on every virus in the ring; a kill pays its reward', () => {
    const d = quiet();
    const w = world(d);
    dominant(w, 'overload');
    const tough = virus(w, d, 40);
    const weak = virus(w, d, 60, 1);
    const ev = pulse(w, d);
    expect(tough.maxHp - tough.hp).toBeCloseTo(worldStats(w, d).damage * d.pulse.overload.damageMul, 6);
    expect(ofType(ev, 'kill').map((k) => k.enemyId)).toEqual([weak.id]);
    expect(ofType(ev, 'hit').every((h) => h.source === 'pulse')).toBe(true);
  });

  it('cryo: freezes the ring for freezeSec', () => {
    const d = quiet();
    const w = world(d);
    dominant(w, 'cryo');
    const e = virus(w, d, 40);
    const ev = pulse(w, d);
    expect(e.frozenUntil).toBe(w.tick + d.pulse.cryo.freezeSec * d.config.tickHz);
    expect(ofType(ev, 'freeze')).toEqual([{ type: 'freeze', enemyId: e.id }]);
    const x = e.x;
    stepN(w, d, 10);
    expect(e.x).toBe(x);
  });

  it('chain: an arc to every virus in the ring (up to maxTargets), chain damage each', () => {
    const d = quiet();
    const w = world(d);
    dominant(w, 'chain');
    const a = virus(w, d, 40);
    const b = virus(w, d, 80);
    const ev = pulse(w, d);
    expect(ofType(ev, 'lightning')).toEqual([{ type: 'lightning', fromId: 0, targets: [a.id, b.id] }]);
    for (const e of [a, b]) expect(e.maxHp - e.hp).toBeCloseTo(worldStats(w, d).damage * d.pulse.chain.damageMul, 6);
    expect(ofType(ev, 'hit').every((h) => h.source === 'lightning')).toBe(true);
  });

  it('mining: every virus in the ring pays its Energy and Bits once', () => {
    const d = quiet();
    const w = world(d);
    dominant(w, 'mining');
    const a = virus(w, d, 40);
    const b = virus(w, d, 80);
    const e0 = w.energy;
    const b0 = w.bits;
    const ev = pulse(w, d);
    const p = ofType(ev, 'pulse')[0]!;
    expect(p.energy).toBeCloseTo((a.energy + b.energy) * d.pulse.mining.energyMul, 9);
    expect(p.bits).toBeCloseTo((a.bits + b.bits) * d.pulse.mining.bitsMul, 9);
    expect(w.energy - e0).toBeCloseTo(p.energy, 9);
    expect(w.bits - b0).toBeCloseTo(p.bits, 9);
  });

  it('firewall: a shield of shieldFrac × max HP, capped at shieldCapFrac', () => {
    const d = quiet();
    const w = world(d);
    dominant(w, 'firewall');
    const hp = worldStats(w, d).health;
    const ev = pulse(w, d);
    expect(w.shield).toBeCloseTo(hp * d.pulse.firewall.shieldFrac, 9);
    expect(ofType(ev, 'pulse')[0]!.shield).toBeCloseTo(w.shield, 9);
    w.pulseReadyTick = w.tick;
    w.shield = hp * d.pulse.firewall.shieldCapFrac - 1;
    pulse(w, d);
    expect(w.shield).toBeCloseTo(hp * d.pulse.firewall.shieldCapFrac, 9);
  });
});

describe('pulse: autoPulse lab node', () => {
  it('fires by itself once ready with minTargets viruses in the ring, never without the node', () => {
    const d = quiet();
    const k = d.pulse.autoPulse.minTargets;
    const run = (auto: boolean, n: number) => {
      const w = world(d, { autoPulse: auto });
      for (let i = 0; i < n; i++) virus(w, d, 40 + i * 5);
      return { w, ev: stepN(w, d, 1) };
    };
    expect(run(true, k).w.pulseAuto).toBe(true);
    expect(ofType(run(true, k).ev, 'pulse')).toHaveLength(1);
    expect(ofType(run(true, k - 1).ev, 'pulse')).toHaveLength(0);
    expect(ofType(run(false, k).ev, 'pulse')).toHaveLength(0);
    // Then it waits for the cooldown.
    const { w } = run(true, k);
    const cd = pulseCooldownTicks(w, d, null);
    expect(ofType(stepN(w, d, cd - 1), 'pulse')).toHaveLength(0);
  });
});

describe('pulse: replay and snapshot', () => {
  it('a logged pulse replays to the same world', () => {
    const d = testData({}, { health: 1e9 });
    const opts: RunOptions = { seed: 11, tier: 1, protocols: false };
    const T = 4 * d.pulse.cooldownSec * d.config.tickHz;
    const w = createWorld(d, opts);
    const log: LoggedCommand[] = [];
    const ev: SimEvent[] = [];
    let pulses = 0;
    for (let t = 0; t < T; t++) {
      const cmds: Command[] = w.enemies.length > 0 && pulseReady(w) ? [{ type: 'pulse' }] : [];
      for (const cmd of cmds) log.push({ tick: w.tick, cmd });
      step(w, d, cmds, ev);
      pulses += ofType(ev, 'pulse').length;
      ev.length = 0;
    }
    expect(pulses).toBeGreaterThan(1);
    expect(hashWorld(replay(d, opts, log, T).world)).toBe(hashWorld(w));
  });

  it('round-trips through a snapshot, and a v7 snapshot migrates with the pulse defaults', () => {
    const d = quiet();
    const w = world(d, { autoPulse: true });
    pulse(w, d);
    expect(JSON.stringify(restore(snapshot(w)))).toBe(JSON.stringify(w));
    const { pulseReadyTick: _a, pulseCount: _b, pulseLastTag: _c, pulseAuto: _d, ...old } = w;
    const v7 = restore(JSON.stringify({ v: 7, world: { ...old, v: 7 } }));
    expect(v7.v).toBe(9);
    expect([v7.pulseReadyTick, v7.pulseCount, v7.pulseLastTag, v7.pulseAuto]).toEqual([0, 0, 'none', false]);
    expect(() => restore(JSON.stringify({ v: 8, world: { ...w, pulseAuto: 'yes' } }))).toThrow(/snapshot: malformed/);
  });
});
