// Display names: auto "NeonVirus-4821", or a custom one within length/charset limits and a simple filter.

const ADJ = ['Neon', 'Cyber', 'Pixel', 'Quantum', 'Glitch', 'Static', 'Vector', 'Binary', 'Laser', 'Plasma', 'Turbo', 'Hyper', 'Nano', 'Proxy', 'Crypto', 'Echo'];
const NOUN = ['Virus', 'Core', 'Byte', 'Shard', 'Node', 'Pulse', 'Kernel', 'Daemon', 'Packet', 'Cipher', 'Spark', 'Bot', 'Grid', 'Patch', 'Signal', 'Wraith'];

export const NAME_MIN = 3;
export const NAME_MAX = 20;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]*[A-Za-z0-9]$/;

/** Words refused anywhere in a name after folding case, leetspeak and separators (kept short: no Scunthorpe hits). */
const BLOCKED = [
  'fuck', 'shit', 'cunt', 'nigg', 'nigr', 'faggot', 'bitch', 'whore', 'slut', 'rapist', 'nazi', 'hitler', 'porn', 'penis', 'vagina',
  'pussy', 'asshole', 'retard', 'kkk', 'xyu', 'pizd', 'blyat', 'ebat', 'pidor', 'pidar', 'admin', 'moderator',
];

function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/1|!|\|/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4|@/g, 'a')
    .replace(/5|\$/g, 's')
    .replace(/7/g, 't')
    .replace(/[^a-z]/g, '');
}

export function isProfane(name: string): boolean {
  const f = fold(name);
  return BLOCKED.some((w) => f.includes(w));
}

/** The cleaned name, or throws a code: name-length | name-charset | name-profane. */
export function checkName(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('name-charset');
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < NAME_MIN || name.length > NAME_MAX) throw new Error('name-length');
  if (!NAME_RE.test(name)) throw new Error('name-charset');
  if (isProfane(name)) throw new Error('name-profane');
  return name;
}

export function autoName(rnd: (n: number) => number): string {
  return `${ADJ[rnd(ADJ.length)]}${NOUN[rnd(NOUN.length)]}-${String(1000 + rnd(9000))}`;
}

/** A CrazyGames username as a display name (truncated, foreign characters dropped); null if nothing usable. */
export function nameFromPortal(username: string): string | null {
  const s = username.replace(/[^A-Za-z0-9 _.-]/g, '').trim().slice(0, NAME_MAX).replace(/[ _.-]+$/, '');
  try {
    return checkName(s);
  } catch {
    return null;
  }
}
