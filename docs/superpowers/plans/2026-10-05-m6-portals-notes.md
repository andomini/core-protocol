# M6 (foundation) — portals, ads, storage, telemetry, packaging: notes

Branch `m6-portals`, commits `0ac0ceb..HEAD`, on top of M2b (`c8b1be5`). Built in parallel with M3/M4/M5, so this is infrastructure plus the one call site that exists today: a midgame ad on RESTART.

Status:
- Tests 195 → 260.
- `typecheck`, `build`, `build:crazygames`, `build:poki` and `build:all` are green. Every build runs `tools/postbuild.mjs`.
- `npm run ui` passes 131/131: the 78 M2 checks plus 53 portal checks.
- `npm run ui:portal-build` passes 22/22.
- `npm run package` writes `dist/core-protocol-crazygames.zip` (374 KB) and `dist/core-protocol-poki.zip` (374 KB).

## For M3 / M4 / M5: the APIs

Everything hangs off `services` (`src/services.ts`), which `main.ts` sets up before Phaser starts.

### Ads: `services.ads` (`src/portal/ads.ts`)
```ts
type RewardedPlacement = 'revive' | 'doubleBits' | 'reroll' | 'freePack' | 'boost' | 'offlineDouble';
services.ads.rewarded(p: RewardedPlacement): Promise<boolean> // true only if the ad played to the end
services.ads.midgame(trigger: 'restart'): Promise<boolean>   // the policy may skip; never rejects
services.ads.available: boolean                              // show rewarded buttons?
services.ads.onAvailable(cb): unsubscribe                    // cb(now), then on every change
services.ads.running: boolean; services.ads.onAd(cb)         // an ad is between request and settle
```

How it behaves:
- **`rewarded()`**
  - Never rejects.
  - When it resolves `false` (unavailable, failed, closed early or timed out after 60 s), it has already shown the **"No ad right now"** DOM toast. The caller must not show a popup.
  - A double tap returns `false` at once and doesn't request a second ad.
  - It also emits the `ad_request` and `ad_result` telemetry events, so the caller doesn't need to.
- **Pause and mute are automatic.**
  - Gameplay stops at request time: PortalGuard sends `gameplayStop`, and `BattleScene` stops ticking while `ads.running`.
  - Audio mutes only on the SDK's real ad start (`adStarted` on CrazyGames, the `onStart` argument on Poki, after 300 ms on Local) and unmutes when the ad settles.
  - A new scene that ticks must also halt while `services.ads.running`.
- **Rewarded buttons:** hide them when `available` is false. CrazyGames reports false with adblock, Poki before init settles, and Local with `?ads=none`. Subscribe with `onAvailable` and keep the unsubscribe for scene shutdown.

**Replacing M3's temporary stub:**
1. Replace `portal.rewardedAd(...)` with `services.ads.rewarded('reroll' | 'boost')` (`import { services } from '../services'`).
2. Drop any toast or failure UI the stub had: the service already shows the toast.
3. Delete the stub.

The placement union lives in `src/portal/ads.ts` (`REWARDED_PLACEMENTS`). Add a member there if a new placement appears.

The spec's rules about *when* an offer may appear (never during active combat, Boost at most every 10 waves, one revive per run) belong to the caller. Last Tower's `src/portal/adPolicy.ts` `rewardedAllowed()` is a good pattern to copy.

### Gameplay lifecycle: `BattleScene.life` (`src/portal/lifecycle.ts`, `RunLifecycle`)
- `life.hold(reason, on)`:
  - gameplay runs only when no holds are active;
  - `'paused'` and `'dead'` are already wired;
  - **M3:** call `life.hold('perkPick', true/false)` around the perk pick overlay. The same goes for any other overlay that stops play (`'menu'`, `'workshop'`, …).
- `life.runStarted(world)` is called from `create()` and `restart()`. It clears the holds, starts a telemetry run and emits `run_start`. A revive (M4) should **not** call it; release the `'dead'` hold instead.
- `life.onEvent(e, world)` sees every sim event. It produces `wave_reached`, `purchase` and `death`; `death` also sets the `'dead'` hold.
- `life.requestRestart(fn)` handles the RESTART button: it offers a midgame ad, then calls `fn`.
  - **M4 "New run":** use the same path.
  - The ×2 Bits and Revive buttons call `services.ads.rewarded` directly.

### Storage: `services.storage` + `SaveSlot` (`src/portal/storage.ts`)
```ts
const meta = new SaveSlot<Meta>(services.storage, { key: 'core-protocol.meta', version: 1, defaults, validate, migrations: {} });
const { data, status } = meta.load(); // status: fresh | ok | migrated | corrupt | future
meta.save(data);                      // writes {v, data}; false if read-only
```

How it works:
- **The envelope** is `{v, data}`. `migrations[n]` turns vN data into vN+1. The chain must be unbroken, which the constructor checks.
- **`validate(data)`** must normalise the data or throw. A throw counts as corrupt.
- **Corrupt blobs** (bad JSON, bad envelope, a failed migration or validation): load returns the defaults and keeps the raw blob in `<key>.bak`.
- **A newer stored version** (an old cached build): load returns the defaults, `.bak` gets a copy, and the slot turns **read-only**, so it never overwrites newer progress.
- **Load before save.** On CrazyGames, `services.storage` is SDK.data per key, but only if that key was *read* from SDK.data. A late or disabled data module therefore never overwrites cloud progress (ported Merge Wall test). A key that was never read goes to localStorage.
- **Fallbacks:** blocked localStorage falls back to memory. Nothing throws.
- **Not wired to gameplay yet.** M4 owns the meta save, and M2.5 owns the run snapshot, which needs `visibilitychange`/`pagehide` saves (spec §2.5).

### Telemetry: `services.telemetry` (`src/telemetry/Telemetry.ts`)
- **Events:**

  | Event | Fields |
  |---|---|
  | `session_start` | portal, ua, size, dpr; `{resumed}` after the tab was hidden |
  | `session_end` | reason, activeS, runs; on `visibilitychange: hidden` or `pagehide` |
  | `run_start` | seed, tier, deviceId, runIndex |
  | `wave_reached` | wave, boss, simS |
  | `purchase` | stat, levels, level, cost, free, wave, energyAfter |
  | `death` | wave, time (sim s), wallS, energy, bits, kills |
  | `ad_request` | kind, placement |
  | `ad_result` | kind, placement, result `completed|failed|unavailable`, ms |

- Every event also carries `t`, `runId`, `sessionId`, `deviceId` and `build` (`__BUILD__` = `<portal>-<UTC yyyymmddhhmm>`).
- **Adding an event:** extend `TelemetryType`, emit it with `services.telemetry.emit(type, payload)`, and add a section to `tools/telemetry-report/summary.ts`. M3 should add `perk_offer`/`perk_pick`, and M4 `meta_buy`/`offline_claim`.
- **Storage:** a ring buffer in localStorage `core-protocol.telemetry` (≤ 200 KB, ≤ 4000 events). `deviceId` and the lifetime `runIndex` live in `core-protocol.device`. Both are plain localStorage, never the CrazyGames cloud.
- **Overlay:** the backtick/`~` key in DEV; `?telemetry=1` in **any** build opens it at load. It shows a live tail with Export JSON, Clear and Close, and ships as a lazy chunk.
- **Report:** `npm run telemetry:report -- a.json b.json` writes `reports/telemetry-<date>.md`. It covers:
  - death wave by lifetime run number;
  - seconds between purchases;
  - levels bought per stat;
  - the ad funnel;
  - session length.

## Builds and size (B8)
Each portal build contains exactly one adapter chunk. Lifecycle forwarding (gameplay start/stop, loadingFinished) is verified both on the dev server against fake SDKs and on the production builds.

The postbuild check fails a build in any of these cases:
- another portal's name, SDK URL or adapter API appears;
- the portal's own SDK tag in `index.html` is missing or appears more than once;
- the own adapter API is missing;
- the Local fake-ad overlay or `?ads=` handling is present in a portal build;
- dev hooks or flags are present (`__cp`, `unlockall`, dev.json keys, `?portal=`, `midgame=always`);
- `index.html` or the JS uses absolute paths;
- the initial download exceeds 1 MB of transfer.

Measured with `npm run build:all` (KiB; text gzip -9, woff2 as stored):

| Build | Raw initial | Transfer (gzip) | Main JS raw / gz | Adapter chunk | Zip |
|---|---|---|---|---|---|
| local | 1290.3 | 368.9 | 1256 / 336 | Local 2.0 | — |
| crazygames | 1290.4 | 368.7 | 1256 / 336 | CrazyGames 2.0 | 374.3 |
| poki | 1289.4 | 368.4 | 1256 / 336 | Poki 1.0 | 374.0 |

Fonts add 31 KiB. Deferred, and not counted toward the initial download: the DevOverlay chunk (0.7 KiB gzip) and the OFL licence texts.

**Proposed fix if B8 means raw bytes (do not implement unless needed):** do a custom Phaser build that drops Arcade/Matter physics, tilemaps, the video/DOM element plugins, spine and similar. The game uses none of them. That should cut about 35–45 % of the 1.2 MB of Phaser code. The usual route is a `phaser/src` entry with only the needed modules (Phaser's custom-build docs). M7 owns the B8 check on a production build.

## Smoke
`npm run ui` (`-- --only portal`) runs on the dev server with `UI_PORT`, default 5180. A port that's taken falls through to the next free one.

Portal checks:
- **Local:**
  - loadingFinished once;
  - no gameplayStart before the first input;
  - pause → stop and resume → start;
  - death → stop;
  - a **first-death RESTART with no ad**;
  - telemetry `run_start` ×2 (runIndex +1), `wave_reached`, `purchase`, `death`.
- **Midgame on RESTART**, run on Local (portrait), on CrazyGames with a fake SDK (907×510) and on Poki with a fake SDK (phone):
  - right after the tap: ad running, sim halted, gameplay stopped, **not muted**;
  - after the SDK's adStarted: **muted**;
  - the sim tick is frozen during the ad;
  - after the ad: unmuted, a new run with a new seed, gameplay started again;
  - SDK order: stop → ad → start.
- **`?ads=fail`:** the failed midgame is silent and the run still restarts within 3 s. A rewarded ad resolves `false` in under 2 s and shows the toast. Nothing is left stuck (no ad running, no mute).
- **`?ads=none`:** `available` is false and rewarded never reaches the SDK.
- **Telemetry overlay:** toggles with `~`.

`npm run ui:portal-build` (after `build:all`, port `PORTAL_CHECK_PORT`, default 5181) serves `dist/<portal>` and checks:
- with the real SDK URL fulfilled by the fake SDK through `page.route` (no network needed): `loadingStop`/`gameLoadingFinished` once, no gameplayStart before input, pause/resume via HUD taps, no other portal's host contacted, no console errors;
- with the SDK URL blocked (adblock): the game still boots, with no errors.

Screenshots: `reports/screens/portal-midgame-portrait.jpg`, `portal-midgame-landscape.jpg` and `portal-ad-fail-toast.jpg`.

**Merge hygiene:** a full `npm run ui` rewrites M2's screenshots and `reports/ui-smoke.json`. I restored them with `git checkout reports/` and committed only the `portal-*` shots.

## Dev hooks and flags (DEV only, stripped from builds)
- `?ads=ok|fail|nofill|hang|none` sets the Local portal's fake ads:
  - `ok`: starts after 300 ms and lasts 2 s, with a "Close early" button;
  - `fail`: rejects after 150 ms;
  - `nofill`: resolves at once with no ad;
  - `hang`: never settles; the guard times out (30 s for midgame, 60 s for rewarded);
  - `none`: unavailable.
- `?portal=crazygames|poki` runs that adapter on the dev server. The smoke injects `tools/ui/fake-sdk/<portal>.js`.
- `?midgame=always` drops the midgame gap and the first-death rule.
- `__cp.state()` gains `portal`, `adRunning`, `adAudioMuted`, `soundMuted` (effective mute), `gameplay` (the SDK was told gameplay is running), `adsAvailable` and `restarting`.
- New `__cp` calls: `__cp.requestRestart()` (the button path), `__cp.rewarded(placement)` and `__cp.telemetry()`.

## Rulings
| Decision | Why | Cost if wrong |
|---|---|---|
| B8 "initial download ≤ 1 MB" is measured as **transfer bytes** (gzip -9 text + woff2), as Last Tower's `tools/size.ts` does; raw is printed beside it | Portals serve gzip/brotli; raw Phaser alone is 1.2 MB, so raw would fail before any game code exists | If raw is meant, do the custom Phaser build (above); the check is a one-line change in `postbuild.mjs` |
| Midgame policy: never at the session's first break (first death), and ≥ 180 s since the last ad that **played** (midgame or rewarded), counted from session start. Numbers are in `src/data/ads.json` | CrazyGames docs: the SDK paces midgames to ≤ 1 per 3 min and asks to protect day-1 retention, so no ads in the first minutes. Poki: call `commercialBreak` at natural breaks and Poki paces it. A game-side floor keeps both portals and the local build consistent | One more ad opportunity lost per session at worst; tune in data |
| A rewarded ad restarts the midgame gap | Avoids revive ad → death → midgame back to back; CrazyGames also adds "safeguards around rewarded ads" | Slightly fewer midgames |
| The toast is for **rewarded** failures only; a failed or skipped midgame is silent | The player didn't ask for a midgame, so "No ad right now" would confuse them. The `?ads=fail` smoke checks the toast through `__cp.rewarded` | Trivial to add a toast to midgame |
| The toast is DOM, not a Phaser Text | Any scene (battle, M4 workshop, offline modal) can use it without owning a game object; it uses palette tokens and is ≥ 16 CSS px | It doesn't appear in Phaser-only captures |
| Portal init runs in parallel with Phaser boot. BootScene waits for fonts **and** init (capped at 2.5 s together) and then calls `loadingFinished`. A late init triggers `PortalGuard.portalReady()`, which replays `loadingFinished` and `gameplayStart` | Merge Wall blocked Phaser creation on init. Running them in parallel is faster, and the replay fixes the "CrazyGames loadingStart after we sent stop" hole | The replay is the only path for a late SDK; it is unit-tested (`crazygamesPortal.test.ts`, init 50 ms late) but has not been seen live |
| `Portal.save/load` became `storage(): KeyValue` (the localStorage API) | Multiple keys: meta, run snapshot, settings. `SaveSlot` adds the versioning on top | — |
| Audio mutes on the real ad start on **all** adapters (Poki via `commercialBreak(onStart)`/`rewardedBreak(onStart)`) | Same behaviour everywhere; the smoke can check it | If Poki's onStart never fires, audio stays on during that ad. Guard fallback: an adapter without `onAdStarted` mutes at request time |
| Telemetry ships in production builds (local only, no network); the overlay needs `?telemetry=1` | Playtesters on the portals can export JSON; ordinary players never see it | ~3 KB of code |
| `game.sound.mute` is driven, but the dev state reports our own effective flag | Phaser's `mute` getter lags while the AudioContext is locked (seen in the smoke); the same issue was noted in Merge Wall | — |
| Sim halts while `ads.running`, at the BattleScene `loop.frame` call | The CrazyGames and Poki docs require pausing at request | — |

## Known gaps
- Not tested against the **real** SDKs (no network in the harness). Before submission (M8), run each build on CrazyGames' QA tool and Poki's inspector.
- No audio exists yet; mute is wired to `game.sound.mute` only. M7 audio must read `services.isMuted()`, or rely on Phaser's mute, and add a player mute toggle.
- `happytime()` is not called anywhere. A candidate is a new best wave (M4).
- No `visibilitychange` gameplayStop (the sim already freezes on HIDDEN). Neither portal requires it.
- The rewarded call sites (revive, ×2 Bits, reroll, free pack, boost, offline ×2) belong to M3 and M4.
- The CrazyGames `hasAdblock` result is read once, at init.
- `tools/ui/portal-check.mjs`'s "SDK blocked" case can only check that the game boots without errors; there are no dev hooks in production to check the sim.
