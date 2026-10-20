import { type EnemyKind, type GameData, STAT_IDS, type StatId } from './data';
import { type Effect, type StructureKind, TAGS, type Tag, validateEffect } from './perkData';
import type { Module } from './crystal';
import { blankGenome } from './mutations';
import { appendStatMods, initProtocols, type Timer } from './perks';
import { createStream, type RngState } from './rng';
import { clampValue } from './num';
import { initialTerrain } from './territory';
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
  /** Tick before which this enemy cannot be knocked back again. */
  kbUntil: number;
  /** Bounty Mark (spec 2026-10-16, phase 2): absent = not marked. */
  marked?: boolean;
  /** Leech (B2): Bits stolen so far, paid back × returnMul on its death; absent = none (optional: no World version bump). */
  carried?: number;
  /** Spore (B2): split generation, absent = 0 (a regular spawn); copies of a split are gen + 1. */
  gen?: number;
  /** c1 boss state (optional: no World version bump). `boss`: the tier boss id (bosses.json); absent = a plain boss / not a boss. */
  boss?: string;
  /** c1: this boss is its tier's FINALE (its kill unlocks the next tier). */
  finale?: boolean;
  /** c1: ticks this boss has been alive (its mechanic clock). */
  bt?: number;
  /** c1 Broodmother: broods already released. */
  brood?: number;
  /** c1 Siphon: Energy drained so far, paid back × drainReturn by its kill. */
  drained?: number;
  /** c1 Mutagen: enraged (sped up below enrageAt). */
  enraged?: boolean;
}

/** One painted blueprint hex (spec 2026-10-16 Planning UI, phase 6): the tag the auto-placer should put there. */
export interface BlueprintHex {
  q: number;
  r: number;
  tag: Tag;
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

/**
 * A firewall-fusion structure (spec 2026-10-15). Whether it is active is derived from the perk profile and
 * `share`/`downUntilTick` every tick, never stored. `x`/`y` are a render cache rewritten by syncStructures.
 */
export interface Struct {
  id: number;
  kind: StructureKind;
  /** Index among the entries of its kind (wall: the sector, 0..5; turret: TURRET_SECTORS[slot]; mines are renumbered at planting). */
  slot: number;
  x: number;
  y: number;
  /** HP as a share of its derived maximum, in [0, 1]. */
  share: number;
  /** Turret fire cooldown (ticks). */
  cd: number;
  /** Station: waves survived in a row. */
  streak: number;
  /** Station: ticks standing this wave. */
  powered: number;
  /** Down (share 0) until this tick; wall without regrow and stations are also repaired at wave start. */
  downUntilTick: number;
}

/** Only true state: max HP, damage, range… are derived (see worldStats). */
export interface CoreState {
  hp: number;
  /** Ticks until the next shot; ≤ 0 = ready. */
  fireCd: number;
  /** Projectiles fired this run (every-Nth-shot perks). */
  shots: number;
}

/** v3 (M3): protocols — perks, set tiers, pick phase, Keys, boost, periodic timers, slow/freeze, bounces. v6: crystal, territory, genome. */
export const WORLD_VERSION = 9; // v8: pulse fields + boot sector (bootOffer, boot); v9: fusionPending dropped (no Weld)

export type Phase = 'wave' | 'pause' | 'pick';

export interface World {
  v: 9;
  seed: number;
  /** 1-based index into GameData.tiers. */
  tier: number;
  tick: number;
  wave: number;
  /** `pick`: a protocol offer (or the run-start boot offer) is open; the world does not tick until a pickPerk / pickBoot (resumes as `pause`). */
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
  /** Set tier applied per tag (0, 2, 4, 6), from the crystal now: a move that breaks a cluster lowers it. */
  setTiers: Record<Tag, number>;
  /** Fusion tier per tag pair ("a+b" in TAGS order; absent = 0), from the links on the crystal now. */
  fusionTiers: Record<string, number>;
  /** Lattice: Σ fusion tier indices summed every tick, and the ticks summed (§4). */
  latticeSum: number;
  latticeTicks: number;
  /** Gene averaging (§5): set counts summed every tick since the last wave start, the ticks summed, the counts now. */
  geneAcc: Record<Tag, number>;
  geneTicks: number;
  tagCountsNow: Record<Tag, number>;
  /** Frost Web (phase 5): territory cell id → frosted until tick. */
  frost: Record<string, number>;
  /** Blueprint copied in at run start (phase 6); empty = none. */
  blueprint: BlueprintHex[];
  /**
   * Bounty Marks (phase 2): Marks killed and jackpots paid this run; `plan`: this wave's Mark draw (createStream
   * 'mark:'+wave) as spawn-queue lengths left at spawn time (1 = the last spawn), the first `count` of them Marked.
   */
  marks: { killed: number; jackpots: number; plan: number[] };
  /** The run's best tier per fusion pair (a link count like fusionTiers; absent = never reached): the Codex reads it at run end. */
  fusionBest: Record<string, number>;
  /** Perk ids on offer (display order) while `phase === 'pick'`; empty otherwise (and during the boot pick). */
  offer: string[];
  // boot
  /** Boot sector ids on offer (boot.json, display order) while the run-start boot pick is open; empty otherwise. */
  bootOffer: string[];
  // boot
  /** The boot sector id taken this run ('' : none yet, or a run without one; snapshots allow no nulls). */
  boot: string;
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
  /** The rewarded revive was used this run. */
  revived: boolean;
  /** Run-end Bits bonus paid at death (taken back on a revive so it is never paid twice). */
  bitsBonus: number;
  /** Lab parameters for this run (M4). */
  lab: LabParams;
  /** Equipped cards with their resolved effects (M5). */
  cards: CardInRun[];
  /** Barrier: absorbs core damage before HP; refilled at each wave start. */
  shield: number;
  /** Protocol modules on the crystal, in placement order (spec 2026-10-14 §A). */
  crystal: Module[];
  /** Territory cells (territory.ts grid order): 1 ours, 0 infected (§B). */
  terrain: number[];
  /** Virus gene levels per countered tag (§C). */
  genome: Record<Tag, number>;
  /** Virus nests: territory cell ids in the ground the breach revealed (spawn while infected). */
  nests: number[];
  /** Firewall-fusion structures, in id order, created lazily by syncStructures. */
  structs: Struct[];
  /** Ice Wall ring radius for this wave, set at the wave start (0 before the first wave). */
  wallR: number;
  /** C4: bought structure upgrade levels per kind (src/sim/structLevels.ts); missing (or a missing kind) = 0. No version bump. */
  structLevels?: Partial<Record<StructureKind, number>>;
  // pulse (uniqueness plan item 4, src/sim/pulse.ts)
  /** The Pulse is ready from this tick on. */
  pulseReadyTick: number;
  /** Pulses fired this run. */
  pulseCount: number;
  /** The tag of the last pulse (its cooldown, for the HUD ring); 'none': the plain pulse or none yet (no null in the World). */
  pulseLastTag: Tag | 'none';
  /** Lab node autoPulse: the sim fires the pulse by itself. */
  pulseAuto: boolean;
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
  // boot
  /** Run-start boot sector pick before the wave-1 protocol pick (default true; needs protocols). */
  boot?: boolean;
  /** Tags of the equipped cards (M5); each counts 1 toward its set. */
  cardTags?: readonly string[];
  /** Lab node: 4 cards per offer instead of 3. */
  extraPerkChoice?: boolean;
  /** Lab node: free reroll(s) per run. */
  freeReroll?: boolean;
  /** Lab node: picks every N waves after the listed ones (default: data schedule). */
  pickEvery?: number;
  /** Lab node: × weight of Rare/Epic in offers. */
  rareMul?: number;
  /** Lab nodes: extra max levels per stat. */
  maxLevelBonus?: Partial<Record<StatId, number>>;
  /** Lab node: Energy at run start. */
  startEnergy?: number;
  /** Equipped cards (M5), effects already resolved for their star level by the meta layer. */
  cards?: readonly CardInRun[];
  /** Workshop mastery (meta): × on a stat's value for the whole run, resolved by the meta layer. */
  workshopMul?: Partial<Record<StatId, number>>;
  /** pulse: lab node autoPulse. */
  autoPulse?: boolean;
  /** Carried with the run for the meta layer (Bits multiplier, Fast Boot, Second Wind); the sim ignores it. */
  metaBonus?: { bitsMul: number; fastBootWaves: number; secondWind: number };
}

/** The effective stats of this world right now (derived; never stored in the World). */
export function worldStats(w: World, data: GameData): CoreStats {
  return effectiveStats(data, { workshop: w.workshop, run: w.levels, mods: w.mods });
}

export interface CardInRun {
  id: string;
  effects: Effect[];
}

export interface LabParams {
  /** 0 = the data schedule. */
  pickEvery: number;
  rareMul: number;
  /** Extra max levels per stat (only stats with a bonus are listed, in STAT_IDS order). */
  maxBonus: Partial<Record<StatId, number>>;
}

function canonicalBonus(b: Partial<Record<StatId, number>> | undefined): Partial<Record<StatId, number>> {
  const out: Partial<Record<StatId, number>> = {};
  for (const id of STAT_IDS) {
    const v = b?.[id];
    if (v !== undefined && Number.isInteger(v) && v > 0) out[id] = v;
  }
  return out;
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
    v: 9,
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
    fusionTiers: {},
    latticeSum: 0,
    latticeTicks: 0,
    geneAcc: blankGenome(),
    geneTicks: 0,
    tagCountsNow: blankGenome(),
    frost: {},
    blueprint: [],
    marks: { killed: 0, jackpots: 0, plan: [] },
    fusionBest: {},
    offer: [],
    bootOffer: [], // boot
    boot: '', // boot
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
    energy: opts.startEnergy !== undefined && Number.isFinite(opts.startEnergy) && opts.startEnergy > 0 ? clampValue(opts.startEnergy) : 0,
    bits: 0,
    keys: 0,
    kills: 0,
    dead: false,
    revived: false,
    bitsBonus: 0,
    lab: {
      pickEvery: opts.pickEvery !== undefined && Number.isInteger(opts.pickEvery) && opts.pickEvery > 0 ? opts.pickEvery : 0,
      rareMul: opts.rareMul !== undefined && Number.isFinite(opts.rareMul) && opts.rareMul > 0 ? opts.rareMul : 1,
      maxBonus: canonicalBonus(opts.maxLevelBonus),
    },
    cards: (opts.cards ?? []).map((c, i) => {
      c.effects.forEach((e, j) => validateEffect(e, `cards[${i}].effects[${j}]`));
      return { id: String(c.id), effects: c.effects.map((e) => ({ ...e })) };
    }),
    shield: 0,
    crystal: [],
    terrain: initialTerrain(data),
    genome: blankGenome(),
    nests: [],
    structs: [],
    wallR: 0,
    // pulse
    pulseReadyTick: 0,
    pulseCount: 0,
    pulseLastTag: 'none',
    pulseAuto: opts.autoPulse === true,
    rng: { spawn: createStream(opts.seed, 'spawn'), combat: createStream(opts.seed, 'combat'), upgrades: createStream(opts.seed, 'upgrades') },
  };
  // Workshop mastery multipliers: one `mul` modifier per stat, canonical order.
  for (const id of STAT_IDS) {
    const x = opts.workshopMul?.[id];
    if (x !== undefined && Number.isFinite(x) && x > 1) w.mods.push({ stat: id, op: 'mul', value: clampValue(x), source: 'mastery' });
  }
  // Card stat effects become modifiers once; their periodic effects get timers (first fire one period in).
  for (const c of w.cards) {
    appendStatMods(w, c.effects, 1, `card:${c.id}`);
    c.effects.forEach((e, i) => {
      if (e.type === 'periodic' && e.action !== 'immunity') w.timers[`card:${c.id}:${i}`] = { next: Math.round(e.everySec * data.config.tickHz), until: -1 };
    });
  }
  // Card tags may already complete a set; then the wave-1 pick opens the run (spec §2.4, B1).
  initProtocols(w, data, opts.boot !== false);
  w.core.hp = worldStats(w, data).health;
  return w;
}
