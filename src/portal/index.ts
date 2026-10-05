import type { Portal } from './Portal';

async function load(name: 'local' | 'crazygames' | 'poki'): Promise<Portal> {
  if (name === 'crazygames') return new (await import('./CrazyGamesPortal')).CrazyGamesPortal();
  if (name === 'poki') return new (await import('./PokiPortal')).PokiPortal();
  return new (await import('./LocalPortal')).LocalPortal();
}

/**
 * __PORTAL__ is a build-time constant, so the dead branches (and their dynamic imports) are dropped:
 * each portal build contains only its own adapter (checked by tools/postbuild.mjs).
 * DEV only: `?portal=crazygames|poki` runs that adapter on the dev server (the UI smoke injects a fake SDK).
 */
export async function createPortal(): Promise<Portal> {
  if (import.meta.env.DEV) {
    const q = new URLSearchParams(location.search).get('portal');
    if (q === 'crazygames' || q === 'poki' || q === 'local') return load(q);
  }
  if (__PORTAL__ === 'crazygames') return new (await import('./CrazyGamesPortal')).CrazyGamesPortal();
  if (__PORTAL__ === 'poki') return new (await import('./PokiPortal')).PokiPortal();
  return new (await import('./LocalPortal')).LocalPortal();
}
