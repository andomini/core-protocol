// Card descriptions at a ★ level (sim effects reuse the protocol text; meta cards have their own lines).
import { type CardDef, simEffect } from '../meta/cards';
import type { GameData } from '../sim/data';
import { effectLine } from './perkText';

export function cardEffectText(data: GameData, c: CardDef, stars: number): string {
  const s = Math.max(1, Math.min(5, stars));
  const v = c.values[s - 1]!;
  if (c.effect.type === 'meta') {
    switch (c.effect.kind) {
      case 'startEnergy':
        return `+${v} Energy at run start`;
      case 'bitsMul':
        return `+${Math.round((v - 1) * 100)}% Bits per run`;
      case 'fastBoot':
        return `First ${v} waves at ×4 speed`;
      case 'secondWind':
        return `Revive once with ${Math.round(v * 100)}% HP`;
    }
  }
  return effectLine(data, simEffect(c, s)!);
}
