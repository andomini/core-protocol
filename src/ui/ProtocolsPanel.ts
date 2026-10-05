// "My protocols": every held perk with its stacks and total effect, and the five sets with their progress.
// Opens from the set chips; the battle pauses while it is open.

import Phaser from 'phaser';
import { CYAN, PANEL_FILL, RARITY_CSS, TAG_COLOR, TAG_CSS, TEXT, TEXT_DIM } from '../render/palette';
import { DEPTH } from '../render/WorldView';
import type { GameData } from '../sim/data';
import { tagCounts } from '../sim/perks';
import { TAGS } from '../sim/perkData';
import type { World } from '../sim/state';
import { Button, panel, text } from './kit';
import type { Layout, Rect } from './layout';
import { setProgress, setTierLines, totalLines } from './perkText';
import { drawTagIcon } from './tagIcon';

const D = DEPTH.overlay - 1;

export class ProtocolsPanel {
  visible = false;
  private readonly fixed: Phaser.GameObjects.GameObject[] = [];
  private readonly dynamic: Phaser.GameObjects.GameObject[] = [];
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly blocker: Phaser.GameObjects.Zone;
  private readonly close: Button;
  private readonly card: Rect;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly L: Layout,
    private readonly data: GameData,
    onClose: () => void,
  ) {
    const portrait = L.o === 'portrait';
    const dim = scene.add.graphics().setDepth(D);
    dim.fillStyle(0x02040c, 0.85).fillRect(0, 0, L.w, L.h);
    this.blocker = scene.add.zone(L.w / 2, L.h / 2, L.w, L.h).setDepth(D).setInteractive();
    const cw = portrait ? 680 : 1180;
    const ch = portrait ? Math.min(L.h - 80, 1240) : 660;
    this.card = { x: (L.w - cw) / 2, y: (L.h - ch) / 2, w: cw, h: ch };
    const frame = panel(scene, this.card, D + 0.1, { edge: CYAN, fill: PANEL_FILL, fillA: 0.96, cut: 22, blur: 14, lw: 2.5 });
    const title = text(scene, L.w / 2, this.card.y + (portrait ? 46 : 34), 'MY PROTOCOLS', portrait ? 40 : 30, { font: 'title', weight: '900', glow: '#22e5ff', blur: 14 })
      .setOrigin(0.5)
      .setDepth(D + 0.3);
    this.g = scene.add.graphics().setDepth(D + 0.2);
    const bw = portrait ? 260 : 200;
    const bh = portrait ? 80 : 54;
    this.close = new Button(scene, { x: L.w / 2 - bw / 2, y: this.card.y + this.card.h - bh - 20, w: bw, h: bh }, 'RESUME', portrait ? 32 : 22, D + 0.4, onClose, {
      font: 'title',
      fill: 0x062a3a,
      lw: 2.5,
      blur: 12,
    });
    this.fixed.push(dim, frame, title, this.g);
    this.hide();
  }

  closeRect(): Rect {
    return this.close.r;
  }

  show(w: World): void {
    this.visible = true;
    for (const o of this.fixed) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(true);
    this.close.setVisible(true);
    this.blocker.setInteractive();
    for (const o of this.dynamic) o.destroy();
    this.dynamic.length = 0;
    const g = this.g.clear();
    const L = this.L;
    const portrait = L.o === 'portrait';
    const f = L.minFont;
    const c = this.card;
    const pad = portrait ? 28 : 30;
    // Sets: five rows (portrait) or five columns (landscape).
    const counts = tagCounts(w, this.data);
    const setsTop = c.y + (portrait ? 96 : 72);
    const setH = portrait ? 74 : 92;
    TAGS.forEach((t, i) => {
      const p = setProgress(this.data, t, counts[t]);
      const tier = w.setTiers[t];
      const r: Rect = portrait
        ? { x: c.x + pad, y: setsTop + i * (setH + 8), w: c.w - pad * 2, h: setH }
        : { x: c.x + pad + i * ((c.w - pad * 2 + 12) / 5), y: setsTop, w: (c.w - pad * 2 + 12) / 5 - 12, h: setH };
      g.fillStyle(TAG_COLOR[t], tier > 0 ? 0.16 : 0.05).fillRoundedRect(r.x, r.y, r.w, r.h, 10);
      g.lineStyle(tier > 0 ? 2.5 : 1.5, TAG_COLOR[t], tier > 0 ? 0.95 : 0.4).strokeRoundedRect(r.x, r.y, r.w, r.h, 10);
      const is = portrait ? 40 : 30;
      drawTagIcon(g, t, r.x + 14 + is / 2, r.y + (portrait ? r.h / 2 : 26), is, TAG_COLOR[t], tier > 0 ? 1 : 0.6);
      const name = `${this.data.sets.tags[t].name.toUpperCase()} ${counts[t]}${p.next ? `/${p.next}` : ''}`;
      const now = tier > 0 ? setTierLines(this.data, t, tier)[0] ?? '' : '';
      const next = p.next ? `next: ${p.nextText}` : 'complete';
      if (portrait) {
        this.add(text(this.scene, r.x + is + 30, r.y + 8, name, f, { color: TAG_CSS[t] }).setDepth(D + 0.3));
        this.add(text(this.scene, r.x + is + 30, r.y + 8 + f + 2, now || next, f, { color: tier > 0 ? TEXT : TEXT_DIM }).setDepth(D + 0.3).setWordWrapWidth(r.w - is - 40));
      } else {
        this.add(text(this.scene, r.x + is + 24, r.y + 14, name, f + 2, { color: TAG_CSS[t] }).setDepth(D + 0.3));
        this.add(text(this.scene, r.x + 12, r.y + 46, now || next, f, { color: tier > 0 ? TEXT : TEXT_DIM }).setDepth(D + 0.3).setWordWrapWidth(r.w - 20));
      }
    });
    // Perks: a grid of "Name ×n" + total effect.
    const held = Object.entries(w.perks).filter(([, n]) => n > 0);
    const gridTop = portrait ? setsTop + 5 * (setH + 8) + 16 : setsTop + setH + 24;
    const cols = portrait ? 2 : 3;
    const colW = (c.w - pad * 2 - (cols - 1) * 14) / cols;
    const rowH = portrait ? 84 : 62;
    if (held.length === 0) {
      this.add(text(this.scene, L.w / 2, gridTop + 40, 'No protocols installed yet', f, { color: TEXT_DIM }).setOrigin(0.5, 0).setDepth(D + 0.3));
    }
    held.forEach(([id, n], i) => {
      const def = this.data.perks.perks[id]!;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = c.x + pad + col * (colW + 14);
      const y = gridTop + row * (rowH + 8);
      g.fillStyle(TAG_COLOR[def.tag], 0.06).fillRoundedRect(x, y, colW, rowH, 8);
      g.fillStyle(TAG_COLOR[def.tag], 0.9).fillRect(x, y + 6, 4, rowH - 12);
      this.add(text(this.scene, x + 14, y + 6, `${def.name} ×${n}`, f, { color: RARITY_CSS[def.rarity] === RARITY_CSS.common ? TEXT : RARITY_CSS[def.rarity] }).setDepth(D + 0.3));
      this.add(text(this.scene, x + 14, y + 8 + f, totalLines(this.data, id, n).join(' · '), f, { color: TAG_CSS[def.tag] }).setDepth(D + 0.3).setWordWrapWidth(colW - 20));
    });
  }

  private add(o: Phaser.GameObjects.Text): void {
    this.dynamic.push(o);
  }

  hide(): void {
    this.visible = false;
    for (const o of this.fixed) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(false);
    for (const o of this.dynamic) o.destroy();
    this.dynamic.length = 0;
    this.close.setVisible(false);
    this.blocker.disableInteractive();
  }
}
