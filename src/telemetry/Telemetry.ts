// Telemetry (adapted from Last Tower): an in-memory ring buffer mirrored to localStorage (≤ 200 KB), exported
// as JSON from the dev overlay and summarised by `npm run telemetry:report`. Local only: nothing is sent
// anywhere. Never breaks the game: every call is wrapped in try/catch.
import { type KeyValue, localKV } from '../portal/storage';

export type TelemetryType =
  | 'session_start'
  | 'session_end'
  | 'run_start'
  | 'wave_reached'
  | 'purchase'
  | 'death'
  | 'ad_request'
  | 'ad_result';

export interface TelemetryEvent {
  t: number;
  type: TelemetryType;
  runId: string;
  sessionId: string;
  deviceId: string;
  build: string;
  [key: string]: unknown;
}

/** Anything that accepts events (the Ads service and the battle lifecycle depend only on this). */
export interface TelemetrySink {
  emit(type: TelemetryType, payload?: Record<string, unknown>): void;
}

export const TELEMETRY_KEY = 'core-protocol.telemetry';
/** Device id and lifetime run counter. Separate from game saves (never in CrazyGames cloud data). */
export const DEVICE_KEY = 'core-protocol.device';
const MAX_BYTES = 200 * 1024;
const MAX_EVENTS = 4000;
const FLUSH_EVERY = 10;

function rid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export class Telemetry implements TelemetrySink {
  private events: TelemetryEvent[] = [];
  readonly sessionId = rid();
  readonly deviceId: string;
  runId = '';
  runIndex = 0;
  private dirty = 0;
  listeners: ((e: TelemetryEvent) => void)[] = [];

  constructor(
    readonly build: string,
    private readonly kv: KeyValue = localKV(),
    private readonly now: () => number = Date.now,
  ) {
    try {
      const raw = kv.getItem(TELEMETRY_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      this.events = Array.isArray(parsed) ? (parsed as TelemetryEvent[]) : [];
    } catch {
      this.events = [];
    }
    let dev = { id: '', runs: 0 };
    try {
      const d = JSON.parse(kv.getItem(DEVICE_KEY) ?? 'null') as { id?: unknown; runs?: unknown } | null;
      if (d && typeof d.id === 'string' && d.id) dev = { id: d.id, runs: Number.isSafeInteger(d.runs) ? (d.runs as number) : 0 };
    } catch {
      /* corrupt: new device id */
    }
    if (!dev.id) dev.id = rid() + rid();
    this.deviceId = dev.id;
    this.runIndex = dev.runs;
    this.saveDevice();
  }

  /** Starts a new run: a fresh runId and the device's lifetime run number (1-based). */
  newRun(): { runId: string; runIndex: number } {
    this.runId = rid();
    this.runIndex++;
    this.saveDevice();
    return { runId: this.runId, runIndex: this.runIndex };
  }

  emit(type: TelemetryType, payload: Record<string, unknown> = {}): void {
    try {
      const e: TelemetryEvent = {
        ...payload,
        t: this.now(),
        type,
        runId: this.runId,
        sessionId: this.sessionId,
        deviceId: this.deviceId,
        build: this.build,
      };
      this.events.push(e);
      if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
      for (const cb of this.listeners) cb(e);
      if (++this.dirty >= FLUSH_EVERY || type === 'death' || type === 'session_end' || type === 'run_start') this.flush();
    } catch {
      // Telemetry never breaks the game.
    }
  }

  /** Persists the newest events that fit in the 200 KB budget (oldest dropped first: a ring buffer). */
  flush(): void {
    try {
      let json = JSON.stringify(this.events);
      while (json.length > MAX_BYTES && this.events.length > 0) {
        this.events.splice(0, Math.ceil(this.events.length / 10));
        json = JSON.stringify(this.events);
      }
      this.kv.setItem(TELEMETRY_KEY, json);
      this.dirty = 0;
    } catch {
      // Quota, blocked storage or an unserialisable payload: keep in memory only.
    }
  }

  all(): readonly TelemetryEvent[] {
    return this.events;
  }

  exportJson(): string {
    return JSON.stringify(this.events, null, 1);
  }

  clear(): void {
    this.events = [];
    this.flush();
  }

  private saveDevice(): void {
    try {
      this.kv.setItem(DEVICE_KEY, JSON.stringify({ id: this.deviceId, runs: this.runIndex }));
    } catch {
      /* blocked */
    }
  }
}

/**
 * Session boundaries: `session_start` now; `session_end` when the page is hidden or unloaded (the reliable
 * signal on mobile), and a new `session_start {resumed}` when it comes back.
 */
export function installSessionEvents(tm: Telemetry, extra: () => Record<string, unknown> = () => ({})): void {
  let startedAt = Date.now();
  let open = true;
  tm.emit('session_start', { portal: __PORTAL__, ua: navigator.userAgent.slice(0, 120), w: innerWidth, h: innerHeight, dpr: devicePixelRatio });
  const end = (reason: string) => {
    if (!open) return;
    open = false;
    tm.emit('session_end', { reason, activeS: Math.round((Date.now() - startedAt) / 1000), ...extra() });
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') end('hidden');
    else if (!open) {
      open = true;
      startedAt = Date.now();
      tm.emit('session_start', { resumed: true });
    }
  });
  window.addEventListener('pagehide', () => end('pagehide'));
}
