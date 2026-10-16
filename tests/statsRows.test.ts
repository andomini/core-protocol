import { describe, expect, it } from 'vitest';
import { emptyLifetime, emptyRunStats, recordEvent } from '../src/meta/runStats';
import { RunSession } from '../src/render/RunSession';
import type { SimEvent } from '../src/sim/events';
import { clock, lifetimeTabs, runTabs } from '../src/ui/statsRows';
import { testData } from './helpers';

describe('stats rows', () => {
  it('clock formats m:ss and h mm', () => {
    expect([clock(0), clock(75), clock(3725)]).toEqual(['0:00', '1:15', '1h 02m']);
  });

  it('run tabs: battle / economy / core with real numbers and no NaN', () => {
    const data = testData({}, { health: 1e6 });
    const sess = new RunSession(data, { seed: 3, tier: 1, protocols: false });
    const s = emptyRunStats();
    sess.advance(30 * 90, (e) => recordEvent(s, e));
    const tabs = runTabs({ world: sess.world, stats: s, core: sess.stats, data, startEnergy: 0 });
    expect(tabs.map((t) => t.id)).toEqual(['battle', 'economy', 'core']);
    const all = tabs.flatMap((t) => t.sections.flatMap((x) => x.rows));
    for (const [label, value] of all) expect(`${label} ${value}`).not.toMatch(/NaN|undefined|Infinity/);
    expect(tabs[2]!.sections.flatMap((x) => x.rows)).toHaveLength(24);
    const kills = tabs[0]!.sections.find((x) => x.title === 'KILLS')!.rows[0]!;
    expect(kills[1]).toBe(String(sess.world.kills));
  });

  it('structure events are counted and the STRUCTURES section appears only once something happened', () => {
    const data = testData({}, { health: 1e6 });
    const sess = new RunSession(data, { seed: 3, tier: 1, protocols: false });
    const s = emptyRunStats();
    const view = () => runTabs({ world: sess.world, stats: s, core: sess.stats, data, startEnergy: 0 });
    expect(view()[0]!.sections.map((x) => x.title)).not.toContain('STRUCTURES');
    const events: SimEvent[] = [
      { type: 'structHit', sid: 1, kind: 'wall', x: 0, y: 0, enemyId: 1, damage: 7, ranged: false },
      { type: 'structDown', sid: 1, kind: 'wall', x: 0, y: 0 },
      { type: 'structDown', sid: 2, kind: 'station', x: 0, y: 0 },
      { type: 'turretShot', sid: 3, targetIds: [1], x: 0, y: 0 },
      { type: 'mineBlast', x: 0, y: 0, r: 40 },
      { type: 'stationPay', sid: 2, x: 0, y: 0, energy: 25, bits: 3 },
    ];
    for (const e of events) recordEvent(s, e);
    expect([s.structDamage, s.wallsBroken, s.stationsLost, s.turretShots, s.minesBlown, s.stationEnergy, s.stationBits]).toEqual([7, 1, 1, 1, 1, 25, 3]);
    const tabs = view();
    expect(tabs[0]!.sections.map((x) => x.title)).toContain('STRUCTURES');
    expect(tabs[1]!.sections.flatMap((x) => x.rows).map((r) => r[0])).toContain('Station Energy');
  });

  it('lifetime tab lists best waves per tier', () => {
    const t = lifetimeTabs({ life: emptyLifetime(), best: { '2': 12, '1': 40 }, tierUnlocked: 2, tickHz: 30, packs: 1, cardsOwned: 3, cardsTotal: 20, labsOwned: 2, labsTotal: 25, workshopLevels: 9 });
    const rows = t[0]!.sections.flatMap((x) => x.rows).map((r) => r[0]);
    expect(rows.indexOf('Best wave · tier 1')).toBeLessThan(rows.indexOf('Best wave · tier 2'));
  });
});
