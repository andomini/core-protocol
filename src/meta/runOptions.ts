// Meta → sim: the RunOptions for a new run from the player's workshop, labs and (M5) cards.
import type { GameData } from '../sim/data';
import type { RunOptions } from '../sim/state';
import { labEffects } from './labs';
import type { MetaData } from './metaData';
import type { MetaState } from './state';

export function buildRunOptions(m: MetaState, _data: GameData, md: MetaData, tier: number, seed: number, cardTags: string[] = []): RunOptions {
  const e = labEffects(m, md);
  return {
    seed,
    tier,
    workshop: { ...m.workshop },
    unlocked: e.unlocked,
    extraPerkChoice: e.perkChoice,
    freeReroll: e.freeReroll,
    pickEvery: e.pickEvery || undefined,
    rareMul: e.rareMul,
    maxLevelBonus: e.maxLevelBonus,
    startEnergy: e.startEnergy,
    cardTags,
  };
}
