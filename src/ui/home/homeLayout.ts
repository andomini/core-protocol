// Home screen geometry (logical px). Portrait: top bar, content, bottom tab bar. Landscape: top bar, a left
// tab rail, content on the right.
import type { Layout, Rect } from '../layout';

export interface HomeGeometry {
  top: Rect;
  content: Rect;
  tabs: Rect[];
  /** Sub-tab strip inside the content (workshop / labs). */
  sub: Rect;
  /** Rows area under the sub-tabs. */
  rows: Rect;
  rowH: number;
  font: number;
  titleFont: number;
  big: number;
}

export function homeGeometry(L: Layout, nTabs: number): HomeGeometry {
  if (L.o === 'portrait') {
    const topH = 120;
    const tabH = 132;
    const content: Rect = { x: 20, y: topH + 10, w: L.w - 40, h: L.h - topH - tabH - 30 };
    const tw = (L.w - 20) / nTabs;
    const tabs: Rect[] = [];
    for (let i = 0; i < nTabs; i++) tabs.push({ x: 10 + i * tw + 4, y: L.h - tabH - 10, w: tw - 8, h: tabH });
    const sub: Rect = { x: content.x, y: content.y + 70, w: content.w, h: 80 };
    const rowsY = sub.y + sub.h + 20;
    const rows: Rect = { x: content.x, y: rowsY, w: content.w, h: content.y + content.h - rowsY };
    return { top: { x: 0, y: 0, w: L.w, h: topH }, content, tabs, sub, rows, rowH: Math.min(150, Math.floor((rows.h - 5 * 14) / 6)), font: 28, titleFont: 44, big: 40 };
  }
  const topH = 84;
  const railW = 220;
  const content: Rect = { x: railW + 20, y: topH + 10, w: L.w - railW - 40, h: L.h - topH - 30 };
  const th = Math.min(120, (L.h - topH - 30) / nTabs - 10);
  const tabs: Rect[] = [];
  for (let i = 0; i < nTabs; i++) tabs.push({ x: 16, y: topH + 10 + i * (th + 10), w: railW - 24, h: th });
  const sub: Rect = { x: content.x, y: content.y + 52, w: content.w, h: 56 };
  const rowsY = sub.y + sub.h + 14;
  const rows: Rect = { x: content.x, y: rowsY, w: content.w, h: content.y + content.h - rowsY };
  return { top: { x: 0, y: 0, w: L.w, h: topH }, content, tabs, sub, rows, rowH: Math.min(84, Math.floor((rows.h - 5 * 10) / 6)), font: 18, titleFont: 32, big: 28 };
}

/**
 * The BATTLE tab. Portrait: tier card, run buttons, the NEXT panel (next goals + daily missions) below, and
 * the progress summary only when a tall phone leaves room. Landscape: tier card and buttons on the left, the
 * NEXT panel as a right column, the summary as one line at the bottom.
 */
export interface BattleGeometry {
  card: Rect;
  /** Run buttons column: centre x, width, first button y and height. */
  btnX: number;
  btnW: number;
  btnY: number;
  btnH: number;
  /** ABANDON (saved run) and the STATS · CODEX · DAILY · RANKS row. */
  smallH: number;
  rowH: number;
  gap: number;
  next: Rect;
  /** Height of one NEXT row (a progress bar behind its text). */
  nextRowH: number;
  /** Section header height inside the NEXT panel. */
  nextHeader: number;
  /** Both NEXT sections fit at once; else the panel header toggles NEXT / DAILY. */
  both: boolean;
  /** Portrait summary card (null: no room); landscape: the one-line summary's box. */
  summary: Rect | null;
}

/** Height of a NEXT panel: padding, `sections` headers, `rows` bars of rowH with `gap` between them. */
export function nextPanelHeight(rows: number, rowH: number, header: number, gap: number, sections: number): number {
  return 12 + sections * header + rows * (rowH + gap) + gap;
}

/** `rows`: NEXT goals + daily missions shown when both sections fit (the panel is sized to them). */
export function battleGeometry(L: Layout, G: HomeGeometry, saved: boolean, rows = 6): BattleGeometry {
  const c = G.content;
  const f = G.font;
  if (L.o === 'portrait') {
    const card: Rect = { x: c.x, y: c.y + 10, w: c.w, h: 390 };
    const btnH = 104;
    const smallH = 80;
    const rowH = 70;
    const gap = 16;
    const btnY = card.y + card.h + 24;
    let y = btnY + btnH + gap;
    if (saved) y += smallH + gap;
    y += rowH + gap;
    const nextRowH = 42;
    const nextHeader = f + 14;
    const bottom = c.y + c.h;
    const full = nextPanelHeight(rows, nextRowH, nextHeader, 6, 2);
    const summaryH = 3 * (f + 16) + 30;
    const both = bottom - y >= full;
    const nextH = both ? full : Math.min(bottom - y, nextPanelHeight(Math.min(3, rows), nextRowH, nextHeader, 6, 1));
    const summary = bottom - y >= full + gap + summaryH ? { x: c.x, y: bottom - summaryH, w: c.w, h: summaryH } : null;
    return { card, btnX: c.x + c.w / 2, btnW: 560, btnY, btnH, smallH, rowH, gap, next: { x: c.x, y, w: c.w, h: nextH }, nextRowH, nextHeader, both, summary };
  }
  const colW = Math.floor(c.w * 0.56);
  const card: Rect = { x: c.x, y: c.y, w: colW, h: 330 };
  const nextX = c.x + colW + 20;
  const lineY = c.y + c.h - f - 4;
  const next: Rect = { x: nextX, y: c.y, w: c.x + c.w - nextX, h: Math.min(lineY - 12 - c.y, nextPanelHeight(rows, 40, f + 16, 6, 2) + 6) };
  return { card, btnX: c.x + colW / 2, btnW: Math.min(420, colW - 40), btnY: card.y + card.h + 22, btnH: 76, smallH: 56, rowH: 50, gap: 16, next, nextRowH: 40, nextHeader: f + 16, both: true, summary: { x: c.x, y: lineY, w: c.w, h: f + 4 } };
}
