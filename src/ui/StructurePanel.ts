// Structure upgrades (C4, uniqueness plan phase 3): a "STRUCTURES" chip in the arena's bottom-left corner (shown while
// any structure kind is built) opens a small panel: the kind (‹ › cycle the built kinds), its level, what the next
// level adds, and one BUY button priced in Energy. Tapping a structure on the field opens the panel on its kind.
// The panel only issues `upgradeStruct` commands; levels, costs and effects come from the sim (structLevels.ts).

import type Phaser from 'phaser';
import { ENERGY_CSS, TAG_CSS, TEXT, TEXT_DIM, TEXT_RED } from '../render/palette';
import { DEPTH } from '../render/WorldView';
import type { Command } from '../sim/commands';
import type { GameData, StructureUpgradeDef } from '../sim/data';
import type { StructureKind } from '../sim/perkData';
import { structureBuilt } from '../sim/perks';
import type { World } from '../sim/state';
import { structLevel, structUpgradeCost, structUpgradeDef, upgradableKinds } from '../sim/structLevels';
import { formatNum } from './format';
import { Button, panel, text } from './kit';
import type { Layout, Rect } from './layout';

const NAME: Record<StructureKind, string> = { wall: 'ICE WALL', turret: 'TURRETS', mine: 'MINES', station: 'STATIONS' };
/** The tag next to firewall in the fusion that builds the kind (its colour). */
const TAG_OF = { wall: 'cryo', turret: 'overload', mine: 'chain', station: 'mining' } as const;
const FIELD: Record<string, string> = {
  dmgFrac: 'damage', hpFrac: 'HP', regrowSec: 'regrow time', blast: 'blast radius', energy: 'Energy', streakMax: 'streak cap',
  rateMul: 'fire rate', range: 'range', dmgMul: 'damage', streakStep: 'streak step',
};
const AT_MAX: Record<string, (n: number) => string> = {
  targets: (n) => `+${n} target${n === 1 ? '' : 's'}`,
  perWave: (n) => `+${n} mine${n === 1 ? '' : 's'} per wave`,
  count: (n) => `+${n} more`,
};

/** What level `level + 1` adds over `level` (one line per field, the max-level bonus last). */
export function nextEffectLines(def: StructureUpgradeDef, level: number): string[] {
  if (level >= def.max) return [];
  const out = Object.entries(def.perLevel).map(([f, frac]) => `${frac < 0 ? '−' : '+'}${Math.round(Math.abs(frac) * 100)}% ${FIELD[f] ?? f}`);
  if (level + 1 === def.max && def.atMax) for (const [f, n] of Object.entries(def.atMax)) out.push(AT_MAX[f]?.(n) ?? `+${n} ${f}`);
  return out;
}

/** The built kind with the cheapest affordable-or-not next level (null when none can level up): the `U` key. */
export function cheapestUpgrade(w: World, data: GameData): StructureKind | null {
  let best: StructureKind | null = null;
  let bestCost = Infinity;
  for (const k of upgradableKinds(data)) {
    if (!structureBuilt(w, data, k)) continue;
    const c = structUpgradeCost(data, k, structLevel(w, data, k));
    if (c < bestCost) [best, bestCost] = [k, c];
  }
  return best;
}

export class StructurePanel {
  private readonly chip: Button;
  private readonly frame: Phaser.GameObjects.Image;
  private readonly title: Phaser.GameObjects.Text;
  private readonly level: Phaser.GameObjects.Text;
  private readonly next: Phaser.GameObjects.Text;
  private readonly prev: Button;
  private readonly fwd: Button;
  private readonly close: Button;
  private readonly buy: Button;
  /** Tap areas (logical px), for the UI smoke. */
  readonly chipRect: Rect;
  readonly panelRect: Rect;
  readonly buyRect: Rect;
  private open_ = false;
  private kind: StructureKind | null = null;
  private built: StructureKind[] = [];
  private chipShown = false;
  private last = '';

  constructor(
    private readonly scene: Phaser.Scene,
    L: Layout,
    private readonly gd: GameData,
    private readonly cb: { world: () => World; command: (cmd: Command) => void },
  ) {
    const a = L.arena;
    const portrait = L.o === 'portrait';
    // Just above the RESET ZOOM button's spot (BattleScene: 156×52 / 124×40, 20 px off the arena's bottom).
    const [cw, ch, zoomH, gap] = portrait ? [230, 56, 52, 14] : [180, 40, 40, 10];
    const [pw, ph, bs, pad] = portrait ? [460, 300, 56, 16] : [300, 196, 36, 10];
    const f = L.minFont;
    const depth = DEPTH.overlay - 4;
    this.chipRect = { x: a.x + 24, y: a.y + a.h - 20 - zoomH - gap - ch, w: cw, h: ch };
    this.panelRect = { x: a.x + 24, y: this.chipRect.y - gap - ph, w: pw, h: ph };
    const p = this.panelRect;
    this.chip = new Button(scene, this.chipRect, 'STRUCTURES', f + 2, depth, () => this.toggle(), { fillA: 0.85 }).setVisible(false);
    this.frame = panel(scene, p, depth, { fillA: 0.94, cut: 12 }).setVisible(false);
    const row = p.y + pad;
    this.prev = new Button(scene, { x: p.x + pad, y: row, w: bs, h: bs }, '‹', f + 6, depth + 0.5, () => this.cycle(-1), { fillA: 0.9 });
    this.fwd = new Button(scene, { x: p.x + p.w - pad - 2 * bs - 8, y: row, w: bs, h: bs }, '›', f + 6, depth + 0.5, () => this.cycle(1), { fillA: 0.9 });
    this.close = new Button(scene, { x: p.x + p.w - pad - bs, y: row, w: bs, h: bs }, '×', f + 6, depth + 0.5, () => this.hide(), { fillA: 0.9 });
    const tx = p.x + pad + bs + (p.w - 2 * pad - 3 * bs - 8) / 2;
    this.title = text(scene, tx, row + bs / 2, '', f + 2, { font: 'title', glow: '#22e5ff' }).setOrigin(0.5).setDepth(depth + 0.5);
    this.level = text(scene, p.x + pad, row + bs + pad * 0.6, '', f, { color: TEXT }).setDepth(depth + 0.5);
    this.next = text(scene, p.x + pad, row + bs + pad * 0.6 + f * 1.4, '', f, { color: TEXT_DIM, weight: '600' }).setDepth(depth + 0.5).setLineSpacing(f * 0.15);
    this.buyRect = { x: p.x + pad, y: p.y + p.h - pad - bs, w: p.w - 2 * pad, h: bs };
    this.buy = new Button(scene, this.buyRect, '', f + 2, depth + 0.5, () => this.buyNow(), { fillA: 0.95, textColor: ENERGY_CSS, glow: ENERGY_CSS });
    this.showPanel(false);
  }

  get visible(): boolean {
    return this.open_;
  }

  /** The chip or the open panel covers (x, y): the field under it is not tapped. */
  contains(x: number, y: number): boolean {
    const inR = (r: Rect) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    return (this.chipShown && inR(this.chipRect)) || (this.open_ && inR(this.panelRect));
  }

  /** Opens the panel on `kind` (a tap on a structure); ignored for a kind that is not built or has no ladder. */
  open(kind: StructureKind): void {
    if (!this.built.includes(kind)) return;
    this.kind = kind;
    this.showPanel(true);
  }

  hide(): void {
    this.showPanel(false);
  }

  /** A rejected BUY: the button shakes and its label blinks red. */
  reject(): void {
    if (!this.open_) return;
    const l = this.buy.label;
    const x0 = this.buyRect.x + this.buyRect.w / 2;
    l.setColor(TEXT_RED);
    this.scene.tweens.add({ targets: l, x: { from: x0 - 8, to: x0 }, duration: 260, ease: 'Bounce.easeOut', onComplete: () => { l.x = x0; this.last = ''; } });
  }

  /** Per frame: the chip's visibility and the panel's numbers (texts are rewritten only when they change). */
  update(w: World, blocked: boolean): void {
    this.built = blocked ? [] : upgradableKinds(this.gd).filter((k) => structureBuilt(w, this.gd, k));
    const shown = this.built.length > 0;
    if (shown !== this.chipShown) {
      this.chipShown = shown;
      this.chip.setVisible(shown);
    }
    if (!shown) {
      if (this.open_) this.showPanel(false);
      return;
    }
    if (!this.open_) return;
    if (this.kind === null || !this.built.includes(this.kind)) this.kind = this.built[0]!;
    const k = this.kind;
    const def = structUpgradeDef(this.gd, k)!;
    const lv = structLevel(w, this.gd, k);
    const cost = structUpgradeCost(this.gd, k, lv);
    const can = Number.isFinite(cost) && w.energy >= cost;
    const key = `${k}|${lv}|${can ? 1 : 0}|${this.built.length}`;
    if (key === this.last) return;
    this.last = key;
    this.title.setText(NAME[k]).setColor(TAG_CSS[TAG_OF[k]]);
    this.title.setShadow(0, 0, TAG_CSS[TAG_OF[k]], 10, false, true);
    this.level.setText(`LV ${lv}/${def.max}`);
    const lines = nextEffectLines(def, lv);
    this.next.setText(lines.length > 0 ? `Next: ${lines.join(', ')}` : 'Fully upgraded').setWordWrapWidth(this.panelRect.w - 32);
    const many = this.built.length > 1;
    this.prev.setVisible(many);
    this.fwd.setVisible(many);
    const maxed = !Number.isFinite(cost);
    this.buy.label.setText(maxed ? 'MAX' : `UPGRADE · ${formatNum(cost)} E`).setColor(maxed ? TEXT_DIM : can ? ENERGY_CSS : TEXT_RED);
    this.buy.bg.setAlpha(can ? 1 : 0.5);
    this.buy.icon.clear();
  }

  private toggle(): void {
    if (this.open_) this.hide();
    else {
      this.kind = this.kind !== null && this.built.includes(this.kind) ? this.kind : (this.built[0] ?? null);
      if (this.kind !== null) this.showPanel(true);
    }
  }

  private cycle(d: number): void {
    if (this.kind === null || this.built.length < 2) return;
    const i = this.built.indexOf(this.kind);
    this.kind = this.built[(i + d + this.built.length) % this.built.length]!;
  }

  private buyNow(): void {
    if (this.kind !== null) this.cb.command({ type: 'upgradeStruct', kind: this.kind });
  }

  private showPanel(v: boolean): void {
    this.open_ = v;
    this.last = '';
    this.frame.setVisible(v);
    this.title.setVisible(v);
    this.level.setVisible(v);
    this.next.setVisible(v);
    this.prev.setVisible(v && this.built.length > 1);
    this.fwd.setVisible(v && this.built.length > 1);
    this.close.setVisible(v);
    this.buy.setVisible(v);
    if (v) this.update(this.cb.world(), false);
  }
}
