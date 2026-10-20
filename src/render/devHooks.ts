// Dev-only window.__cp: state readers and controls for the Playwright smoke. Installed only when
// import.meta.env.DEV is true, so production builds contain none of it (checked by grepping dist/).

import type Phaser from 'phaser';
import type { RewardedPlacement } from '../portal/ads';
import { services } from '../services';
import type { BuyCount } from '../sim/commands';
import type { EnemyKind, StatId, TabId } from '../sim/data';
import { grantPerk, rebuildCrystal } from '../sim/perks';
import { freeSlots } from '../sim/crystal';
import type { BattleScene } from './scenes/BattleScene';

export function installDevHooks(game: Phaser.Game): void {
  const portalState = () => ({
    portal: services.portal.name,
    adRunning: services.ads.running,
    adAudioMuted: services.guard.isAdAudioMuted,
    // Effective mute as applied to game.sound.mute (Phaser's own getter lags while the AudioContext is locked).
    soundMuted: services.isMuted(),
    gameplay: services.guard.isPlaying,
    adsAvailable: services.ads.available,
  });
  const battle = (): BattleScene | null => {
    const s = game.scene.getScene('Battle') as unknown as BattleScene | null;
    return s && s.sys.isActive() ? s : null;
  };
  (window as unknown as { __cp: unknown }).__cp = {
    game,
    ready: () => (battle() !== null && battle()!.session !== undefined) || game.scene.isActive('Home'),
    /** Meta save (dev): read, or patch and persist (e.g. { bits: 5000, firstRunDone: true }). */
    meta: (patch?: Record<string, unknown>) => {
      const m = services.meta.meta as unknown as Record<string, unknown>;
      if (patch) {
        Object.assign(m, patch);
        services.meta.save();
        const h = game.scene.getScene('Home') as unknown as { refresh?: () => void };
        if (game.scene.isActive('Home')) h.refresh?.();
      }
      return JSON.parse(JSON.stringify(m));
    },
    /** Switches scenes like the UI does. */
    goto: (scene: 'Home' | 'Battle', data?: Record<string, unknown>) => {
      for (const s of game.scene.getScenes(true)) if (s.sys.settings.key !== 'Boot') s.scene.start(scene, data);
    },
    homeTab: (t: string) => (game.scene.getScene('Home') as unknown as { setTab: (t: string) => void }).setTab(t),
    state: () => {
      const b = battle();
      if (!b) return { scene: game.scene.getScenes(true).map((s) => s.sys.settings.key).join(','), ...portalState() };
      const w = b.session.world;
      return {
        scene: 'Battle',
        orientation: b.L.o,
        wave: w.wave,
        tick: w.tick,
        phase: w.phase,
        enemies: w.enemies.length,
        visible: b.visibleEnemies(),
        projectiles: w.projectiles.length,
        dead: w.dead,
        overlay: b.death.visible,
        kills: w.kills,
        energy: w.energy,
        bits: w.bits,
        coreHp: w.core.hp,
        speed: b.speed,
        paused: b.paused,
        fps: Math.round(b.avgFps()),
        seed: w.seed,
        levels: { ...w.levels },
        unlocked: [...w.unlocked],
        tab: b.upgrades.tab,
        amount: b.upgrades.amount,
        commands: b.session.log.length,
        pickOpen: b.pick.visible || b.placingIndex >= 0,
        placing: b.placingIndex >= 0,
        crystal: w.crystal.map((m) => [m.q, m.r]),
        offer: [...w.offer],
        bootOffer: [...w.bootOffer], // boot
        boot: w.boot, // boot
        picks: w.picks,
        perks: Object.fromEntries(Object.entries(w.perks).filter(([, n]) => n > 0)),
        setTiers: { ...w.setTiers },
        fusionTiers: { ...w.fusionTiers },
        keys: w.keys,
        ...portalState(),
        restarting: b.life.isRestarting,
      };
    },
    /** Upgrade panel and overlay geometry (logical px) for real taps in the smoke. */
    ui: () => {
      const b = battle();
      if (!b) return null;
      const cards = [0, 1, 2, 3].map((i) => b.pick.cardRect(i)).filter((r) => r !== null);
      return {
        ...b.upgrades.info(),
        restart: b.death.restartRect(),
        home: b.death.homeRect(),
        double: b.death.doubleRect(),
        revive: b.death.reviveRect(),
        pick: { cards, reroll: b.pick.rerollRect(), boost: b.pick.boostRect() },
        place: b.crystal.placing ? { ...b.editor.rects(), autoSlot: b.crystal.placing.auto && b.crystal.hexScreen(...b.crystal.placing.auto), free: b.crystal.placing.free } : null,
        editor: b.editor.visible ? b.editor.rects() : null,
        crystalBtn: b.crystalBtn.r,
        layout: { w: b.L.w, h: b.L.h, panel: b.L.panel },
      };
    },
    setTab: (t: TabId) => battle()?.upgrades.setTab(t),
    /** Issues a buy command exactly like a row tap would. */
    buy: (stat: StatId, count: BuyCount = 1) => battle()?.command({ type: 'buy', stat, count }),
    /** Dev cheat for manual testing: adds Energy outside the command log (breaks replay of this run). */
    /** Drops the core far below 0 HP (past any regen) outside the command log (dies on the next tick): a quick death for any loadout. */
    breach: () => {
      const b = battle();
      if (b) b.session.world.core.hp = -1e12;
    },
    give: (energy: number) => {
      const b = battle();
      if (b) b.session.world.energy += energy;
    },
    setSpeed: (n: number) => battle()?.setSpeed(n),
    pause: (on = true) => battle()?.setPaused(on),
    spawn: (kind: EnemyKind, n = 1, dir?: number) => battle()?.spawn(kind, n, dir),
    /** Jumps the wave counter (the arena radius and camera zoom follow at the next frame). */
    setWave: (n: number) => {
      const b = battle();
      if (b) b.session.world.wave = n;
    },
    restart: () => battle()?.restart(),
    /**
     * Dev: replaces the crystal with a showcase one (sets on and off, a lone module, fusions I and II) outside
     * the command log (breaks replay of this run), for crystal screenshots and the editor checks.
     */
    demoCrystal: () => {
      const b = battle();
      if (!b) return;
      const w = b.session.world;
      // A clean slate first: the boot sector and the picks so far would sit under the showcase and hide its moves.
      w.crystal = [];
      for (const id of Object.keys(w.perks)) w.perks[id] = 0;
      w.mods = w.mods.filter((m) => !m.source.startsWith('perk:'));
      rebuildCrystal(w, b.gd);
      const put: [string, [number, number], number][] = [
        ['overclockRounds', [-2, 2], 2], ['burstFire', [-1, 2], 2], ['bounce', [0, 2], 1], ['arc', [-1, 3], 1], ['conductive', [-2, 3], 1],
        ['frostShot', [2, 0], 1], ['patch', [2, -2], 2], ['hardening', [1, -2], 1], ['energySiphon', [0, -2], 2],
      ];
      // A slot that is not free falls back to the auto slot (every perk id is a key of w.perks: test the stacks, not the key).
      const free = (s: [number, number]) => freeSlots(w, b.gd).some(([q, r]) => q === s[0] && r === s[1]);
      for (const [id, slot, n] of put) for (let i = 0; i < n; i++) grantPerk(w, b.gd, id, null, i === 0 && (w.perks[id] ?? 0) === 0 && free(slot) ? slot : undefined);
    },
    /** Takes card `i` of the open protocol offer (as a card tap would: the boot sector while the boot pick is open). */
    pickPerk: (i = 0) => {
      const b = battle();
      b?.command(b.session.world.bootOffer.length > 0 ? { type: 'pickBoot', index: i } : { type: 'pickPerk', index: i });
    },
    /** Opens a protocol pick now (outside the schedule). */
    pickNow: () => battle()?.devPickNow(),
    /** Takes boot sector `i` of the open boot offer. */
    pickBoot: (i = 0) => battle()?.command({ type: 'pickBoot', index: i }),
    /** The crystal editor: `index` ≥ 0 places that offer card's module, −1 (default) arranges (as the pause menu's CRYSTAL). */
    openEditor: (index = -1) => battle()?.openEditor(index),
    closeEditor: () => battle()?.closeEditor(true),
    editor: () => {
      const e = battle()?.editor;
      if (!e) return null;
      return { open: e.visible, mode: e.mode, selected: e.selected, readout: [...e.readoutLines], strip: [...e.stripLines], chips: e.pairChips().map((c) => ({ ...c })), glow: e.glowing().map((x) => [...x]), stripEnd: e.stripEnd, stripBottom: e.stripBottom };
    },
    /** Screen point (logical px) of crystal hex (q, r) at the current zoom. */
    slotScreen: (q: number, r: number) => battle()?.crystal.hexScreen(q, r) ?? null,
    /** Issues a moveModule command (as the editor would). */
    moveModule: (from: [number, number], to: [number, number]) => battle()?.command({ type: 'moveModule', from, to }),
    /** Fusion chips shown in the set bar (pair key → rect) and the pair whose card is open. */
    /** Shows `label` in the HUD's Bounty chip (render only; the next real change replaces it) and returns the logical bounds of the chip and its HUD neighbours. */
    bountyPreview: (label: string) => {
      const b = battle();
      if (!b) return null;
      const box = (t: Phaser.GameObjects.Text) => {
        const r = t.getBounds();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      b.hud.bountyText.setText(label);
      return { bounty: box(b.hud.bountyText), wave: box(b.hud.waveText), secs: box(b.hud.secsText), chips: b.chips.rect, pairs: Object.values(b.chips.pairs) };
    },
    fusionChips: () => {
      const c = battle()?.chips;
      return c ? { pairs: c.pairs, tip: c.tipKey } : null;
    },
    openProtocols: () => battle()?.openProtocols(),
    closeProtocols: () => battle()?.closeProtocols(),
    /** The RESTART button path (midgame ad offer first). */
    requestRestart: () => {
      const b = battle();
      if (b) void b.life.requestRestart(() => b.restart());
    },
    /** A rewarded ad through the real service (toast on failure); resolves true if it completed. */
    rewarded: (placement: RewardedPlacement) => services.ads.rewarded(placement),
    telemetry: () => services.telemetry.all(),
    /** The leaderboard service (identity, queue, flush) for the UI smoke's mocked-API checks. */
    lb: () => services.leaderboard,
  };
}
