// Boot: bake every neon texture at the render scale, then wait (bounded) for the web fonts and the portal
// SDK init, report loading finished to the portal (once), then Battle.

import Phaser from 'phaser';
import { MetaStore } from '../../meta/MetaStore';
import { DEFAULT_META_DATA } from '../../meta/metaData';
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
      // The meta save is read after the portal init (CrazyGames data module) where possible.
      services.meta = new MetaStore(services.storage, DEFAULT_DATA, DEFAULT_META_DATA);
      const m = services.meta.meta;
      // The very first session drops straight into a run (instant play); later ones open on Home.
      const forceHome = import.meta.env.DEV && new URLSearchParams(location.search).get('home') === '1';
      if (!forceHome && !m.firstRunDone && !services.meta.hasRun()) this.scene.start('Battle', { mode: 'new', tier: 1 });
      else this.scene.start('Home');
    });
  }
}
