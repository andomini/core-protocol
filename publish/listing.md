# Core Protocol: store listing (EN)

Copy-paste text for the Poki (and CrazyGames) submission forms. Check each form's own length limits.

## Title

Core Protocol

## Short description (≤ 150 chars)

Grow a crystal of protocol modules around your core, fuse tags, fire the Pulse and outlast viruses that mutate against your build.

(130 chars)

## Description

Pick a boot sector, grow a crystal, fuse its tags and fire the Pulse. The viruses learn your build and mutate to beat it.

**Pick a boot sector.** Every run starts with a choice of three of the five starter crystals: Hot Start (Overload), Cold Boot (Cryo),
Arc Loader (Chain), Miner Kernel (Mining) or Safe Mode (Firewall). Each one sets three modules around the core from the first shot.

**Grow a crystal.** Every protocol you take becomes a hex module on the crystal around your core. Place modules of the
same tag next to each other: a connected cluster lights up as a set and unlocks its bonus tiers. Move modules around
any time in the crystal editor.

**Fuse tags.** Where two different tags touch, the link welds. Enough links between a pair and the two tags fuse into
one of 10 fusions, such as Thermal Shock (Overload + Cryo), with effects neither set has on its own.

**Fire the Pulse.** Tap the core to release a shock ring. Its effect follows your strongest tag: it freezes with Cryo,
arcs from virus to virus with Chain, shields the core with Firewall, pays out with Mining.

**Viruses that mutate.** Capsids, flagellate runners, armoured shells and legged phages come in from the infected grid.
From wave 5 the swarm grows a resistance to your dominant tag every 8 waves, and the genome strip shows which one is next,
so the crystal you built has to adapt.

Between runs, spend Bits and Keys on permanent upgrades in the Workshop, research in the Labs and card packs. Daily missions
pay extra Keys, and the next-unlock track on Home shows what you are saving for. Reach milestones to open harder tiers with new rules.

Features:
- 5 boot sectors, 25 protocols as crystal modules, 5 sets and 10 tag fusions
- An active Pulse ability whose effect follows your build
- Virus mutations from wave 5 that counter your strongest tag
- Territory that you win back from the infection, with structures to build (walls, turrets, mines, relay stations)
- 18 core stats, 26 lab research nodes, 20 collectible cards, 3 daily missions
- 6 tiers, each with its own twist; boss waves
- Up to ×2 game speed, offline earnings
- Progress is saved automatically; an unfinished run can be continued

## How to play / controls

- At the start of a run, tap one of the three boot sectors.
- The core shoots automatically at viruses in range.
- Tap upgrade buttons (ATK / DEF / UTIL tabs) to spend Energy during a run.
- When protocols are offered, tap one: it becomes a module on the crystal. Same-tag clusters build set bonuses, links between tags build fusions. Open the crystal to move modules.
- Tap the core (or PULSE, or Space) to fire the Pulse when it is charged.
- When the core falls, collect Bits and Keys. Spend them on Home: Workshop, Labs and Cards.
- Mouse (desktop) or touch (mobile). Pause and ×1/×2 speed at the top right.

## Tags / categories

Primary category: Strategy (Tower Defense) · alternatives: Idle, Casual
Tags: tower defense, idle, incremental, upgrade, roguelite, strategy, puzzle, 2D, mobile

## Technical facts for the form

- Orientation: both (portrait and landscape layouts)
- Platforms: mobile and desktop (touch and mouse)
- Language: English
- Saves: Poki build uses localStorage; CrazyGames build uses the SDK data module ("Progress Save" must be enabled)
- Ads: rewarded (revive, ×2 Bits, reroll, free pack, boost, ×2 offline) and a midgame break on restart, only through the portal SDK
- Data collection: none by the game itself (no external requests besides the portal SDK)
- Initial download: ~404 KB gzipped (1.4 MB raw), 9 files (measured before the Phase 1 uniqueness work; re-check with `npm run package`, `tools/postbuild.mjs` prints it)
- Content: abstract neon shapes (stylised viruses and a crystal), no violence against people (suggested rating PEGI 3 / 7)
- Engine: Phaser 3.90 (MIT); fonts Orbitron and Chakra Petch (SIL OFL 1.1, licences shipped in fonts/)
