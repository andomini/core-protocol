// Verb VFX (uniqueness plan item 14): the audiovisual signature of boot pick, module docking, fusion, Pulse and
// the pick-card reveal. Render only; may use Math.random. Everything is a fixed pool of plain records drawn into one
// ADD-blended Graphics per layer (world fx / overlay cards), so nothing allocates per frame.
// (src/render/effects.ts is the general juice layer; this file only adds the verb-specific shapes.)

import Phaser from 'phaser';
import type { Tag } from '../sim/perkData';
import { WHITE } from './palette';
import { DEPTH } from './WorldView';

const enum K {
  Ring,
  Overload,
  Cryo,
  Chain,
  Mining,
  Firewall,
  Dock,
  Link,
}

interface Item {
  kind: K;
  x: number;
  y: number;
  x2: number;
  y2: number;
  r: number;
  c1: number;
  c2: number;
  start: number;
  dur: number;
  /** Random phase (spike angles). */
  seed: number;
}

/** Live verb effects at most (a Pulse is 1–2, a boot pick 3 docks, a fusion 1 link). */
export const MAX_VFX = 40;
/** Durations (ms). */
export const VFX_MS = { pulse: 900, firewall: 1100, dock: 520, dockStagger: 130, link: 650, button: 450 } as const;

const PULSE_KIND: Readonly<Record<Tag, K>> = { overload: K.Overload, cryo: K.Cryo, chain: K.Chain, mining: K.Mining, firewall: K.Firewall };

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

/** Strokes (or fills) a flat-topped hexagon of radius r at (x, y), rotated by `rot`. No allocation. */
function hexPath(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, rot: number, fill: boolean): void {
  g.beginPath();
  for (let i = 0; i <= 6; i++) {
    const a = rot + (Math.PI / 3) * i + Math.PI / 6;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  if (fill) g.fillPath();
  else g.strokePath();
}

export class Vfx {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly items: Item[] = [];
  private live = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(DEPTH.fx + 0.3).setBlendMode(Phaser.BlendModes.ADD);
    for (let i = 0; i < MAX_VFX; i++) this.items.push({ kind: K.Ring, x: 0, y: 0, x2: 0, y2: 0, r: 0, c1: 0, c2: 0, start: 0, dur: 1, seed: 0 });
  }

  private push(kind: K, x: number, y: number, x2: number, y2: number, r: number, c1: number, c2: number, dur: number, delay = 0): void {
    if (this.live >= MAX_VFX) return;
    const it = this.items[this.live++]!;
    it.kind = kind;
    it.x = x;
    it.y = y;
    it.x2 = x2;
    it.y2 = y2;
    it.r = r;
    it.c1 = c1;
    it.c2 = c2;
    it.start = this.scene.time.now + delay;
    it.dur = dur;
    it.seed = Math.random() * Math.PI * 2;
  }

  /** The Pulse from the core: a shape per dominant tag (overload boom, cryo spikes, chain jag, mining coins, firewall hex). */
  pulse(tag: Tag | null, x: number, y: number, r: number, color: number): void {
    const kind = tag ? PULSE_KIND[tag] : K.Ring;
    this.push(kind, x, y, 0, 0, r, color, WHITE, kind === K.Firewall ? VFX_MS.firewall : VFX_MS.pulse);
    // An echo ring trails every Pulse.
    this.push(K.Ring, x, y, 0, 0, r * 0.7, color, color, VFX_MS.pulse * 0.8, 90);
  }

  /** The HUD Pulse button answers the press: a ring off the button. */
  button(x: number, y: number, r: number, color: number): void {
    this.push(K.Ring, x, y, 0, 0, r, color, WHITE, VFX_MS.button);
  }

  /** A module docks into crystal hex (x, y) of radius R: a hex frame clamps down on it and flashes. */
  dock(x: number, y: number, R: number, color: number, index = 0): void {
    this.push(K.Dock, x, y, 0, 0, R, color, WHITE, VFX_MS.dock, index * VFX_MS.dockStagger);
  }

  /** A fusion link lights up: two heads race along a→b and b→a in their tags' colours and meet. */
  link(ax: number, ay: number, bx: number, by: number, ca: number, cb: number): void {
    this.push(K.Link, ax, ay, bx, by, 0, ca, cb, VFX_MS.link);
  }

  reset(): void {
    this.live = 0;
    this.g.clear();
  }

  update(): void {
    const g = this.g;
    if (this.live === 0) return;
    g.clear();
    const now = this.scene.time.now;
    let n = 0;
    for (let i = 0; i < this.live; i++) {
      const it = this.items[i]!;
      const t = (now - it.start) / it.dur;
      if (t >= 1) continue;
      if (t >= 0) this.draw(g, it, t);
      if (n !== i) {
        const tmp = this.items[n]!;
        this.items[n] = it;
        this.items[i] = tmp;
      }
      n++;
    }
    this.live = n;
  }

  private draw(g: Phaser.GameObjects.Graphics, it: Item, t: number): void {
    const e = easeOut(t);
    const f = 1 - t;
    const R = it.r * (0.2 + 0.8 * e);
    switch (it.kind) {
      case K.Ring:
        g.lineStyle(2 + 4 * f, it.c1, 0.85 * f).strokeCircle(it.x, it.y, R);
        break;
      case K.Overload:
        // Boom: a hot core flash, a thick shock front and a thinner white crest.
        g.fillStyle(it.c1, 0.3 * f * f).fillCircle(it.x, it.y, R * 0.55);
        g.lineStyle(4 + 12 * f, it.c1, 0.75 * f).strokeCircle(it.x, it.y, R);
        g.lineStyle(2, it.c2, 0.9 * f).strokeCircle(it.x, it.y, R * 0.92);
        break;
      case K.Cryo: {
        // Crystalline: 12 ice spikes standing on the front, a slowly turning hex inside.
        g.lineStyle(2 + 2 * f, it.c1, 0.8 * f).strokeCircle(it.x, it.y, R);
        g.lineStyle(2.5, it.c2, 0.85 * f);
        for (let k = 0; k < 12; k++) {
          const a = it.seed + (Math.PI / 6) * k;
          const c = Math.cos(a);
          const s = Math.sin(a);
          const l = (k % 2 === 0 ? 0.16 : 0.09) * it.r * f + 4;
          g.lineBetween(it.x + c * R, it.y + s * R, it.x + c * (R + l), it.y + s * (R + l));
        }
        g.lineStyle(2, it.c1, 0.6 * f);
        hexPath(g, it.x, it.y, R * 0.45, it.seed + t * 0.8, false);
        break;
      }
      case K.Chain: {
        // Electric: a jagged ring re-rolled every frame, a white core line.
        const amp = Math.max(4, it.r * 0.05) * (0.4 + f);
        for (let pass = 0; pass < 2; pass++) {
          g.lineStyle(pass === 0 ? 7 * f + 1 : 2, pass === 0 ? it.c1 : it.c2, (pass === 0 ? 0.45 : 0.95) * f);
          g.beginPath();
          for (let k = 0; k <= 28; k++) {
            const a = it.seed + ((Math.PI * 2) / 28) * k;
            const rr = R + (k === 28 || k === 0 ? 0 : (Math.random() - 0.5) * 2 * amp);
            const px = it.x + Math.cos(a) * rr;
            const py = it.y + Math.sin(a) * rr;
            if (k === 0) g.moveTo(px, py);
            else g.lineTo(px, py);
          }
          g.strokePath();
        }
        break;
      }
      case K.Mining: {
        // Coin cascade: the ring carries 10 spinning gold diamonds outward.
        g.lineStyle(2 + 2 * f, it.c1, 0.7 * f).strokeCircle(it.x, it.y, R);
        g.fillStyle(it.c1, 0.95 * f);
        const s = Math.max(4, it.r * 0.035) * (0.6 + 0.6 * f);
        for (let k = 0; k < 10; k++) {
          const a = it.seed + ((Math.PI * 2) / 10) * k + t * 0.6;
          const px = it.x + Math.cos(a) * R;
          const py = it.y + Math.sin(a) * R;
          const w = s * Math.abs(Math.cos(t * 14 + k));
          g.fillTriangle(px - w, py, px, py - s, px + w, py);
          g.fillTriangle(px - w, py, px, py + s, px + w, py);
        }
        break;
      }
      case K.Firewall: {
        // Shield: a hex wall expands fast, holds, then fades; an inner hex echoes it.
        const ex = easeOut(Math.min(1, t * 2.2));
        const a = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
        const HR = it.r * (0.25 + 0.75 * ex);
        g.fillStyle(it.c1, 0.1 * a);
        hexPath(g, it.x, it.y, HR, 0, true);
        g.lineStyle(3 + 5 * a, it.c1, 0.8 * a);
        hexPath(g, it.x, it.y, HR, 0, false);
        g.lineStyle(2, it.c2, 0.6 * a);
        hexPath(g, it.x, it.y, HR * 0.86, 0, false);
        break;
      }
      case K.Dock: {
        // The frame clamps from 2.4R onto the hex, then a white fill flashes and fades.
        const k = Math.min(1, t / 0.55);
        const ek = easeOut(k);
        const hr = it.r * (2.4 - 1.4 * ek);
        g.lineStyle(3, it.c1, 0.4 + 0.6 * ek * (t < 0.55 ? 1 : f / 0.45));
        hexPath(g, it.x, it.y, hr, (1 - ek) * 0.6, false);
        if (t >= 0.5) {
          const ff = 1 - (t - 0.5) / 0.5;
          g.fillStyle(it.c2, 0.55 * ff);
          hexPath(g, it.x, it.y, it.r * 0.95, 0, true);
          g.lineStyle(2, it.c1, 0.8 * ff).strokeCircle(it.x, it.y, it.r * (1 + 1.6 * (1 - ff)));
        }
        break;
      }
      case K.Link: {
        // A glow along the link, two heads meeting at the seam, a seam burst at the end.
        const dx = it.x2 - it.x;
        const dy = it.y2 - it.y;
        g.lineStyle(10 * f + 2, it.c1, 0.25 * f).lineBetween(it.x, it.y, it.x2, it.y2);
        const h = Math.min(1, t / 0.45);
        const hx = it.x + dx * 0.5 * h;
        const hy = it.y + dy * 0.5 * h;
        const kx = it.x2 - dx * 0.5 * h;
        const ky = it.y2 - dy * 0.5 * h;
        g.lineStyle(4, it.c1, 0.95 * f).lineBetween(it.x, it.y, hx, hy);
        g.lineStyle(4, it.c2, 0.95 * f).lineBetween(it.x2, it.y2, kx, ky);
        g.fillStyle(WHITE, 0.95 * f).fillCircle(hx, hy, 5).fillCircle(kx, ky, 5);
        if (h >= 1) {
          const m = (t - 0.45) / 0.55;
          g.lineStyle(3, WHITE, 0.9 * (1 - m)).strokeCircle(it.x + dx / 2, it.y + dy / 2, 6 + 30 * easeOut(m));
        }
        break;
      }
    }
  }
}

// --- pick cards ---

interface CardItem {
  x: number;
  y: number;
  w: number;
  h: number;
  color: number;
  start: number;
  dur: number;
  /** 0: a one-shot flash; 1: a strong (epic) flash; 2: a breathing glow until cleared. */
  mode: 0 | 1 | 2;
}

/** Rarity flashes and boot-card glows over the pick overlay (one ADD Graphics, ticks itself while anything lives). */
export class CardFx {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly items: CardItem[] = [];
  private live = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    depth: number,
  ) {
    this.g = scene.add.graphics().setDepth(depth).setBlendMode(Phaser.BlendModes.ADD);
    for (let i = 0; i < 8; i++) this.items.push({ x: 0, y: 0, w: 0, h: 0, color: 0, start: 0, dur: 1, mode: 0 });
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.tick, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off(Phaser.Scenes.Events.UPDATE, this.tick, this));
  }

  private push(r: { x: number; y: number; w: number; h: number }, color: number, delay: number, dur: number, mode: CardItem['mode']): void {
    if (this.live >= this.items.length) return;
    const it = this.items[this.live++]!;
    it.x = r.x;
    it.y = r.y;
    it.w = r.w;
    it.h = r.h;
    it.color = color;
    it.start = this.scene.time.now + delay;
    it.dur = dur;
    it.mode = mode;
  }

  /** A rarity flash over card rect `r` after `delay` ms (epic: brighter, with a second outline). */
  flash(r: { x: number; y: number; w: number; h: number }, color: number, delay: number, epic: boolean): void {
    this.push(r, color, delay, epic ? 650 : 480, epic ? 1 : 0);
  }

  /** A breathing glow in `color` around card rect `r` (boot sector cards) until clear(). */
  glow(r: { x: number; y: number; w: number; h: number }, color: number, delay: number): void {
    this.push(r, color, delay, 1, 2);
  }

  clear(): void {
    this.live = 0;
    this.g.clear();
  }

  private tick(): void {
    if (this.live === 0) return;
    const g = this.g.clear();
    const now = this.scene.time.now;
    let n = 0;
    for (let i = 0; i < this.live; i++) {
      const it = this.items[i]!;
      const dt = now - it.start;
      const t = it.mode === 2 ? 0 : dt / it.dur;
      if (t >= 1) continue;
      if (dt >= 0) {
        if (it.mode === 2) {
          // Boot glow: fades in, then breathes at ~0.9 Hz.
          const a = Math.min(1, dt / 300) * (0.35 + 0.3 * Math.sin(dt / 170));
          g.lineStyle(6, it.color, 0.35 * a).strokeRoundedRect(it.x - 5, it.y - 5, it.w + 10, it.h + 10, 18);
          g.lineStyle(2, it.color, 0.9 * a).strokeRoundedRect(it.x - 2, it.y - 2, it.w + 4, it.h + 4, 16);
        } else {
          const f = 1 - t;
          g.fillStyle(it.color, (it.mode === 1 ? 0.32 : 0.22) * f * f).fillRoundedRect(it.x, it.y, it.w, it.h, 14);
          const grow = 4 + 14 * easeOut(t);
          g.lineStyle(3, it.color, 0.9 * f).strokeRoundedRect(it.x - grow, it.y - grow, it.w + grow * 2, it.h + grow * 2, 16);
          if (it.mode === 1) g.lineStyle(2, WHITE, 0.7 * f).strokeRoundedRect(it.x - grow * 0.5, it.y - grow * 0.5, it.w + grow, it.h + grow, 15);
        }
      }
      if (n !== i) {
        const tmp = this.items[n]!;
        this.items[n] = it;
        this.items[i] = tmp;
      }
      n++;
    }
    this.live = n;
    if (n === 0) g.clear();
  }
}

type Movable = Phaser.GameObjects.GameObject & { y: number; alpha: number; setAlpha(a: number): unknown };

/**
 * Card reveal: a card's objects slide up `dy` px and fade in after `delay` ms. The offset is applied as a delta, so
 * `finish()` (before a refill or hide) always returns every object to exactly where its layout put it.
 */
export class SlideIn {
  private objs: Movable[] = [];
  private off = 0;
  private tween: Phaser.Tweens.Tween | null = null;
  private readonly state = { k: 0 };

  constructor(private readonly scene: Phaser.Scene) {}

  start(objs: Movable[], dy: number, delay: number, dur: number): void {
    this.finish();
    this.objs = objs;
    this.off = dy;
    for (const o of objs) {
      o.y += dy;
      o.setAlpha(0);
    }
    this.state.k = 0;
    this.tween = this.scene.tweens.add({
      targets: this.state,
      k: 1,
      delay,
      duration: dur,
      ease: 'Back.easeOut',
      onUpdate: () => this.apply(dy * (1 - this.state.k), Math.min(1, this.state.k * 1.6)),
      onComplete: () => {
        this.tween = null;
        this.finish();
      },
    });
  }

  private apply(off: number, alpha: number): void {
    const d = off - this.off;
    this.off = off;
    for (const o of this.objs) {
      o.y += d;
      o.setAlpha(alpha);
    }
  }

  /** Snap to the final state (no offset, full alpha) and stop. */
  finish(): void {
    if (this.tween) {
      const tw = this.tween;
      this.tween = null;
      tw.remove();
    }
    if (this.objs.length > 0) this.apply(0, 1);
    this.objs = [];
  }
}
