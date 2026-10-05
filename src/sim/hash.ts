import type { World } from './state';

/** FNV-1a (32-bit) over the canonical JSON of the world, as 8 hex chars. */
export function hashWorld(w: World): string {
  const s = JSON.stringify(w);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
