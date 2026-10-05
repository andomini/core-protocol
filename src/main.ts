import Phaser from 'phaser';
import { installDevHooks } from './render/devHooks';
import { LETTERBOX } from './render/palette';
import { initRenderScale } from './render/resolution';
import { BattleScene } from './render/scenes/BattleScene';
import { BootScene } from './render/scenes/BootScene';
import { DEFAULT_DATA } from './sim/data';
import { chooseOrientation, makeLayout } from './ui/layout';

// The layout is chosen once at load from the window aspect (spec §4); a later resize only re-fits.
const layout = makeLayout(chooseOrientation(window.innerWidth, window.innerHeight), DEFAULT_DATA);
const rs = initRenderScale(layout.w, layout.h, window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: LETTERBOX,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    // Canvas in real device pixels; scenes zoom their camera by RS (see render/resolution.ts).
    width: Math.round(layout.w * rs),
    height: Math.round(layout.h * rs),
  },
  render: { antialias: true, powerPreference: 'high-performance' },
  input: { activePointers: 2 },
  scene: [BootScene, BattleScene],
});
game.registry.set('layout', layout);
if (import.meta.env.DEV) installDevHooks(game);
