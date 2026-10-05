import Phaser from 'phaser';
import adsJson from './data/ads.json';
import { MidgamePolicy } from './portal/adPolicy';
import { Ads } from './portal/ads';
import { createPortal } from './portal';
import { PortalGuard } from './portal/PortalGuard';
import { showToast } from './portal/toast';
import { installDevHooks } from './render/devHooks';
import { LETTERBOX } from './render/palette';
import { initRenderScale } from './render/resolution';
import { BattleScene } from './render/scenes/BattleScene';
import { BootScene } from './render/scenes/BootScene';
import { HomeScene } from './render/scenes/HomeScene';
import { AudioBus } from './render/audio';
import { services } from './services';
import { setButtonPressHook } from './ui/kit';
import { DEFAULT_DATA } from './sim/data';
import { installSessionEvents, Telemetry } from './telemetry/Telemetry';
import { chooseOrientation, makeLayout } from './ui/layout';

/** SDK init may take at most this long before the game opens anyway (a late init is replayed by PortalGuard). */
const PORTAL_INIT_CAP_MS = 2500;

async function start(): Promise<void> {
  const portal = await createPortal();
  const guard = new PortalGuard(portal, { midgameTimeoutMs: adsJson.midgame.timeoutMs, rewardedTimeoutMs: adsJson.rewarded.timeoutMs });
  // Portals measure engagement from the first real input (Poki: no gameplayStart before it).
  const onInput = () => guard.noteInput();
  window.addEventListener('pointerdown', onInput, { capture: true, passive: true });
  window.addEventListener('keydown', onInput, { capture: true, passive: true });
  // Keep the host page from scrolling while the game has focus.
  window.addEventListener('keydown', (e) => {
    if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'].includes(e.key)) e.preventDefault();
  });
  window.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  const settled = portal
    .init()
    .catch((e) => console.debug('[portal] init failed', e))
    .then(() => guard.portalReady());
  // MidgamePolicy's clock starts now: the first midgame gap counts from session start.
  // Dev only: ?midgame=always drops the gap and the first-death rule (UI smoke).
  const forceMidgame = import.meta.env.DEV && new URLSearchParams(location.search).get('midgame') === 'always';
  const rules = forceMidgame ? { minGapSeconds: 0, skipFirstBreaks: 0 } : adsJson.midgame;
  const telemetry = new Telemetry(__BUILD__);
  services.portal = portal;
  services.guard = guard;
  services.telemetry = telemetry;
  services.storage = portal.storage();
  services.portalInit = Promise.race([settled, new Promise<void>((r) => setTimeout(r, PORTAL_INIT_CAP_MS))]);
  services.ads = new Ads({
    guard,
    policy: new MidgamePolicy(rules, () => performance.now()),
    telemetry,
    toast: (t) => showToast(t, adsJson.toast.ms, toastAnchor()),
    toastText: adsJson.toast.text,
  });
  // Poki's init can settle after its own cap; availability is re-read now and then (cheap).
  setInterval(() => guard.checkAvailability(), adsJson.availabilityPollMs);

  // The layout is chosen once at load from the window aspect (spec §4); a later resize only re-fits.
  const layout = makeLayout(chooseOrientation(window.innerWidth, window.innerHeight), DEFAULT_DATA, window.innerHeight / window.innerWidth);
  const rs = initRenderScale(layout.w, layout.h, window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    banner: import.meta.env.DEV, // clean console in portal builds
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
    scene: [BootScene, HomeScene, BattleScene],
  });
  game.registry.set('layout', layout);
  // The toast sits in the arena (below the core), never across the arena/panel seam.
  const toastAnchor = () => {
    const r = game.canvas?.getBoundingClientRect();
    if (!r || r.width === 0) return null;
    const a = layout.arena;
    return { x: r.left + ((a.x + a.w / 2) * r.width) / layout.w, y: r.top + ((a.y + a.h * 0.72) * r.height) / layout.h };
  };

  // Effective mute = portal mute OR an ad is playing (audio mutes at the ad's real start, not at request).
  let portalMuted = false;
  let adAudio = false;
  const audio = new AudioBus();
  services.audio = audio;
  const applyMute = () => {
    game.sound.mute = portalMuted || adAudio;
    audio.portalMuted = portalMuted;
    audio.adPlaying = adAudio;
    audio.apply();
  };
  // Browsers start audio only from a user gesture.
  window.addEventListener('pointerdown', () => audio.unlock(), { capture: true, passive: true });
  setButtonPressHook(() => audio.play('click'));
  window.addEventListener('keydown', () => audio.unlock(), { capture: true, passive: true });
  services.isMuted = () => portalMuted || adAudio;
  portal.onMuteChange((m) => {
    portalMuted = m;
    applyMute();
  });
  guard.onAdAudio((m) => {
    adAudio = m;
    applyMute();
  });
  game.events.once(Phaser.Core.Events.READY, applyMute);

  installSessionEvents(telemetry, () => ({ runs: telemetry.runIndex }));
  const telemetryFlag = new URLSearchParams(location.search).get('telemetry') === '1';
  if (import.meta.env.DEV || telemetryFlag) {
    void import('./telemetry/DevOverlay').then((m) => m.installDevOverlay(telemetry, telemetryFlag));
  }
  if (import.meta.env.DEV) installDevHooks(game);
}

void start();
