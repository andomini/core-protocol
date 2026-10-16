import { describe, expect, it } from 'vitest';
import { applyCommands, awaitsStructure, buildNeedText, isUnlocked } from '../src/sim/commands';
import { DEFAULT_DATA, STAT_IDS, TAB_IDS, validateData, type StatId } from '../src/sim/data';
import { SECTOR_DIRS } from '../src/sim/hex';
import { fusionStructure, structureFusionNames } from '../src/sim/perks';
import { restore, snapshot } from '../src/sim/snapshot';
import { createWorld, worldStats, type Struct, type World } from '../src/sim/state';
import { wallMaxHp } from '../src/sim/structures';
import { spawnEnemy } from '../src/sim/waves';
import { formatStat } from '../src/ui/format';
import type { Command } from '../src/sim/commands';
import type { SimEvent } from '../src/sim/events';
import { DEFAULT_META_DATA } from '../src/meta/metaData';
import { buildRunOptions } from '../src/meta/runOptions';
import { defaultMeta, validateMeta } from '../src/meta/state';
import { buyWorkshop } from '../src/meta/workshop';
import { ofType, stepN, testData } from './helpers';

const apply = (w: World, data: ReturnType<typeof testData>, cmds: Command[]): SimEvent[] => {
  const ev: SimEvent[] = [];
  applyCommands(w, data, cmds, ev);
  return ev;
};

const BUILD: StatId[] = ['structHealth', 'structRegen', 'turretDamage', 'turretSpeed', 'mineDamage', 'stationIncome'];
const WALL = 'cryo+firewall';
const BASTION = 'overload+firewall';
const MINES = 'chain+firewall';
const MINING = 'mining+firewall';
const TANK = 1e9;

/** A quiet world (no random spawns) with `key` linked to `tier` (none: no firewall fusion) and `workshop` levels. */
function setup(key: string | null, workshop: Partial<Record<StatId, number>> = {}) {
  const data = testData({ config: { baseEnemiesPerWave: 0, enemiesPerWaveGrowth: 0 } }, { damage: 100, regen: 0, thorns: 0, health: 1000 });
  const w = createWorld(data, { seed: 1, tier: 1, protocols: false, workshop });
  if (key !== null) w.fusionTiers[key] = 1;
  stepN(w, data, 1);
  return { data, w };
}
const of = (w: World, kind: Struct['kind']) => w.structs.filter((s) => s.kind === kind);
const onAxis = (slot: number, d: number): [number, number] => [SECTOR_DIRS[slot]![0] * d, SECTOR_DIRS[slot]![1] * d];

describe('BUILD tab: data', () => {
  it('six BUILD stats appended after the old eighteen, all in the build tab and all naming a structure', () => {
    expect(TAB_IDS).toContain('build');
    expect(STAT_IDS.slice(18)).toEqual(BUILD);
    for (const id of BUILD) {
      const def = DEFAULT_DATA.stats.stats[id];
      expect(def.tab).toBe('build');
      expect(def.needs?.length).toBeGreaterThan(0);
      expect(def.lockedByDefault).toBeFalsy();
      expect(DEFAULT_DATA.stats.tabs.build).toBeDefined();
    }
    expect(Object.values(DEFAULT_DATA.stats.stats).filter((d) => d.tab === 'build')).toHaveLength(6);
  });

  it('validation rejects a BUILD stat without needs, an empty list and an unknown structure', () => {
    const bad = (patch: Record<string, unknown>) => {
      const d = structuredClone(DEFAULT_DATA);
      Object.assign(d.stats.stats.turretDamage, patch);
      return () => validateData(d);
    };
    expect(bad({})).not.toThrow();
    expect(bad({ needs: undefined })).toThrow(/needs/);
    expect(bad({ needs: [] })).toThrow(/needs/);
    expect(bad({ needs: ['moat'] })).toThrow(/unknown structure/);
  });
});

describe('BUILD tab: the lock rule', () => {
  it('without the fusion every BUILD row is locked and a buy is rejected; nothing is spent', () => {
    const { data, w } = setup(null);
    w.energy = 1e9;
    for (const id of BUILD) {
      expect(awaitsStructure(w, data, id)).toBe(true);
      expect(isUnlocked(w, data, id)).toBe(false);
      const ev = apply(w, data, [{ type: 'buy', stat: id, count: 1 }]);
      expect(ofType(ev, 'buyRejected')).toEqual([{ type: 'buyRejected', stat: id, reason: 'locked' }]);
      expect(w.levels[id]).toBe(0);
    }
    expect(w.energy).toBe(1e9);
  });

  it('each row opens with its own structure; walls and stations share the HP rows', () => {
    const open = (key: string) => {
      const { data, w } = setup(key);
      return BUILD.filter((id) => isUnlocked(w, data, id));
    };
    expect(open(WALL)).toEqual(['structHealth', 'structRegen']);
    expect(open(BASTION)).toEqual(['turretDamage', 'turretSpeed']);
    expect(open(MINES)).toEqual(['mineDamage']);
    expect(open(MINING)).toEqual(['structHealth', 'structRegen', 'stationIncome']);
  });

  it('a buy is accepted once the link exists; unlinking locks the row again but keeps the level', () => {
    const { data, w } = setup(BASTION);
    w.energy = 1e9;
    const ok = apply(w, data, [{ type: 'buy', stat: 'turretDamage', count: 3 }]);
    expect(ofType(ok, 'buyRejected')).toHaveLength(0);
    expect(w.levels.turretDamage).toBe(3);
    w.fusionTiers[BASTION] = 0;
    const ev = apply(w, data, [{ type: 'buy', stat: 'turretDamage', count: 1 }]);
    expect(ofType(ev, 'buyRejected')[0]).toMatchObject({ reason: 'locked' });
    expect(w.levels.turretDamage).toBe(3);
  });

  it('the row text names the missing fusion; it is null once the structure exists or for other tabs', () => {
    const { data, w } = setup(null);
    expect(buildNeedText(w, data, 'turretDamage')).toMatch(/^needs \S/);
    expect(buildNeedText(w, data, 'structHealth')).toBe('needs Wall/Relay');
    expect(buildNeedText(w, data, 'turretSpeed')).toBe('needs Bastion');
    expect(structureFusionNames(data, 'station')).toEqual(['Relay']);
    expect(buildNeedText(w, data, 'damage')).toBeNull();
    w.fusionTiers[BASTION] = 1;
    expect(buildNeedText(w, data, 'turretDamage')).toBeNull();
  });
});

describe('BUILD tab: effects', () => {
  it('Structure HP multiplies the HP of walls and stations', () => {
    const base = setup(WALL);
    const hp = (x: ReturnType<typeof setup>) => wallMaxHp(worldStats(x.w, x.data), fusionStructure(x.w, x.data, 'wall')!);
    const up = setup(WALL, { structHealth: 10 });
    expect(worldStats(up.w, up.data).structHealth).toBeCloseTo(2, 9);
    expect(hp(up) / hp(base)).toBeCloseTo(2, 9);
  });

  it('Structure Regen heals a damaged segment per second and not at level 0', () => {
    const heal = (lv: number) => {
      const { data, w } = setup(WALL, { structRegen: lv });
      const s = of(w, 'wall')[0]!;
      s.share = 0.5;
      stepN(w, data, data.config.tickHz);
      return s.share;
    };
    expect(heal(0)).toBe(0.5);
    const { w, data } = setup(WALL, { structRegen: 10 });
    expect(heal(10)).toBeCloseTo(0.5 + worldStats(w, data).structRegen, 6);
  });

  it('Structure Regen leaves a downed segment alone', () => {
    const { data, w } = setup(WALL, { structRegen: 30 });
    const s = of(w, 'wall')[0]!;
    s.share = 0;
    s.downUntilTick = w.tick + 10_000;
    stepN(w, data, 30);
    expect(s.share).toBe(0);
  });

  it('Turret Damage raises the hit, Turret Speed the number of shots', () => {
    const run = (workshop: Partial<Record<StatId, number>>) => {
      const { data, w } = setup(BASTION, workshop);
      spawnEnemy(w, data, 'basic', ...onAxis(0, w.wallR + 80), [], TANK).speed = 0;
      const ev = stepN(w, data, 150);
      return { hit: ofType(ev, 'hit').find((h) => h.source === 'turret')!.damage, shots: ofType(ev, 'turretShot').length };
    };
    const base = run({});
    expect(run({ turretDamage: 10 }).hit / base.hit).toBeCloseTo(2, 6);
    expect(run({ turretSpeed: 20 }).shots).toBeGreaterThan(base.shots);
  });

  it('Mine Damage raises the blast', () => {
    const blast = (workshop: Partial<Record<StatId, number>>) => {
      const { data, w } = setup(MINES, workshop);
      const m = of(w, 'mine')[0]!;
      spawnEnemy(w, data, 'basic', m.x, m.y, [], TANK).speed = 0;
      return ofType(stepN(w, data, 2), 'hit').find((h) => h.source === 'mine')!.damage;
    };
    expect(blast({ mineDamage: 10 }) / blast({})).toBeCloseTo(2, 6);
  });

  it('Station Income multiplies the wave-end pay', () => {
    const pay = (workshop: Partial<Record<StatId, number>>) => {
      const { data, w } = setup(MINING, workshop);
      return ofType(stepN(w, data, 800), 'stationPay')[0]!.energy;
    };
    expect(pay({ stationIncome: 10 }) / pay({})).toBeCloseTo(1.5, 6);
  });
});

describe('BUILD tab: workshop and saves', () => {
  it('workshop levels flow into a run even before any fusion exists, and run levels start at 0', () => {
    const { data, w } = setup(null, { turretDamage: 5, structRegen: 4 });
    expect(w.workshop.turretDamage).toBe(5);
    expect(w.levels.turretDamage).toBe(0);
    expect(worldStats(w, data).turretDamage).toBeCloseTo(1.5, 9);
    expect(worldStats(w, data).structRegen).toBeCloseTo(0.006, 9);
  });

  it('a save from before the BUILD tab restores with those levels at 0 and plays on', () => {
    const { data, w } = setup(WALL);
    const o = JSON.parse(snapshot(w));
    for (const id of BUILD) {
      delete o.world.levels[id];
      delete o.world.workshop[id];
    }
    const back = restore(JSON.stringify(o));
    for (const id of BUILD) {
      expect(back.levels[id]).toBe(0);
      expect(back.workshop[id]).toBe(0);
    }
    expect(Object.keys(back.levels)).toEqual([...STAT_IDS]);
    expect(() => stepN(back, data, 5)).not.toThrow();
    expect(worldStats(back, data).structHealth).toBe(1);
  });

  it('Home: the workshop sells a BUILD stat with no fusion, the level survives a save round trip and reaches the run', () => {
    const md = DEFAULT_META_DATA;
    const m = defaultMeta();
    m.bits = 1e6;
    for (const id of BUILD) expect(buyWorkshop(m, DEFAULT_DATA, md, id)).toBe(true);
    for (let i = 0; i < 4; i++) expect(buyWorkshop(m, DEFAULT_DATA, md, 'turretDamage')).toBe(true);
    const back = validateMeta(JSON.parse(JSON.stringify(m)), DEFAULT_DATA, md);
    for (const id of BUILD) expect(back.workshop[id]).toBe(id === 'turretDamage' ? 5 : 1);
    const o = buildRunOptions(back, DEFAULT_DATA, md, 1, 7);
    expect(o.workshop?.turretDamage).toBe(5);
    const w = createWorld(DEFAULT_DATA, o);
    expect(w.workshop.turretDamage).toBe(5);
    expect(worldStats(w, DEFAULT_DATA).turretDamage).toBeGreaterThan(1.49);
    expect(isUnlocked(w, DEFAULT_DATA, 'turretDamage')).toBe(false);
  });

  it('formats the new values', () => {
    expect(formatStat('mult', 1.5)).toBe('×1.5');
    expect(formatStat('pct', 0.05)).toBe('5%');
  });
});
