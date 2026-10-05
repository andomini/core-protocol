// Protocol pick overlay (spec §2.4): "CHOOSE A PROTOCOL" / "WAVE N CLEARED", 3–4 cards with the tag glyph,
// rarity frame, effect lines from data, NEW / LV badge and set progress; REROLL (free with the lab node,
// else a rewarded ad) and BOOST (rewarded: ×Energy for the next waves). The sim waits in its `pick` phase.

import Phaser from 'phaser';
import { CYAN, ENERGY, ENERGY_CSS, LOCKED, PANEL_FILL, RARITY_COLOR, RARITY_CSS, TAG_COLOR, TAG_CSS, TEXT, TEXT_DIM } from '../render/palette';
import { DEPTH } from '../render/WorldView';
import type { GameData } from '../sim/data';
import { boostActive, boostAvailable, tagCounts } from '../sim/perks';
import type { Tag } from '../sim/perkData';
import type { World } from '../sim/state';
import { Button, panel, text } from './kit';
import type { Layout, Rect } from './layout';
import { perkLines, setProgress } from './perkText';
import { pickGeometry, type PickGeometry } from './pickLayout';
import { drawTagIcon } from './tagIcon';

export interface PickHandlers {
  pick(index: number): void;
  reroll(): void;
  boost(): void;
}

interface Card {
  frame: Phaser.GameObjects.Image | null;
  frameKey: string;
  g: Phaser.GameObjects.Graphics;
  tag: Phaser.GameObjects.Text;
  name: Phaser.GameObjects.Text;
  rarity: Phaser.GameObjects.Text;
  badge: Phaser.GameObjects.Text;
  lines: Phaser.GameObjects.Text;
  progress: Phaser.GameObjects.Text;
  zone: Phaser.GameObjects.Zone;
  r: Rect;
}

const D = DEPTH.overlay - 2;

export class PickOverlay {
  visible = false;
  private readonly dim: Phaser.GameObjects.Graphics;
  private readonly blocker: Phaser.GameObjects.Zone;
  private readonly title: Phaser.GameObjects.Text;
  private readonly sub: Phaser.GameObjects.Text;
  private readonly cards: Card[] = [];
  private geo: PickGeometry;
  private n = 0;
  private readonly rerollBtn: Button;
  private readonly boostBtn: Button;
  private shownKey = '';
  /** Locks input briefly after (re)showing so a double tap cannot pick by accident. */
  private armedAt = 0;
  private busy = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly L: Layout,
    private readonly data: GameData,
    private readonly h: PickHandlers,
  ) {
    this.dim = scene.add.graphics().setDepth(D);
    this.dim.fillStyle(0x02040c, 0.82).fillRect(0, 0, L.w, L.h);
    this.dim.fillStyle(CYAN, 0.025);
    for (let y = 0; y < L.h; y += 6) this.dim.fillRect(0, y, L.w, 2);
    this.blocker = scene.add.zone(L.w / 2, L.h / 2, L.w, L.h).setDepth(D).setInteractive();
    this.geo = pickGeometry(L, data.perks.offer.sizeLab);
    const g0 = pickGeometry(L, data.perks.offer.size);
    this.title = text(scene, L.w / 2, g0.headerY, '', g0.titleSize, { font: 'title', weight: '900', glow: '#22e5ff', blur: 16 }).setOrigin(0.5).setDepth(D + 0.3);
    this.sub = text(scene, L.w / 2, g0.subY, '', g0.subSize, { color: TEXT_DIM }).setOrigin(0.5).setDepth(D + 0.3);
    for (let i = 0; i < data.perks.offer.sizeLab; i++) this.cards.push(this.makeCard(i));
    const btnFont = L.o === 'portrait' ? 30 : 20;
    this.rerollBtn = new Button(scene, g0.reroll, 'REROLL', btnFont, D + 0.4, () => this.guard(() => this.h.reroll()), { font: 'title', edge: CYAN, fill: 0x062a3a, lw: 2.5, blur: 12 });
    this.boostBtn = new Button(scene, g0.boost, 'BOOST', btnFont, D + 0.4, () => this.guard(() => this.h.boost()), { font: 'title', edge: ENERGY, fill: 0x2a2306, lw: 2.5, blur: 12, textColor: ENERGY_CSS, glow: ENERGY_CSS });
    this.hide();
  }

  private makeCard(i: number): Card {
    const s = this.scene;
    const g = s.add.graphics().setDepth(D + 0.2);
    const t = (size: number, color = TEXT) => text(s, 0, 0, '', size, { color }).setDepth(D + 0.3);
    const geo = this.geo;
    const card: Card = {
      frame: null,
      frameKey: '',
      g,
      tag: t(geo.smallSize),
      name: text(s, 0, 0, '', geo.nameSize, { font: 'title', weight: '800', color: TEXT }).setDepth(D + 0.3),
      rarity: t(geo.smallSize),
      badge: t(geo.smallSize, '#03050d'),
      lines: t(geo.lineSize),
      progress: t(geo.smallSize),
      zone: s.add.zone(0, 0, 10, 10).setDepth(D + 0.5).setInteractive({ useHandCursor: true }),
      r: { x: 0, y: 0, w: 0, h: 0 },
    };
    card.zone.on('pointerdown', () => this.guard(() => this.h.pick(i)));
    return card;
  }

  private guard(f: () => void): void {
    if (!this.visible || this.busy || this.scene.time.now < this.armedAt) return;
    f();
  }

  /** While an ad plays the buttons stay inert. */
  setBusy(b: boolean): void {
    this.busy = b;
  }

  /** Card rect `i` (logical px), for the UI smoke. */
  cardRect(i: number): Rect | null {
    return i < this.n ? this.cards[i]!.r : null;
  }

  rerollRect(): Rect {
    return this.rerollBtn.r;
  }

  boostRect(): Rect {
    return this.boostBtn.r;
  }

  /** Shows (or refreshes) the overlay for the world's open offer. */
  show(w: World, now: number): void {
    const key = `${w.picks}:${w.rerolls}:${w.offer.join(',')}:${w.boost.from}`;
    if (this.visible && key === this.shownKey) return;
    const fresh = !this.visible || !this.shownKey.startsWith(`${w.picks}:`);
    this.shownKey = key;
    this.visible = true;
    this.armedAt = now + (fresh ? 350 : 150);
    this.n = w.offer.length;
    const geo = pickGeometry(this.L, this.n);
    this.geo = geo;
    this.dim.setVisible(true);
    this.blocker.setInteractive();
    this.title.setText(w.picks === 0 && w.wave <= 1 ? 'CHOOSE A PROTOCOL' : `WAVE ${w.wave} CLEARED`).setVisible(true);
    this.sub.setText('Install one protocol · sets unlock at 2 / 4 / 6').setVisible(true);
    const counts = tagCounts(w, this.data);
    for (let i = 0; i < this.cards.length; i++) {
      const c = this.cards[i]!;
      if (i >= this.n) {
        this.setCardVisible(c, false);
        continue;
      }
      this.fillCard(c, geo, geo.cards[i]!, w.offer[i]!, w, counts);
      this.setCardVisible(c, true);
    }
    // Buttons.
    this.rerollBtn.setVisible(true);
    this.rerollBtn.label.setText(w.freeRerolls > 0 ? `REROLL · FREE` : 'REROLL  ▶AD');
    const canBoost = boostAvailable(w, this.data);
    this.boostBtn.setVisible(true);
    const b = this.data.perks.boost;
    this.boostBtn.label.setText(boostActive(w) || (w.boost.from > 0 && !canBoost) ? 'BOOST USED' : `BOOST ×${b.energyMul}  ▶AD`);
    this.boostBtn.bg.setAlpha(canBoost ? 1 : 0.35);
    this.boostBtn.label.setAlpha(canBoost ? 1 : 0.45);
    if (!canBoost) this.boostBtn.zone.disableInteractive();
    if (fresh) {
      const targets: Phaser.GameObjects.GameObject[] = [];
      for (let i = 0; i < this.n; i++) {
        const c = this.cards[i]!;
        targets.push(c.g, c.tag, c.name, c.rarity, c.badge, c.lines, c.progress);
        if (c.frame) targets.push(c.frame);
      }
      this.scene.tweens.add({ targets, alpha: { from: 0, to: 1 }, duration: 260 });
      this.scene.tweens.add({ targets: [this.dim, this.title, this.sub], alpha: { from: 0, to: 1 }, duration: 200 });
    }
  }

  private setCardVisible(c: Card, v: boolean): void {
    c.frame?.setVisible(v);
    for (const o of [c.g, c.tag, c.name, c.rarity, c.badge, c.lines, c.progress]) o.setVisible(v);
    if (v) c.zone.setInteractive({ useHandCursor: true });
    else c.zone.disableInteractive();
  }

  private fillCard(c: Card, geo: PickGeometry, r: Rect, id: string, w: World, counts: Record<Tag, number>): void {
    const def = this.data.perks.perks[id]!;
    const tag = def.tag;
    const tc = TAG_COLOR[tag];
    const rc = RARITY_COLOR[def.rarity];
    c.r = r;
    // Frame: baked once per (rect, rarity) combination.
    const key = `${r.x},${r.y},${r.w}x${r.h}:${def.rarity}`;
    if (c.frameKey !== key) {
      c.frame?.destroy();
      c.frame = panel(this.scene, r, D + 0.1, {
        fill: PANEL_FILL,
        fillA: 0.97,
        edge: def.rarity === 'common' ? LOCKED : rc,
        cut: 18,
        lw: def.rarity === 'epic' ? 3.5 : 2.5,
        blur: def.rarity === 'common' ? 6 : 18,
      });
      c.frameKey = key;
    }
    c.zone.setPosition(r.x + r.w / 2, r.y + r.h / 2).setSize(r.w, r.h);
    if (c.zone.input) c.zone.input.hitArea.setSize(r.w, r.h);
    const g = c.g.clear();
    const stacks = w.perks[id] ?? 0;
    const prog = setProgress(this.data, tag, counts[tag] + 1);
    const line = perkLines(this.data, id).join('\n');
    const pad = geo.horizontal ? 26 : 20;
    if (geo.horizontal) {
      // Icon disc on the left, text on the right.
      const ix = r.x + 74;
      const iy = r.y + r.h / 2 - 6;
      g.fillStyle(tc, 0.12).fillCircle(ix, iy, 50);
      g.lineStyle(3, tc, 0.9).strokeCircle(ix, iy, 50);
      drawTagIcon(g, tag, ix, iy, 52, tc);
      c.tag.setText(this.data.sets.tags[tag].name.toUpperCase()).setColor(TAG_CSS[tag]).setOrigin(0.5, 0).setPosition(ix, iy + 58);
      const tx = r.x + 150;
      c.name.setText(def.name).setOrigin(0, 0).setPosition(tx, r.y + 18);
      c.rarity.setText(def.tradeoff ? `${def.rarity.toUpperCase()} · TRADE-OFF` : def.rarity.toUpperCase()).setColor(RARITY_CSS[def.rarity]).setOrigin(1, 0).setPosition(r.x + r.w - pad, r.y + 22);
      c.lines.setText(line).setColor(TEXT).setOrigin(0, 0).setPosition(tx, r.y + 18 + geo.nameSize + 14).setWordWrapWidth(r.w - 150 - pad);
      c.progress.setText(this.progressText(tag, prog)).setOrigin(0, 1).setPosition(tx, r.y + r.h - 16).setWordWrapWidth(r.w - 150 - pad);
    } else {
      const ix = r.x + r.w / 2;
      const iy = r.y + 70;
      g.fillStyle(tc, 0.12).fillCircle(ix, iy, 44);
      g.lineStyle(3, tc, 0.9).strokeCircle(ix, iy, 44);
      drawTagIcon(g, tag, ix, iy, 46, tc);
      c.tag.setText(this.data.sets.tags[tag].name.toUpperCase()).setColor(TAG_CSS[tag]).setOrigin(0.5, 0).setPosition(ix, iy + 52);
      c.name.setText(def.name).setOrigin(0.5, 0).setPosition(ix, iy + 52 + geo.smallSize + 14);
      c.rarity.setText(def.tradeoff ? `${def.rarity.toUpperCase()} · TRADE-OFF` : def.rarity.toUpperCase()).setColor(RARITY_CSS[def.rarity]).setOrigin(0.5, 0).setPosition(ix, iy + 52 + geo.smallSize + 14 + geo.nameSize + 10);
      c.lines.setText(line).setColor(TEXT).setOrigin(0.5, 0).setAlign('center').setPosition(ix, c.rarity.y + geo.smallSize + 22).setWordWrapWidth(r.w - pad * 2);
      c.progress.setText(this.progressText(tag, prog)).setColor(TEXT_DIM).setOrigin(0.5, 1).setAlign('center').setPosition(ix, r.y + r.h - 18).setWordWrapWidth(r.w - pad * 2);
    }
    // Completes a tier → highlight the progress line in the tag colour.
    const completes = prog.tier > 0 && this.data.sets.tiers.includes(prog.count);
    c.progress.setColor(completes ? TAG_CSS[tag] : TEXT_DIM);
    // Badge: NEW or LV n → n+1.
    const badge = stacks === 0 ? 'NEW' : `LV ${stacks}→${stacks + 1}`;
    c.badge.setText(badge).setColor('#03050d');
    const bw = c.badge.width + 18;
    const bh = c.badge.height + 4;
    // A sticker on the top of the icon disc (never collides with the name or the rarity).
    const bx = (geo.horizontal ? r.x + 74 : r.x + r.w / 2) - bw / 2;
    const by = geo.horizontal ? r.y + 8 : r.y + 10;
    g.fillStyle(stacks === 0 ? tc : 0xe8fbff, 0.95).fillRoundedRect(bx, by, bw, bh, 6);
    c.badge.setOrigin(0.5, 0.5).setPosition(bx + bw / 2, by + bh / 2);
  }

  private progressText(tag: Tag, p: ReturnType<typeof setProgress>): string {
    const name = this.data.sets.tags[tag].name.toUpperCase();
    if (p.next === 0) return `${name} ${p.count} · set complete`;
    if (this.data.sets.tiers.includes(p.count)) return `${name} ${p.count}/${p.count} → SET ON: ${p.tier === p.count ? this.tierText(tag, p.count) : ''}`;
    return `${name} ${p.count}/${p.next} → ${p.nextText}`;
  }

  private tierText(tag: Tag, tier: number): string {
    const effs = this.data.sets.sets[tag][String(tier)];
    return effs && effs[0] ? setProgress(this.data, tag, tier - 1).nextText : '';
  }

  hide(): void {
    this.visible = false;
    this.shownKey = '';
    this.dim.setVisible(false);
    this.blocker.disableInteractive();
    this.title.setVisible(false);
    this.sub.setVisible(false);
    for (const c of this.cards) this.setCardVisible(c, false);
    this.rerollBtn.setVisible(false);
    this.boostBtn.setVisible(false);
  }
}
