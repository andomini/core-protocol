import { describe, expect, it } from 'vitest';
import { DEFAULT_DATA } from '../src/sim/data';
import { makeLayout, type Rect } from '../src/ui/layout';
import { panelLayout, ROWS } from '../src/ui/panelLayout';

const within = (a: Rect, b: Rect) => a.x >= b.x - 1e-9 && a.y >= b.y - 1e-9 && a.x + a.w <= b.x + b.w + 1e-9 && a.y + a.h <= b.y + b.h + 1e-9;
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const CASES = [
  { name: 'portrait 720×1280', L: makeLayout('portrait', DEFAULT_DATA), twoLine: false },
  { name: 'portrait 390×844', L: makeLayout('portrait', DEFAULT_DATA, 844 / 390), twoLine: true },
  { name: 'landscape', L: makeLayout('landscape', DEFAULT_DATA), twoLine: true },
];

describe('upgrade panel layout', () => {
  for (const { name, L, twoLine } of CASES) {
    it(`${name}: tabs, toggle and ${ROWS} rows sit inside the panel without overlapping`, () => {
      const g = panelLayout(L);
      const boxes = [...g.tabs, g.amount, ...g.rows.map((r) => r.rect)];
      expect(g.tabs).toHaveLength(3);
      expect(g.rows).toHaveLength(ROWS);
      for (const b of boxes) expect(within(b, L.panel), JSON.stringify(b)).toBe(true);
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i]!, boxes[j]!)).toBe(false);
      for (const r of g.rows) expect(within(r.price, r.rect)).toBe(true);
    });

    it(`${name}: every font ≥ the layout minimum (${L.minFont} px) and rows fit their text`, () => {
      const g = panelLayout(L);
      for (const f of Object.values(g.fonts)) expect(f).toBeGreaterThanOrEqual(L.minFont);
      expect(g.twoLine).toBe(twoLine);
      const rowH = g.rows[0]!.rect.h;
      expect(rowH).toBeGreaterThanOrEqual(g.twoLine ? g.fonts.name + g.fonts.value + 8 : g.fonts.name + 12);
      // Tap targets: at least ~44 CSS px on a 390-wide phone (720 logical → ×0.54).
      if (L.o === 'portrait') expect(rowH * (390 / 720)).toBeGreaterThanOrEqual(28);
    });
  }
});
