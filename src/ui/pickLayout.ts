// Geometry of the protocol pick overlay (logical px). Portrait: horizontal card strips stacked under the
// header; landscape: cards side by side. Buttons (REROLL, BOOST) sit under the cards.

import type { Layout, Rect } from './layout';

export interface PickGeometry {
  headerY: number;
  subY: number;
  titleSize: number;
  subSize: number;
  cards: Rect[];
  reroll: Rect;
  boost: Rect;
  /** Text sizes inside a card. */
  nameSize: number;
  lineSize: number;
  smallSize: number;
  /** Card content arrangement. */
  horizontal: boolean;
}

export function pickGeometry(L: Layout, n: number): PickGeometry {
  if (L.o === 'portrait') {
    const cw = 660;
    const ch = n >= 4 ? 196 : 224;
    const gap = n >= 4 ? 18 : 24;
    const btnH = 96;
    const total = n * ch + (n - 1) * gap;
    const header = 150;
    const avail = L.h - header - btnH - 60;
    const y0 = header + Math.max(20, (avail - total) / 2);
    const cards: Rect[] = [];
    for (let i = 0; i < n; i++) cards.push({ x: (L.w - cw) / 2, y: y0 + i * (ch + gap), w: cw, h: ch });
    const by = y0 + total + Math.max(28, Math.min(56, (avail - total) / 2));
    const bw = (cw - 24) / 2;
    return {
      headerY: Math.max(70, y0 - 110),
      subY: Math.max(118, y0 - 56),
      titleSize: 46,
      subSize: 28,
      cards,
      reroll: { x: (L.w - cw) / 2, y: by, w: bw, h: btnH },
      boost: { x: (L.w - cw) / 2 + bw + 24, y: by, w: bw, h: btnH },
      nameSize: 36,
      lineSize: 28,
      smallSize: 28,
      horizontal: true,
    };
  }
  const gap = 22;
  const cw = n >= 4 ? 280 : 340;
  const ch = 380;
  const total = n * cw + (n - 1) * gap;
  const x0 = (L.w - total) / 2;
  const y0 = 120;
  const cards: Rect[] = [];
  for (let i = 0; i < n; i++) cards.push({ x: x0 + i * (cw + gap), y: y0, w: cw, h: ch });
  const bw = 300;
  const by = y0 + ch + 34;
  return {
    headerY: 48,
    subY: 86,
    titleSize: 36,
    subSize: 18,
    cards,
    reroll: { x: L.w / 2 - bw - 12, y: by, w: bw, h: 64 },
    boost: { x: L.w / 2 + 12, y: by, w: bw, h: 64 },
    nameSize: 26,
    lineSize: 19,
    smallSize: 16,
    horizontal: false,
  };
}
