// Geometry of the protocol pick overlay (logical px). Portrait: horizontal card strips stacked under the
// header; landscape: cards side by side. Buttons (REROLL, BOOST) sit under the cards. The boot pick
// (bootGeometry) has larger cards and no buttons.

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

/** Boot pick (uniqueness plan item 1): `n` large cards with a mini-crystal each; no REROLL / BOOST. */
export interface BootGeometry {
  headerY: number;
  subY: number;
  titleSize: number;
  subSize: number;
  cards: Rect[];
  nameSize: number;
  lineSize: number;
  smallSize: number;
  /** Mini-crystal hex size (logical px) and its centre offset inside a card. */
  hexSize: number;
  crystal: { dx: number; dy: number };
  horizontal: boolean;
}

export function bootGeometry(L: Layout, n: number): BootGeometry {
  if (L.o === 'portrait') {
    const cw = 680;
    const gap = 26;
    const header = 170;
    const avail = L.h - header - 40;
    const ch = Math.min(330, Math.floor((avail - (n - 1) * gap) / n));
    const total = n * ch + (n - 1) * gap;
    const y0 = header + Math.max(10, (avail - total) / 2);
    const cards: Rect[] = [];
    for (let i = 0; i < n; i++) cards.push({ x: (L.w - cw) / 2, y: y0 + i * (ch + gap), w: cw, h: ch });
    return {
      headerY: Math.max(70, y0 - 120),
      subY: Math.max(122, y0 - 60),
      titleSize: 46,
      subSize: 28,
      cards,
      nameSize: 38,
      lineSize: 28,
      smallSize: 28,
      hexSize: Math.min(15, Math.floor(ch / 20)),
      crystal: { dx: 112, dy: ch / 2 },
      horizontal: true,
    };
  }
  const gap = 26;
  const cw = Math.min(380, Math.floor((L.w - 80 - (n - 1) * gap) / n));
  const ch = 500;
  const total = n * cw + (n - 1) * gap;
  const x0 = (L.w - total) / 2;
  const y0 = 128;
  const cards: Rect[] = [];
  for (let i = 0; i < n; i++) cards.push({ x: x0 + i * (cw + gap), y: y0, w: cw, h: ch });
  return {
    headerY: 50,
    subY: 92,
    titleSize: 36,
    subSize: 18,
    cards,
    nameSize: 28,
    lineSize: 19,
    smallSize: 16,
    hexSize: 14,
    crystal: { dx: cw / 2, dy: 100 },
    horizontal: false,
  };
}
