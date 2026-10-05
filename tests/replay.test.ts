import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RunSession } from '../src/render/RunSession';
import type { LoggedCommand } from '../src/sim/commands';
import { DEFAULT_DATA, STAT_IDS } from '../src/sim/data';
import { hashWorld } from '../src/sim/hash';
import { replay } from '../src/sim/replay';
import type { RunOptions } from '../src/sim/state';
import { testData } from './helpers';

interface Golden {
  opts: RunOptions;
  ticks: number;
  hashEvery: number;
  final: { wave: number; dead: boolean; energy: number; levels: Record<string, number>; perks: Record<string, number>; setTiers: Record<string, number> };
  log: LoggedCommand[];
  hashes: string[];
}

const golden = JSON.parse(readFileSync('tests/replays/golden-01.json', 'utf8')) as Golden;

describe('golden replay (tests/replays/golden-01.json)', () => {
  it('covers ~3 minutes with purchases of every kind', () => {
    expect(golden.ticks).toBe(3 * 60 * DEFAULT_DATA.config.tickHz);
    expect(golden.hashes).toHaveLength(Math.floor(golden.ticks / golden.hashEvery));
    const buys = golden.log.flatMap((l) => (l.cmd.type === 'buy' ? [l.cmd] : []));
    const counts = new Set(buys.map((c) => String(c.count)));
    expect(counts).toContain('1');
    expect(counts).toContain('10');
    expect(counts).toContain('max');
    expect(buys.length).toBeGreaterThanOrEqual(12);
    expect(new Set(buys.map((c) => c.stat)).size).toBeGreaterThanOrEqual(10);
    const types = new Set(golden.log.map((l) => (l.cmd.type === 'reroll' ? `reroll:${l.cmd.via}` : l.cmd.type)));
    for (const t of ['pickPerk', 'reroll:ad', 'reroll:free', 'boost']) expect(types, t).toContain(t);
  });

  it('replays to the recorded hash every 100 ticks and the recorded final state', () => {
    const r = replay(DEFAULT_DATA, golden.opts, golden.log, golden.ticks, golden.hashEvery);
    expect(r.hashes).toEqual(golden.hashes);
    expect(r.world.wave).toBe(golden.final.wave);
    expect(r.world.dead).toBe(golden.final.dead);
    expect(r.world.energy).toBe(golden.final.energy);
    expect(r.world.levels).toEqual(golden.final.levels);
    expect(r.world.perks).toEqual(golden.final.perks);
    expect(r.world.setTiers).toEqual(golden.final.setTiers);
  });

  it('rejects a log that is out of tick order', () => {
    const bad: LoggedCommand[] = [
      { tick: 5, cmd: { type: 'buy', stat: 'damage', count: 1 } },
      { tick: 2, cmd: { type: 'buy', stat: 'damage', count: 1 } },
    ];
    expect(() => replay(DEFAULT_DATA, { seed: 1, tier: 1, protocols: false }, bad, 20)).toThrow(/out of order/);
  });
});

describe('a live session log replays exactly', () => {
  it('queued, paused (apply-now) and post-death commands all reproduce the session', () => {
    const opts: RunOptions = { seed: 31, tier: 1, unlocked: [...STAT_IDS] };
    // Hard-hitting viruses, so the run dies (post-death commands) after a few protocol picks.
    const data = testData({ enemies: { basic: { damage: 12 }, fast: { damage: 8 }, tank: { damage: 32 }, ranged: { damage: 16 }, boss: { damage: 40 } } });
    const s = new RunSession(data, opts);
    let i = 0;
    while (!s.world.dead && s.world.tick < 20000) {
      s.advance(7, () => {});
      if (s.picking) {
        // Every other pick is resolved apply-now (as the overlay does), the rest by the next step.
        if (i % 2 === 0) s.queue({ type: 'reroll', via: 'ad' });
        s.queue({ type: 'pickPerk', index: i % 3 });
        if (i % 2 === 0) s.applyPendingNow(() => {});
      }
      const stat = STAT_IDS[i++ % STAT_IDS.length]!;
      s.queue({ type: 'buy', stat, count: i % 3 === 0 ? 'max' : 1 });
      if (i % 5 === 0) s.applyPendingNow(() => {}); // as if paused
    }
    s.queue({ type: 'buy', stat: 'damage', count: 1 });
    s.applyPendingNow(() => {}); // after death: rejected, still logged
    const r = replay(data, opts, s.log, s.world.tick + 5);
    expect(s.world.dead).toBe(true);
    expect(hashWorld(r.world)).toBe(hashWorld(s.world));
    expect(s.log.length).toBeGreaterThan(50);
    expect(s.world.picks).toBeGreaterThanOrEqual(3);
  });
});
