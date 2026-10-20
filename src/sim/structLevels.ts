// C4 (uniqueness plan phase 3): structure upgrades. Levels are per kind (`World.structLevels`, missing = 0), bought with
// Energy by the `upgradeStruct` command, and fold into the kind's StructureValues after the fusion ladders, so the
// sim, the renderer and the HUD all read one set of numbers. Imports only data and types (perks.ts calls in).

import type { GameData, StructureUpgradeDef } from './data';
import { clampValue, powInt } from './num';
import { STRUCTURE_FIELDS, type StructureKind, type StructureValues } from './perkData';
import type { World } from './state';

/** The upgrade ladder of `kind`, undefined when the kind has none. */
export function structUpgradeDef(data: GameData, kind: StructureKind): StructureUpgradeDef | undefined {
  return data.structures.upgrades?.[kind];
}

/** Bought level of `kind`: a whole number in [0, max]; anything else in a save reads as the nearest valid level. */
export function structLevel(w: World, data: GameData, kind: StructureKind): number {
  const def = structUpgradeDef(data, kind);
  const raw = w.structLevels?.[kind];
  if (def === undefined || typeof raw !== 'number' || !(raw > 0)) return 0;
  return Math.min(def.max, Math.floor(raw));
}

/** Energy for the step from `level` to `level + 1`: ceil(cost · costGrowth^level); Infinity past the top. */
export function structUpgradeCost(data: GameData, kind: StructureKind, level: number): number {
  const def = structUpgradeDef(data, kind);
  if (def === undefined || level >= def.max) return Infinity;
  return clampValue(Math.ceil(def.cost * powInt(def.costGrowth, level)));
}

/** Upper bound of a whole-number field (targets ≤ 8, perWave ≤ 12, …), Infinity for a real one. */
function fieldCap(kind: StructureKind, field: string): number {
  const rule = STRUCTURE_FIELDS[kind][field]?.rule;
  return rule !== undefined && 'max' in rule ? rule.max : Infinity;
}

/** One kind's values at `level`: each `perLevel` field × (1 + frac·level), each `atMax` field + add at the top level. Only fields the ladders set are touched. */
export function leveledValues(data: GameData, kind: StructureKind, v: StructureValues, level: number): StructureValues {
  const def = structUpgradeDef(data, kind);
  if (def === undefined || level <= 0) return v;
  const out: StructureValues = { ...v };
  for (const [f, frac] of Object.entries(def.perLevel)) if (out[f] !== undefined) out[f] = clampValue(out[f]! * (1 + frac * level));
  if (level >= def.max && def.atMax !== undefined)
    for (const [f, add] of Object.entries(def.atMax)) if (out[f] !== undefined) out[f] = Math.min(fieldCap(kind, f), clampValue(out[f]! + add));
  return out;
}

/** Folds the bought levels into folded structure values (in place on the map; the caller's map is fresh). */
export function applyStructLevels(w: World, data: GameData, structures: Partial<Record<StructureKind, StructureValues>>): void {
  if (w.structLevels === undefined) return;
  for (const kind of Object.keys(structures) as StructureKind[]) {
    const v = structures[kind];
    const level = structLevel(w, data, kind);
    if (v !== undefined && level > 0) structures[kind] = leveledValues(data, kind, v, level);
  }
}

/** Kinds that have a ladder, in STRUCTURE_FIELDS order (the panel's and the bots' list). */
export function upgradableKinds(data: GameData): StructureKind[] {
  return (Object.keys(STRUCTURE_FIELDS) as StructureKind[]).filter((k) => structUpgradeDef(data, k) !== undefined);
}
