import { describe, expect, it } from 'vitest';
import { DEFAULT_DATA } from '../src/sim/data';
import { makeLayout, ORIENTATIONS, portraitHeight, type Rect } from '../src/ui/layout';
import { pickGeometry } from '../src/ui/pickLayout';

const inside = (r: Rect, w: number, h: number) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('pick overlay geometry', () => {
  for (const o of ORIENTATIONS) {
    for (const aspect of o === 'portrait' ? [1280 / 720, 844 / 390] : [720 / 1280]) {
      for (const n of [3, 4]) {
        it(`${o} ${aspect.toFixed(2)} with ${n} cards: everything on screen, nothing overlaps, text ≥ min`, () => {
          const L = makeLayout(o, DEFAULT_DATA, o === 'portrait' ? portraitHeight(aspect) / 720 : aspect);
          const g = pickGeometry(L, n);
          const rects = [...g.cards, g.reroll, g.boost];
          for (const r of rects) expect(inside(r, L.w, L.h), JSON.stringify(r)).toBe(true);
          for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i]!, rects[j]!)).toBe(false);
          expect(g.headerY).toBeLessThan(g.cards[0]!.y);
          for (const s of [g.titleSize, g.subSize, g.nameSize, g.lineSize, g.smallSize]) expect(s).toBeGreaterThanOrEqual(L.minFont);
        });
      }
    }
  }
});
