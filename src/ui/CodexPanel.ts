// Fusion Codex (spec 2026-10-16 phase 2): the ten tag pairs, silhouettes until a run reaches the fusion.
// The best tier reached is kept in MetaState.codex; the first III pays meta.json codex.bits once.

import Phaser from 'phaser';
import { CYAN, LOCKED, LOCKED_CSS, PANEL_FILL, TAG_COLOR, TAG_CSS, TEXT, TEXT_DIM } from '../render/palette';
import { DEPTH } from '../render/WorldView';
import type { GameData } from '../sim/data';
import { fusionKeys } from '../sim/perkData';
import { formatNum } from './format';
import { Button, panel, text } from './kit';
import type { Layout, Rect } from './layout';
import { fusionTags } from './perkText';
import { drawTagIcon } from './tagIcon';

const D = DEPTH.overlay + 2;
// Best tier index I = 1 … III = 3; a 4 in an older save (the shelved Apex) reads as III.
const LEVEL = ['', 'I', 'II', 'III', 'III'];

export class CodexPanel {
  visible = false;
  private readonly fixed: Phaser.GameObjects.GameObject[] = [];
  private readonly blocker: Phaser.GameObjects.Zone;
  private readonly close: Button;
  private readonly card: Rect;
  private readonly content: Phaser.GameObjects.Container;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly L: Layout,
    private readonly data: GameData,
    onClose: () => void,
  ) {
    const portrait = L.o === 'portrait';
    const dim = scene.add.graphics().setDepth(D);
    dim.fillStyle(0x02040c, 0.88).fillRect(0, 0, L.w, L.h);
    this.blocker = scene.add.zone(L.w / 2, L.h / 2, L.w, L.h).setDepth(D).setInteractive();
    const cw = portrait ? 690 : 1200;
    const ch = portrait ? Math.min(L.h - 60, 1180) : 680;
    this.card = { x: (L.w - cw) / 2, y: (L.h - ch) / 2, w: cw, h: ch };
    const frame = panel(scene, this.card, D + 0.1, { edge: CYAN, fill: PANEL_FILL, fillA: 0.97, cut: 22, blur: 14, lw: 2.5 });
    const title = text(scene, L.w / 2, this.card.y + (portrait ? 40 : 30), 'FUSION CODEX', portrait ? 40 : 30, { font: 'title', weight: '900', glow: '#22e5ff', blur: 14 })
      .setOrigin(0.5)
      .setDepth(D + 0.3);
    const bw = portrait ? 240 : 180;
    const bh = portrait ? 78 : 52;
    this.close = new Button(scene, { x: L.w / 2 - bw / 2, y: this.card.y + ch - bh - 18, w: bw, h: bh }, 'CLOSE', portrait ? 30 : 22, D + 0.5, onClose, { font: 'title', fill: 0x062a3a });
    this.content = scene.add.container(0, 0).setDepth(D + 0.3);
    this.fixed.push(dim, frame, title);
    this.hide();
  }

  closeRect(): Rect {
    return this.close.r;
  }

  /** `bits`: the one-off Bits for a pair's first III (meta.json codex.bits). */
  show(codex: Record<string, number>, bits: number): void {
    this.visible = true;
    for (const o of this.fixed) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(true);
    this.close.setVisible(true);
    this.blocker.setInteractive();
    this.content.setVisible(true);
    this.render(codex, bits);
  }

  private render(codex: Record<string, number>, bits: number): void {
    this.content.removeAll(true);
    const portrait = this.L.o === 'portrait';
    const f = this.L.minFont;
    const keys = fusionKeys();
    const found = keys.filter((k) => (codex[k] ?? 0) > 0).length;
    const top = this.card.y + (portrait ? 80 : 60);
    const sub = `${found}/${keys.length} discovered · first III of a pair: +${formatNum(bits)} Bits`;
    this.content.add(text(this.scene, this.L.w / 2, top, sub, f, { color: TEXT_DIM }).setOrigin(0.5, 0));
    const cols = portrait ? 2 : 5;
    const rows = Math.ceil(keys.length / cols);
    const gx = 14;
    const area: Rect = { x: this.card.x + 24, y: top + f + 20, w: this.card.w - 48, h: this.close.r.y - 16 - (top + f + 20) };
    const cw = (area.w - (cols - 1) * gx) / cols;
    const chh = (area.h - (rows - 1) * gx) / rows;
    const g = this.scene.add.graphics();
    this.content.add(g);
    keys.forEach((k, i) => {
      const x = area.x + (i % cols) * (cw + gx);
      const y = area.y + Math.floor(i / cols) * (chh + gx);
      const lvl = codex[k] ?? 0;
      const [a, b] = fusionTags(k);
      const known = lvl > 0;
      g.fillStyle(known ? TAG_COLOR[a] : 0x22e5ff, known ? 0.1 : 0.04).fillRoundedRect(x, y, cw, chh, 10);
      g.lineStyle(2, known ? TAG_COLOR[a] : LOCKED, known ? 0.8 : 0.5).strokeRoundedRect(x, y, cw, chh, 10);
      const icon = Math.min(chh * 0.32, portrait ? 46 : 40);
      const iy = y + 14 + icon / 2;
      drawTagIcon(g, a, x + cw / 2 - icon * 0.62, iy, icon, known ? TAG_COLOR[a] : LOCKED, known ? 1 : 0.45);
      drawTagIcon(g, b, x + cw / 2 + icon * 0.62, iy, icon, known ? TAG_COLOR[b] : LOCKED, known ? 1 : 0.45);
      const name = known ? this.data.sets.fusions[k]!.name.toUpperCase() : '???';
      const ny = iy + icon / 2 + 10;
      const t = text(this.scene, x + cw / 2, ny, name, f, { font: 'title', weight: '800', color: known ? TAG_CSS[a] : LOCKED_CSS }).setOrigin(0.5, 0);
      if (t.width > cw - 12) t.setFontSize(Math.max(12, Math.floor((f * (cw - 12)) / t.width)));
      this.content.add(t);
      const best = known ? `BEST ${LEVEL[lvl] ?? lvl}` : `${this.data.sets.tags[a].name} + ${this.data.sets.tags[b].name}`;
      this.content.add(text(this.scene, x + cw / 2, ny + f + 8, best, f, { color: known ? TEXT : TEXT_DIM }).setOrigin(0.5, 0));
    });
  }

  hide(): void {
    this.visible = false;
    for (const o of this.fixed) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(false);
    this.close.setVisible(false);
    this.content.removeAll(true);
    this.content.setVisible(false);
    this.blocker.disableInteractive();
  }
}
