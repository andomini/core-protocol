// The crystal editor (spec 2026-10-15 §5, replaces the placement panel): the crystal zooms in above a scrim
// and the HUD column (portrait: the HUD strip and the upgrade panel) shows a title, a readout of what the
// hovered choice would change, the bonus strip (every tag's count and set tier, every linked pair's links and
// fusion tier) and the buttons. Place mode bolts a new module on (free slots coloured by what they add, the
// auto slot pulsing); Arrange mode moves modules: tap one, then a hex (or drag on desktop) — an empty hex
// moves it, a module swaps with it. Targets are coloured by the outcome, invalid hexes dim. UNDO walks back
// the moves of this session. Commands go through the scene (applied at once: the battle is paused).

import Phaser from 'phaser';
import { type CrystalDiff, crystalSlots, fusionLinkCounts, movePreview, slotGains, autoSlot, freeSlots, pairLinkSlots } from '../sim/crystal';
import type { GameData } from '../sim/data';
import { fusionKeys, TAGS, type Tag } from '../sim/perkData';
import { nextFusionTier, tagCounts } from '../sim/perks';
import type { World } from '../sim/state';
import { crystalRing } from '../sim/territory';
import type { CrystalView, EditState } from '../render/CrystalView';
import { BG, CRIMSON, CYAN, PANEL_FILL, TAG_COLOR, TAG_CSS, TEXT, TEXT_DIM, WHITE } from '../render/palette';
import { DEPTH } from '../render/WorldView';
import { Button, panel, text } from './kit';
import type { Layout, Rect } from './layout';
import { fusionLevel, fusionTags, latticeLine } from './perkText';
import { drawTagIcon } from './tagIcon';

const D = DEPTH.overlay - 4;
const GREEN = '#2bffb0';
const RED = '#ff3b5c';
const SECTOR_NAMES = ['east', 'north-east', 'north-west', 'west', 'south-west', 'south-east'];
const FLASH_MS = 1500;
const RULES = [
  'Touching same-tag modules form a set; only the largest cluster counts (dashed modules add nothing)',
  'Links between the largest clusters: 1 / 3 / 5 → fusion I / II / III (rises weld in 5 s)',
  'Tap a pair chip: glowing hexes add a link to it',
  'Wedges: most modules in a 60° sector colour its ground',
  'Tap a module, then a hex: move or swap',
];

export type EditorMode = 'place' | 'arrange';

export interface EditorHandlers {
  /** Take the offer card with its module at `slot` (null = the auto slot). */
  place: (slot: [number, number] | null) => void;
  /** Place mode: back to the cards. */
  back: () => void;
  /** Place mode: auto-place from now on (and place this one). */
  always: () => void;
  move: (from: [number, number], to: [number, number]) => void;
  done: () => void;
}

interface StripEntry {
  tags: Tag[];
  label: string;
  color: string;
  on: boolean;
  plain: string;
  /** A pair chip's fusion key (tappable). */
  key?: string;
}

interface Line {
  text: string;
  color: string;
}

/** Readout lines for a diff: sets, fusions, wedges; green when a tier rises, red when it falls. */
export function diffLines(data: GameData, d: CrystalDiff | null): Line[] {
  if (!d) return [{ text: 'Not allowed here', color: RED }];
  const out: Line[] = [];
  const tone = (a: number, b: number): string => (b > a ? GREEN : b < a ? RED : TEXT_DIM);
  for (const s of d.sets) {
    const name = data.sets.tags[s.tag].name;
    const tier = s.tierTo > s.tierFrom ? `: ${s.tierTo}-set online` : s.tierTo < s.tierFrom ? `: ${s.tierFrom}-set offline` : '';
    out.push({ text: `${name} ${s.from} → ${s.to}${tier}`, color: tone(s.tierFrom, s.tierTo) });
  }
  for (const f of d.fusions) {
    const name = data.sets.fusions[f.key]!.name;
    const tier =
      f.tierTo > f.tierFrom
        ? `: ${fusionLevel(data, f.tierTo)} online`
        : f.tierTo < f.tierFrom
          ? f.tierTo > 0
            ? `: ${fusionLevel(data, f.tierFrom)} → ${fusionLevel(data, f.tierTo)}`
            : `: ${fusionLevel(data, f.tierFrom)} offline`
          : '';
    out.push({ text: `${name} links ${f.from} → ${f.to}${tier}`, color: tone(f.tierFrom, f.tierTo) });
  }
  for (const s of d.sectors) {
    const n = (t: Tag | null): string => (t === null ? 'empty' : data.sets.tags[t].name);
    out.push({ text: `${SECTOR_NAMES[s.sector]} wedge: ${n(s.from)} → ${n(s.to)}`, color: TEXT_DIM });
  }
  if (out.length === 0) return [{ text: 'No change', color: TEXT_DIM }];
  // Tier changes first; at most three lines.
  const ranked = [...out.filter((l) => l.color !== TEXT_DIM), ...out.filter((l) => l.color === TEXT_DIM)];
  if (ranked.length <= 3) return ranked;
  return [ranked[0]!, ranked[1]!, { text: `+${ranked.length - 2} more`, color: TEXT_DIM }];
}

/**
 * Outline colour for a choice (spec §5): red if any tier falls; else the module's tag colour when it grows
 * its set, the partner tag's colour when it adds a link, white for both, cyan for neither (a wedge change
 * alone stays neutral).
 */
export function outcomeColor(d: CrystalDiff, tag: Tag): number {
  if (d.sets.some((s) => s.tierTo < s.tierFrom) || d.fusions.some((f) => f.tierTo < f.tierFrom)) return CRIMSON;
  const grew = d.sets.some((s) => s.tag === tag && s.to > s.from);
  const link = d.fusions.find((f) => f.to > f.from);
  if (grew && link) return WHITE;
  if (grew) return TAG_COLOR[tag];
  if (link) {
    const [a, b] = fusionTags(link.key);
    return TAG_COLOR[a === tag ? b : a];
  }
  return CYAN;
}

/** Every hex module `i` may move (or swap) to, outlined in its outcome colour (the editor and the field drag). */
export function moveTargets(w: World, data: GameData, i: number): EditState['targets'] {
  const targets: EditState['targets'] = [];
  const m = w.crystal[i];
  if (!m) return targets;
  for (const [q, r] of crystalSlots(data, crystalRing(data, w.wave))) {
    if (q === m.q && r === m.r) continue;
    const d = movePreview(w, data, [m.q, m.r], [q, r]);
    if (d) targets.push({ q, r, color: outcomeColor(d, m.tag) });
  }
  return targets;
}

export class CrystalEditor {
  private readonly scrim: Phaser.GameObjects.Rectangle;
  private readonly panels: Phaser.GameObjects.Image[] = [];
  private readonly title: Phaser.GameObjects.Text;
  private readonly sub: Phaser.GameObjects.Text;
  private readonly readout: Phaser.GameObjects.Text[] = [];
  private readonly stripG: Phaser.GameObjects.Graphics;
  private readonly stripT: Phaser.GameObjects.Text[] = [];
  private readonly rules: Phaser.GameObjects.Text;
  private readonly backBtn: Button;
  private readonly autoBtn: Button;
  private readonly alwaysBtn: Button;
  private readonly undoBtn: Button;
  private readonly doneBtn: Button;
  /** Where the readout, strip and rules go. */
  private readonly area: Rect;
  private readonly fs: number;
  private readonly lineH: number;
  private readonly readoutY: number;
  /** The strip and the rules end above this (the button row's top less a gap). */
  readonly stripBottom: number;
  private showRules = false;
  private armedAt = 0;
  private perk = '';
  private hoverHex: [number, number] | null = null;
  private drag: { from: number; x: number; y: number; moved: boolean; toggle: boolean } | null = null;
  private readonly undo: { from: [number, number]; to: [number, number] }[] = [];
  private flash: { lines: Line[]; until: number } | null = null;
  /** The tapped pair chip (fusion key) whose link hexes glow, or null. */
  private pair: string | null = null;
  /** Tappable pair chips of the strip (logical px). */
  private chipRects: { key: string; r: Rect }[] = [];
  visible = false;
  mode: EditorMode = 'arrange';
  /** Place mode: the offer index whose module is being placed. */
  index = -1;
  /** Arrange mode: the selected module, or −1. */
  selected = -1;
  /** For the smoke: the readout and the bonus strip as plain strings. */
  readoutLines: string[] = [];
  stripLines: string[] = [];
  /** For the smoke: the strip's bottom edge and the limit it must stay above (the buttons' top less a gap). */
  stripEnd = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly L: Layout,
    private readonly data: GameData,
    private readonly crystal: CrystalView,
    private readonly world: () => World,
    private readonly h: EditorHandlers,
  ) {
    const portrait = L.o === 'portrait';
    this.fs = portrait ? L.minFont : L.minFont + 2;
    this.lineH = Math.round(this.fs * 1.3);
    this.scrim = scene.add.rectangle(0, 0, L.w, L.h, BG, 0.82).setOrigin(0).setDepth(D - 2);
    this.scrim.on('pointerdown', (p: Phaser.Input.Pointer) => this.down(p.worldX, p.worldY));
    this.scrim.on('pointermove', (p: Phaser.Input.Pointer) => this.move(p.worldX, p.worldY));
    this.scrim.on('pointerup', (p: Phaser.Input.Pointer) => this.up(p.worldX, p.worldY));
    const pst = { fill: PANEL_FILL, fillA: 1, edge: CYAN, cut: 10, lw: 2, blur: 8 };
    let top: Rect;
    if (portrait) {
      top = { x: 16, y: 12, w: L.w - 32, h: L.hud.h - 24 };
      this.area = { x: 24, y: L.panel.y + 12, w: L.w - 48, h: L.panel.h - 24 };
      this.panels.push(panel(scene, { x: 8, y: 6, w: L.w - 16, h: L.hud.h - 12 }, D - 0.5, pst));
      this.panels.push(panel(scene, { x: 8, y: L.panel.y + 4, w: L.w - 16, h: L.h - L.panel.y - 10 }, D - 0.5, pst));
    } else {
      const x = L.arena.x + L.arena.w;
      top = { x: x + 20, y: 20, w: L.w - x - 40, h: 100 };
      this.area = { x: x + 20, y: 104, w: L.w - x - 40, h: L.h - 104 - 90 };
      this.panels.push(panel(scene, { x: x + 6, y: 6, w: L.w - x - 12, h: L.h - 12 }, D - 0.5, pst));
    }
    const tfs = portrait ? 40 : 30;
    this.title = text(scene, top.x, top.y, '', tfs, { font: 'title', weight: '900', glow: '#22e5ff', blur: 14 }).setDepth(D + 0.3);
    this.sub = text(scene, top.x, top.y + tfs + (portrait ? 16 : 18), '', this.fs, { color: TEXT_DIM }).setDepth(D + 0.3);
    this.readoutY = portrait ? this.area.y : this.area.y;
    for (let i = 0; i < 3; i++) this.readout.push(text(scene, this.area.x, this.readoutY + i * this.lineH, '', this.fs, { weight: '700' }).setDepth(D + 0.3));
    this.stripG = scene.add.graphics().setDepth(D + 0.3);
    this.rules = text(scene, this.area.x, 0, RULES.map((r) => `• ${r}`).join('\n'), portrait ? L.minFont : L.minFont, {
      color: TEXT,
      weight: '600',
    })
      .setWordWrapWidth(this.area.w)
      .setDepth(D + 0.3);
    const bh = portrait ? 76 : 54;
    const gap = portrait ? 16 : 12;
    const by = L.h - bh - (portrait ? 24 : 18);
    this.stripBottom = by - (portrait ? 12 : 8);
    const r3 = (i: number): Rect => {
      const bw = (this.area.w - gap * 2) / 3;
      return { x: this.area.x + i * (bw + gap), y: by, w: bw, h: bh };
    };
    const r2 = (i: number): Rect => {
      const bw = (this.area.w - gap) / 2;
      return { x: this.area.x + i * (bw + gap), y: by, w: bw, h: bh };
    };
    const font = portrait ? 28 : 19;
    const st = { font: 'title' as const, edge: CYAN, fill: 0x062a3a, lw: 2.5, blur: 12 };
    this.backBtn = new Button(scene, r3(0), 'BACK', font, D + 0.4, () => this.guard(() => this.h.back()), st);
    this.autoBtn = new Button(scene, r3(1), 'AUTO', font, D + 0.4, () => this.guard(() => this.placeAt(null)), st);
    this.alwaysBtn = new Button(scene, r3(2), 'AUTO ALL', font, D + 0.4, () => this.guard(() => this.h.always()), st);
    this.undoBtn = new Button(scene, r2(0), 'UNDO', font, D + 0.4, () => this.guard(() => this.undoMove()), st);
    this.doneBtn = new Button(scene, r2(1), 'DONE', font, D + 0.4, () => this.guard(() => this.h.done()), { ...st, edge: 0x2bffb0 });
    this.hide();
  }

  private guard(f: () => void): void {
    if (!this.visible || this.scene.time.now < this.armedAt) return;
    f();
  }

  /** The zoom that fits the ring limit into ~78 % of the arena's short side (and the next, locked ring into ~92 %). */
  private scale(w: World): number {
    const a = this.L.arena;
    const c = this.data.crystal;
    const ring = crystalRing(this.data, w.wave);
    const fit = (share: number, k: number): number => (share * Math.min(a.w, a.h)) / ((k * Math.sqrt(3) + 1) * c.cellSize);
    return ring < c.maxRingCap ? Math.min(fit(0.39, ring), fit(0.46, ring + 1)) : fit(0.39, ring);
  }

  /** Opens in Place mode for offer card `index` (perk `perk` adds a new module). */
  openPlace(index: number, perk: string, now: number, showRules: boolean): void {
    this.mode = 'place';
    this.index = index;
    this.perk = perk;
    this.open(now, showRules);
  }

  openArrange(now: number, showRules: boolean): void {
    this.mode = 'arrange';
    this.index = -1;
    this.open(now, showRules);
  }

  private open(now: number, showRules: boolean): void {
    this.visible = true;
    this.armedAt = now + 150;
    this.undo.length = 0;
    this.flash = null;
    this.selected = -1;
    this.drag = null;
    this.hoverHex = null;
    this.pair = null;
    this.scrim.setVisible(true).setInteractive();
    for (const p of this.panels) p.setVisible(true);
    this.title.setVisible(true);
    this.sub.setVisible(true);
    for (const t of this.readout) t.setVisible(true);
    this.stripG.setVisible(true);
    this.showRules = showRules;
    this.crystal.setZoom({ scale: this.scale(this.world()) });
    this.refresh(now);
  }

  hide(): void {
    this.visible = false;
    this.index = -1;
    this.selected = -1;
    this.drag = null;
    this.scrim.setVisible(false).disableInteractive();
    for (const p of this.panels) p.setVisible(false);
    this.title.setVisible(false);
    this.sub.setVisible(false);
    for (const t of this.readout) t.setVisible(false);
    this.stripG.clear().setVisible(false);
    for (const t of this.stripT) t.setVisible(false);
    this.rules.setVisible(false);
    for (const b of [this.backBtn, this.autoBtn, this.alwaysBtn, this.undoBtn, this.doneBtn]) b.setVisible(false);
    this.crystal.setZoom(null);
    this.crystal.placing = null;
    this.crystal.edit = null;
    this.crystal.pairGlow = null;
    this.pair = null;
  }

  /** Per frame while open: the post-move readout expires. */
  update(now: number): void {
    if (this.visible && this.flash && now >= this.flash.until) {
      this.flash = null;
      this.drawReadout();
    }
  }

  /** Recomputes everything from the World (after a command or a mode switch). */
  private refresh(now: number): void {
    const w = this.world();
    const place = this.mode === 'place';
    for (const b of [this.backBtn, this.autoBtn, this.alwaysBtn]) b.setVisible(place);
    for (const b of [this.undoBtn, this.doneBtn]) b.setVisible(!place);
    if (place) {
      const def = this.data.perks.perks[this.perk]!;
      const free = freeSlots(w, this.data);
      this.crystal.placing = {
        tag: def.tag,
        free,
        colors: free.map((s) => {
          const d = slotGains(w, this.data, this.perk, s);
          return d ? outcomeColor(d, def.tag) : CYAN;
        }),
        auto: autoSlot(w, this.data, def.tag),
      };
      this.crystal.edit = null;
      this.title.setText(`PLACE ${def.name.toUpperCase()}`).setColor(TAG_CSS[def.tag]);
      this.sub.setText('Tap a hex · its colour shows the gain');
      this.autoBtn.bg.setTint(TAG_COLOR[def.tag]);
    } else {
      this.crystal.placing = null;
      this.crystal.edit = this.editState(w);
      this.title.setText('ARRANGE CRYSTAL').setColor('#e8fbff');
      this.sub.setText(this.selected >= 0 ? 'Tap where it goes · a module swaps' : 'Tap a module to move it');
      this.undoBtn.label.setAlpha(this.undo.length > 0 ? 1 : 0.4);
    }
    this.crystal.pairGlow = this.pair ? { hexes: this.glowHexes(w, this.pair), color: WHITE } : null;
    this.drawStrip(w);
    this.drawReadout();
    void now;
  }

  /** Hexes that add a link to pair `key`: place mode, the free slots for this module; arrange mode, the
   * selected module's targets that add one, or (nothing selected) the free hexes where either tag adds one. */
  private glowHexes(w: World, key: string): [number, number][] {
    if (this.mode === 'place') {
      const tag = this.data.perks.perks[this.perk]!.tag;
      return fusionTags(key).includes(tag) ? pairLinkSlots(w, this.data, key, [tag]) : [];
    }
    const m = w.crystal[this.selected];
    if (!m) return pairLinkSlots(w, this.data, key);
    const out: [number, number][] = [];
    for (const t of this.crystal.edit?.targets ?? []) {
      const d = movePreview(w, this.data, [m.q, m.r], [t.q, t.r]);
      if (d?.fusions.some((f) => f.key === key && f.to > f.from)) out.push([t.q, t.r]);
    }
    return out;
  }

  /** Pair chip text: `II · 2 → III` (tier · links → next level), `MAX` at the top, `weld` while a rise settles. */
  pairLabel(w: World, key: string, links: number): string {
    const tier = w.fusionTiers[key] ?? 0;
    const next = nextFusionTier(this.data, links, key);
    const pend = w.fusionPending[key];
    const nxt = pend ? `${fusionLevel(this.data, pend.tier)} weld` : next > 0 ? fusionLevel(this.data, next) : 'MAX';
    return `${tier > 0 ? fusionLevel(this.data, tier) : '–'} · ${links} → ${nxt}`;
  }

  private editState(w: World): EditState {
    return { selected: this.selected, targets: moveTargets(w, this.data, this.selected), ghost: this.crystal.edit?.ghost ?? null };
  }

  private currentLines(): Line[] {
    if (this.flash) return this.flash.lines;
    const w = this.world();
    if (this.mode === 'place') {
      const slot = this.hoverHex && this.crystal.placing?.free.find(([q, r]) => q === this.hoverHex![0] && r === this.hoverHex![1]);
      return diffLines(this.data, slotGains(w, this.data, this.perk, slot ?? undefined));
    }
    const m = w.crystal[this.selected];
    if (!m) return [{ text: 'Select a module', color: TEXT_DIM }];
    const hx = this.hoverHex;
    if (!hx || (hx[0] === m.q && hx[1] === m.r)) return [{ text: 'Pick a target hex', color: TEXT_DIM }];
    return diffLines(this.data, movePreview(w, this.data, [m.q, m.r], hx));
  }

  private drawReadout(): void {
    const lines = this.currentLines();
    this.readoutLines = lines.map((l) => l.text);
    this.readout.forEach((t, i) => {
      const l = lines[i];
      t.setText(l ? l.text : '').setColor(l ? l.color : TEXT_DIM);
    });
  }

  /**
   * The bonus strip: the Lattice chip, every tag (count · set tier), then every pair with a link or with both
   * tags on the crystal (links · fusion tier → next). It never runs into the buttons: when it would, the pair
   * chips drop the "→ next" part, then the pairs with no link (unless tapped) go, then the tail folds into "+N".
   */
  private drawStrip(w: World): void {
    const g = this.stripG.clear();
    const counts = tagCounts(w, this.data);
    const links = fusionLinkCounts(w, this.data);
    const head: StripEntry[] = [];
    const lattice = latticeLine(this.data, w);
    head.push({ tags: [], label: lattice, color: '#ffd23b', on: true, plain: lattice });
    for (const tag of TAGS) {
      const tier = w.setTiers[tag] ?? 0;
      head.push({
        tags: [tag],
        label: `${counts[tag]} · ${tier > 0 ? `${tier}-set` : '–'}`,
        color: tier > 0 ? TAG_CSS[tag] : TEXT_DIM,
        on: tier > 0 || counts[tag] > 0,
        plain: `${this.data.sets.tags[tag].name} ${counts[tag]}·${tier}`,
      });
    }
    // Pair chips: every pair with a link or with both tags on the crystal (tap → its link hexes glow).
    const present = new Set(w.crystal.map((m) => m.tag));
    const pairs: (StripEntry & { short: string; bare: boolean })[] = [];
    for (const key of fusionKeys()) {
      const n = links[key] ?? 0;
      const [ta, tb] = fusionTags(key);
      if (n <= 0 && !(present.has(ta) && present.has(tb))) continue;
      const tier = w.fusionTiers[key] ?? 0;
      const label = this.pairLabel(w, key, n);
      pairs.push({
        tags: [ta, tb],
        label,
        short: `${tier > 0 ? fusionLevel(this.data, tier) : '–'} · ${n}${w.fusionPending[key] ? '…' : ''}`,
        bare: n <= 0 && w.fusionPending[key] === undefined && this.pair !== key,
        color: this.pair === key ? '#2bffb0' : tier > 0 ? '#ffffff' : TEXT_DIM,
        on: true,
        plain: `${this.data.sets.fusions[key]!.name} ${label}`,
        key,
      });
    }
    this.stripLines = [...head, ...pairs].map((e) => e.plain);
    const top = this.readoutY + this.lineH * 3 + Math.round(this.fs * 0.6);
    let entries: StripEntry[] = [...head, ...pairs];
    let lay = this.layStrip(entries, top);
    if (lay.end > this.stripBottom) {
      entries = [...head, ...pairs.map((e) => ({ ...e, label: e.short }))];
      lay = this.layStrip(entries, top);
    }
    if (lay.end > this.stripBottom) {
      entries = [...head, ...pairs.filter((e) => !e.bare).map((e) => ({ ...e, label: e.short }))];
      lay = this.layStrip(entries, top);
    }
    const total = head.length + pairs.length;
    if (lay.end > this.stripBottom) {
      // Fold the tail into "+N" until the rest fits.
      const kept = entries.slice();
      let folded = entries;
      while (kept.length > 1) {
        kept.pop();
        folded = [...kept, { tags: [], label: `+${total - kept.length}`, color: TEXT_DIM, on: true, plain: '' }];
        lay = this.layStrip(folded, top);
        if (lay.end <= this.stripBottom) break;
      }
      entries = folded;
    }
    this.chipRects = [];
    entries.forEach((e, i) => {
      const t = this.stripT[i]!.setVisible(true);
      const p = lay.at[i]!;
      const icon = lay.icon;
      e.tags.forEach((tag, k) => drawTagIcon(g, tag, p.x + icon / 2 + k * (icon + 2), p.cy, icon, TAG_COLOR[tag], e.on ? 1 : 0.35));
      t.setPosition(p.x + p.wIcons + (e.tags.length > 0 ? 6 : 0), p.cy);
      if (e.key) {
        this.chipRects.push({ key: e.key, r: { x: p.x - 4, y: p.y, w: p.wd + 8, h: lay.rowH } });
        if (this.pair === e.key) g.lineStyle(2, 0x2bffb0, 0.9).strokeRect(p.x - 4, p.y + 1, p.wd + 8, lay.rowH - 2);
      }
    });
    for (let i = entries.length; i < this.stripT.length; i++) this.stripT[i]!.setVisible(false);
    // The rules (first open) sit under the strip, only when they fit above the buttons.
    const ry = lay.end + Math.round(this.fs * 0.5);
    this.rules.setY(ry).setVisible(this.showRules && ry + this.rules.height <= this.stripBottom);
    this.stripEnd = lay.end;
  }

  /** Lays the strip entries out in rows from `top` (texts set, not yet placed); `end` is the last row's bottom. */
  private layStrip(entries: readonly StripEntry[], top: number): { at: { x: number; y: number; cy: number; wd: number; wIcons: number }[]; end: number; rowH: number; icon: number } {
    const icon = Math.round(this.fs * 1.15);
    const rowH = Math.round(this.fs * 1.55);
    const gapX = Math.round(this.fs * 0.9);
    const right = this.area.x + this.area.w;
    let x = this.area.x;
    let y = top;
    const at: { x: number; y: number; cy: number; wd: number; wIcons: number }[] = [];
    entries.forEach((e, i) => {
      let t = this.stripT[i];
      if (!t) {
        t = text(this.scene, 0, 0, '', this.fs, { weight: '700' }).setOrigin(0, 0.5).setDepth(D + 0.31).setVisible(false);
        this.stripT.push(t);
      }
      t.setText(e.label).setColor(e.color);
      const wIcons = e.tags.length * (icon + 2);
      const wd = wIcons + (e.tags.length > 0 ? 6 : 0) + t.width;
      if (x > this.area.x && x + wd > right) {
        x = this.area.x;
        y += rowH;
      }
      at.push({ x, y, cy: y + rowH / 2, wd, wIcons });
      x += wd + gapX;
    });
    return { at, end: y + rowH, rowH, icon };
  }

  private placeAt(slot: [number, number] | null): void {
    if (this.mode !== 'place') return;
    const w = this.world();
    const d = slotGains(w, this.data, this.perk, slot ?? undefined);
    this.h.place(slot);
    this.mode = 'arrange';
    this.index = -1;
    this.selected = -1;
    this.flash = { lines: diffLines(this.data, d), until: this.scene.time.now + FLASH_MS };
    this.refresh(this.scene.time.now);
  }

  private commit(from: [number, number], to: [number, number], record: boolean): boolean {
    const w = this.world();
    const d = movePreview(w, this.data, from, to);
    if (!d) return false;
    this.h.move(from, to);
    if (record) this.undo.push({ from, to });
    this.selected = -1;
    this.flash = { lines: diffLines(this.data, d), until: this.scene.time.now + FLASH_MS };
    if (this.crystal.edit) this.crystal.edit.ghost = null;
    this.refresh(this.scene.time.now);
    return true;
  }

  private undoMove(): void {
    if (this.mode !== 'arrange') return;
    const last = this.undo.pop();
    if (!last) return;
    // The module that moved now sits at `to`; moving it back to `from` also undoes a swap.
    this.commit(last.to, last.from, false);
  }

  /** Arrange: moves (or swaps) the selected module to hex (q, r) if that is allowed. */
  moveSelected(q: number, r: number): boolean {
    const m = this.world().crystal[this.selected];
    return m ? this.commit([m.q, m.r], [q, r], true) : false;
  }

  select(i: number): void {
    this.selected = i;
    this.flash = null;
    this.refresh(this.scene.time.now);
  }

  private isTarget(q: number, r: number): boolean {
    return this.crystal.edit?.targets.some((t) => t.q === q && t.r === r) ?? false;
  }

  /** Toggles the glow of pair chip `key` (null clears it). */
  tapPair(key: string | null): void {
    this.pair = key === this.pair ? null : key;
    this.refresh(this.scene.time.now);
  }

  /** Pair chip rects (logical px), for the UI smoke. */
  pairChips(): { key: string; r: Rect }[] {
    return this.chipRects;
  }

  /** Hexes glowing for the tapped pair chip, for the UI smoke. */
  glowing(): [number, number][] {
    return this.crystal.pairGlow?.hexes ?? [];
  }

  private down(x: number, y: number): void {
    if (!this.visible || this.scene.time.now < this.armedAt) return;
    const chip = this.chipRects.find((c) => x >= c.r.x && x <= c.r.x + c.r.w && y >= c.r.y && y <= c.r.y + c.r.h);
    if (chip) {
      this.tapPair(chip.key);
      return;
    }
    const [q, r] = this.crystal.hexAt(x, y);
    this.hoverHex = [q, r];
    if (this.mode === 'place') {
      const s = this.crystal.slotAt(x, y);
      if (s) this.placeAt(s);
      else this.drawReadout();
      return;
    }
    const w = this.world();
    const i = w.crystal.findIndex((m) => m.q === q && m.r === r);
    if (this.selected >= 0 && i !== this.selected && this.isTarget(q, r)) {
      this.moveSelected(q, r);
      return;
    }
    if (i >= 0) {
      const toggle = i === this.selected;
      if (!toggle) this.select(i);
      this.drag = { from: i, x, y, moved: false, toggle };
      return;
    }
    if (this.selected >= 0) this.select(-1);
  }

  private move(x: number, y: number): void {
    if (!this.visible) return;
    const hx = this.crystal.hexAt(x, y);
    const changed = !this.hoverHex || this.hoverHex[0] !== hx[0] || this.hoverHex[1] !== hx[1];
    this.hoverHex = hx;
    const d = this.drag;
    if (d && this.crystal.edit) {
      if (!d.moved && Math.hypot(x - d.x, y - d.y) > 10) d.moved = true;
      if (d.moved) this.crystal.edit.ghost = [x, y];
    }
    if (changed && !this.flash) this.drawReadout();
  }

  private up(x: number, y: number): void {
    const d = this.drag;
    this.drag = null;
    if (!d || !this.visible) return;
    if (this.crystal.edit) this.crystal.edit.ghost = null;
    if (d.moved) {
      const [q, r] = this.crystal.hexAt(x, y);
      if (this.isTarget(q, r)) this.moveSelected(q, r);
    } else if (d.toggle) this.select(-1);
  }

  /** Button rects (logical px), for the UI smoke. */
  rects(): { auto: Rect; back: Rect; always: Rect; undo: Rect; done: Rect } {
    return { auto: this.autoBtn.r, back: this.backBtn.r, always: this.alwaysBtn.r, undo: this.undoBtn.r, done: this.doneBtn.r };
  }
}
