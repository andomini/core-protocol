// Cards (spec §3.4): packs bought with Keys (pity: an Epic every N packs), a free pack every few hours
// (rewarded), a starter pack after the first run; duplicates raise ★1–★5; equipped cards (slots from labs)
// reach the sim as resolved effects and count toward their tag's set.
import cardsJson from '../data/cards.json';
import { type Effect, RARITIES, type Rarity, TAGS, type Tag, validateEffect } from '../sim/perkData';
import type { CardInRun } from '../sim/state';
import { labEffects } from './labs';
import type { MetaData } from './metaData';
import type { MetaState } from './state';

export type MetaCardKind = 'startEnergy' | 'bitsMul' | 'fastBoot' | 'secondWind';

export interface CardDef {
  id: string;
  name: string;
  tag: Tag | null;
  rarity: Rarity;
  /** A sim effect template (the star value goes into `param`), or a meta-layer effect. */
  effect: (Partial<Effect> & { type: Effect['type'] }) | { type: 'meta'; kind: MetaCardKind };
  param: string;
  values: number[];
}

export interface CardsData {
  pack: { price: number; size: number; rarityWeights: Record<Rarity, number>; pityEvery: number; freeEveryHours: number };
  /** Copies needed for ★1…★5. */
  stars: number[];
  baseSlots: number;
  cards: CardDef[];
}

function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`cards data: ${msg}`);
}

export function validateCards(d: CardsData): CardsData {
  check(d.stars.length === 5 && d.stars.every((s, i) => i === 0 || s > d.stars[i - 1]!), 'stars must be 5 increasing thresholds');
  const ids = new Set<string>();
  for (const c of d.cards) {
    check(!ids.has(c.id), `duplicate card ${c.id}`);
    ids.add(c.id);
    check((RARITIES as readonly string[]).includes(c.rarity), `${c.id}: bad rarity`);
    check(c.tag === null || (TAGS as readonly string[]).includes(c.tag), `${c.id}: bad tag`);
    check(c.values.length === 5 && c.values.every((v) => Number.isFinite(v)), `${c.id}: needs 5 finite values`);
    if (c.effect.type !== 'meta') for (let s = 1; s <= 5; s++) validateEffect(simEffect(c, s)!, `cards.${c.id}★${s}`);
  }
  return d;
}

/** The sim effect of `c` at `stars` (null for meta-layer cards). */
export function simEffect(c: CardDef, stars: number): Effect | null {
  if (c.effect.type === 'meta') return null;
  return { ...c.effect, [c.param]: c.values[Math.max(1, Math.min(5, stars)) - 1]! } as Effect;
}

export const CARDS: CardsData = validateCards(cardsJson as unknown as CardsData);

export function cardDef(id: string): CardDef | undefined {
  return CARDS.cards.find((c) => c.id === id);
}

/** ★ level for a number of copies (0 = not owned). */
export function starsFor(copies: number): number {
  let s = 0;
  for (const t of CARDS.stars) if (copies >= t) s++;
  return s;
}

export function cardSlots(m: MetaState, md: MetaData): number {
  return labEffects(m, md).cardSlots;
}

export interface PackCard {
  id: string;
  isNew: boolean;
  /** The ★ level went up with this copy. */
  starUp: boolean;
}

function add(m: MetaState, id: string): PackCard {
  const before = m.cards[id] ?? 0;
  m.cards[id] = before + 1;
  return { id, isNew: before === 0, starUp: before > 0 && starsFor(before + 1) > starsFor(before) };
}

function draw(rnd: () => number, rarity: Rarity | null, filter: (c: CardDef) => boolean = () => true): CardDef {
  let r = rarity;
  if (r === null) {
    const w = CARDS.pack.rarityWeights;
    const total = w.common + w.rare + w.epic;
    let roll = rnd() * total;
    r = 'common';
    for (const k of RARITIES) {
      roll -= w[k];
      if (roll < 0) {
        r = k;
        break;
      }
    }
  }
  const pool = CARDS.cards.filter((c) => c.rarity === r && filter(c));
  return pool[Math.floor(rnd() * pool.length)]!;
}

function rollPack(m: MetaState, rnd: () => number): PackCard[] {
  const defs: CardDef[] = [];
  for (let i = 0; i < CARDS.pack.size; i++) defs.push(draw(rnd, null));
  if (!defs.some((d) => d.rarity === 'epic') && m.packsSinceEpic + 1 >= CARDS.pack.pityEvery) defs[defs.length - 1] = draw(rnd, 'epic');
  m.packsSinceEpic = defs.some((d) => d.rarity === 'epic') ? 0 : m.packsSinceEpic + 1;
  m.packs += 1;
  return defs.map((d) => add(m, d.id));
}

/** Opens a pack for Keys; null when the player cannot afford it. */
export function openPack(m: MetaState, rnd: () => number = Math.random): PackCard[] | null {
  if (m.keys < CARDS.pack.price) return null;
  m.keys -= CARDS.pack.price;
  return rollPack(m, rnd);
}

export function canFreePack(m: MetaState, now: number): boolean {
  return m.freePackAt <= 0 || now - m.freePackAt >= CARDS.pack.freeEveryHours * 3600_000;
}

/** The rewarded free pack (call after the ad completed). */
export function claimFreePack(m: MetaState, rnd: () => number, now: number): PackCard[] | null {
  if (!canFreePack(m, now)) return null;
  m.freePackAt = now;
  return rollPack(m, rnd);
}

/** After the first run: two tagged Common cards of different tags (spec §3.4). Once. */
export function grantStarter(m: MetaState, rnd: () => number = Math.random): PackCard[] | null {
  if (m.starterGiven) return null;
  m.starterGiven = true;
  const a = draw(rnd, 'common', (c) => c.tag !== null);
  const b = draw(rnd, 'common', (c) => c.tag !== null && c.tag !== a.tag);
  const out = [add(m, a.id), add(m, b.id)];
  for (const p of out) if (m.loadout.length < CARDS.baseSlots && !m.loadout.includes(p.id)) m.loadout.push(p.id);
  return out;
}

export function equip(m: MetaState, md: MetaData, id: string): boolean {
  if (!(m.cards[id]! > 0) || m.loadout.includes(id) || m.loadout.length >= cardSlots(m, md)) return false;
  m.loadout.push(id);
  return true;
}

export function unequip(m: MetaState, id: string): void {
  m.loadout = m.loadout.filter((x) => x !== id);
}

/** Equipped cards as the sim sees them (resolved effects) plus their tags. */
export function loadoutForRun(m: MetaState, md: MetaData): { cards: CardInRun[]; cardTags: Tag[] } {
  const slots = cardSlots(m, md);
  const cards: CardInRun[] = [];
  const cardTags: Tag[] = [];
  for (const id of m.loadout.slice(0, slots)) {
    const c = cardDef(id);
    const stars = starsFor(m.cards[id] ?? 0);
    if (!c || stars === 0) continue;
    if (c.tag) cardTags.push(c.tag);
    const e = simEffect(c, stars);
    if (e) cards.push({ id, effects: [e] });
  }
  return { cards, cardTags };
}

export interface LoadoutBonus {
  startEnergy: number;
  bitsMul: number;
  /** Waves played at ×4 speed (Fast Boot). */
  fastBootWaves: number;
  /** Second Wind: a free revive with this share of HP (0 = none). */
  secondWind: number;
}

/** Meta-layer effects of the equipped cards. */
export function loadoutBonus(m: MetaState, md?: MetaData): LoadoutBonus {
  const b: LoadoutBonus = { startEnergy: 0, bitsMul: 1, fastBootWaves: 0, secondWind: 0 };
  const ids = md ? m.loadout.slice(0, cardSlots(m, md)) : m.loadout;
  for (const id of ids) {
    const c = cardDef(id);
    const stars = starsFor(m.cards[id] ?? 0);
    if (!c || stars === 0 || c.effect.type !== 'meta') continue;
    const v = c.values[stars - 1]!;
    if (c.effect.kind === 'startEnergy') b.startEnergy += v;
    else if (c.effect.kind === 'bitsMul') b.bitsMul *= v;
    else if (c.effect.kind === 'fastBoot') b.fastBootWaves = Math.max(b.fastBootWaves, v);
    else b.secondWind = Math.max(b.secondWind, v);
  }
  return b;
}
