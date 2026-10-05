// The persistent player state (meta save). Plain JSON; validated on load.
import { type GameData, STAT_IDS, type StatId } from '../sim/data';
import { cardDef } from './cards';
import { labNode, type MetaData } from './metaData';

export interface Settings {
  sound: boolean;
  music: boolean;
  reduceMotion: boolean;
}

export interface MetaState {
  bits: number;
  keys: number;
  /** Permanent workshop levels per stat. */
  workshop: Partial<Record<StatId, number>>;
  /** Owned lab node ids. */
  labs: string[];
  /** Highest unlocked tier (1-based). */
  tierUnlocked: number;
  /** Best wave per tier ("1" → 27). */
  best: Record<string, number>;
  /** Claimed milestones "tier:wave". */
  milestones: string[];
  runs: number;
  /** Epoch ms when the game was last seen (offline income). */
  lastSeen: number;
  /** The first run has ended (spec §3.4: the Cards tab and loadout appear after it). */
  firstRunDone: boolean;
  /** Tier the player last chose. */
  tier: number;
  /** Card copies owned (id → count). */
  cards: Record<string, number>;
  /** Equipped card ids (≤ slots). */
  loadout: string[];
  /** Loadout presets (lab node). */
  presets: string[][];
  packs: number;
  packsSinceEpic: number;
  /** Epoch ms of the last free (rewarded) pack. */
  freePackAt: number;
  starterGiven: boolean;
  settings: Settings;
}

export function defaultMeta(): MetaState {
  return {
    bits: 0,
    keys: 0,
    workshop: {},
    labs: [],
    tierUnlocked: 1,
    best: {},
    milestones: [],
    runs: 0,
    lastSeen: 0,
    firstRunDone: false,
    tier: 1,
    cards: {},
    loadout: [],
    presets: [[], [], []],
    packs: 0,
    packsSinceEpic: 0,
    freePackAt: 0,
    starterGiven: false,
    settings: { sound: true, music: true, reduceMotion: false },
  };
}

const num = (x: unknown, d: number): number => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : d);
const int = (x: unknown, d: number): number => Math.floor(num(x, d));
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Normalises a loaded blob into a valid MetaState (throws if it is not an object at all). */
export function validateMeta(raw: unknown, data: GameData, md: MetaData): MetaState {
  if (!isObj(raw)) throw new Error('meta: not an object');
  const m = defaultMeta();
  m.bits = num(raw.bits, 0);
  m.keys = int(raw.keys, 0);
  if (isObj(raw.workshop)) {
    for (const id of STAT_IDS) {
      const v = int(raw.workshop[id], 0);
      if (v > 0) m.workshop[id] = v;
    }
  }
  if (Array.isArray(raw.labs)) m.labs = [...new Set(raw.labs.filter((x): x is string => typeof x === 'string' && labNode(md, x) !== undefined))];
  m.tierUnlocked = Math.max(1, Math.min(data.tiers.length, int(raw.tierUnlocked, 1)));
  m.tier = Math.max(1, Math.min(m.tierUnlocked, int(raw.tier, 1)));
  if (isObj(raw.best)) for (const [k, v] of Object.entries(raw.best)) if (/^\d+$/.test(k)) m.best[k] = int(v, 0);
  if (Array.isArray(raw.milestones)) m.milestones = raw.milestones.filter((x): x is string => typeof x === 'string' && /^\d+:\d+$/.test(x));
  m.runs = int(raw.runs, 0);
  m.lastSeen = num(raw.lastSeen, 0);
  m.firstRunDone = raw.firstRunDone === true;
  if (isObj(raw.cards)) for (const [k, v] of Object.entries(raw.cards)) if (cardDef(k)) m.cards[k] = int(v, 0);
  if (Array.isArray(raw.loadout)) m.loadout = [...new Set(raw.loadout.filter((x): x is string => typeof x === 'string' && (m.cards[x] ?? 0) > 0))];
  const presets = raw.presets;
  if (Array.isArray(presets)) {
    m.presets = [0, 1, 2].map((i) => {
      const p: unknown = presets[i];
      return Array.isArray(p) ? p.filter((x): x is string => typeof x === 'string' && cardDef(x) !== undefined) : [];
    });
  }
  m.packs = int(raw.packs, 0);
  m.packsSinceEpic = int(raw.packsSinceEpic, 0);
  m.freePackAt = num(raw.freePackAt, 0);
  m.starterGiven = raw.starterGiven === true;
  if (isObj(raw.settings)) {
    m.settings.sound = raw.settings.sound !== false;
    m.settings.music = raw.settings.music !== false;
    m.settings.reduceMotion = raw.settings.reduceMotion === true;
  }
  return m;
}
