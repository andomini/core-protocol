/// <reference types="vite/client" />
declare const __PORTAL__: 'local' | 'crazygames' | 'poki';
declare const __BUILD__: string;
/** Git commit of the build (vite.config.ts gitCommit): names the sim/data a leaderboard replay must be verified with. */
declare const __COMMIT__: string;

interface ImportMetaEnv {
  /** Leaderboard API origin (server/), e.g. https://core-protocol-lb.<account>.workers.dev. Empty → no leaderboards. */
  readonly VITE_LEADERBOARD_URL?: string;
}
