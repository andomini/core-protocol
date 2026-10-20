// c2: the Territory Beacon button (src/sim/beacon.ts; captioned CLAIM, B key), left of the Pulse button in the arena's bottom-right corner.
// Shows the Energy cost while none stands (dim when it cannot be placed: too poor, none of the front left, a pick
// open), and the hold progress (waves held / needed, as pips around the mast glyph) while one stands.

import Phaser from 'phaser';
import { BEACON_COLOR } from '../render/BeaconView';
import { ENERGY_CSS, TEXT_DIM } from '../render/palette';
import { DEPTH } from '../render/WorldView';
import { beaconCost, beaconCount } from '../sim/beacon';
import type { GameData } from '../sim/data';
import type { World } from '../sim/state';
import { formatNum } from './format';
import { Button, text } from './kit';
import type { Layout, Rect } from './layout';

/** The button rect: the Pulse button's size, one button width (plus a gap) to its left. */
export function beaconRect(pulse: Rect): Rect {
  const gap = Math.round(pulse.w * 0.1);
  return { x: pulse.x - pulse.w - gap, y: pulse.y, w: pulse.w, h: pulse.h };
}

export class BeaconHud {
  /** `.r` is the hint/smoke target. */
  readonly btn: Button;
  private readonly cost: Phaser.GameObjects.Text;
  private key = '';

  constructor(
    scene: Phaser.Scene,
    L: Layout,
    private readonly data: GameData,
    pulse: Rect,
    onBeacon: () => void,
  ) {
    const r = beaconRect(pulse);
    this.btn = new Button(scene, r, 'CLAIM', L.minFont, DEPTH.hud, onBeacon, { font: 'title', fillA: 0.75, edge: BEACON_COLOR, glow: '#2bffb0' });
    this.btn.label.setY(r.y + r.h - r.w * 0.14);
    this.cost = text(scene, r.x + r.w / 2, r.y + r.w * 0.2, '', L.minFont, { color: ENERGY_CSS, glow: ENERGY_CSS, blur: 6 })
      .setOrigin(0.5)
      .setDepth(DEPTH.hud + 0.15);
  }

  reset(): void {
    this.key = '';
  }

  update(w: World): void {
    const b = this.data.territory.beacon;
    const standing = w.structs.find((s) => s.kind === 'beacon' && s.share > 0);
    const cost = beaconCost(w, this.data);
    const full = beaconCount(w) >= b.max;
    const ready = !full && !w.dead && w.phase !== 'pick' && w.energy >= cost;
    const held = standing?.streak ?? -1;
    const price = formatNum(Math.ceil(cost));
    const key = `${ready}|${full}|${held}|${price}|${Math.round((standing?.share ?? 0) * 16)}`;
    if (key === this.key) return;
    this.key = key;
    const r = this.btn.r;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.w * 0.62;
    const s = r.w / 100;
    const g = this.btn.icon.clear();
    const a = ready || standing ? 1 : 0.4;
    // Mast glyph.
    g.lineStyle(3 * s, BEACON_COLOR, a).lineBetween(cx, cy + 16 * s, cx, cy - 12 * s);
    g.lineStyle(2 * s, BEACON_COLOR, a).lineBetween(cx - 9 * s, cy + 16 * s, cx, cy - 4 * s).lineBetween(cx + 9 * s, cy + 16 * s, cx, cy - 4 * s);
    g.fillStyle(BEACON_COLOR, a).fillCircle(cx, cy - 14 * s, 4 * s);
    g.lineStyle(1.5 * s, BEACON_COLOR, 0.5 * a).strokeCircle(cx, cy - 14 * s, 9 * s);
    if (standing) {
      // Hold progress: one arc per wave to hold, lit when held; the HP share as a thin inner arc.
      const R = r.w * 0.3;
      const n = b.holdWaves;
      const span = (Math.PI * 2) / n;
      for (let i = 0; i < n; i++) {
        const a0 = -Math.PI / 2 + i * span + 0.12;
        g.lineStyle(5 * s, BEACON_COLOR, i < held ? 1 : 0.2).beginPath().arc(cx, cy, R, a0, a0 + span - 0.24, false).strokePath();
      }
      g.lineStyle(2 * s, BEACON_COLOR, 0.6).beginPath().arc(cx, cy, R - 7 * s, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * standing.share, false).strokePath();
      this.cost.setText(`${held}/${n}`).setColor('#2bffb0').setAlpha(1);
    } else {
      this.cost.setText(`⚡${price}`).setColor(ready ? ENERGY_CSS : TEXT_DIM).setAlpha(ready ? 1 : 0.7);
    }
    this.btn.label.setAlpha(ready || standing ? 1 : 0.5);
  }
}
