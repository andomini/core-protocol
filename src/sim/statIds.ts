/** The 24 in-run stats (spec §2.3), in panel order: ATK, DEF, UTIL, BUILD (the firewall structures' upgrades). */
export const STAT_IDS = [
  'damage', 'attackSpeed', 'critChance', 'critFactor', 'range', 'multishot',
  'health', 'regen', 'defense', 'thorns', 'lifesteal', 'knockback',
  'energyBonus', 'energyPerWave', 'interest', 'bitsPerKill', 'bitsPerWave', 'freeUpgrade',
  'structHealth', 'structRegen', 'turretDamage', 'turretSpeed', 'mineDamage', 'stationIncome',
] as const;
export type StatId = (typeof STAT_IDS)[number];
