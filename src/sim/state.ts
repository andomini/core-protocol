import { type EnemyKind, type GameData, STAT_IDS, type StatId } from './data';
import { TAGS, type Tag } from './perkData';
import { initProtocols, type Timer } from './perks';
import { createStream, type RngState } from './rng';
import { canonicalLevels, type CoreStats, effectiveStats, type Levels, type Modifier } from './stats';

// The World is plain JSON: no classes, Maps or functions, so it can be hashed and snapshotted.

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  damage: number;
  /** World px per second. */
  speed: number;
  radius: number;
  standoff: number;
  attackIntervalTicks: number;
  /** Ticks until the next attack; ≤ 0 = ready. */
  attackCd: number;
  energy: number;
  bits: number;
  /** On-hit slow strength (0..1) while `slowUntil` ≥ the current tick. */
  slow: number;
  slowUntil: number;
  /** Frozen (no move, no attack) while `frozenUntil` ≥ the current tick. */
  frozenUntil: number;
}

export interface Projectile {
  id: number;
  targetId: number;
  x: number;
  y: number;
  damage: number;
  crit: boolean;
  /** Bounces left (🔗 Bounce): on a hit it retargets the nearest enemy it has not hit yet. */
  bounces: number;
  /** Enemies this projectile already hit (bounce exclusion). */
  hits: number[];
}

/** Only true state: max HP, damage, range… are derived (see worldStats). */
export interface CoreState {
  hp: number;
  /** Ticks until the next shot; ≤ 0 = ready. */
  fireCd: number;
  /** Projectiles fired this run (every-Nth-shot perks). */
  shots: number;
}

/** v3 (M3): protocols — perks, set tiers, pick phase, Keys, boost, periodic timers, slow/freeze, bounces. */
export const WORLD_VERSION = 3;

export type Phase = 'wave' | 'pause' | 'pick';

export interface World {
  v: 3;
  seed: number;
  /** 1-based index into GameData.tiers. */
  tier: number;
  tick: number;
  wave: number;
  /** `pick`: a protocol offer is open; the world does not tick until a pickPerk (resumes as `pause`). */
  phase: Phase;
  /** Ticks elapsed in the current phase (kept through a pick). */
  phaseTick: number;
  spawnQueue: EnemyKind[];
  spawnInterval: number;
  nextSpawnTick: number;
  core: CoreState;
  /** Levels bought in this run (canonical STAT_IDS key order). */
  levels: Levels;
  /** Workshop levels this run started with (M4 fills them). */
  workshop: Levels;
  /** Stats unlocked beyond the defaults (lab nodes, M4), in STAT_IDS order. */
  unlocked: StatId[];
  /** Stat modifiers from perks, sets, cards (M3/M5 append). */
  mods: Modifier[];
  /** Protocol picks are on (false: legacy sim tests and the dev stress mode). */
  protocols: boolean;
  /** Perk stacks by id (canonical perks.json key order, every id present). */
  perks: Record<string, number>;
  /** Tags of the card loadout (M5); each counts 1 toward its set. */
  cardTags: Tag[];
  /** Highest set tier applied per tag (0, 2, 4, 6). */
  setTiers: Record<Tag, number>;
  /** Perk ids on offer (display order) while `phase === 'pick'`; empty otherwise. */
  offer: string[];
  /** Rerolls used on the open offer. */
  rerolls: number;
  /** Picks taken so far. */
  picks: number;
  /** Consecutive picks whose offer had no Rare+ (pity). */
  pity: number;
  freeRerolls: number;
  /** Cards per offer (3, or 4 with the lab node). */
  offerSize: number;
  /** Rewarded boost: × Energy on waves from..until (0 = never used). */
  boost: { from: number; until: number };
  /** Periodic effects by source key (sets): next trigger and active-until. */
  timers: Record<string, Timer>;
  enemies: Enemy[];
  projectiles: Projectile[];
  nextId: number;
  energy: number;
  bits: number;
  /** 🔑 Keys earned this run (bosses). */
  keys: number;
  kills: number;
  dead: boolean;
  /** Separate streams so purchases (upgrades) never perturb combat or spawns. */
  rng: { spawn: RngState; combat: RngState; upgrades: RngState };
}

export interface RunOptions {
  seed: number;
  tier: number;
  workshop?: Partial<Record<StatId, number>>;
  /** Locked-by-default stats to unlock for this run (lab nodes in M4; `?unlockall=1` in dev). */
  unlocked?: readonly string[];
  /** Protocol picks (default true). */
  protocols?: boolean;
  /** Tags of the equipped cards (M5); each counts 1 toward its set. */
  cardTags?: readonly string[];
  /** Lab node: 4 cards per offer instead of 3. */
  extraPerkChoice?: boolean;
  /** Lab node: free reroll(s) per run. */
  freeReroll?: boolean;
}

/** The effective stats of this world right now (derived; never stored in the World). */
export function worldStats(w: World, data: GameData): CoreStats {
  return effectiveStats(data, { workshop: w.workshop, run: w.levels, mods: w.mods });
}

export function createWorld(data: GameData, opts: RunOptions): World {
  if (!Number.isInteger(opts.tier) || opts.tier < 1 || opts.tier > data.tiers.length) {
    throw new Error(`createWorld: tier ${opts.tier} is out of range 1..${data.tiers.length}`);
  }
  if (!Number.isInteger(opts.seed)) throw new Error(`createWorld: seed must be an integer, got ${opts.seed}`);
  const workshop = canonicalLevels(opts.workshop);
  const levels = canonicalLevels(undefined);
  const unlocked = STAT_IDS.filter((id) => opts.unlocked?.includes(id) === true);
  const mods: Modifier[] = [];
  const perks: Record<string, number> = {};
  for (const id of Object.keys(data.perks.perks)) perks[id] = 0;
  const setTiers = {} as Record<Tag, number>;
  for (const t of TAGS) setTiers[t] = 0;
  const cardTags = (opts.cardTags ?? []).filter((t): t is Tag => (TAGS as readonly string[]).includes(t));
  const w: World = {
    v: 3,
    seed: opts.seed,
    tier: opts.tier,
    tick: 0,
    wave: 0,
    // Start "at the end of a pause" so the first step starts wave 1 and emits its event.
    phase: 'pause',
    phaseTick: data.config.pauseSeconds * data.config.tickHz,
    spawnQueue: [],
    spawnInterval: 1,
    nextSpawnTick: 1,
    core: { hp: 0, fireCd: 0, shots: 0 },
    levels,
    workshop,
    unlocked,
    mods,
    protocols: opts.protocols !== false,
    perks,
    cardTags,
    setTiers,
    offer: [],
    rerolls: 0,
    picks: 0,
    pity: 0,
    freeRerolls: opts.freeReroll === true ? data.perks.freeRerolls : 0,
    offerSize: opts.extraPerkChoice === true ? data.perks.offer.sizeLab : data.perks.offer.size,
    boost: { from: 0, until: 0 },
    timers: {},
    enemies: [],
    projectiles: [],
    nextId: 1,
    energy: 0,
    bits: 0,
    keys: 0,
    kills: 0,
    dead: false,
    rng: { spawn: createStream(opts.seed, 'spawn'), combat: createStream(opts.seed, 'combat'), upgrades: createStream(opts.seed, 'upgrades') },
  };
  // Card tags may already complete a set; then the wave-1 pick opens the run (spec §2.4, B1).
  initProtocols(w, data);
  w.core.hp = worldStats(w, data).health;
  return w;
}
