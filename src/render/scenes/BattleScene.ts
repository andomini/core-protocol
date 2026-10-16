// The battle: a RunSession stepped by a FixedLoop, drawn by WorldView + Effects, with HUD, the upgrade
// panel and the death overlay.

import Phaser from 'phaser';
import type { Command } from '../../sim/commands';
import { DEFAULT_DATA, type EnemyKind, type GameData, STAT_IDS, type StatId } from '../../sim/data';
import type { RunOptions, Struct, World } from '../../sim/state';
import type { SimEvent } from '../../sim/events';
import { DeathOverlay } from '../../ui/DeathOverlay';
import { labEffects } from '../../meta/labs';
import { DEFAULT_META_DATA } from '../../meta/metaData';
import { buildRunOptions } from '../../meta/runOptions';
import { enterPick } from '../../sim/perks';
import { fusionKeys, type StructureKind, TAGS, type Tag } from '../../sim/perkData';
import { showToast } from '../../portal/toast';
import { clusterCounts, freeSlots, fusionLinkCounts, fusionLinks, moduleCluster, needsPlacement, sectorTags } from '../../sim/crystal';
import { arenaRadius } from '../../sim/territory';
import { formatNum, formatPrice } from '../../ui/format';
import { CrystalEditor } from '../../ui/CrystalEditor';
import { GenomeStrip } from '../../ui/GenomeStrip';
import { CrystalView } from '../CrystalView';
import { StructureView } from '../StructureView';
import { worldStats } from '../../sim/state';
import { sectorOf } from '../../sim/hex';
import { grantStarter, type PackCard } from '../../meta/cards';
import { type Settlement, settleRun } from '../../meta/runEnd';
import { Button } from '../../ui/kit';
import { PickOverlay } from '../../ui/PickOverlay';
import { DamageNumbers } from '../../ui/DamageNumbers';
import { StatsPanel } from '../../ui/StatsPanel';
import { runTabs } from '../../ui/statsRows';
import { addRunToLifetime, emptyRunStats, type LifetimeStats, recordEvent, type RunStats } from '../../meta/runStats';
import { Hints } from '../../ui/Hints';
import { quoteFor } from '../../sim/commands';
import { ProtocolsPanel } from '../../ui/ProtocolsPanel';
import { SetChips } from '../../ui/SetChips';
import { fusionStructure, nextFusionTier, tagCounts } from '../../sim/perks';
import type { RewardedPlacement } from '../../portal/ads';
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
import { CRIMSON, ENERGY, RARITY_CSS, TAG_COLOR, TAG_CSS, TEXT, TEXT_RED } from '../palette';
import { SetTooltip } from '../../ui/SetTooltip';
import { fusionLevel, fusionLines, fusionReachedLines, fusionTags, latticeLine, totalLines } from '../../ui/perkText';
import { RunSession } from '../RunSession';
import { DEPTH, ENEMY_VIS, WorldView } from '../WorldView';
import { RS } from '../resolution';
import { autoBuy, autoBuyOn, autoPick, loadAutoStats, saveAutoStats, setAutoBuy, setWidgetSpeed, WIDGET, WIDGET_CFG, widgetSpeed } from '../widget';

const OFFLINE_TOAST_MS = 2600;
const MAX_TICKS_PER_FRAME = 4;
/** `modTipAt` for a structure tooltip is this + the structure id (a crystal module is its index, below it). */
const STRUCT_TIP = 1_000_000;
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
  pick!: PickOverlay;
  crystal!: CrystalView;
  structures!: StructureView;
  private modTip!: SetTooltip;
  private modTipAt = -1;
  private baseScale = 1;
  private zoomed = false;
  editor!: CrystalEditor;
  genome!: GenomeStrip;
  /** The offer index whose new module is being placed (spec 2026-10-14 §A), or −1. */
  get placingIndex(): number {
    return this.editor?.visible && this.editor.mode === 'place' ? this.editor.index : -1;
  }
  private pausedBeforeEditor = false;
  private tiersBeforeEditor: { sets: Record<Tag, number>; fusions: Record<string, number> } | null = null;
  crystalBtn!: Button;
  /** The lifecycle 'perkPick' hold is on (the pick or its placement step is open). */
  private pickHeld = false;
  numbers!: DamageNumbers;
  hints!: Hints;
  statsPanel!: StatsPanel;
  runStats: RunStats = emptyRunStats();
  private statsBtn!: Button;
  private statsRefreshAt = 0;
  chips!: SetChips;
  protocols!: ProtocolsPanel;
  private pausedBeforePanel = false;
  loop!: FixedLoop;
  /** Portal lifecycle + telemetry hooks (M6). */
  life!: RunLifecycle;
  speed = 1;
  paused = false;
  private banner!: Phaser.GameObjects.Text;
  /** A smaller line under the banner (what a fusion does). */
  private bannerSub!: Phaser.GameObjects.Text;
  private bannerUntil = 0;
  private fpsText: Phaser.GameObjects.Text | null = null;
  private frameMs: number[] = [];
  private readonly tmp = { x: 0, y: 0 };
  private deathAt = 0;
  private stressCount = 0;
  private mode: 'new' | 'continue' = 'new';
  private tier = 1;
  private speeds: number[] = SPEEDS;
  /** The death settlement already paid into the meta save (undone on a revive). */
  private paid: { s: Settlement; runKeys: number; doubled: boolean; lifetimeBefore: LifetimeStats } | null = null;
  private starter: PackCard[] | null = null;
  /** Fast Boot (card): waves played at ×4 unless the player picks another speed. */
  private fastBoot = 0;
  private speedChosen = false;
  private secondWindPending = 0;
  private exitBtn!: Button;
  private readonly saveOnHide = (): void => this.saveRun();
  /** Widget mode (src/render/widget.ts): auto-buy switch, when the open pick appeared, next title update. */
  private autoBuy = !WIDGET || autoBuyOn();
  /** Stats marked for auto-buy: the widget keeps its own list, a normal game keeps it in the meta settings. */
  private autoStats = new Set<StatId>();
  private pickSince = 0;
  private titleAt = 0;

  constructor() {
    super('Battle');
  }

  /** `mode: 'continue'` resumes the saved run; otherwise a new run on `tier`. Resets per-run scene state. */
  init(data: { mode?: 'new' | 'continue'; tier?: number } = {}): void {
    this.mode = data.mode === 'continue' ? 'continue' : 'new';
    this.tier = data.tier ?? services.meta?.meta.tier ?? 1;
    this.speed = 1;
    this.paused = false;
    this.deathAt = 0;
    this.bannerUntil = 0;
    this.frameMs = [];
    this.paid = null;
    this.runStats = emptyRunStats();
    this.starter = null;
    this.speedChosen = false;
    this.secondWindPending = 0;
    this.pausedBeforePanel = false;
    this.tiersBeforeEditor = null;
    this.pausedBeforeEditor = false;
  }

  create(): void {
    this.autoStats = WIDGET ? loadAutoStats() : new Set(services.meta.meta.settings.autoStats);
    // A copy: L.scale zooms out as the breach widens (arenaRadius), Home keeps the shared layout.
    this.L = { ...(this.registry.get('layout') as Layout) };
    this.baseScale = this.L.scale;
    this.zoomed = false;
    this.flags = readFlags(location.search);
    this.gd = battleData(DEFAULT_DATA, this.flags);
    this.life = new RunLifecycle({ guard: services.guard, ads: services.ads, telemetry: services.telemetry, tickHz: this.gd.config.tickHz });
    this.cameras.main.setZoom(RS).centerOn(this.L.w / 2, this.L.h / 2);
    const set = services.meta.meta.settings;
    services.audio.sfxOn = set.sound;
    services.audio.musicOn = set.music;
    services.audio.apply();
    this.speeds = labEffects(services.meta.meta, DEFAULT_META_DATA).speeds;
    if (WIDGET && this.speeds.includes(widgetSpeed())) this.speed = widgetSpeed();
    this.fastBoot = 0;
    const saved = this.mode === 'continue' ? services.meta.loadRun() : null;
    if (saved) {
      this.tier = saved.world.tier;
      this.session = new RunSession(this.gd, saved.opts);
      this.session.adopt(saved.world, saved.opts);
      this.runStats = saved.stats;
    } else {
      this.session = new RunSession(this.gd, this.runOptions(this.flags.seed ?? newSeed()));
    }
    this.fastBoot = this.session.opts.metaBonus?.fastBootWaves ?? 0;
    this.loop = new FixedLoop(this.gd.config.tickHz, MAX_TICKS_PER_FRAME);
    this.view = new WorldView(this, this.L, () => this.session);
    this.structures = new StructureView(this, this.L, this.gd);
    this.fx = new Effects(this);
    this.numbers = new DamageNumbers(this, this.L);
    this.hints = new Hints(this, this.L, !services.meta.meta.firstRunDone && !this.flags.stress);
    this.hud = new Hud(this, this.L, this.gd, { onSpeed: () => this.cycleSpeed(), onPause: () => this.setPaused(!this.paused) });
    this.upgrades = new UpgradePanel(this, this.L, this.gd, {
      world: () => this.session.world,
      stats: () => this.session.stats,
      command: (cmd) => this.command(cmd),
      pending: () => this.session.hasPending,
      auto: {
        has: (id) => this.autoStats.has(id),
        toggle: (id) => {
          if (!this.autoStats.delete(id)) this.autoStats.add(id);
          if (WIDGET) saveAutoStats(this.autoStats);
          else {
            services.meta.meta.settings.autoStats = [...this.autoStats];
            services.meta.save();
          }
          this.showBanner(`AUTO ${this.gd.stats.stats[id].name.toUpperCase()} ${this.autoStats.has(id) ? 'ON' : 'OFF'}`, '#ffd23f', this.time.now);
        },
      },
    });
    this.death = new DeathOverlay(this, this.L, {
      stats: () => this.openStats(),
      revive: () => this.revive(),
      double: () => this.doubleBits(),
      home: () => this.goHome(),
      retry: () => void this.life.requestRestart(() => this.restart()),
    });
    this.pick = new PickOverlay(this, this.L, this.gd, {
      pick: (index) => this.choosePerk(index),
      reroll: () => {
        if (this.session.world.freeRerolls > 0) this.command({ type: 'reroll', via: 'free' });
        else void this.rewarded('reroll').then((ok) => ok && this.command({ type: 'reroll', via: 'ad' }));
      },
      boost: () => void this.rewarded('boost').then((ok) => ok && this.command({ type: 'boost' })),
    });
    this.crystal = new CrystalView(this, this.L, this.gd);
    this.modTip = new SetTooltip(this, this.L, this.gd, DEPTH.overlay - 2);
    // Mouse hover (or a tap on touch) over a crystal module: what it does and whether its cluster counts.
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.hoverModule(p.worldX, p.worldY, false));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.hoverModule(p.worldX, p.worldY, true));
    this.genome = new GenomeStrip(this, this.L);
    this.editor = new CrystalEditor(this, this.L, this.gd, this.crystal, () => this.session.world, {
      place: (slot) => this.placeModule(slot),
      back: () => this.closeEditor(false),
      always: () => {
        services.meta.meta.settings.autoPlace = true;
        services.meta.save();
        this.placeModule(this.crystal.placing?.auto ?? null);
        // The note joins the close announcement, so it does not cover a set / fusion banner the placement earned.
        this.closeEditor(false, 'Auto-place on');
      },
      move: (from, to) => this.command({ type: 'moveModule', from, to }),
      done: () => this.closeEditor(true),
    });
    this.chips = new SetChips(this, this.L, this.gd, () => this.openProtocols());
    this.protocols = new ProtocolsPanel(this, this.L, this.gd, () => this.closeProtocols());
    this.statsPanel = new StatsPanel(this, this.L, () => this.closeStats());
    const a = this.L.arena;
    this.banner = text(this, a.x + a.w / 2, a.y + a.h * 0.18, '', this.L.o === 'portrait' ? 44 : 34, { font: 'title', weight: '900', glow: '#22e5ff', blur: 16 })
      .setOrigin(0.5)
      .setDepth(DEPTH.bars + 0.5)
      .setVisible(false);
    this.bannerSub = text(this, a.x + a.w / 2, this.banner.y + (this.L.o === 'portrait' ? 44 : 34), '', this.L.minFont + 4, { weight: '700' })
      .setOrigin(0.5, 0)
      .setDepth(DEPTH.bars + 0.5)
      .setVisible(false);
    const stress = this.flags.stress ? stressTuning() : null;
    this.stressCount = stress?.enemies ?? 0;
    if (stress) {
      this.speed = stress.speed;
      this.fpsText = text(this, a.x + 16, a.y + a.h - 16, '', this.L.minFont, { color: '#2bffb0', stroke: true }).setOrigin(0, 1).setDepth(DEPTH.overlay - 1);
    }
    const a2 = this.L.arena;
    const ew = this.L.o === 'portrait' ? 340 : 260;
    const eh = this.L.o === 'portrait' ? 90 : 60;
    this.exitBtn = new Button(this, { x: a2.x + a2.w / 2 - ew / 2, y: a2.y + a2.h * 0.2 + (this.L.o === 'portrait' ? 70 : 50), w: ew, h: eh }, 'SAVE & EXIT', this.L.o === 'portrait' ? 30 : 20, DEPTH.overlay - 1, () => this.saveAndExit(), {
      font: 'title',
      fill: 0x062a3a,
    }).setVisible(false);
    this.statsBtn = new Button(this, { x: a2.x + a2.w / 2 - ew / 2, y: a2.y + a2.h * 0.2 + (this.L.o === 'portrait' ? 70 : 50) + eh + 16, w: ew, h: eh }, 'STATS', this.L.o === 'portrait' ? 30 : 20, DEPTH.overlay - 1, () => this.openStats(), {
      font: 'title',
      fill: 0x062a3a,
    }).setVisible(false);
    this.crystalBtn = new Button(this, { x: a2.x + a2.w / 2 - ew / 2, y: a2.y + a2.h * 0.2 + (this.L.o === 'portrait' ? 70 : 50) + (eh + 16) * 2, w: ew, h: eh }, 'CRYSTAL', this.L.o === 'portrait' ? 30 : 20, DEPTH.overlay - 1, () => this.openEditor(-1), {
      font: 'title',
      fill: 0x062a3a,
    }).setVisible(false);
    // Save the run when the tab hides or the page goes away (spec §2.5: no save-scumming by reload).
    document.addEventListener('visibilitychange', this.saveOnHide);
    window.addEventListener('pagehide', this.saveOnHide);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      document.removeEventListener('visibilitychange', this.saveOnHide);
      window.removeEventListener('pagehide', this.saveOnHide);
      this.game.events.off(Phaser.Core.Events.HIDDEN, this.onHidden);
    });
    this.input.keyboard?.on('keydown-SPACE', () => this.setPaused(!this.paused));
    this.input.keyboard?.on('keydown-S', () => this.cycleSpeed());
    if (WIDGET) {
      this.input.keyboard?.on('keydown-A', () => {
        this.autoBuy = !this.autoBuy;
        setAutoBuy(this.autoBuy);
        this.showBanner(this.autoBuy ? `AUTO-BUY ON (${this.autoStats.size})` : 'AUTO-BUY PAUSED', '#ffd23f', this.time.now);
      });
    } else {
      // Auto-pause when the tab is hidden; the sim must not run in the background (the widget is meant to).
      this.game.events.on(Phaser.Core.Events.HIDDEN, this.onHidden);
    }
    this.life.runStarted(this.session.world, this.session.world.phase === 'pick' ? ['perkPick'] : []);
    this.pickHeld = this.session.world.phase === 'pick';
  }

  private readonly onHidden = (): void => this.loop.reset();

  /** Options for a new run from the meta save (workshop, labs) on this scene's tier; dev flags on top. */
  private runOptions(seed: number): RunOptions {
    const o = buildRunOptions(services.meta.meta, this.gd, DEFAULT_META_DATA, this.tier, seed);
    if (this.flags.unlockAll) o.unlocked = [...STAT_IDS];
    o.protocols = !this.flags.stress;
    return o;
  }

  /** Snapshot of the run in progress (wave starts, tab hidden, pause → exit). Never in stress mode. */
  saveRun(): void {
    const w = this.session?.world;
    if (!w || w.dead || this.flags.stress) return;
    services.meta.saveRun(w, this.session.opts, this.runStats);
  }

  private saveAndExit(): void {
    this.saveRun();
    this.goHome();
  }

  private updateHints(now: number): void {
    const w = this.session.world;
    const info = this.upgrades.info();
    const affordable = info.rows.find((r) => !r.locked && quoteFor(w, this.gd, r.stat, 1).affordable);
    const bought = this.session.log.some((l) => l.cmd.type === 'buy');
    const low = w.core.hp < this.session.stats.health * 0.4;
    const def = info.tabs.find((t) => t.tab === 'def');
    const anySet = Object.values(w.setTiers).some((t) => t > 0);
    this.hints.update(
      now,
      {
        buy: { active: !bought && affordable !== undefined && w.wave >= 1, target: affordable?.rect ?? null },
        speed: { active: w.wave >= 3 && this.speed === 1, target: this.hud.speedBtn.r },
        def: { active: low && w.wave >= 2, target: def?.rect ?? null },
        chips: { active: anySet && this.chips.rect.w > 0, target: this.chips.rect },
      },
      w.dead || w.phase === 'pick' || this.paused || this.protocols.visible,
    );
  }

  /** Camera shake unless the player turned on "Reduce motion". */
  shake(ms: number, intensity: number): void {
    if (!services.meta.meta.settings.reduceMotion) this.cameras.main.shake(ms, intensity);
  }

  goHome(): void {
    this.life.hold('menu', true);
    this.scene.start('Home');
  }

  /** Pays the run into the meta save at death (so closing the tab on the death screen loses nothing). */
  private settle(): void {
    const w = this.session.world;
    services.meta.clearRun();
    if (this.flags.stress) return;
    const m = services.meta.meta;
    const lifetimeBefore = structuredClone(m.lifetime);
    const s = settleRun(m, this.gd, DEFAULT_META_DATA, { tier: w.tier, wave: w.wave, bits: w.bits, keys: w.keys, doubled: false, bitsMul: this.session.opts.metaBonus?.bitsMul });
    this.paid = { s, runKeys: Math.floor(w.keys), doubled: false, lifetimeBefore };
    addRunToLifetime(m.lifetime, this.runStats, {
      waves: w.wave,
      simTicks: w.tick,
      bits: s.bits,
      keys: s.keys,
      energyEarned: Math.max(0, w.energy + this.runStats.energySpent - (this.session.opts.startEnergy ?? 0)),
    });
    // After the first run: the starter cards (spec §3.4) and the Cards tab.
    this.starter = m.starterGiven ? null : grantStarter(m);
    if (this.starter) this.registry.set('starterReveal', this.starter);
    services.meta.save();
  }

  private deathNote(s: Settlement): string {
    const parts: string[] = [];
    if (s.newBest) parts.push('NEW BEST');
    if (s.milestones.length) parts.push(`MILESTONE ${s.milestones.map((m) => `W${m}`).join(' ')}`);
    if (s.tierUnlocked) parts.push(`TIER ${s.tierUnlocked} UNLOCKED`);
    if (this.starter) parts.push('STARTER CARDS UNLOCKED');
    return parts.join(' · ');
  }

  private revive(): void {
    const w = this.session.world;
    if (!w.dead || w.revived) return;
    void this.rewarded('revive').then((ok) => {
      if (!ok || !this.session.world.dead) return;
      // Undo the payout: the run continues and is paid again (in full) at its next death.
      const p = this.paid;
      if (p) {
        const m = services.meta.meta;
        m.bits = Math.max(0, m.bits - p.s.bits * (p.doubled ? 2 : 1));
        m.keys = Math.max(0, m.keys - p.runKeys);
        m.runs = Math.max(0, m.runs - 1);
        m.lifetime = p.lifetimeBefore;
        this.paid = null;
        services.meta.save();
      }
      this.command({ type: 'revive' });
      this.death.hide();
      this.deathAt = 0;
      this.life.runStarted(this.session.world, []);
      this.saveRun();
    });
  }

  private doubleBits(): void {
    const p = this.paid;
    if (!p || p.doubled) return;
    void this.rewarded('doubleBits').then((ok) => {
      if (!ok || !this.paid || this.paid.doubled) return;
      services.meta.meta.bits += this.paid.s.bits;
      this.paid.doubled = true;
      services.meta.save();
      this.death.update2({ bits: this.paid.s.bits * 2, canDouble: false });
    });
  }

  /** A card tap: a perk that adds a new crystal module first asks where to bolt it (unless auto-place). */
  private choosePerk(index: number): void {
    const w = this.session.world;
    const id = w.offer[index];
    if (id === undefined) return;
    const free = freeSlots(w, this.gd);
    if (services.meta.meta.settings.autoPlace || WIDGET || !needsPlacement(w, id) || free.length === 0) {
      this.command({ type: 'pickPerk', index });
      return;
    }
    this.pick.hide();
    this.openEditor(index);
  }

  /**
   * The crystal editor (spec 2026-10-15 §5): `index` ≥ 0 = Place mode for that offer card, −1 = Arrange
   * (pause menu). The battle stays paused while it is open; closing restores the previous pause state.
   */
  openEditor(index: number): void {
    const w = this.session.world;
    if (w.dead || this.editor.visible || (index < 0 && w.phase === 'pick')) return;
    this.pausedBeforeEditor = this.paused;
    this.tiersBeforeEditor = { sets: { ...w.setTiers }, fusions: { ...w.fusionTiers } };
    this.paused = true;
    this.life.hold('editor', true);
    if (this.modTipAt >= 0) this.hoverModule(-1e6, -1e6, true);
    this.bannerUntil = 0;
    this.banner.setVisible(false);
    this.bannerSub.setVisible(false);
    const rules = !services.meta.meta.settings.editorSeen;
    const id = index >= 0 ? w.offer[index] : undefined;
    if (id !== undefined) this.editor.openPlace(index, id, this.time.now, rules);
    else this.editor.openArrange(this.time.now, rules);
  }

  /** `done` = DONE (the rule strip has been seen); BACK / AUTO ALL close without it. */
  closeEditor(done: boolean, note?: string): void {
    if (!this.editor.visible) return;
    this.editor.hide();
    this.life.hold('editor', false);
    this.paused = this.pausedBeforeEditor;
    if (this.tiersBeforeEditor) this.announceTiers(this.tiersBeforeEditor, note);
    else if (note) this.arenaToast([note], 'info');
    this.tiersBeforeEditor = null;
    if (done && !services.meta.meta.settings.editorSeen) {
      services.meta.meta.settings.editorSeen = true;
      services.meta.save();
    }
  }

  private placeModule(slot: [number, number] | null): void {
    const index = this.placingIndex;
    if (index < 0) return;
    this.command(slot ? { type: 'pickPerk', index, slot } : { type: 'pickPerk', index });
  }

  /** The pick ended while its placement step was still open: close it. */
  private endPlacing(): void {
    if (this.placingIndex >= 0) this.closeEditor(false);
  }

  /** A player command: queued for the next tick, or applied at once while the sim is not stepping. */
  command(cmd: Command): void {
    this.session.queue(cmd);
    const w = this.session.world;
    if (this.paused || w.dead || w.phase === 'pick') this.session.applyPendingNow(this.onEvent);
  }

  /** A rewarded ad through the portal service (pauses/mutes per portal rules; toast on failure). */
  async rewarded(placement: RewardedPlacement): Promise<boolean> {
    this.pick.setBusy(true);
    try {
      return await services.ads.rewarded(placement);
    } finally {
      this.pick.setBusy(false);
    }
  }

  private statsTabs() {
    return runTabs({ world: this.session.world, stats: this.runStats, core: this.session.stats, data: this.gd, startEnergy: this.session.opts.startEnergy ?? 0 });
  }

  openStats(): void {
    if (this.statsPanel.visible) return;
    this.pausedBeforePanel = this.paused;
    this.paused = true;
    this.life.hold('stats', true);
    this.statsPanel.show(this.statsTabs());
  }

  closeStats(): void {
    this.statsPanel.hide();
    this.life.hold('stats', false);
    this.paused = this.pausedBeforePanel;
  }

  /** The wall segment, turret or station under a screen point (the mines are too small to tap), or null. Only what the fusion ladders build right now. */
  private structureAt(w: World, x: number, y: number): Struct | null {
    if (w.wallR <= 0 || w.structs.length === 0) return null;
    const L = this.L;
    const dx = (x - L.cx) / L.scale;
    const dy = (y - L.cy) / L.scale;
    const d = Math.hypot(dx, dy);
    const sd = this.gd.structures;
    let best: Struct | null = null;
    let bestD = Infinity;
    for (const s of w.structs) {
      if (s.share <= 0 || s.kind === 'mine') continue;
      const v = fusionStructure(w, this.gd, s.kind);
      if (v === undefined || s.slot >= (s.kind === 'wall' ? sd.wall.segments : v.count ?? 0)) continue;
      // A wall segment is the ring band of its sector; turrets and stations are discs.
      if (s.kind === 'wall') {
        if (Math.abs(d - w.wallR) <= 16 && sectorOf(dx, dy) === s.slot && Math.abs(d - w.wallR) < bestD) [best, bestD] = [s, Math.abs(d - w.wallR)];
        continue;
      }
      const hit = (s.kind === 'station' ? sd.station.radius : 14) + 10;
      const dist = Math.hypot(dx - s.x, dy - s.y);
      if (dist <= hit && dist < bestD) [best, bestD] = [s, dist];
    }
    return best;
  }

  /** The fusion that builds structures of `kind`. */
  private fusionOfKind(kind: StructureKind): string | undefined {
    return Object.keys(this.gd.sets.fusions).find((k) => Object.values(this.gd.sets.fusions[k]!.tiers).some((es) => es.some((e) => e.type === 'structure' && e.kind === kind)));
  }

  /** Tap on a structure: its fusion's ladder plus a live line (segment HP, station streak). */
  private showStructureTip(w: World, s: Struct): void {
    const key = this.fusionOfKind(s.kind);
    if (key === undefined) return;
    const pct = Math.round(s.share * 100);
    let live: string;
    if (s.kind === 'wall') live = `Segment ${s.slot + 1}: ${pct} %`;
    else if (s.kind === 'turret') live = `Turret ${s.slot + 1}`;
    else {
      const v = fusionStructure(w, this.gd, 'station');
      const mul = v?.streakStep !== undefined ? Math.min(v.streakMax ?? 1, 1 + v.streakStep * s.streak) : 1;
      live = `Station ${s.slot + 1}: streak ×${(Math.round(mul * 100) / 100).toString()}${s.share < 1 ? `, HP ${pct} %` : ''}`;
    }
    const L = this.L;
    const [sx, sy] = [L.cx + s.x * L.scale, L.cy + s.y * L.scale];
    const R = 20 * L.scale;
    const tier = w.fusionTiers[key] ?? 0;
    const links = fusionLinkCounts(w, this.gd)[key] ?? 0;
    this.modTip.showFusion(key, links, tier, { x: sx - R, y: sy - R, w: R * 2, h: R * 2 }, {
      title: this.gd.sets.fusions[key]!.name,
      titleColor: TEXT,
      lines: [live],
      note: '',
      noteColor: TEXT,
    });
  }

  private hoverModule(x: number, y: number, tap = false): void {
    const w = this.session.world;
    const blocked = w.dead || w.phase === 'pick' || this.editor.visible || this.protocols.visible || this.statsPanel.visible;
    const mod = blocked ? -1 : this.crystal.moduleAt(w, x, y);
    // A structure is only opened by a tap and stays up until the next tap elsewhere (or a module hover).
    const struct = mod < 0 && tap && !blocked ? this.structureAt(w, x, y) : null;
    if (mod < 0 && !tap && !blocked && this.modTipAt >= STRUCT_TIP) return;
    const i = struct !== null ? STRUCT_TIP + struct.id : mod;
    if (i === this.modTipAt) return;
    this.modTipAt = i;
    if (struct !== null) {
      this.crystal.hover = [];
      this.showStructureTip(w, struct);
      return;
    }
    if (i < 0) {
      this.modTip.hide();
      this.crystal.hover = [];
      return;
    }
    const m = w.crystal[i]!;
    const def = this.gd.perks.perks[m.perk]!;
    const n = w.perks[m.perk] ?? 0;
    const cluster = moduleCluster(w, i);
    const largest = clusterCounts(w, this.gd)[m.tag];
    const cards = w.cardTags.filter((t) => t === m.tag).length;
    const setName = this.gd.sets.tags[m.tag].name.toUpperCase();
    const counts = cluster.stacks >= largest;
    const size = cluster.members.length > 1 ? `${cluster.members.length} linked modules, ${cluster.stacks} stacks` : `${cluster.stacks} stack${cluster.stacks === 1 ? '' : 's'}`;
    const note = counts
      ? `Cluster: ${size} → counts for ${setName}${cards > 0 ? ` (+${cards} from cards)` : ''}`
      : `Cluster: ${size}, not your largest ${setName} (${largest}) → does not count. Place same-tag modules side by side.`;
    this.crystal.hover = cluster.members;
    const [cx, cy] = this.crystal.hexScreen(m.q, m.r);
    const R = this.gd.crystal.cellSize * this.L.scale;
    // Links of this module's cluster with other tags: per pair, the links, the fusion tier and the next one.
    const fuse: string[] = [];
    const linkCounts = fusionLinkCounts(w, this.gd);
    for (const l of fusionLinks(w, this.gd)) {
      if (!cluster.members.includes(l.a) && !cluster.members.includes(l.b)) continue;
      const tag = fusionTags(l.key).find((t) => t !== m.tag)!;
      const links = linkCounts[l.key] ?? 0;
      const tier = w.fusionTiers[l.key] ?? 0;
      const next = nextFusionTier(this.gd, links, l.key);
      const name = this.gd.sets.fusions[l.key]!.name;
      const cur = tier > 0 ? `${name} ${fusionLevel(this.gd, tier)}: ${fusionReachedLines(this.gd, l.key, tier).join(' · ')}` : name;
      const more = next > 0 ? ` (${fusionLevel(this.gd, next)} at ${next}: ${fusionLines(this.gd, l.key, next).join(' · ')})` : '';
      const s = `Touches ${this.gd.sets.tags[tag].name}: ${links} link${links === 1 ? '' : 's'} → ${cur}${more}`;
      if (!fuse.includes(s)) fuse.push(s);
    }
    this.modTip.show(m.tag, largest + cards, w.setTiers[m.tag], { x: cx - R, y: cy - R, w: R * 2, h: R * 2 }, {
      title: `${def.name} ×${n}`,
      titleColor: def.rarity === 'common' ? TEXT : RARITY_CSS[def.rarity],
      lines: totalLines(this.gd, m.perk, n),
      note: fuse.length > 0 ? `${note}\n${fuse.join('\n')}` : note,
      noteColor: counts ? TAG_CSS[m.tag] : TEXT_RED,
    });
  }

  openProtocols(): void {
    const w = this.session.world;
    if (w.dead || w.phase === 'pick' || this.protocols.visible) return;
    this.pausedBeforePanel = this.paused;
    this.paused = true;
    this.life.hold('protocols', true);
    this.protocols.show(w);
  }

  closeProtocols(): void {
    this.protocols.hide();
    this.life.hold('protocols', false);
    this.paused = this.pausedBeforePanel;
  }

  cycleSpeed(): void {
    this.speedChosen = true;
    const i = this.speeds.indexOf(this.speed);
    this.setSpeed(this.speeds[(i + 1) % this.speeds.length]!);
  }

  setSpeed(n: number): void {
    this.speed = Math.max(1, Math.min(this.devMaxSpeed || battleJson.maxSpeed, Math.round(n)));
    if (WIDGET) setWidgetSpeed(this.speed);
  }

  // ---- Dev / admin (src/render/admin.ts, dev builds only) ------------------------------------------------
  /** Dev: speeds beyond the player's cap (×10…×50). 0 = normal cap. */
  devMaxSpeed = 0;
  /** Dev: the core cannot die (a ×1e9 Health modifier inside the World, so it holds at any speed). */
  get devGod(): boolean {
    return this.session.world.mods.some((m) => m.source === 'dev:god');
  }

  set devGod(on: boolean) {
    const w = this.session.world;
    w.mods = w.mods.filter((m) => m.source !== 'dev:god');
    if (on) w.mods.push({ stat: 'health', op: 'mul', value: 1e9, source: 'dev:god' });
    this.session.stats = worldStats(w, this.gd);
    w.core.hp = this.session.stats.health;
  }

  /** Dev: take the first card of every protocol offer automatically. */
  devAutoPick = false;

  /** Dev: jump to the start of wave `n` (clears the arena; not replayable). */
  devJumpWave(n: number): void {
    const w = this.session.world;
    if (w.dead || !(n >= 1)) return;
    w.enemies = [];
    w.projectiles = [];
    w.spawnQueue = [];
    w.offer = w.phase === 'pick' ? w.offer : [];
    w.wave = Math.floor(n) - 1;
    if (w.phase !== 'pick') {
      w.phase = 'pause';
      w.phaseTick = this.gd.config.pauseSeconds * this.gd.config.tickHz;
    }
    this.view.reset();
  }

  /** Dev: removes every enemy (no rewards). */
  devKillAll(): void {
    this.session.world.enemies = [];
    this.session.world.projectiles = [];
    this.view.reset();
  }

  /** Dev: opens a protocol pick right now. */
  devPickNow(): void {
    const w = this.session.world;
    if (w.dead || w.phase === 'pick') return;
    enterPick(w, this.gd, []);
  }

  /** Dev: raises every unlocked stat by `n` levels (respects the caps). */
  devLevels(n: number): void {
    const w = this.session.world;
    for (const id of STAT_IDS) {
      const max = this.gd.stats.stats[id].maxLevel;
      w.levels[id] = max === undefined ? w.levels[id] + n : Math.min(max + (w.lab.maxBonus[id] ?? 0), w.levels[id] + n);
    }
    this.session.stats = worldStats(w, this.gd);
  }

  devDie(): void {
    this.devGod = false;
    this.session.world.core.hp = 0;
  }

  /** Buys the marked stats (cheapest first) while the run is playing. */
  private autoBuyTick(): void {
    const w = this.session.world;
    if (this.autoStats.size === 0 || w.dead || w.phase === 'pick' || this.paused || this.session.hasPending) return;
    const c = autoBuy(w, this.gd, this.autoStats);
    if (c) this.command(c);
  }

  /** Widget mode: plays the run on its own (see src/render/widget.ts). */
  private widgetTick(time: number): void {
    const w = this.session.world;
    if (w.dead) {
      if (this.deathAt > 0 && time - this.deathAt > WIDGET_CFG.restartDelayMs && !this.secondWindPending) this.restart();
    } else if (w.phase === 'pick') {
      if (this.pickSince === 0) this.pickSince = time;
      else if (time - this.pickSince > WIDGET_CFG.pickDelayMs && !this.session.hasPending) this.command({ type: 'pickPerk', index: autoPick(w, this.gd) });
    } else {
      this.pickSince = 0;
      if (this.autoBuy && !this.paused && !this.session.hasPending) {
        const c = autoBuy(w, this.gd, this.autoStats);
        if (c) this.command(c);
      }
    }
    if (time >= this.titleAt) {
      this.titleAt = time + WIDGET_CFG.titleEveryMs;
      const state = w.dead ? 'DEAD' : this.paused ? 'PAUSED' : `×${this.speed}`;
      const auto = this.autoBuy && this.autoStats.size ? ` · auto ${this.autoStats.size}` : '';
      document.title = `Core Protocol · T${w.tier} W${w.wave} · ${state} · best W${services.meta.meta.best[String(w.tier)] ?? 0}${auto}`;
    }
  }

  setPaused(p: boolean): void {
    if (this.session.world.dead || this.editor.visible) return;
    this.paused = p;
    this.life.hold('paused', p);
  }

  restart(): void {
    this.paid = null;
    this.starter = null;
    this.speedChosen = false;
    this.secondWindPending = 0;
    services.meta.clearRun();
    this.session.restart(this.runOptions(newSeed()));
    this.fastBoot = this.session.opts.metaBonus?.fastBootWaves ?? 0;
    this.view.reset();
    this.structures.reset();
    this.fx.reset();
    this.numbers.reset();
    this.hud.reset();
    this.upgrades.reset();
    this.loop.reset();
    this.death.hide();
    this.pick.hide();
    this.endPlacing();
    this.protocols.hide();
    this.statsPanel.hide();
    this.chips.reset();
    this.modTipAt = -1;
    this.modTip.hide();
    this.crystal.hover = [];
    this.paused = false;
    this.deathAt = 0;
    this.bannerUntil = 0;
    this.bannerSub.setVisible(false);
    this.life.runStarted(this.session.world, this.session.world.phase === 'pick' ? ['perkPick'] : []);
    this.pickHeld = this.session.world.phase === 'pick';
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

  private showBanner(s: string, color: string, now: number, sub = ''): void {
    // The editor's readout already says what a move did; banners would sit dimmed under its scrim.
    if (this.editor?.visible) return;
    this.banner.setText(s).setColor(color).setVisible(true).setAlpha(1);
    this.bannerSub.setText(sub).setVisible(sub !== '').setAlpha(1);
    this.bannerUntil = now + (sub === '' ? 1500 : 2800);
  }

  private screenOf(id: number): boolean {
    const e = this.session.lastKnown(id);
    if (!e) return false;
    this.view.enemyScreen(e, 1, this.tmp);
    return true;
  }

  private setOnline(tag: Tag, tier: number, now: number): void {
    const L = this.L;
        const name = this.gd.sets.tags[tag].name.toUpperCase();
    this.showBanner(`${name} SET ×${tier} ONLINE`, TAG_CSS[tag], now);
    services.audio.play('set');
    this.fx.pulse(L.cx, L.cy, this.session.stats.range * L.scale, TAG_COLOR[tag]);
  }

  private fusionOnline(key: string, tier: number, a: [number, number], b: [number, number], now: number): void {
    const L = this.L;
    const coreR = this.gd.core.radius * L.scale * 1.15;
        const f = this.gd.sets.fusions[key]!;
    const [ta, tb] = fusionTags(key);
    const [ax, ay] = this.crystal.hexScreen(a[0], a[1]);
    const [bx, by] = this.crystal.hexScreen(b[0], b[1]);
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    this.crystal.fused(key, now);
    // Both colours meet at the seam, then a two-colour shock wave rolls out over the arena.
    this.fx.arc(ax, ay, bx, by, TAG_COLOR[ta]);
    this.fx.arc(bx, by, ax, ay, TAG_COLOR[tb]);
    this.fx.pulse(mx, my, coreR * 3, TAG_COLOR[ta]);
    this.fx.pulse(mx, my, coreR * 2, TAG_COLOR[tb]);
    this.fx.waveRing(L.cx, L.cy, this.session.stats.range * L.scale, TAG_COLOR[ta]);
    this.fx.waveRing(L.cx, L.cy, this.session.stats.range * L.scale * 0.7, TAG_COLOR[tb]);
    this.shake(260, 0.005);
    this.showBanner(`FUSION ${fusionLevel(this.gd, tier)} · ${f.name.toUpperCase()}`, TAG_CSS[ta], now, `${this.gd.sets.tags[ta].name} + ${this.gd.sets.tags[tb].name}: ${fusionLines(this.gd, key, tier).join(' · ')}`);
    this.bannerSub.setColor(TAG_CSS[tb]);
    services.audio.play('set');
  }

  private setOffline(tag: Tag, prev: number): string {
    return `${this.gd.sets.tags[tag].name} ${prev}-set offline`;
  }

  private fusionOffline(key: string, prev: number): string {
    return `${this.gd.sets.fusions[key]!.name} ${fusionLevel(this.gd, prev)} offline`;
  }

  /** A dim toast (the ad-fail toast's quiet tone) in the arena below the core. */
  private offlineToast(lines: string[]): void {
    this.arenaToast(lines, 'dim');
  }

  /** A DOM toast over the arena's lower part (the banner sits higher). */
  private arenaToast(lines: string[], tone: 'info' | 'dim'): void {
    if (lines.length === 0) return;
    const r = this.game.canvas?.getBoundingClientRect();
    const L = this.L;
    const a = L.arena;
    const at = r && r.width > 0 ? { x: r.left + ((a.x + a.w / 2) * r.width) / L.w, y: r.top + ((a.y + a.h * 0.72) * r.height) / L.h } : null;
    showToast(lines.join(' · '), OFFLINE_TOAST_MS, at, tone);
  }

  /**
   * The editor closed: announce what its moves changed in all. Tiers up → banner and burst (the last banner
   * stays, so with several changes a toast lists them all), down → a dim toast. Net fusion tiers go to the
   * run stats here (the editor's own events are skipped there).
   */
  private announceTiers(before: { sets: Record<Tag, number>; fusions: Record<string, number> }, note?: string): void {
    const w = this.session.world;
    const now = this.time.now;
    const on: string[] = [];
    const off: string[] = [];
    for (const t of TAGS) {
      const prev = before.sets[t];
      const tier = w.setTiers[t];
      if (tier > prev) {
        this.setOnline(t, tier, now);
        on.push(`${this.gd.sets.tags[t].name} ${tier}-set online`);
      } else if (tier < prev) off.push(this.setOffline(t, prev));
    }
    const links = fusionLinks(w, this.gd);
    for (const key of fusionKeys()) {
      const prev = before.fusions[key] ?? 0;
      const tier = w.fusionTiers[key] ?? 0;
      const l = links.find((f) => f.key === key);
      if (tier > prev && l) {
        const ma = w.crystal[l.a]!;
        const mb = w.crystal[l.b]!;
        recordEvent(this.runStats, { type: 'fusion', key, tier, prev, a: [ma.q, ma.r], b: [mb.q, mb.r] });
        this.fusionOnline(key, tier, [ma.q, ma.r], [mb.q, mb.r], now);
        on.push(`${this.gd.sets.fusions[key]!.name} ${fusionLevel(this.gd, tier)} online`);
      } else if (tier < prev) off.push(this.fusionOffline(key, prev));
    }
    const notes = note ? [note] : [];
    if (on.length > 1 || (on.length > 0 && off.length > 0) || (on.length > 0 && notes.length > 0)) this.arenaToast([...on, ...off, ...notes], 'info');
    else if (off.length > 0) this.arenaToast([...off, ...notes], 'dim');
    else if (notes.length > 0) this.arenaToast(notes, 'info');
  }

  private readonly onEvent = (e: SimEvent): void => {
    // Editor experiments (move, undo) are not "reached": announceTiers records the net result on close.
    if (!(e.type === 'fusion' && this.editor.visible)) recordEvent(this.runStats, e);
    this.life.onEvent(e, this.session.world);
    const now = this.time.now;
    const sfx = services.audio;
    if (e.type === 'buy' || e.type === 'buyRejected') {
      if (e.type === 'buy') sfx.play('upgrade', 1 + Math.min(1, e.level / 60));
      this.upgrades.onEvent(e);
      return;
    }
    const L = this.L;
    const coreR = this.gd.core.radius * L.scale * 1.15;
    switch (e.type) {
      case 'shot':
        sfx.play(e.crit ? 'crit' : 'shot');
        if (this.screenOf(e.targetId)) this.fx.muzzle(L.cx, L.cy, this.tmp.x, this.tmp.y, coreR);
        break;
      case 'hit':
        this.view.flash(e.enemyId, now);
        if (this.screenOf(e.enemyId)) {
          this.fx.hit(this.tmp.x, this.tmp.y);
          if (e.crit) this.numbers.show(this.tmp.x, this.tmp.y, e.damage, true);
        }
        break;
      case 'kill': {
        const en = this.session.lastKnown(e.enemyId);
        if (!en) break;
        this.view.enemyScreen(en, 1, this.tmp);
        const rot = e.kind === 'fast' || e.kind === 'ranged' || e.kind === 'boss' ? Math.atan2(-en.y, -en.x) : now * 0.0012;
        this.fx.death(e.kind, ENEMY_TEX[e.kind], this.tmp.x, this.tmp.y, rot, L.scale * ENEMY_VIS, e.kind === 'boss');
        sfx.play(e.kind === 'boss' ? 'bossDie' : 'kill');
        if (e.kind === 'boss') this.shake(260, 0.006);
        break;
      }
      case 'coreHit': {
        const heavy = e.damage >= this.session.stats.health * 0.1;
        sfx.play('wallHit');
        this.view.coreHit(now, heavy);
        this.hud.coreHit(now);
        this.fx.coreHit(this.view.coreX, this.view.coreY, coreR, heavy);
        if (e.ranged && this.screenOf(e.enemyId)) this.fx.beam(this.tmp.x, this.tmp.y, L.cx, L.cy, coreR);
        break;
      }
      case 'structHit': {
        if (e.kind === 'station') this.structures.hitStation(e.sid, now);
        else this.structures.hit(this.session.world.structs.find((x) => x.id === e.sid)?.slot ?? -1, now);
        const [sx, sy] = [L.cx + e.x * L.scale, L.cy + e.y * L.scale];
        this.fx.hit(sx, sy);
        if (e.ranged && this.screenOf(e.enemyId)) this.fx.beam(this.tmp.x, this.tmp.y, sx, sy, 0);
        sfx.play('wallHit');
        break;
      }
      case 'structDown':
        this.fx.pulse(L.cx + e.x * L.scale, L.cy + e.y * L.scale, 34 * L.scale, e.kind === 'station' ? TAG_COLOR.mining : TAG_COLOR.cryo);
        sfx.play('kill');
        this.shake(120, 0.003);
        break;
      case 'turretShot': {
        // A short tracer from the barrel to the first target, in the Bastion's colour.
        if (!this.screenOf(e.targetIds[0]!)) break;
        const [tx, ty] = [this.tmp.x, this.tmp.y];
        const [sx, sy] = [L.cx + e.x * L.scale, L.cy + e.y * L.scale];
        this.structures.shot(e.sid, this.session.world, tx, ty, now);
        const d = Math.hypot(tx - sx, ty - sy) || 1;
        const m = this.gd.structures.turret.muzzle * L.scale;
        this.fx.bounce(sx + ((tx - sx) / d) * m, sy + ((ty - sy) / d) * m, tx, ty, TAG_COLOR.overload);
        for (let i = 1; i < e.targetIds.length; i++) {
          if (this.screenOf(e.targetIds[i]!)) this.fx.bounce(sx, sy, this.tmp.x, this.tmp.y, TAG_COLOR.overload);
        }
        sfx.play('shot', 1.4);
        break;
      }
      case 'mineBlast': {
        this.fx.pulse(L.cx + e.x * L.scale, L.cy + e.y * L.scale, e.r * L.scale * 1.4, TAG_COLOR.chain);
        sfx.play('zap');
        this.shake(100, 0.002);
        break;
      }
      case 'structUp':
        this.fx.waveRing(L.cx + e.x * L.scale, L.cy + e.y * L.scale, 26 * L.scale, e.kind === 'station' ? TAG_COLOR.mining : TAG_COLOR.cryo);
        break;
      case 'stationPay': {
        // A green "+E" rising from the station (Bits ride along when a tier pays them).
        const [sx, sy] = [L.cx + e.x * L.scale, L.cy + e.y * L.scale];
        this.fx.pulse(sx, sy, 22 * L.scale, TAG_COLOR.mining);
        this.numbers.popup(sx, sy, `+${formatNum(e.energy)} E${e.bits > 0 ? ` +${formatNum(e.bits)} B` : ''}`, TAG_CSS.mining);
        break;
      }
      case 'waveStart':
        this.saveRun();
        if (this.fastBoot > 0 && !this.speedChosen) this.speed = e.wave <= this.fastBoot ? 4 : Math.min(this.speed, this.speeds[this.speeds.length - 1]!);
        sfx.play(e.boss ? 'boss' : 'wave');
        if (e.boss) this.showBanner('WORM.EXE INBOUND', '#ff6b8b', now);
        else this.showBanner(`WAVE ${e.wave}`, '#e8fbff', now);
        this.fx.waveRing(L.cx, L.cy, this.session.stats.range * L.scale, e.boss ? CRIMSON : undefined);
        break;
      // In the editor the crystal changes back and forth (move, undo): closing it announces the net change.
      case 'setTier':
        if (this.editor.visible) break;
        if (e.tier > e.prev) this.setOnline(e.tag, e.tier, now);
        else if (e.tier < e.prev) this.offlineToast([this.setOffline(e.tag, e.prev)]);
        break;
      case 'fusion':
        if (this.editor.visible) break;
        if (e.tier > e.prev && e.a !== null && e.b !== null) this.fusionOnline(e.key, e.tier, e.a, e.b, now);
        else if (e.tier < e.prev) this.offlineToast([this.fusionOffline(e.key, e.prev)]);
        break;
      case 'lightning': {
        sfx.play('zap');
        // fromId 0: a Tesla Coil bolt from the core.
        const from = e.fromId === 0 ? null : this.session.lastKnown(e.fromId);
        if (e.fromId !== 0 && !from) break;
        if (from) this.view.enemyScreen(from, 1, this.tmp);
        const fx0 = from ? this.tmp.x : L.cx;
        const fy0 = from ? this.tmp.y : L.cy;
        for (const id of e.targets) if (this.screenOf(id)) this.fx.arc(fx0, fy0, this.tmp.x, this.tmp.y, TAG_COLOR.chain);
        break;
      }
      case 'bounce': {
        const from = this.session.lastKnown(e.fromId);
        if (!from || !this.screenOf(e.toId)) break;
        const tx = this.tmp.x;
        const ty = this.tmp.y;
        this.view.enemyScreen(from, 1, this.tmp);
        this.fx.bounce(this.tmp.x, this.tmp.y, tx, ty, TAG_COLOR.chain);
        break;
      }
      case 'freezeAll':
        sfx.play('freeze');
        this.fx.pulse(L.cx, L.cy, Math.max(L.arena.w, L.arena.h) * 0.6, TAG_COLOR.cryo);
        break;
      case 'overdrive':
        this.fx.pulse(L.cx, L.cy, coreR * 4, TAG_COLOR.overload);
        this.showBanner('OVERDRIVE', TAG_CSS.overload, now);
        break;
      case 'immunity':
        this.fx.pulse(L.cx, L.cy, coreR * 3, TAG_COLOR.firewall);
        break;
      case 'damageBoost':
        this.fx.pulse(L.cx, L.cy, coreR * 4, TAG_COLOR.overload);
        this.showBanner('OVERCLOCK', TAG_CSS.overload, now);
        sfx.play('set');
        break;
      case 'waveSkip':
        this.showBanner(`WAVE ${e.wave} SKIPPED`, '#ffd23f', now);
        sfx.play('coin');
        break;
      case 'perkPicked':
        sfx.play('perk');
        if (e.module) {
          const [mx, my] = this.crystal.hexScreen(e.module[0], e.module[1]);
          this.fx.pulse(mx, my, this.gd.crystal.cellSize * L.scale * 2.5, TAG_COLOR[this.gd.perks.perks[e.id]!.tag]);
        }
        break;
      case 'mutation': {
        const name = this.gd.sets.tags[e.tag].name.toUpperCase();
        this.showBanner(`VIRUS MUTATED: ${name} RESIST ${e.level}`, '#ff6b8b', now);
        this.fx.pulse(L.cx, L.cy, Math.max(L.arena.w, L.arena.h) * 0.6, CRIMSON);
        sfx.play('boss');
        break;
      }
      case 'arenaGrow':
        this.showBanner(e.ringGrew ? 'BREACH WIDENED · CRYSTAL GREW A RING' : e.nests > 0 ? 'BREACH WIDENED · NESTS IN THE NEW GROUND' : 'BREACH WIDENED', '#ff6b8b', now);
        this.fx.pulse(L.cx, L.cy, Math.max(L.arena.w, L.arena.h) * 0.6, CRIMSON);
        break;
      case 'nestDestroyed': {
        const [sx, sy] = [L.cx + e.x * L.scale, L.cy + e.y * L.scale];
        this.fx.pulse(sx, sy, this.gd.territory.cellSize * L.scale * 4, ENERGY);
        this.showBanner(`NEST PURGED +${formatPrice(e.energy)} ENERGY`, '#ffd23f', now);
        sfx.play('bossDie');
        break;
      }
      case 'boost':
        this.showBanner(`ENERGY ×${this.gd.perks.boost.energyMul}`, '#ffd23f', now);
        this.fx.pulse(L.cx, L.cy, coreR * 4, ENERGY);
        break;
      case 'death': {
        const sw = this.session.opts.metaBonus?.secondWind ?? 0;
        if (sw > 0 && !this.session.world.revived && !this.flags.stress) {
          // Second Wind (card): a free revive, no payout in between (applied next frame, outside this flush).
          this.secondWindPending = sw;
          this.showBanner('SECOND WIND', '#2bffb0', now);
          this.fx.pulse(L.cx, L.cy, coreR * 5, 0x2bffb0);
          break;
        }
        this.settle();
        sfx.play('death');
        this.fx.coreBreach(L.cx, L.cy, coreR);
        this.shake(380, 0.01);
        this.deathAt = now;
        break;
      }
      default:
        break;
    }
  };

  /** The camera pulls back as the arena grows, so the spawn ring stays at the arena edge (snaps on the first frame). */
  private zoomTick(delta: number): void {
    const target = (this.baseScale * this.gd.config.spawnRadius) / arenaRadius(this.gd, this.session.world.wave);
    const L = this.L;
    if (!this.zoomed || Math.abs(target - L.scale) < target * 1e-3) L.scale = target;
    else L.scale += (target - L.scale) * (1 - Math.exp(-delta / 700));
    this.zoomed = true;
  }

  override update(time: number, delta: number): void {
    const w = this.session.world;
    if (this.stressCount > 0 && !w.dead) {
      const missing = this.stressCount - w.enemies.length;
      for (let i = 0; i < missing; i++) this.session.spawn(STRESS_KINDS[(w.nextId + i) % STRESS_KINDS.length]!, 1, this.onEvent);
    }
    if (this.devAutoPick && w.phase === 'pick' && !w.dead && !this.session.hasPending) this.command({ type: 'pickPerk', index: 0 });
    if (WIDGET) this.widgetTick(time);
    else this.autoBuyTick();
    if (this.secondWindPending > 0 && w.dead) {
      this.command({ type: 'revive', hp: this.secondWindPending });
      this.secondWindPending = 0;
      this.life.runStarted(w, []);
    }
    const n = this.loop.frame(delta, this.paused || w.dead || services.ads.running ? 0 : this.speed);
    if (n > 0) {
      this.session.advance(n, this.onEvent);
      this.runStats.realMs += delta;
    }
    this.zoomTick(delta);
    const alpha = w.dead ? 1 : this.loop.alpha();
    this.view.draw(alpha, time);
    this.structures.draw(this.session.world, time);
    this.crystal.draw(this.session.world, sectorTags(this.session.world, this.gd), time);
    this.genome.update(this.session.world.genome);
    this.fx.update();
    this.hud.update(this.session.world, this.session.stats, this.speed, this.paused && !this.editor.visible, time, delta);
    this.upgrades.update(time);
    if (this.bannerUntil > 0) {
      const left = this.bannerUntil - time;
      if (left <= 0) {
        this.banner.setVisible(false);
        this.bannerSub.setVisible(false);
        this.bannerUntil = 0;
      } else {
        this.banner.setAlpha(Math.min(1, left / 400));
        this.bannerSub.setAlpha(Math.min(1, left / 400));
      }
    }
    if (this.deathAt > 0 && !this.death.visible && time - this.deathAt > 700) {
      const dw = this.session.world;
      const p = this.paid;
      this.death.show(
        {
          wave: dw.wave,
          kills: dw.kills,
          bits: p ? p.s.bits : Math.floor(dw.bits),
          keys: p ? p.s.keys : dw.keys,
          note: [latticeLine(this.gd, dw, true), p ? this.deathNote(p.s) : ''].filter((x) => x).join(' · '),
          canRevive: !dw.revived && !this.flags.stress,
          canDouble: p !== null && !p.doubled,
        },
        time,
      );
    }
    this.chips.update(tagCounts(w, this.gd), w.setTiers, fusionLinkCounts(w, this.gd), w.fusionTiers);
    // Overlays cover the chips without a pointerout: drop a hover card left open under them.
    if (w.dead || w.phase === 'pick' || this.editor.visible || this.protocols.visible || this.statsPanel.visible) {
      this.chips.hideTip();
      if (this.modTipAt >= 0) this.hoverModule(-1e6, -1e6, true);
    }
    this.numbers.update(time);
    this.updateHints(time);
    const tense = !w.dead && w.core.hp < this.session.stats.health * 0.3;
    if (tense !== services.audio.tense) {
      services.audio.tense = tense;
      services.audio.apply();
    }
    if (w.phase === 'pick' && !w.dead) {
      if (!this.pickHeld) this.life.hold('perkPick', true);
      this.pickHeld = true;
      if (!this.editor.visible) this.pick.show(w, time);
    } else if (this.pickHeld) {
      this.pickHeld = false;
      this.pick.hide();
      this.endPlacing();
      this.life.hold('perkPick', false);
    }
    const pauseMenu = this.paused && !w.dead && !this.editor.visible && !this.protocols.visible && !this.statsPanel.visible && w.phase !== 'pick';
    this.exitBtn.setVisible(pauseMenu);
    this.statsBtn.setVisible(pauseMenu);
    this.crystalBtn.setVisible(pauseMenu && w.crystal.length > 0);
    this.editor.update(time);
    if (this.statsPanel.visible && time >= this.statsRefreshAt) {
      this.statsRefreshAt = time + 500;
      this.statsPanel.update(this.statsTabs());
    }
    this.death.update(time);
    this.frameMs.push(delta);
    if (this.frameMs.length > 120) this.frameMs.shift();
    if (this.fpsText && (this.game.getFrame() & 15) === 0) {
      this.fpsText.setText(`FPS ${this.avgFps().toFixed(0)}  ·  ${this.session.world.enemies.length} viruses  ·  ×${this.speed}`);
    }
  }
}

