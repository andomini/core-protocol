import { describe, expect, it } from 'vitest';
import { CARDS, cardDef } from '../src/meta/cards';
import { DEFAULT_DATA } from '../src/sim/data';
import { cardEffectText } from '../src/ui/cardText';

describe('cardEffectText', () => {
  it('describes every card at every star level', () => {
    for (const c of CARDS.cards) for (let s = 1; s <= 5; s++) expect(cardEffectText(DEFAULT_DATA, c, s)).toMatch(/\w{3}/);
  });
  it('uses the star value', () => {
    expect(cardEffectText(DEFAULT_DATA, cardDef('damage')!, 1)).toBe('+5% Damage');
    expect(cardEffectText(DEFAULT_DATA, cardDef('damage')!, 5)).toBe('+20% Damage');
    expect(cardEffectText(DEFAULT_DATA, cardDef('fastBoot')!, 2)).toBe('First 13 waves at ×4 speed');
    expect(cardEffectText(DEFAULT_DATA, cardDef('secondWind')!, 1)).toBe('Revive once with 30% HP');
  });
});
