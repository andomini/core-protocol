import { describe, expect, it } from 'vitest';
import { canFreePack, CARDS, claimFreePack, equip, grantStarter, loadoutBonus, openPack, starsFor, unequip } from '../src/meta/cards';
import { DEFAULT_META_DATA } from '../src/meta/metaData';
import { buildRunOptions } from '../src/meta/runOptions';
import { defaultMeta } from '../src/meta/state';
import { DEFAULT_DATA } from '../src/sim/data';
import { createWorld, worldStats } from '../src/sim/state';

/** Deterministic rng for tests (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('cards data', () => {
  it('20 cards: 10 common, 7 rare, 3 epic; 5 star values each', () => {
    const by = (r: string) => CARDS.cards.filter((c) => c.rarity === r).length;
    expect(CARDS.cards).toHaveLength(20);
    expect([by('common'), by('rare'), by('epic')]).toEqual([10, 7, 3]);
    for (const c of CARDS.cards) expect(c.values).toHaveLength(5);
  });

  it('stars come from copies: 1, 3, 6, 10, 15', () => {
    expect([0, 1, 2, 3, 5, 6, 9, 10, 15, 99].map(starsFor)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 5, 5]);
  });
});

describe('packs', () => {
  it('a pack costs Keys and gives 3 cards; refuses without Keys', () => {
    const m = defaultMeta();
    expect(openPack(m, rng(1))).toBeNull();
    m.keys = CARDS.pack.price;
    const r = openPack(m, rng(1))!;
    expect(r).toHaveLength(3);
    expect(m.keys).toBe(0);
    expect(Object.values(m.cards).reduce((a, b) => a + b, 0)).toBe(3);
    expect(r[0]!.isNew).toBe(true);
  });

  it('pity: an Epic at least every 10 packs', () => {
    const m = defaultMeta();
    m.keys = 1e6;
    let since = 0;
    for (let i = 0; i < 200; i++) {
      const r = openPack(m, rng(i + 7))!;
      const epic = r.some((x) => CARDS.cards.find((c) => c.id === x.id)!.rarity === 'epic');
      since = epic ? 0 : since + 1;
      expect(since).toBeLessThan(CARDS.pack.pityEvery);
    }
  });

  it('free pack once every 4 hours', () => {
    const m = defaultMeta();
    const h = 3600_000;
    expect(canFreePack(m, 10 * h)).toBe(true);
    expect(claimFreePack(m, rng(3), 10 * h)).not.toBeNull();
    expect(canFreePack(m, 12 * h)).toBe(false);
    expect(claimFreePack(m, rng(3), 12 * h)).toBeNull();
    expect(canFreePack(m, 14 * h + 1)).toBe(true);
  });

  it('the starter pack gives 2 tagged commons of different tags, once', () => {
    const m = defaultMeta();
    const r = grantStarter(m, rng(5))!;
    const defs = r.map((x) => CARDS.cards.find((c) => c.id === x.id)!);
    expect(defs).toHaveLength(2);
    expect(defs.every((d) => d.rarity === 'common' && d.tag !== null)).toBe(true);
    expect(defs[0]!.tag).not.toBe(defs[1]!.tag);
    expect(grantStarter(m, rng(5))).toBeNull();
  });
});

describe('loadout', () => {
  it('equips owned cards up to the slot count; unequips', () => {
    const m = defaultMeta();
    m.cards = { damage: 1, health: 1, spikes: 1 };
    expect(equip(m, DEFAULT_META_DATA, 'damage')).toBe(true);
    expect(equip(m, DEFAULT_META_DATA, 'regen')).toBe(false); // not owned
    expect(equip(m, DEFAULT_META_DATA, 'health')).toBe(true);
    expect(equip(m, DEFAULT_META_DATA, 'spikes')).toBe(false); // 2 slots
    m.labs.push('slot3');
    expect(equip(m, DEFAULT_META_DATA, 'spikes')).toBe(true);
    unequip(m, 'damage');
    expect(m.loadout).toEqual(['health', 'spikes']);
  });

  it('the loadout reaches the sim (effects at star level, tags) and the meta (Energy, Bits, Fast Boot, Second Wind)', () => {
    const m = defaultMeta();
    m.cards = { damage: 3, spikes: 1, energyStart: 1, bitsPlus: 1, fastBoot: 1, secondWind: 1 };
    m.labs = ['slot3', 'slot4', 'slot5', 'slot6'];
    for (const id of ['damage', 'spikes', 'energyStart', 'bitsPlus', 'fastBoot', 'secondWind']) equip(m, DEFAULT_META_DATA, id);
    const o = buildRunOptions(m, DEFAULT_DATA, DEFAULT_META_DATA, 1, 1);
    expect(o.cardTags).toEqual(['firewall']);
    expect(o.cards!.map((c) => c.id)).toEqual(['damage', 'spikes']);
    expect(o.startEnergy).toBe(20);
    const b = loadoutBonus(m);
    expect(b.bitsMul).toBe(1.08);
    expect(b.fastBootWaves).toBe(10);
    expect(b.secondWind).toBe(0.3);
    const base = worldStats(createWorld(DEFAULT_DATA, { seed: 1, tier: 1 }), DEFAULT_DATA).damage;
    expect(worldStats(createWorld(DEFAULT_DATA, o), DEFAULT_DATA).damage).toBeCloseTo(base * 1.08, 9); // ★2 at 3 copies
  });
});
