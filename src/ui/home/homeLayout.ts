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
