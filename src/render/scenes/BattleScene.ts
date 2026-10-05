// The battle: a RunSession stepped by a FixedLoop, drawn by WorldView + Effects, with HUD, the upgrade
// panel and the death overlay.

import Phaser from 'phaser';
import type { Command } from '../../sim/commands';
import { DEFAULT_DATA, type EnemyKind, type GameData, STAT_IDS } from '../../sim/data';
import type { RunOptions } from '../../sim/state';
import type { SimEvent } from '../../sim/events';
import { DeathOverlay } from '../../ui/DeathOverlay';
import { Hud } from '../../ui/Hud';
import { text } from '../../ui/kit';
import { UpgradePanel } from '../../ui/UpgradePanel';
import { circleInRect, type Layout } from '../../ui/layout';
import battleJson from '../../data/battle.json';
import { RunLifecycle } from '../../portal/lifecycle';
import { services } from '../../services';
import { battleData, type DevFlags, readFlags, stressTuning } from '../devFlags';
import { Effects } from '../effects';
import { FixedLoop } from '../loop';
import { CRIMSON } from '../palette';
import { RunSession } from '../RunSession';
import { DEPTH, ENEMY_VIS, WorldView } from '../WorldView';
import { RS } from '../resolution';

const MAX_TICKS_PER_FRAME = 4;
const ENEMY_TEX: Record<EnemyKind, string> = { basic: 'e_basic', fast: 'e_fast', tank: 'e_tank', ranged: 'e_ranged', boss: 'e_boss_head' };
const STRESS_KINDS: EnemyKind[] = ['basic', 'fast', 'tank', 'ranged'];
/** Player-facing speeds; up to maxSpeed only through dev hooks / stress (labs unlock ×3–×5 in M4). */
const SPEEDS: number[] = battleJson.speeds;

function newSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

export class BattleScene extends Phaser.Scene {
  L!: Layout;
  gd!: GameData;
  flags!: DevFlags;
  session!: RunSession;
  view!: WorldView;
  fx!: Effects;
  hud!: Hud;
  upgrades!: UpgradePanel;
  death!: DeathOverlay;
  loop!: FixedLoop;
  /** Portal lifecycle + telemetry hooks (M6). */
  life!: RunLifecycle;
  speed = 1;
  paused = false;
  private banner!: Phaser.GameObjects.Text;
  private bannerUntil = 0;
  private fpsText: Phaser.GameObjects.Text | null = null;
  private frameMs: number[] = [];
  private readonly tmp = { x: 0, y: 0 };
  private deathAt = 0;
  private stressCount = 0;

  constructor() {
    super('Battle');
  }

  create(): void {
    this.L = this.registry.get('layout') as Layout;
    this.flags = readFlags(location.search);
    this.gd = battleData(DEFAULT_DATA, this.flags);
    this.life = new RunLifecycle({ guard: services.guard, ads: services.ads, telemetry: services.telemetry, tickHz: this.gd.config.tickHz });
    this.cameras.main.setZoom(RS).centerOn(this.L.w / 2, this.L.h / 2);
    this.session = new RunSession(this.gd, this.runOptions(this.flags.seed ?? newSeed()));
    this.loop = new FixedLoop(this.gd.config.tickHz, MAX_TICKS_PER_FRAME);
    this.view = new WorldView(this, this.L, () => this.session);
    this.fx = new Effects(this);
    this.hud = new Hud(this, this.L, this.gd, { onSpeed: () => this.cycleSpeed(), onPause: () => this.setPaused(!this.paused) });
    this.upgrades = new UpgradePanel(this, this.L, this.gd, {
      world: () => this.session.world,
      stats: () => this.session.stats,
      command: (cmd) => this.command(cmd),
      pending: () => this.session.hasPending,
    });
    this.death = new DeathOverlay(this, this.L, () => void this.life.requestRestart(() => this.restart()));
    const a = this.L.arena;
    this.banner = text(this, a.x + a.w / 2, a.y + a.h * 0.18, '', this.L.o === 'portrait' ? 44 : 34, { font: 'title', weight: '900', glow: '#22e5ff', blur: 16 })
      .setOrigin(0.5)
      .setDepth(DEPTH.bars + 0.5)
      .setVisible(false);
    const stress = this.flags.stress ? stressTuning() : null;
    this.stressCount = stress?.enemies ?? 0;
    if (stress) {
      this.speed = stress.speed;
      this.fpsText = text(this, a.x + 16, a.y + a.h - 16, '', this.L.minFont, { color: '#2bffb0', stroke: true }).setOrigin(0, 1).setDepth(DEPTH.overlay - 1);
    }
    this.input.keyboard?.on('keydown-SPACE', () => this.setPaused(!this.paused));
    this.input.keyboard?.on('keydown-S', () => this.cycleSpeed());
    // Auto-pause when the tab is hidden; the sim must not run in the background.
    this.game.events.on(Phaser.Core.Events.HIDDEN, () => this.loop.reset());
    this.life.runStarted(this.session.world);
  }

  /** First-run options: nothing unlocked (labs come in M4) unless ?unlockall=1 (dev). */
  private runOptions(seed: number): RunOptions {
    return { seed, tier: 1, unlocked: this.flags.unlockAll ? [...STAT_IDS] : [] };
  }

  /** A player command: queued for the next tick, or applied at once while the sim is not stepping. */
  command(cmd: Command): void {
    this.session.queue(cmd);
    if (this.paused || this.session.world.dead) this.session.applyPendingNow(this.onEvent);
  }

  cycleSpeed(): void {
    const i = SPEEDS.indexOf(this.speed);
    this.setSpeed(SPEEDS[(i + 1) % SPEEDS.length]!);
  }

  setSpeed(n: number): void {
    this.speed = Math.max(1, Math.min(battleJson.maxSpeed, Math.round(n)));
  }

  setPaused(p: boolean): void {
    if (this.session.world.dead) return;
    this.paused = p;
    this.life.hold('paused', p);
  }

  restart(): void {
    this.session.restart(this.runOptions(newSeed()));
    this.view.reset();
    this.fx.reset();
    this.hud.reset();
    this.upgrades.reset();
    this.loop.reset();
    this.death.hide();
    this.paused = false;
    this.deathAt = 0;
    this.bannerUntil = 0;
    this.life.runStarted(this.session.world);
  }

  /** Dev: spawns `n` enemies of a kind on the spawn ring. */
  spawn(kind: EnemyKind, n: number, dir?: number): void {
    this.session.spawn(kind, n, this.onEvent, dir);
  }

  /** Enemies whose circle touches the visible arena this frame (used by the UI smoke). */
  visibleEnemies(): number {
    let n = 0;
    for (const e of this.session.world.enemies) {
      this.view.enemyScreen(e, this.loop.alpha(), this.tmp);
      if (circleInRect(this.L.arena, this.tmp.x, this.tmp.y, e.radius * this.L.scale)) n++;
    }
    return n;
  }

  avgFps(): number {
    if (this.frameMs.length === 0) return 0;
    let s = 0;
    for (const d of this.frameMs) s += d;
    return 1000 / (s / this.frameMs.length);
  }

  private showBanner(s: string, color: string, now: number): void {
    this.banner.setText(s).setColor(color).setVisible(true).setAlpha(1);
    this.bannerUntil = now + 1500;
  }

  private screenOf(id: number): boolean {
    const e = this.session.lastKnown(id);
    if (!e) return false;
    this.view.enemyScreen(e, 1, this.tmp);
    return true;
  }

  private readonly onEvent = (e: SimEvent): void => {
    this.life.onEvent(e, this.session.world);
    const now = this.time.now;
    if (e.type === 'buy' || e.type === 'buyRejected') {
      this.upgrades.onEvent(e);
      return;
    }
    const L = this.L;
    const coreR = this.gd.core.radius * L.scale * 1.15;
    switch (e.type) {
      case 'shot':
        if (this.screenOf(e.targetId)) this.fx.muzzle(L.cx, L.cy, this.tmp.x, this.tmp.y, coreR);
        break;
      case 'hit':
        this.view.flash(e.enemyId, now);
        if (this.screenOf(e.enemyId)) this.fx.hit(this.tmp.x, this.tmp.y);
        break;
      case 'kill': {
        const en = this.session.lastKnown(e.enemyId);
        if (!en) break;
        this.view.enemyScreen(en, 1, this.tmp);
        const rot = e.kind === 'fast' || e.kind === 'ranged' || e.kind === 'boss' ? Math.atan2(-en.y, -en.x) : now * 0.0012;
        this.fx.death(e.kind, ENEMY_TEX[e.kind], this.tmp.x, this.tmp.y, rot, L.scale * ENEMY_VIS, e.kind === 'boss');
        if (e.kind === 'boss') this.cameras.main.shake(260, 0.006);
        break;
      }
      case 'coreHit': {
        const heavy = e.damage >= this.session.stats.health * 0.1;
        this.view.coreHit(now, heavy);
        this.hud.coreHit(now);
        this.fx.coreHit(this.view.coreX, this.view.coreY, coreR, heavy);
        if (e.ranged && this.screenOf(e.enemyId)) this.fx.beam(this.tmp.x, this.tmp.y, L.cx, L.cy, coreR);
        break;
      }
      case 'waveStart':
        if (e.boss) this.showBanner('WORM.EXE INBOUND', '#ff6b8b', now);
        else this.showBanner(`WAVE ${e.wave}`, '#e8fbff', now);
        this.fx.waveRing(L.cx, L.cy, this.session.stats.range * L.scale, e.boss ? CRIMSON : undefined);
        break;
      case 'death':
        this.fx.coreBreach(L.cx, L.cy, coreR);
        this.cameras.main.shake(380, 0.01);
        this.deathAt = now;
        break;
      default:
        break;
    }
  };

  override update(time: number, delta: number): void {
    const w = this.session.world;
    if (this.stressCount > 0 && !w.dead) {
      const missing = this.stressCount - w.enemies.length;
      for (let i = 0; i < missing; i++) this.session.spawn(STRESS_KINDS[(w.nextId + i) % STRESS_KINDS.length]!, 1, this.onEvent);
    }
    const n = this.loop.frame(delta, this.paused || w.dead || services.ads.running ? 0 : this.speed);
    if (n > 0) this.session.advance(n, this.onEvent);
    const alpha = w.dead ? 1 : this.loop.alpha();
    this.view.draw(alpha, time);
    this.fx.update();
    this.hud.update(this.session.world, this.session.stats, this.speed, this.paused, time, delta);
    this.upgrades.update(time);
    if (this.bannerUntil > 0) {
      const left = this.bannerUntil - time;
      if (left <= 0) {
        this.banner.setVisible(false);
        this.bannerUntil = 0;
      } else {
        this.banner.setAlpha(Math.min(1, left / 400));
      }
    }
    if (this.deathAt > 0 && !this.death.visible && time - this.deathAt > 700) {
      const dw = this.session.world;
      this.death.show({ wave: dw.wave, kills: dw.kills, energy: dw.energy, bits: dw.bits }, time);
    }
    this.death.update(time);
    this.frameMs.push(delta);
    if (this.frameMs.length > 120) this.frameMs.shift();
    if (this.fpsText && (this.game.getFrame() & 15) === 0) {
      this.fpsText.setText(`FPS ${this.avgFps().toFixed(0)}  ·  ${this.session.world.enemies.length} viruses  ·  ×${this.speed}`);
    }
  }
}

