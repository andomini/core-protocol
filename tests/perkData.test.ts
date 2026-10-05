import { describe, expect, it } from 'vitest';
import { DEFAULT_DATA, type GameData, validateData } from '../src/sim/data';
import { EFFECT_TYPES, TAGS } from '../src/sim/perkData';

const perks = DEFAULT_DATA.perks.perks;
const ids = Object.keys(perks);

function withPerk(mut: (d: GameData) => void): () => GameData {
  return () => {
    const d = structuredClone(DEFAULT_DATA);
    mut(d);
    return validateData(d);
  };
}

describe('protocol data (spec §2.4)', () => {
  it('has the 25 perks: 5 per tag, the last of each a trade-off', () => {
    expect(ids).toHaveLength(25);
    for (const tag of TAGS) {
      const of = ids.filter((id) => perks[id]!.tag === tag);
      expect(of, tag).toHaveLength(5);
      expect(of.filter((id) => perks[id]!.tradeoff).length, tag).toBe(1);
    }
  });

  it('the three stat-dependent perks require their locked stat', () => {
    expect(perks.split!.requires).toBe('multishot');
    expect(perks.leech!.requires).toBe('lifesteal');
    expect(perks.compound!.requires).toBe('interest');
    expect(ids.filter((id) => perks[id]!.requires !== undefined)).toHaveLength(3);
  });

  it('every tag has a 2/4/6 set and every effect type is used somewhere', () => {
    expect(DEFAULT_DATA.sets.tiers).toEqual([2, 4, 6]);
    const used = new Set<string>();
    for (const id of ids) for (const e of perks[id]!.effects) used.add(e.type);
    for (const tag of TAGS) for (const t of ['2', '4', '6']) for (const e of DEFAULT_DATA.sets.sets[tag][t]!) used.add(e.type);
    expect([...used].sort()).toEqual([...EFFECT_TYPES].sort());
  });

  it('rarity split and pity are data', () => {
    expect(DEFAULT_DATA.perks.offer.rarityWeights).toEqual({ common: 70, rare: 25, epic: 5 });
    expect(DEFAULT_DATA.perks.offer.pityAfter).toBe(3);
    expect(DEFAULT_DATA.perks.schedule).toEqual({ waves: [1, 3, 5, 8, 10], every: 5 });
  });

  it('only the boss drops Keys', () => {
    expect(DEFAULT_DATA.enemies.boss.keys).toBeGreaterThan(0);
    for (const k of ['basic', 'fast', 'tank', 'ranged'] as const) expect(DEFAULT_DATA.enemies[k].keys).toBe(0);
  });

  it('rejects bad perk data and names the field', () => {
    expect(withPerk((d) => (d.perks.perks.bounce!.tag = 'fire' as never))).toThrow(/perks\.bounce\.tag/);
    expect(withPerk((d) => (d.perks.perks.bounce!.maxStacks = 0))).toThrow(/perks\.bounce\.maxStacks/);
    expect(withPerk((d) => (d.perks.perks.split!.requires = 'luck' as never))).toThrow(/perks\.split\.requires/);
    expect(withPerk((d) => ((d.perks.perks.overclockRounds!.effects[0] as { stat: string }).stat = 'luck'))).toThrow(/overclockRounds\.effects\[0\]\.stat/);
    expect(withPerk((d) => ((d.perks.perks.bounce!.effects[0] as { rule: string }).rule = 'gravity'))).toThrow(/bounce\.effects\[0\]\.rule/);
    expect(withPerk((d) => ((d.perks.perks.arc!.effects[0] as { chance: number }).chance = 2))).toThrow(/arc\.effects\[0\]\.chance/);
    expect(withPerk((d) => ((d.perks.perks.arc!.effects[0] as { type: string }).type = 'onSpawn'))).toThrow(/arc\.effects\[0\]\.type/);
    expect(withPerk((d) => (d.perks.offer.rarityWeights = { common: 1, rare: 0, epic: 0 }))).toThrow(/pity/);
  });

  it('rejects a set without a tier or with a bad effect', () => {
    expect(withPerk((d) => delete (d.sets.sets.cryo as Record<string, unknown>)['4'])).toThrow(/sets\.sets\.cryo\.4/);
    expect(withPerk((d) => ((d.sets.sets.firewall['6']![0] as { hpBelow: number }).hpBelow = 0))).toThrow(/firewall\.6\[0\]\.hpBelow/);
  });
});
