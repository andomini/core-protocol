// Dev-only window.__cp: state readers and controls for the Playwright smoke. Installed only when
// import.meta.env.DEV is true, so production builds contain none of it (checked by grepping dist/).

import type Phaser from 'phaser';
import type { BuyCount } from '../sim/commands';
import type { EnemyKind, StatId, TabId } from '../sim/data';
import type { BattleScene } from './scenes/BattleScene';

export function installDevHooks(game: Phaser.Game): void {
  const battle = (): BattleScene | null => {
    const s = game.scene.getScene('Battle') as unknown as BattleScene | null;
    return s && s.sys.isActive() ? s : null;
  };
  (window as unknown as { __cp: unknown }).__cp = {
    game,
    ready: () => battle() !== null && battle()!.session !== undefined,
    state: () => {
      const b = battle();
      if (!b) return { scene: game.scene.getScenes(true).map((s) => s.sys.settings.key).join(',') };
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
      };
    },
    /** Upgrade panel and overlay geometry (logical px) for real taps in the smoke. */
    ui: () => {
      const b = battle();
      if (!b) return null;
      return { ...b.upgrades.info(), restart: b.death.restartRect(), layout: { w: b.L.w, h: b.L.h, panel: b.L.panel } };
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
  };
}
