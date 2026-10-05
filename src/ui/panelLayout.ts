// Upgrade panel geometry (pure, no Phaser): tabs + buy-amount toggle on top, then 6 stat rows.
// Rows are two-line (name + level / value → next) when tall enough, else single-line
// (name · value → next). The price box sits at the right of every row.

import type { Layout, Rect } from './layout';

export interface PanelFonts {
  tab: number;
  name: number;
  /** Second line (value → next, level) or the value column in single-line rows. */
  value: number;
  price: number;
  /** Floating "+1" ticks. */
  tick: number;
}

export interface RowGeo {
  rect: Rect;
  /** Glyph centre. */
  glyph: [number, number];
  /** Name text anchor (left, middle). */
  name: [number, number];
  /** Level text anchor (right, middle): two-line rows only. */
  level: [number, number] | null;
  /** Value → next anchor: (left, middle) in two-line rows, (right, middle) in single-line rows. */
  value: [number, number];
  price: Rect;
}

export interface PanelGeo {
  frame: Rect;
  tabs: Rect[];
  amount: Rect;
  rows: RowGeo[];
  twoLine: boolean;
  glyphSize: number;
  fonts: PanelFonts;
}

export const ROWS = 6;

export function panelLayout(L: Layout): PanelGeo {
  const portrait = L.o === 'portrait';
  const p = L.panel;
  const m = portrait ? 8 : 12;
  const frame: Rect = { x: p.x + m, y: p.y + m, w: p.w - m * 2, h: p.h - m * 2 };
  const pad = portrait ? 10 : 10;
  const gap = portrait ? 6 : 6;
  const fonts: PanelFonts = portrait
    ? { tab: 30, name: 28, value: 28, price: 30, tick: 30 }
    : { tab: 18, name: 18, value: 16, price: 18, tick: 18 };
  const headH = portrait ? 58 : 44;
  const amountW = portrait ? 150 : 96;
  const inner = { x: frame.x + pad, y: frame.y + pad, w: frame.w - pad * 2, h: frame.h - pad * 2 };
  const tabW = (inner.w - amountW - gap * 3) / 3;
  const tabs: Rect[] = [0, 1, 2].map((i) => ({ x: inner.x + i * (tabW + gap), y: inner.y, w: tabW, h: headH }));
  const amount: Rect = { x: inner.x + inner.w - amountW, y: inner.y, w: amountW, h: headH };

  const rowsTop = inner.y + headH + gap * 1.5;
  const rowGap = portrait ? 4 : 5;
  const rowH = Math.floor((inner.y + inner.h - rowsTop - rowGap * (ROWS - 1)) / ROWS);
  // Two lines need room for two text lines plus breathing space.
  const twoLine = rowH >= (fonts.name + fonts.value) * 1.4;
  const glyphSize = Math.min(portrait ? 48 : 34, rowH - 10);
  const priceW = portrait ? 176 : 132;
  const rows: RowGeo[] = [];
  for (let i = 0; i < ROWS; i++) {
    const r: Rect = { x: inner.x, y: rowsTop + i * (rowH + rowGap), w: inner.w, h: rowH };
    const cy = r.y + rowH / 2;
    const gx = r.x + 8 + glyphSize / 2;
    const textX = gx + glyphSize / 2 + (portrait ? 12 : 10);
    const price: Rect = { x: r.x + r.w - priceW - 6, y: r.y + 5, w: priceW, h: rowH - 10 };
    if (twoLine) {
      const l1 = r.y + rowH * 0.31;
      const l2 = r.y + rowH * 0.71;
      rows.push({ rect: r, glyph: [gx, cy], name: [textX, l1], level: [price.x - 12, l1], value: [textX, l2], price });
    } else {
      rows.push({ rect: r, glyph: [gx, cy], name: [textX, cy], level: null, value: [price.x - 14, cy], price });
    }
  }
  return { frame, tabs, amount, rows, twoLine, glyphSize, fonts };
}
