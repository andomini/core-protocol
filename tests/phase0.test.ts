import { describe, expect, it } from 'vitest';
import { DEFAULT_DATA } from '../src/sim/data';
import { type Effect, validateSets } from '../src/sim/perkData';
import { perkProfile, periodicTicks } from '../src/sim/perks';
import { hitEnemy } from '../src/sim/projectiles';
import { createWorld } from '../src/sim/state';
import { combatStats } from '../src/sim/step';
import { spawnEnemy } from '../src/sim/waves';

const D = DEFAULT_DATA;

describe('crystal combos v2, phase 0: data fixes', () => {
  it('freezeAll: validator rejects a base freeze above 0.6 x its period; the multiplied freeze is clamped', () => {
    const bad = structuredClone(D.sets);
    bad.sets.cryo['6'] = [{ type: 'periodic', action: 'freezeAll', everySec: 10, seconds: 7 }];
    expect(() => validateSets(bad)).toThrow(/seconds must be <= 0.6 x everySec/);
    const w = createWorld(D, { seed: 3, tier: 1, protocols: false });
    const prof = perkProfile(w, D);
    prof.rules.freezeSeconds = 10;
    const e = { type: 'periodic', action: 'freezeAll', everySec: 15, seconds: 3 } satisfies Extract<Effect, { type: 'periodic' }>;
    expect(periodicTicks(D, prof, e)).toBe(Math.round(0.6 * 15 * D.config.tickHz));
    prof.rules.freezeSeconds = 1;
    expect(periodicTicks(D, prof, e)).toBe(Math.round(3 * D.config.tickHz));
  });

  it('Frost Web no longer stretches freezes; chain 2 gives +1 bounce, mining 2 +0.1 Bits per kill', () => {
    expect(JSON.stringify(D.sets.fusions['cryo+chain'])).not.toContain('freezeSeconds');
    expect(D.sets.sets.chain['2']).toContainEqual({ type: 'ruleChange', rule: 'bounces', op: 'add', value: 1 });
    expect(D.sets.sets.mining['2']).toContainEqual({ type: 'statAdd', stat: 'bitsPerKill', value: 0.1 });
  });

  it('howCap: the crit x frozen x chain kill-Energy product never exceeds data.sets.howCap', () => {
    const pay = (mul: number) => {
      const w = createWorld(D, { seed: 3, tier: 1, protocols: false });
      w.wave = 1;
      const e = spawnEnemy(w, D, 'basic', 50, 0, []);
      e.frozenUntil = w.tick + 100;
      const prof = perkProfile(w, D);
      prof.critKillMul = mul;
      prof.frozenKillMul = mul;
      prof.chainKillMul = mul;
      const st = combatStats(w, D, prof);
      const e0 = w.energy;
      hitEnemy(w, D, st, prof, e, e.hp * 2, true, 'bounce', []);
      return w.energy - e0;
    };
    expect(D.sets.howCap).toBe(4);
    expect(pay(3)).toBeCloseTo(pay(1) * D.sets.howCap, 9);
    expect(pay(1.2)).toBeCloseTo(pay(1) * 1.2 ** 3, 9);
  });
});
