// App-wide services, set once in main.ts before the Phaser game is created. Scenes import `services`.
import type { Ads } from './portal/ads';
import type { Portal } from './portal/Portal';
import type { PortalGuard } from './portal/PortalGuard';
import type { KeyValue } from './portal/storage';
import type { MetaStore } from './meta/MetaStore';
import type { Telemetry } from './telemetry/Telemetry';

export interface Services {
  portal: Portal;
  guard: PortalGuard;
  ads: Ads;
  telemetry: Telemetry;
  /** Game saves (M4 meta, run snapshots): CrazyGames data module where available, else localStorage. Wrap in SaveSlot. */
  storage: KeyValue;
  /** Portal init, raced against the boot cap: always resolves. BootScene waits for it before loadingFinished. */
  portalInit: Promise<void>;
  /** Meta progress + the saved run (M4). */
  meta: MetaStore;
  /** Effective mute: portal mute OR ad audio. */
  isMuted(): boolean;
}

export const services = {} as Services;
