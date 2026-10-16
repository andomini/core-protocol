/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { defineConfig, loadEnv, type Plugin } from 'vite';

const PORTALS = ['local', 'crazygames', 'poki'] as const;
type PortalName = (typeof PORTALS)[number];

// SDK <script> tags injected into index.html per portal build. No SRI hash:
// both URLs are versionless and updated by the portals without notice.
const SDK_TAGS: Record<PortalName, string> = {
  local: '',
  crazygames: '<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>',
  poki: '<script src="https://game-cdn.poki.com/scripts/v2/poki-sdk.js"></script>',
};

function portalHtml(portal: PortalName): Plugin {
  return {
    name: 'portal-html',
    transformIndexHtml(html) {
      // GitHub Pages dev preview (PAGES=1): keep it out of search engines (it is not the portal release).
      const noindex = process.env.PAGES === '1' ? '<meta name="robots" content="noindex, nofollow" />' : '';
      return html.replace('<!-- PORTAL_SDK -->', SDK_TAGS[portal] + noindex);
    },
  };
}

/**
 * The build's git commit for leaderboard replays (the verifier replays with this commit's sim and data):
 * full SHA, "-dirty" when src/ or tools/leaderboard/ differ from it (such builds are not ranked), else "unknown".
 */
function gitCommit(): string {
  if (process.env.COMMIT_SHA) return process.env.COMMIT_SHA;
  try {
    const sha = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    // Uncommitted or untracked files in the replayed code make the build unverifiable.
    const dirty = execSync('git status --porcelain -- src tools/leaderboard', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() !== '';
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return 'unknown';
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const portal = (process.env.VITE_PORTAL ?? env.VITE_PORTAL ?? 'local') as PortalName;
  if (!PORTALS.includes(portal)) {
    throw new Error(`VITE_PORTAL must be one of ${PORTALS.join(', ')}; got "${portal}"`);
  }
  return {
    // Relative paths: portals serve the build from arbitrary sub-paths.
    base: './',
    define: {
      __PORTAL__: JSON.stringify(portal),
      __COMMIT__: JSON.stringify(gitCommit()),
      // Telemetry build tag: portal + build time (UTC, minutes).
      __BUILD__: JSON.stringify(`${portal}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`),
    },
    plugins: [portalHtml(portal)],
    // The leaderboard verifier keeps git worktrees in .verifier-cache/ (never part of the app).
    server: { host: true, port: 5173, watch: { ignored: ['**/.verifier-cache/**', '**/server/**'] } },
    build: {
      outDir: `dist/${portal}`,
      emptyOutDir: true,
      target: 'es2020',
      assetsInlineLimit: 8192,
      chunkSizeWarningLimit: 2000,
    },
    test: { include: ['tests/**/*.test.ts'], environment: 'node' },
  };
});
