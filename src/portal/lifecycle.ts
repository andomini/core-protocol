// The battle's portal + telemetry hooks in one place, so scenes only need one-line calls:
//   runStarted(world)        on create and on every new run   → gameplayStart (after first input), run_start
//   hold(reason, on)         pause / death / any overlay      → gameplayStop while any hold is on
//   onEvent(e, world)        every sim event                  → wave_reached, purchase, death (+ death hold)
//   requestRestart(restart)  the RESTART button               → midgame ad (policy), then restart()
// No Phaser; unit-tested in Node.
import type { SimEvent } from '../sim/events';
import type { World } from '../sim/state';
import type { TelemetrySink } from '../telemetry/Telemetry';
import type { Ads } from './ads';
import type { PortalGuard } from './PortalGuard';

/** Why gameplay is not running. M3+ add their own overlay names (e.g. 'perkPick'). */
export type HoldReason = 'paused' | 'dead' | 'menu' | (string & {});

export interface LifecycleDeps {
  guard: Pick<PortalGuard, 'gameplayStart' | 'gameplayStop'>;
  ads: Pick<Ads, 'midgame'>;
  telemetry: (TelemetrySink & { newRun(): { runId: string; runIndex: number }; readonly deviceId: string }) | null;
  tickHz: number;
  now?: () => number;
}

type RunInfo = Pick<World, 'seed' | 'tier' | 'wave' | 'tick' | 'energy' | 'bits' | 'kills'>;

export class RunLifecycle {
  private readonly holds = new Set<string>();
  private active = false;
  private restarting = false;
  private runT0 = 0;
  private readonly now: () => number;

  constructor(private readonly d: LifecycleDeps) {
    this.now = d.now ?? (() => performance.now());
  }

  /** A RESTART is waiting on its midgame ad. */
  get isRestarting(): boolean {
    return this.restarting;
  }

  runStarted(w: RunInfo): void {
    this.holds.clear();
    this.active = true;
    this.runT0 = this.now();
    const tm = this.d.telemetry;
    if (tm) {
      const { runIndex } = tm.newRun();
      tm.emit('run_start', { seed: w.seed, tier: w.tier, deviceId: tm.deviceId, runIndex });
    }
    this.sync();
  }

  hold(reason: HoldReason, on: boolean): void {
    if (on) this.holds.add(reason);
    else this.holds.delete(reason);
    this.sync();
  }

  onEvent(e: SimEvent, w: RunInfo): void {
    const tm = this.d.telemetry;
    switch (e.type) {
      case 'waveStart':
        tm?.emit('wave_reached', { wave: e.wave, boss: e.boss, simS: this.simS(w.tick) });
        break;
      case 'buy':
        tm?.emit('purchase', { stat: e.stat, levels: e.levels, level: e.level, cost: e.cost, free: e.free, wave: w.wave, energyAfter: Math.floor(w.energy) });
        break;
      case 'death':
        tm?.emit('death', {
          wave: e.wave,
          time: this.simS(e.tick),
          wallS: Math.round((this.now() - this.runT0) / 1000),
          energy: Math.floor(w.energy),
          bits: Math.floor(w.bits),
          kills: w.kills,
        });
        this.hold('dead', true);
        break;
      default:
        break;
    }
  }

  /**
   * RESTART after death: offers a midgame ad (the policy decides; a failure is silent), then calls
   * `restart` (which must call runStarted). Repeated taps while the ad runs are ignored.
   */
  async requestRestart(restart: () => void): Promise<void> {
    if (this.restarting) return;
    this.restarting = true;
    try {
      await this.d.ads.midgame('restart');
    } catch {
      /* never blocks the restart */
    } finally {
      this.restarting = false;
    }
    restart();
  }

  private simS(tick: number): number {
    return Math.round((tick / this.d.tickHz) * 10) / 10;
  }

  private sync(): void {
    if (this.active && this.holds.size === 0) this.d.guard.gameplayStart();
    else this.d.guard.gameplayStop();
  }
}
