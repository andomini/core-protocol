// The crystal editor readout (uniqueness plan item 11): at most three plain sentences, no jargon.
import { describe, expect, it } from 'vitest';
import type { CrystalDiff } from '../src/sim/crystal';
import { DEFAULT_DATA } from '../src/sim/data';
import { TAGS } from '../src/sim/perkData';
import { diffLines, effectPhrase } from '../src/ui/crystalReadout';
import { fusionLines, setTierLines } from '../src/ui/perkText';

const D = DEFAULT_DATA;
const none: CrystalDiff = { sets: [], fusions: [], sectors: [] };
const fusion = (key: string, tierFrom: number, tierTo: number, from: number, to: number): CrystalDiff => ({ ...none, fusions: [{ key, tierFrom, tierTo, from, to }] });
const KEY = 'cryo+mining';
const NAME = D.sets.fusions[KEY]!.name;

describe('crystal editor readout', () => {
  it('names the change and its effect in one sentence', () => {
    const set = diffLines(D, { ...none, sets: [{ tag: 'overload', tierFrom: 4, tierTo: 6, from: 5, to: 6 }] });
    expect(set).toHaveLength(1);
    expect(set[0]!.text).toBe(`Overload set 4 → 6: ${effectPhrase(setTierLines(D, 'overload', 6))}`);
    expect(diffLines(D, { ...none, sets: [{ tag: 'cryo', tierFrom: 0, tierTo: 2, from: 1, to: 2 }] })[0]!.text).toMatch(/^Opens Cryo 2-set: /);
    expect(diffLines(D, fusion(KEY, 3, 5, 4, 5))[0]!.text).toBe(`${NAME} II → III: ${effectPhrase(fusionLines(D, KEY, 5))}`);
    expect(diffLines(D, fusion(KEY, 0, 1, 0, 1))[0]!.text).toMatch(new RegExp(`^Opens ${NAME} I: `));
    expect(diffLines(D, fusion(KEY, 1, 0, 1, 0))[0]!.text).toBe(`Breaks ${NAME} I`);
    expect(diffLines(D, { ...none, sets: [{ tag: 'chain', tierFrom: 2, tierTo: 0, from: 2, to: 1 }] })[0]!.text).toBe('Breaks Chain 2-set');
    expect(diffLines(D, fusion(KEY, 1, 1, 1, 2))[0]!.text).toBe(`${NAME} 2/3 links toward II`);
    expect(diffLines(D, fusion(KEY, 5, 5, 5, 6))[0]!.text).toBe(`${NAME} 6 links: top tier`);
    expect(diffLines(D, { ...none, sectors: [{ sector: 1, from: null, to: 'cryo' }] })[0]!.text).toBe('North-east ground turns Cryo');
    expect(diffLines(D, none)).toEqual([{ text: 'No change', color: expect.any(String) }]);
    expect(diffLines(D, null)[0]!.text).toBe('Not allowed here');
  });

  it('a fall says what goes: "back to" a smaller same effect, else "loses"', () => {
    expect(diffLines(D, fusion('overload+firewall', 5, 3, 5, 4))[0]!.text).toBe('Bastion III → II: back to 2 turrets');
    expect(diffLines(D, fusion('overload+chain', 5, 3, 5, 4))[0]!.text).toBe(`Overcharge III → II: loses ${effectPhrase(fusionLines(D, 'overload+chain', 5))}`);
    expect(diffLines(D, { ...none, sets: [{ tag: 'firewall', tierFrom: 6, tierTo: 4, from: 6, to: 5 }] })[0]!.text).toMatch(/^Firewall set 6 → 4: loses /);
  });

  it('at most three lines, tier changes first, no jargon in any sentence', () => {
    const d: CrystalDiff = {
      sets: [{ tag: 'overload', tierFrom: 2, tierTo: 2, from: 2, to: 3 }],
      fusions: [fusion(KEY, 1, 3, 2, 3).fusions[0]!, fusion('overload+chain', 3, 1, 3, 2).fusions[0]!, fusion('cryo+chain', 0, 1, 0, 1).fusions[0]!],
      sectors: [{ sector: 0, from: 'cryo', to: null }],
    };
    const lines = diffLines(D, d);
    expect(lines).toHaveLength(3);
    expect(lines[0]!.text).toMatch(/I → II/);
    expect(lines[2]!.text).toBe('+3 more');
    const all: string[] = [];
    for (const key of Object.keys(D.sets.fusions)) {
      const [a, b, c] = D.sets.fusionTiers as [number, number, number];
      for (const [x, y] of [[0, a], [a, b], [b, c], [c, b], [b, a], [a, 0]] as const) all.push(...diffLines(D, fusion(key, x, y, x, y)).map((l) => l.text));
    }
    for (const tag of TAGS)
      for (const [x, y] of [[0, 2], [2, 4], [4, 6], [6, 4], [4, 2]] as const)
        all.push(...diffLines(D, { ...none, sets: [{ tag, tierFrom: x, tierTo: y, from: y, to: y }] }).map((l) => l.text));
    for (const s of all) {
      expect(s).not.toMatch(/fold|ladder|weld|apex|pending/i);
      expect(s).not.toMatch(/[()]/);
    }
    // Every sentence with an effect has a brief form (its head) for a narrow readout row.
    const rise = diffLines(D, fusion(KEY, 1, 3, 2, 3))[0]!;
    expect(rise.brief).toBe(`${NAME} I → II`);
  });
});
