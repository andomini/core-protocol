/// <reference types="vitest/config" />
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
      // Telemetry build tag: portal + build time (UTC, minutes).
      __BUILD__: JSON.stringify(`${portal}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`),
    },
    plugins: [portalHtml(portal)],
    server: { host: true, port: 5173 },
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
