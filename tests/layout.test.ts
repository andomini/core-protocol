import { describe, expect, it } from 'vitest';
import { DEFAULT_DATA } from '../src/sim/data';
import { chooseOrientation, circleInRect, makeLayout, ORIENTATIONS, type Rect, worldToScreen } from '../src/ui/layout';

const area = (r: Rect): number => r.w * r.h;
const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (r: Rect, w: number, h: number): boolean => r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;

describe('layout', () => {
  it('picks the orientation from the window aspect', () => {
    expect(chooseOrientation(390, 844)).toBe('portrait');
    expect(chooseOrientation(1280, 720)).toBe('landscape');
    expect(chooseOrientation(907, 510)).toBe('landscape');
    expect(chooseOrientation(800, 800)).toBe('portrait');
  });

  it('portrait is 720×1280 with min text 28; landscape is 1280×720 with min text 16', () => {
    const p = makeLayout('portrait', DEFAULT_DATA);
    const l = makeLayout('landscape', DEFAULT_DATA);
    expect([p.w, p.h, p.minFont]).toEqual([720, 1280, 28]);
    expect([l.w, l.h, l.minFont]).toEqual([1280, 720, 16]);
  });

  for (const o of ORIENTATIONS) {
    it(`${o}: HUD, arena and panel tile the screen without overlapping`, () => {
      const L = makeLayout(o, DEFAULT_DATA);
      const rects = [L.hud, L.arena, L.panel];
      for (const r of rects) expect(inside(r, L.w, L.h), JSON.stringify(r)).toBe(true);
      expect(overlaps(L.hud, L.arena)).toBe(false);
      expect(overlaps(L.hud, L.panel)).toBe(false);
      expect(overlaps(L.arena, L.panel)).toBe(false);
      expect(rects.reduce((s, r) => s + area(r), 0)).toBe(L.w * L.h);
    });

    it(`${o}: the core sits at the arena centre`, () => {
      const L = makeLayout(o, DEFAULT_DATA);
      expect(worldToScreen(L, 0, 0)).toEqual([L.arena.x + L.arena.w / 2, L.arena.y + L.arena.h / 2]);
      const [x, y] = worldToScreen(L, 100, -50);
      expect(x - L.cx).toBeCloseTo(100 * L.scale, 9);
      expect(y - L.cy).toBeCloseTo(-50 * L.scale, 9);
    });

    it(`${o}: the core's range circle is fully inside the arena`, () => {
      const L = makeLayout(o, DEFAULT_DATA);
      const r = DEFAULT_DATA.core.range * L.scale;
      expect(r).toBeLessThan(Math.min(L.arena.w, L.arena.h) / 2);
    });

    it(`${o}: the world is not shrunk to fit the spawn ring (range fills the arena, enemies stay readable)`, () => {
      const L = makeLayout(o, DEFAULT_DATA);
      expect(DEFAULT_DATA.core.range * L.scale).toBeGreaterThan(0.75 * (Math.min(L.arena.w, L.arena.h) / 2));
      expect(DEFAULT_DATA.enemies.basic.radius * L.scale).toBeGreaterThanOrEqual(12);
    });
  }

  it('portrait: the arena takes ≈55 % of the height under the HUD, the panel is at the bottom', () => {
    const L = makeLayout('portrait', DEFAULT_DATA);
    expect(L.arena.w).toBe(720);
    expect(L.arena.h / L.h).toBeGreaterThan(0.5);
    expect(L.arena.h / L.h).toBeLessThan(0.6);
    expect(L.hud.y).toBe(0);
    expect(L.panel.y + L.panel.h).toBe(L.h);
  });

  it('landscape: the arena takes the left 60 % at full height, the right column is HUD + panel', () => {
    const L = makeLayout('landscape', DEFAULT_DATA);
    expect(L.arena).toEqual({ x: 0, y: 0, w: 768, h: 720 });
    expect(L.hud.x).toBe(768);
    expect(L.panel.x).toBe(768);
    expect(L.panel.y + L.panel.h).toBe(L.h);
  });

  it('circleInRect detects touching, inside and outside circles', () => {
    const r = { x: 0, y: 0, w: 100, h: 100 };
    expect(circleInRect(r, 50, 50, 1)).toBe(true);
    expect(circleInRect(r, -5, 50, 6)).toBe(true);
    expect(circleInRect(r, -5, 50, 4)).toBe(false);
    expect(circleInRect(r, 104, 104, 5)).toBe(false); // corner: distance √32 > 5
    expect(circleInRect(r, 103, 103, 5)).toBe(true);
  });
});
