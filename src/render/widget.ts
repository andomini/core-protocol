// Desktop widget mode (`?widget=1`, any build): the game runs unattended for hours in its own window.
// The loop keeps going while the window is hidden (setTimeout loop, no Phaser/scene auto-pause), upgrades
// the stats the player marked (tap a row's glyph) are bought cheapest-first, protocols are picked like the
// greedy balance bot (tools/sim/bot.ts), a dead
// run restarts by itself, and the window title carries the live state for the desktop.
// The player can still play by hand: a pick waits `pickDelayMs` for a manual choice, A pauses auto-buy.
import widgetJson from '../data/widget.json';
import { type Command, isUnlocked, quoteFor } from '../sim/commands';
import type { GameData, StatId } from '../sim/data';
import { tagCounts } from '../sim/perks';
import type { World } from '../sim/state';

export const WIDGET = typeof location !== 'undefined' && new URLSearchParams(location.search).get('widget') === '1';
export const WIDGET_CFG = widgetJson;

const AUTO_STATS_KEY = 'core-protocol-widget-auto-stats';
const AUTOBUY_KEY = 'core-protocol-widget-autobuy';

export function autoBuyOn(): boolean {
  try {
    return localStorage.getItem(AUTOBUY_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setAutoBuy(on: boolean): void {
  try {
    localStorage.setItem(AUTOBUY_KEY, on ? '1' : '0');
  } catch {
    /* memory only */
  }
}

const SPEED_KEY = 'core-protocol-widget-speed';

/** The speed the player last chose, kept across restarts and reloads (1 if none). */
export function widgetSpeed(): number {
  try {
    return Number(localStorage.getItem(SPEED_KEY)) || 1;
  } catch {
    return 1;
  }
}

export function setWidgetSpeed(n: number): void {
  try {
    localStorage.setItem(SPEED_KEY, String(n));
  } catch {
    /* memory only */
  }
}

/** The stats the player marked for auto-buy (none by default: nothing is bought without asking). */
export function loadAutoStats(): Set<StatId> {
  try {
    const v = JSON.parse(localStorage.getItem(AUTO_STATS_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as StatId[]) : []);
  } catch {
    return new Set();
  }
}

export function saveAutoStats(s: Set<StatId>): void {
  try {
    localStorage.setItem(AUTO_STATS_KEY, JSON.stringify([...s]));
  } catch {
    /* memory only */
  }
}

/** The cheapest of the marked upgrades, bought once affordable (it saves up rather than buying a pricier one). */
export function autoBuy(w: World, data: GameData, marked: ReadonlySet<StatId>): Command | null {
  let best: StatId | null = null;
  let bestCost = Infinity;
  for (const id of marked) {
    if (!isUnlocked(w, data, id)) continue;
    const q = quoteFor(w, data, id, 1);
    if (q.levels > 0 && q.cost < bestCost) {
      bestCost = q.cost;
      best = id;
    }
  }
  if (best === null || !quoteFor(w, data, best, 1).affordable) return null;
  return { type: 'buy', stat: best, count: 1 };
}

/**
 * Calls `onNew` when the installed build changes (scripts/widget-install.sh rewrites widget-build.txt next to
 * index.html). XHR, not fetch: Chrome only lets XHR read file:// (with --allow-file-access-from-files).
 */
export function watchBuild(onNew: () => void, everyMs = 30_000): void {
  const read = (cb: (v: string) => void): void => {
    const x = new XMLHttpRequest();
    x.open('GET', `widget-build.txt?t=${Date.now()}`);
    x.onload = () => {
      const v = x.responseText.trim();
      if ((x.status === 200 || x.status === 0) && v) cb(v);
    };
    x.send();
  };
  let seen: string | null = null;
  const check = (): void =>
    read((v) => {
      if (seen === null) seen = v;
      else if (v !== seen) onNew();
    });
  check();
  setInterval(check, everyMs);
}

const RANK = { common: 0, rare: 1, epic: 2 } as const;

/** Highest rarity; among equals the card of the most-held tag (builds set bonuses). */
export function autoPick(w: World, data: GameData): number {
  const counts = tagCounts(w, data);
  let best = 0;
  let bestScore = -Infinity;
  w.offer.forEach((id, i) => {
    const p = data.perks.perks[id]!;
    const score = RANK[p.rarity] * 100 + counts[p.tag];
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}
