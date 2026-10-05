// Boot: bake every neon texture at the render scale, then wait (bounded) for the web fonts and the portal
// SDK init, report loading finished to the portal (once), then Battle.

import Phaser from 'phaser';
import { services } from '../../services';
import { DEFAULT_DATA } from '../../sim/data';
import { generateTextures } from '../textures';

const FONT_TIMEOUT_MS = 2500;

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    generateTextures(this, DEFAULT_DATA);
    // Text is rasterised on creation: wait for the fonts (bounded so a slow font never blocks play).
    const fonts = Promise.all([
      document.fonts?.load('900 40px "Orbitron"'),
      document.fonts?.load('700 28px "Chakra Petch"'),
      document.fonts?.load('500 28px "Chakra Petch"'),
    ]).catch(() => undefined);
    const timeout = new Promise((r) => setTimeout(r, FONT_TIMEOUT_MS));
    void Promise.race([Promise.all([fonts, services.portalInit]), timeout]).then(() => {
      services.guard.loadingFinished();
      this.scene.start('Battle');
    });
  }
}
