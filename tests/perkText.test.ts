import { describe, expect, it } from 'vitest';
import type { Effect } from '../src/sim/perkData';
import { effectLine, perkLines, setProgress, totalLines } from '../src/ui/perkText';
import { mechanicsData } from './helpers';

const data = mechanicsData();

describe('perkText', () => {
  it('describes stat effects with signed percentages or flat values', () => {
    expect(effectLine(data, { type: 'statMul', stat: 'damage', value: 1.15 })).toBe('+15% Damage');
    expect(effectLine(data, { type: 'statMul', stat: 'health', value: 0.75 })).toBe('−25% Health');
    expect(effectLine(data, { type: 'statAdd', stat: 'critChance', value: 0.05 })).toBe('+5% Crit Chance');
    expect(effectLine(data, { type: 'statAdd', stat: 'regen', value: 1 })).toBe('+1 Regen/s');
    expect(effectLine(data, { type: 'statAdd', stat: 'multishot', value: 1 })).toBe('+1 Multishot');
    expect(effectLine(data, { type: 'statMul', stat: 'interestCap', value: 1.5 })).toBe('+50% Interest cap');
  });

  it('describes procs, conditions, periodic triggers and rule changes', () => {
    const cases: [Effect, string][] = [
      [{ type: 'onHit', action: 'slow', strength: 0.2, seconds: 2 }, 'Hits slow 20% for 2s'],
      [{ type: 'onHit', action: 'freeze', chance: 0.05, seconds: 1 }, '5% chance to freeze 1s'],
      [{ type: 'onHit', action: 'lightning', chance: 0.1 }, '10% chance: lightning'],
      [{ type: 'onCrit', action: 'lightning' }, 'Crits throw lightning'],
      [{ type: 'onKill', energy: 0.1 }, '+10% Energy per kill'],
      [{ type: 'onKill', kind: 'boss', energyMul: 2, bitsMul: 2 }, 'Bosses: ×2 Energy, ×2 Bits'],
      [{ type: 'onKill', kind: 'boss', keys: 1 }, 'Bosses: +1 Key'],
      [{ type: 'conditional', when: 'targetSlowed', damageMul: 1.3 }, '+30% damage to slowed'],
      [{ type: 'conditional', when: 'targetFrozen', damageMul: 1.5 }, '+50% damage to frozen'],
      [{ type: 'conditional', when: 'nthShot', every: 10, damageMul: 3 }, 'Every 10th shot ×3'],
      [{ type: 'conditional', when: 'targetHpBelow', frac: 0.2, damageMul: 2 }, '×2 damage below 20% HP'],
      [{ type: 'conditional', when: 'innerRange', frac: 0.4, slow: 0.15 }, 'Slow 15% in inner 40% of range'],
      [{ type: 'periodic', action: 'overdrive', everySec: 30, seconds: 8, value: 2 }, 'Every 30s: ×2 attack speed for 8s'],
      [{ type: 'periodic', action: 'freezeAll', everySec: 20, seconds: 2 }, 'Every 20s: freeze all for 2s'],
      [{ type: 'periodic', action: 'immunity', everyWaves: 3, seconds: 3, hpBelow: 0.5 }, 'Below 50% HP: 3s immunity (every 3 waves)'],
      [{ type: 'ruleChange', rule: 'bounces', op: 'add', value: 1 }, '+1 bounce'],
      [{ type: 'ruleChange', rule: 'bounceDamage', op: 'mul', value: 0.6 }, '−40% bounce damage'],
      [{ type: 'ruleChange', rule: 'lightningTargets', op: 'mul', value: 2 }, 'Lightning targets ×2'],
      [{ type: 'ruleChange', rule: 'freezeSeconds', op: 'mul', value: 2 }, 'Freezes last ×2'],
      [{ type: 'ruleChange', rule: 'enemyHp', op: 'mul', value: 1.15 }, 'Enemies +15% HP'],
      [{ type: 'ruleChange', rule: 'thornsRanged', op: 'add', value: 1 }, 'Thorns also reflect ranged hits'],
    ];
    for (const [e, s] of cases) expect(effectLine(data, e), JSON.stringify(e)).toBe(s);
  });

  it('every perk and set tier in the shipped data has a description', () => {
    for (const id of Object.keys(data.perks.perks)) for (const l of perkLines(data, id)) expect(l.length).toBeGreaterThan(3);
    for (const tiers of Object.values(data.sets.sets)) for (const effs of Object.values(tiers)) for (const e of effs) expect(effectLine(data, e)).not.toMatch(/undefined|NaN/);
  });

  it('totals stack a perk: ×1.15 twice reads +32%; flat adds sum', () => {
    expect(totalLines(data, 'overclockRounds', 2)).toEqual(['+32% Damage']);
    expect(totalLines(data, 'critSpike', 3)).toEqual(['+15% Crit Chance']);
    expect(totalLines(data, 'bounce', 2)).toEqual(['+2 bounce']);
  });

  it('set progress names the next tier and its bonus', () => {
    expect(setProgress(data, 'chain', 0)).toEqual({ count: 0, tier: 0, next: 2, nextText: '+1 bounce' });
    expect(setProgress(data, 'chain', 3)).toEqual({ count: 3, tier: 2, next: 4, nextText: 'Crits throw lightning' });
    expect(setProgress(data, 'chain', 6).next).toBe(0);
  });
});
