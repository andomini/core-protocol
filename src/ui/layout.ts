// Screen layout (pure, no Phaser): chosen once at load from the window aspect.
// Portrait 720×1280: HUD strip on top, arena ≈55 % of the height, upgrade panel at the bottom.
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
  /** Reserved for the upgrade panel (M2b). */
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
const LANDSCAPE_ARENA_W = 768; // 60 % of 1280
const LANDSCAPE_HUD_H = 208;

export function chooseOrientation(width: number, height: number): Orientation {
  return width > height ? 'landscape' : 'portrait';
}

export function makeLayout(o: Orientation, data: GameData): Layout {
  let w: number, h: number, hud: Rect, arena: Rect, panel: Rect, minFont: number;
  if (o === 'portrait') {
    w = 720;
    h = 1280;
    minFont = 28;
    hud = { x: 0, y: 0, w, h: PORTRAIT_HUD_H };
    arena = { x: 0, y: PORTRAIT_HUD_H, w, h: PORTRAIT_ARENA_H };
    const panelY = PORTRAIT_HUD_H + PORTRAIT_ARENA_H;
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
