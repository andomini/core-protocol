// The STATS screen's content (pure): tabs → sections → rows of [label, value, accent?].
import { DAMAGE_SOURCES, type DamageSource, type LifetimeStats, type RunStats, totalDamage, totalKills } from '../meta/runStats';
import { ENEMY_KINDS, type EnemyKind, type GameData, STAT_IDS } from '../sim/data';
import { TAGS } from '../sim/perkData';
import type { World } from '../sim/state';
import type { CoreStats } from '../sim/stats';
import { type StatFormatKind, formatNum, formatStat } from './format';

export type StatRow = [label: string, value: string, accent?: string];
export interface StatSection {
  title: string;
  rows: StatRow[];
}
export interface StatTab {
  id: string;
  label: string;
  sections: StatSection[];
}

const KIND_NAME: Record<EnemyKind, string> = { basic: 'Basic', fast: 'Fast', tank: 'Tank', ranged: 'Ranged', boss: 'Worm (boss)' };
const SOURCE_NAME: Record<DamageSource, string> = { shot: 'Shots', bounce: 'Bounces', lightning: 'Lightning', tesla: 'Tesla Coil', thorns: 'Thorns' };

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(ss).padStart(2, '0')}`;
}

const pct = (a: number, b: number): string => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');
const n = formatNum;

export interface RunView {
  world: World;
  stats: RunStats;
  core: CoreStats;
  data: GameData;
  /** Energy the run started with (labs, cards). */
  startEnergy: number;
}

export function runTabs(v: RunView): StatTab[] {
  const { world: w, stats: s, core, data } = v;
  const simS = w.tick / data.config.tickHz;
  const dmg = totalDamage(s);
  const kills = totalKills(s.kills);
  const taken = s.takenMelee + s.takenRanged;
  const earned = Math.max(0, w.energy + s.energySpent - v.startEnergy);
  const battle: StatSection[] = [
    {
      title: 'RUN',
      rows: [
        ['Tier · wave', `T${w.tier} · ${w.wave}`],
        ['Game time', clock(simS)],
        ['Real time', clock(s.realMs / 1000)],
        ['Core HP', `${n(Math.ceil(w.core.hp))} / ${n(Math.ceil(core.health))}`],
      ],
    },
    {
      title: 'KILLS',
      rows: [['Total', n(kills), '#ff8be8'] as StatRow, ...ENEMY_KINDS.map((k): StatRow => [KIND_NAME[k], n(s.kills[k])])],
    },
    {
      title: 'DAMAGE DEALT',
      rows: [
        ['Total', n(dmg), '#ffe14a'] as StatRow,
        ...DAMAGE_SOURCES.filter((k) => s.damage[k] > 0 || k === 'shot').map((k): StatRow => [SOURCE_NAME[k], `${n(s.damage[k])} · ${pct(s.damage[k], dmg)}`]),
        ['From crits', `${n(s.critDamage)} · ${pct(s.critDamage, dmg)}`],
        ['Crit rate', `${pct(s.crits, s.hits)} of ${n(s.hits)} hits`],
        ['Biggest hit', n(s.maxHit)],
        ['Average DPS', simS > 0 ? n(dmg / simS) : '—'],
      ],
    },
    {
      title: 'DAMAGE TAKEN',
      rows: [
        ['Total', n(taken), '#ff6b8b'] as StatRow,
        ['Melee', `${n(s.takenMelee)} · ${pct(s.takenMelee, taken)}`],
        ['Ranged', `${n(s.takenRanged)} · ${pct(s.takenRanged, taken)}`],
        ['Hits taken', n(s.hitsTaken)],
        ['Blocked (immunity)', n(s.blocked)],
        ['Absorbed (shield)', n(s.absorbed)],
        ['Healed (lifesteal)', n(s.healedLifesteal)],
        ['Revives', n(s.revives)],
      ],
    },
  ];
  const tagsOn = TAGS.filter((t) => w.setTiers[t] > 0).map((t) => `${data.sets.tags[t].name} ×${w.setTiers[t]}`);
  const economy: StatSection[] = [
    {
      title: 'ENERGY',
      rows: [
        ['Earned', n(earned), '#ffd23f'] as StatRow,
        ['From kills', `${n(s.energyFromKills)} · ${pct(s.energyFromKills, earned)}`],
        ['From waves & interest', n(Math.max(0, earned - s.energyFromKills))],
        ['Spent', n(s.energySpent)],
        ['Unspent', n(w.energy)],
        ['Levels bought', n(s.levelsBought)],
        ['Free upgrades', n(s.freeUpgrades)],
      ],
    },
    {
      title: 'REWARDS',
      rows: [
        ['Bits', n(w.bits), '#5cf2ff'] as StatRow,
        ['Bits from kills', n(s.bitsFromKills)],
        ['Keys', n(w.keys), '#ffb84d'],
        ['Waves skipped', n(s.waveSkips)],
      ],
    },
    {
      title: 'PROTOCOLS',
      rows: [
        ['Installed', n(s.picks)],
        ['Rerolls', n(s.rerolls)],
        ['Boosts', n(s.boosts)],
        ['Sets online', tagsOn.length ? tagsOn.join(', ') : 'none'],
        ['Freezes applied', n(s.freezes)],
        ['Lightning bolts', n(s.bolts)],
      ],
    },
  ];
  const coreRows: StatRow[] = STAT_IDS.map((id): StatRow => {
    const def = data.stats.stats[id];
    const lvl = w.levels[id] + w.workshop[id];
    return [def.name, `${formatStat(def.format as StatFormatKind, core[id])}  ·  lv ${w.levels[id]}${w.workshop[id] ? ` + ${w.workshop[id]}` : ''}`, lvl > 0 ? undefined : '#5a6a95'];
  });
  return [
    { id: 'battle', label: 'BATTLE', sections: battle },
    { id: 'economy', label: 'ECONOMY', sections: economy },
    {
      id: 'core',
      label: 'CORE',
      sections: [
        { title: 'ATTACK', rows: coreRows.slice(0, 6) },
        { title: 'DEFENSE', rows: coreRows.slice(6, 12) },
        { title: 'UTILITY', rows: coreRows.slice(12, 18) },
      ],
    },
  ];
}

export interface LifetimeView {
  life: LifetimeStats;
  best: Record<string, number>;
  tierUnlocked: number;
  tickHz: number;
  packs: number;
  cardsOwned: number;
  cardsTotal: number;
  labsOwned: number;
  labsTotal: number;
  workshopLevels: number;
}

export function lifetimeTabs(v: LifetimeView): StatTab[] {
  const l = v.life;
  const kills = totalKills(l.kills);
  return [
    {
      id: 'lifetime',
      label: 'LIFETIME',
      sections: [
        {
          title: 'PLAY',
          rows: [
            ['Runs', n(l.runs)],
            ['Waves played', n(l.waves)],
            ['Game time', clock(l.simTicks / v.tickHz)],
            ['Real time', clock(l.realMs / 1000)],
            ['Revives', n(l.revives)],
          ],
        },
        {
          title: 'COMBAT',
          rows: [
            ['Viruses purged', n(kills), '#ff8be8'] as StatRow,
            ...ENEMY_KINDS.map((k): StatRow => [KIND_NAME[k], n(l.kills[k])]),
            ['Damage dealt', n(l.damage), '#ffe14a'],
            ['Biggest hit', n(l.maxHit)],
            ['Hits taken', n(l.hitsTaken)],
          ],
        },
        {
          title: 'ECONOMY',
          rows: [
            ['Bits earned', n(l.bitsEarned), '#5cf2ff'] as StatRow,
            ['Keys earned', n(l.keysEarned), '#ffb84d'],
            ['Energy earned', n(l.energyEarned)],
            ['Levels bought in runs', n(l.levelsBought)],
            ['Protocols installed', n(l.picks)],
          ],
        },
        {
          title: 'PROGRESS',
          rows: [
            ['Tiers unlocked', `${v.tierUnlocked}`],
            ...Object.entries(v.best)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([t, wv]): StatRow => [`Best wave · tier ${t}`, n(wv)]),
            ['Workshop levels', n(v.workshopLevels)],
            ['Labs', `${v.labsOwned} / ${v.labsTotal}`],
            ['Cards', `${v.cardsOwned} / ${v.cardsTotal}`],
            ['Packs opened', n(v.packs)],
          ],
        },
      ],
    },
  ];
}
