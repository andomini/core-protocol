// Screen layout (pure, no Phaser): chosen once at load from the window aspect.
// Portrait 720 wide × 1280–1560 tall (adapts to tall phones): HUD strip on top, arena ≈55 % of the
// height, upgrade panel at the bottom. Extra height beyond 1280 goes mostly to the panel; the arena may
// grow only a little (PORTRAIT_ARENA_EXTRA_MAX) because a taller arena zooms the world in, which pushes
// side spawns further off-screen and the Range ring towards the side edges.
// Landscape 1280×720: arena on the left 60 % at full height, HUD + upgrade panel in the right column.
// The world (sim px, core at 0,0) maps onto the arena centre with a uniform scale.

import type { GameData } from '../sim/data';

export type Orientation = 'portrait' | 'landscape';
export const ORIENTATIONS: readonly Orientation[] = ['portrait', 'landscape'];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  o: Orientation;
  /** Logical canvas size. */
  w: number;
  h: number;
  hud: Rect;
  arena: Rect;
  /** The upgrade panel. */
  panel: Rect;
  /** Screen position of the core (world 0,0). */
  cx: number;
  cy: number;
  /** Screen px per world px. */
  scale: number;
  /** Minimum text size in logical px. */
  minFont: number;
}

/** The spawn ring sits this many screen px beyond the arena's far (long-axis) edge, so axis-aligned
 *  spawns start off-screen on every side; only the corners can show a fresh spawn (it fades in). */
export const SPAWN_MARGIN = 24;

const PORTRAIT_HUD_H = 136;
const PORTRAIT_ARENA_H = 704; // 55 % of 1280
export const PORTRAIT_W = 720;
export const PORTRAIT_MIN_H = 1280;
export const PORTRAIT_MAX_H = 1560;
/** Share of the extra portrait height given to the arena, and its cap (spawn visibility ≤ 1 s, max-level
 *  Range ring inside the 720-px width; see tests/layout.test.ts and tests/spawnVisibility.test.ts). */
const PORTRAIT_ARENA_SHARE = 0.3;
const PORTRAIT_ARENA_EXTRA_MAX = 72;
const LANDSCAPE_ARENA_W = 768; // 60 % of 1280
const LANDSCAPE_HUD_H = 208;

export function chooseOrientation(width: number, height: number): Orientation {
  return width > height ? 'landscape' : 'portrait';
}

/** Portrait logical height for a window aspect (height / width): fills tall phones instead of letterboxing. */
export function portraitHeight(aspect: number): number {
  if (!Number.isFinite(aspect)) return PORTRAIT_MIN_H;
  return Math.max(PORTRAIT_MIN_H, Math.min(PORTRAIT_MAX_H, Math.round(PORTRAIT_W * aspect)));
}

/** `aspect` = window height / width; used only in portrait (landscape is always 1280×720). */
export function makeLayout(o: Orientation, data: GameData, aspect = PORTRAIT_MIN_H / PORTRAIT_W): Layout {
  let w: number, h: number, hud: Rect, arena: Rect, panel: Rect, minFont: number;
  if (o === 'portrait') {
    w = PORTRAIT_W;
    h = portraitHeight(aspect);
    minFont = 28;
    const extra = h - PORTRAIT_MIN_H;
    const arenaH = PORTRAIT_ARENA_H + Math.min(PORTRAIT_ARENA_EXTRA_MAX, Math.round(extra * PORTRAIT_ARENA_SHARE));
    hud = { x: 0, y: 0, w, h: PORTRAIT_HUD_H };
    arena = { x: 0, y: PORTRAIT_HUD_H, w, h: arenaH };
    const panelY = PORTRAIT_HUD_H + arenaH;
    panel = { x: 0, y: panelY, w, h: h - panelY };
  } else {
    w = 1280;
    h = 720;
    minFont = 16;
    arena = { x: 0, y: 0, w: LANDSCAPE_ARENA_W, h };
    hud = { x: LANDSCAPE_ARENA_W, y: 0, w: w - LANDSCAPE_ARENA_W, h: LANDSCAPE_HUD_H };
    panel = { x: LANDSCAPE_ARENA_W, y: LANDSCAPE_HUD_H, w: w - LANDSCAPE_ARENA_W, h: h - LANDSCAPE_HUD_H };
  }
  const halfLong = Math.max(arena.w, arena.h) / 2;
  const scale = (halfLong + SPAWN_MARGIN) / data.config.spawnRadius;
  return { o, w, h, hud, arena, panel, cx: arena.x + arena.w / 2, cy: arena.y + arena.h / 2, scale, minFont };
}

/** World point (sim px) → screen px. */
export function worldToScreen(L: Layout, x: number, y: number): [number, number] {
  return [L.cx + x * L.scale, L.cy + y * L.scale];
}

/** True when a circle (screen px) touches or overlaps the rect. */
export function circleInRect(r: Rect, x: number, y: number, radius: number): boolean {
  const nx = Math.max(r.x, Math.min(x, r.x + r.w));
  const ny = Math.max(r.y, Math.min(y, r.y + r.h));
  const dx = x - nx;
  const dy = y - ny;
  return dx * dx + dy * dy <= radius * radius;
}
