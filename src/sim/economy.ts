// Wave timing and wave scaling, shared by waves.ts and structures.ts (kept apart so the two do not import each other).

import type { GameData } from './data';
import { clampValue, powInt } from './num';

export function waveTicks(data: GameData): number {
  return data.config.waveSeconds * data.config.tickHz;
}

export function pauseTicks(data: GameData): number {
  return data.config.pauseSeconds * data.config.tickHz;
}

/** base × mul × growth^(wave − 1), clamped to MAX_VALUE. */
export function scaleForWave(base: number, mul: number, growth: number, wave: number): number {
  return clampValue(base * mul * powInt(growth, wave - 1));
}
