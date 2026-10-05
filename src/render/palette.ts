// Neon cyberspace palette (spec §4): every colour token lives here.

export const BG = 0x070b1a;
export const BG_CSS = '#070b1a';
export const LETTERBOX = '#03050d';

export const GRID = 0x1f6bff;
export const GRID_MAJOR = 0x22e5ff;

export const CYAN = 0x22e5ff;
export const CYAN_CSS = '#22e5ff';
export const MAGENTA = 0xff2bd6;
export const YELLOW = 0xffe14a;
export const ORANGE_RED = 0xff5a2a;
export const VIOLET = 0xa45bff;
export const CRIMSON = 0xff2d55;
export const WHITE = 0xffffff;

export const ENEMY_COLOR = {
  basic: MAGENTA,
  fast: YELLOW,
  tank: ORANGE_RED,
  ranged: VIOLET,
  boss: CRIMSON,
} as const;

export const CORE = CYAN;
export const CORE_HIT = 0xff3b5c;
export const TRACER = 0x9ff8ff;

export const HP_OK = 0x2bffb0;
export const HP_LOW = 0xff3b5c;
export const ENERGY = 0xffd23f;
export const ENERGY_CSS = '#ffd23f';
export const BITS = 0x5cf2ff;
export const BITS_CSS = '#5cf2ff';
export const BREAK = 0xffb03b;

/** Upgrade panel tab accents (ATK / DEF / UTIL). */
export const TAB_COLOR = { atk: 0xff4d7a, def: 0x2bffb0, util: 0xffd23f } as const;
export const TAB_CSS = { atk: '#ff4d7a', def: '#2bffb0', util: '#ffd23f' } as const;
export const LOCKED = 0x5a6a95;
export const LOCKED_CSS = '#5a6a95';

export const PANEL_FILL = 0x0a1230;
export const PANEL_EDGE = 0x22e5ff;
export const TEXT = '#e8fbff';
export const TEXT_DIM = '#7f97c8';
export const TEXT_RED = '#ff3b5c';

export const FONT_TITLE = '"Orbitron", "Chakra Petch", monospace';
export const FONT_UI = '"Chakra Petch", "Orbitron", monospace';

export const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** Protocol tag accents (spec §2.4): ⚡ Overload, 🧊 Cryo, 🔗 Chain, 💰 Mining, 🛡 Firewall. */
export const TAG_COLOR = { overload: 0xffd23f, cryo: 0x7fe3ff, chain: 0xb18cff, mining: 0x4dff9a, firewall: 0xff7a45 } as const;
export const TAG_CSS = { overload: '#ffd23f', cryo: '#7fe3ff', chain: '#b18cff', mining: '#4dff9a', firewall: '#ff7a45' } as const;
/** Card frame accents by rarity. */
export const RARITY_COLOR = { common: 0x6f86c0, rare: 0x3fa8ff, epic: 0xff4dd8 } as const;
export const RARITY_CSS = { common: '#8fa3d6', rare: '#5cb8ff', epic: '#ff6be0' } as const;
/** Enemy tints: frozen (icy fill) and slowed (cold multiply). */
export const FROZEN_TINT = 0xbff6ff;
export const SLOW_TINT = 0x8fd8ff;
/** 🔑 Keys (card packs). */
export const KEY = 0xffb84d;
export const KEY_CSS = '#ffb84d';
