# Uniqueness plan, item 10: daily missions + NEXT strip (agent A3 notes)

## Mission pool (`src/data/missions.json`)
`perDay: 3`, `salt`, and 8 templates, one per kind:

| id | mode | text | floor targets T1..T6 | scale | step | reward (Keys) T1..T6 |
|---|---|---|---|---|---|---|
| wave | best | Reach wave {n} on tier {t}+ | 10 | bestWave × 0.8 | 5 | 5 5 6 6 7 8 |
| kills | best | Purge {n} viruses in one run | 100..1000 | avgKills × 1.1 | 50 | 4 4 5 5 6 6 |
| fusion | best | Reach a tier {r} fusion | 2 2 2 3 3 3 | none | 1 | 5 5 6 6 7 8 |
| nests | best | Destroy {n} nests in one run | 2..8 | bestWave × 0.08 | 1 | 4 4 5 6 6 7 |
| levels | sum | Buy {n} stat levels today | 80..550 | avgLevels × 2 | 10 | 3 3 4 4 5 5 |
| bits | best | Earn {n} Bits in one run | 100..100000 | avgBits × 1.1 | 0 (two significant digits) | 4 4 5 5 6 6 |
| tagWave | best | Wave {n} with {tag} as top set | 8 | bestWave × 0.5 | 5 | 5 5 6 6 7 8 |
| waves | sum | Clear {n} waves today | 30..250 | avgWaves × 2 | 10 | 3 3 4 4 5 5 |

`best` keeps the best value of one run today. `sum` adds each run's value. Placeholders:
- `{n}`: the target
- `{t}`: the tier
- `{r}`: the fusion tier as a roman numeral
- `{tag}`: the set name, upper-cased

## Pick and targets (`src/meta/missions.ts`)
- **Pick.** `missionsFor(day, meta)` hashes `dayIndex(day)` together with `salt + i·7919` (a murmur finaliser over `Math.imul`) and sorts the templates by that hash. It takes the first `perDay` templates of distinct kinds. A second hash picks the tagWave tag. There is no Math.random, so every device shows the same 3 missions on a given UTC day; only the targets differ per player.
- **Target formula.** `max(targets[tierUnlocked−1], roundDown(ref × frac, step))`.
  - `ref` is one of:
    - the best wave on `refTier`, the highest tier that has a best wave;
    - a lifetime per-run average (kills, levels, Bits, waves).
  - A `step` of 0 rounds down to two significant digits.
  - The reward is `reward[tierUnlocked−1]`.
  - The wave mission requires tier ≥ `refTier`. tagWave counts only when that tag is the largest set at death (`tagCounts`).
- **Reset.** The state is `meta.missions = {day, list, progress, claimed, last}`. `ensureMissionDay(m, now)` rebuilds it whenever `dayKey(now)`, the UTC "YYYY-MM-DD", differs from the stored day. It runs from Home (on view and in a 1 s timer) and in `applyMissions`. The list and its targets are frozen for the whole day, so a tier unlocked mid-day does not move them. `msToReset(now)` is the time to the next UTC midnight.
- **Settlement.** `settleRun` / `settleDaily` (only when the run is paid) call `applyMissions` when `RunResult.missions` and `now` are set. The result comes back as `Settlement.missions` (deltas) and `missionKeys`. Keys are added to `meta.keys` once and the mission is marked `claimed`.
- **Revive.** A revived run settles again under the same key `${m.runs}:${seed}`, because BattleScene's revive undo does `runs -= 1`.
  - Sum missions subtract the previous `last.add`, so the run is not counted twice.
  - Best missions are naturally idempotent.
  - Paid mission Keys stay paid, the same as milestones.
- **Save.** The meta slot is version 2. `META_MIGRATIONS[1]` adds empty missions. `validateMissionsState` drops unknown ids or garbage.
- **Run stats.** `RunStats.nests` counts `nestDestroyed` events.

## Home BATTLE tab (`homeLayout.battleGeometry`, `HomeScene.battleView/nextPanel`)
- **Portrait.**
  - From top to bottom: tier card (390), START/CONTINUE (104), ABANDON (80, only when a run is saved), and the STATS·CODEX·DAILY·RANKS row (70).
  - Below that comes the NEXT panel. Each row is a 42 px progress bar with its text on top, label on the left and progress/reward on the right. Labels that do not fit get an ellipsis.
  - The panel has two sections:
    - NEXT shows 3 goals: next tier unlock (or the next milestone once every tier is unlocked), the cheapest lab node or workshop mastery step in Bits, and a card pack in Keys (only after the first run).
    - DAILY shows the 3 missions as `a/b · +N`, or `✓ +N` once done, with "resets in Xh Ym" in the header.
  - If both sections do not fit, the header becomes a NEXT / DAILY toggle. The old progress-summary card is shown only when a tall phone has room for it.
  - The "Reach wave X to unlock tier" line moved out of the tier card into NEXT.
- **Landscape.** The tier card and buttons take the left 56 % of the content area. The NEXT panel, with both sections, is the right column. The summary is one line at the bottom.
- **Death overlay.** Under the note there are 3 mission lines, one per mission:
  - completed by this run: `✓ text · +N KEYS`;
  - completed earlier today: `✓ text · done`;
  - otherwise: `text · a/b (+delta)`.
- **ABANDON RUN** also settles the missions and shows a toast when it pays Keys.

## Open issues
- There is no hex-cleanse event in the sim, so "cleanse N hexes" became "destroy N nests". A real cleanse mission needs a sim event, which is outside A3's scope.
- The top-set tag and the best fusion are read from the world at death or abandon only, not as a peak during the run.
- Mission Keys are not added to `lifetime.keysEarned`, because that total is built from world keys in `addRunToLifetime`.
- Meta save v2: an older build loading a v2 save gets status `future` and treats it as read-only.
- `BattleScene.ts` (outside A3's ownership) changed by about 7 lines: `missionRun` and `now` are fed into `settleRun`/`settleDaily`, and the mission lines are passed to `death.show`.
- Reward and target numbers are first guesses and have not been checked with the progression sim.
