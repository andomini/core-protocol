// Vector glyphs for the five protocol tags, drawn into a Graphics (no emoji: the UI fonts lack them).
// ⚡ Overload = bolt, 🧊 Cryo = snowflake, 🔗 Chain = two links, 💰 Mining = data crystal, 🛡 Firewall = shield.

import type Phaser from 'phaser';
import type { Tag } from '../sim/perkData';

/** Draws the glyph centred at (cx, cy) fitting a `size`×`size` box. */
export function drawTagIcon(g: Phaser.GameObjects.Graphics, tag: Tag, cx: number, cy: number, size: number, color: number, alpha = 1): void {
  const s = size / 2;
  const lw = Math.max(2, size * 0.09);
  g.lineStyle(lw, color, alpha);
  g.fillStyle(color, alpha);
  switch (tag) {
    case 'overload':
      g.fillPoints(
        [
          { x: cx + s * 0.15, y: cy - s },
          { x: cx - s * 0.55, y: cy + s * 0.1 },
          { x: cx - s * 0.02, y: cy + s * 0.1 },
          { x: cx - s * 0.2, y: cy + s },
          { x: cx + s * 0.55, y: cy - s * 0.15 },
          { x: cx + s * 0.04, y: cy - s * 0.15 },
        ],
        true,
      );
      break;
    case 'cryo':
      for (let i = 0; i < 3; i++) {
        const a = (Math.PI / 3) * i + Math.PI / 2;
        const dx = Math.cos(a) * s * 0.92;
        const dy = Math.sin(a) * s * 0.92;
        g.lineBetween(cx - dx, cy - dy, cx + dx, cy + dy);
        for (const sign of [1, -1]) {
          const bx = cx + dx * 0.55 * sign;
          const by = cy + dy * 0.55 * sign;
          const b = 0.6;
          const ux = Math.cos(a + b * sign) * s * 0.3 * sign;
          const uy = Math.sin(a + b * sign) * s * 0.3 * sign;
          const vx = Math.cos(a - b * sign) * s * 0.3 * sign;
          const vy = Math.sin(a - b * sign) * s * 0.3 * sign;
          g.lineBetween(bx, by, bx + ux, by + uy);
          g.lineBetween(bx, by, bx + vx, by + vy);
        }
      }
      break;
    case 'chain': {
      const r = s * 0.42;
      const off = s * 0.36;
      g.strokeEllipse(cx - off, cy + off * 0.2, r * 2.1, r * 1.3);
      g.strokeEllipse(cx + off, cy - off * 0.2, r * 2.1, r * 1.3);
      break;
    }
    case 'mining':
      g.strokePoints(
        [
          { x: cx, y: cy - s },
          { x: cx + s * 0.75, y: cy - s * 0.3 },
          { x: cx, y: cy + s },
          { x: cx - s * 0.75, y: cy - s * 0.3 },
        ],
        true,
      );
      g.lineBetween(cx - s * 0.75, cy - s * 0.3, cx + s * 0.75, cy - s * 0.3);
      g.lineBetween(cx, cy - s, cx, cy + s);
      break;
    case 'firewall':
      g.strokePoints(
        [
          { x: cx, y: cy - s },
          { x: cx + s * 0.8, y: cy - s * 0.6 },
          { x: cx + s * 0.7, y: cy + s * 0.2 },
          { x: cx, y: cy + s },
          { x: cx - s * 0.7, y: cy + s * 0.2 },
          { x: cx - s * 0.8, y: cy - s * 0.6 },
        ],
        true,
      );
      g.fillStyle(color, alpha * 0.35);
      g.fillPoints(
        [
          { x: cx, y: cy - s * 0.6 },
          { x: cx + s * 0.45, y: cy - s * 0.35 },
          { x: cx + s * 0.4, y: cy + s * 0.12 },
          { x: cx, y: cy + s * 0.6 },
        ],
        true,
      );
      break;
  }
}
