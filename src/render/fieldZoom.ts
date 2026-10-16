// Player zoom of the battlefield (render only, no Phaser): `z` multiplies the arena's own scale (which pulls back
// as the breach widens) and `panX/panY` move the core on screen from where the unzoomed view puts it. The zoomed
// field always covers the arena rect, so panning never shows more than the unzoomed view did.
import type { Rect } from '../ui/layout';

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3;

export interface FieldZoom {
  z: number;
  /** Screen px from the core's unzoomed position (cx, cy) to where it is drawn. */
  panX: number;
  panY: number;
}

/** The unzoomed view: the arena and the core's screen position in it. */
export interface ZoomFrame {
  arena: Rect;
  cx: number;
  cy: number;
}

export function freshZoom(): FieldZoom {
  return { z: 1, panX: 0, panY: 0 };
}

/** Keep the pan inside what zoom `z` allows: the arena's zoomed image must still cover the arena on every side. */
export function clampPan(s: FieldZoom, f: ZoomFrame): void {
  const k = s.z - 1;
  const a = f.arena;
  s.panX = Math.min(k * (f.cx - a.x), Math.max(-k * (a.x + a.w - f.cx), s.panX));
  s.panY = Math.min(k * (f.cy - a.y), Math.max(-k * (a.y + a.h - f.cy), s.panY));
}

/** Zoom by `factor` about screen point (px, py): the field point under it stays put (as far as the clamp allows). */
export function zoomAt(s: FieldZoom, f: ZoomFrame, factor: number, px: number, py: number): void {
  let z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s.z * factor));
  // Snap a hair above 1 to exactly 1 (no pan), so "unzoomed" has one meaning everywhere.
  if (z <= ZOOM_MIN + 1e-3) z = ZOOM_MIN;
  const r = z / s.z;
  s.panX = px - (px - (f.cx + s.panX)) * r - f.cx;
  s.panY = py - (py - (f.cy + s.panY)) * r - f.cy;
  s.z = z;
  clampPan(s, f);
}

/** Drag the zoomed field by (dx, dy) screen px. */
export function panBy(s: FieldZoom, f: ZoomFrame, dx: number, dy: number): void {
  s.panX += dx;
  s.panY += dy;
  clampPan(s, f);
}

/** Zoomed in at all (a hair above 1 counts as unzoomed). */
export function isZoomed(s: FieldZoom): boolean {
  return s.z > ZOOM_MIN + 1e-3;
}
