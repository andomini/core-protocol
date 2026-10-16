import { describe, expect, it } from 'vitest';
import { clampPan, freshZoom, isZoomed, panBy, ZOOM_MAX, zoomAt, type ZoomFrame } from '../src/render/fieldZoom';

const f: ZoomFrame = { arena: { x: 0, y: 136, w: 720, h: 704 }, cx: 360, cy: 488 };

/** Screen position of a field point that sits at (sx, sy) in the unzoomed view. */
function screenOf(s: ReturnType<typeof freshZoom>, sx: number, sy: number): [number, number] {
  return [f.cx + s.panX + (sx - f.cx) * s.z, f.cy + s.panY + (sy - f.cy) * s.z];
}

describe('field zoom', () => {
  it('keeps the point under the cursor in place', () => {
    const s = freshZoom();
    zoomAt(s, f, 2, 400, 500);
    const [x, y] = screenOf(s, 400, 500);
    expect(x).toBeCloseTo(400);
    expect(y).toBeCloseTo(500);
    expect(isZoomed(s)).toBe(true);
  });

  it('clamps the zoom and never pans past the unzoomed view', () => {
    const s = freshZoom();
    zoomAt(s, f, 100, 0, 136);
    expect(s.z).toBe(ZOOM_MAX);
    for (const [dx, dy] of [[1e4, 1e4], [-1e4, -1e4], [1e4, -1e4]] as const) {
      panBy(s, f, dx, dy);
      const [l, t] = screenOf(s, f.arena.x, f.arena.y);
      const [r, b] = screenOf(s, f.arena.x + f.arena.w, f.arena.y + f.arena.h);
      expect(l).toBeLessThanOrEqual(f.arena.x + 1e-9);
      expect(t).toBeLessThanOrEqual(f.arena.y + 1e-9);
      expect(r).toBeGreaterThanOrEqual(f.arena.x + f.arena.w - 1e-9);
      expect(b).toBeGreaterThanOrEqual(f.arena.y + f.arena.h - 1e-9);
    }
  });

  it('zooming back out to 1 recentres the core', () => {
    const s = freshZoom();
    zoomAt(s, f, 2.5, 100, 200);
    panBy(s, f, 50, -80);
    zoomAt(s, f, 0.01, 700, 800);
    expect(s.z).toBe(1);
    expect(s.panX).toBe(0);
    expect(s.panY).toBe(0);
    expect(isZoomed(s)).toBe(false);
    clampPan(s, f);
    expect(s.panX).toBe(0);
  });
});
