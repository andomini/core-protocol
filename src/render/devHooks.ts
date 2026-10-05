// Dev-only window.__cp: state readers and controls for the Playwright smoke. Installed only when
// import.meta.env.DEV is true, so production builds contain none of it (checked by grepping dist/).

import type Phaser from 'phaser';
import type { EnemyKind } from '../sim/data';
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
      };
    },
    setSpeed: (n: number) => battle()?.setSpeed(n),
    pause: (on = true) => battle()?.setPaused(on),
    spawn: (kind: EnemyKind, n = 1, dir?: number) => battle()?.spawn(kind, n, dir),
    restart: () => battle()?.restart(),
  };
}
