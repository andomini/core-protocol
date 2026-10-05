// Dev-only window.__cp: state readers and controls for the Playwright smoke. Installed only when
// import.meta.env.DEV is true, so production builds contain none of it (checked by grepping dist/).

import type Phaser from 'phaser';
import type { RewardedPlacement } from '../portal/ads';
import { services } from '../services';
import type { BuyCount } from '../sim/commands';
import type { EnemyKind, StatId, TabId } from '../sim/data';
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
        pickOpen: b.pick.visible,
        offer: [...w.offer],
        picks: w.picks,
        perks: Object.fromEntries(Object.entries(w.perks).filter(([, n]) => n > 0)),
        setTiers: { ...w.setTiers },
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
        layout: { w: b.L.w, h: b.L.h, panel: b.L.panel },
      };
    },
    setTab: (t: TabId) => battle()?.upgrades.setTab(t),
    /** Issues a buy command exactly like a row tap would. */
    buy: (stat: StatId, count: BuyCount = 1) => battle()?.command({ type: 'buy', stat, count }),
    /** Dev cheat for manual testing: adds Energy outside the command log (breaks replay of this run). */
    give: (energy: number) => {
      const b = battle();
      if (b) b.session.world.energy += energy;
    },
    setSpeed: (n: number) => battle()?.setSpeed(n),
    pause: (on = true) => battle()?.setPaused(on),
    spawn: (kind: EnemyKind, n = 1, dir?: number) => battle()?.spawn(kind, n, dir),
    restart: () => battle()?.restart(),
    /** Takes card `i` of the open protocol offer (as a card tap would). */
    pickPerk: (i = 0) => battle()?.command({ type: 'pickPerk', index: i }),
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
  };
}
