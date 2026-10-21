import { freshDeck, type Card } from './cards.ts';

/** Random integer in [0, n) from a cryptographic source with rejection of modulo bias. Fails closed. */
export function secureInt(n: number): number {
  if (!Number.isInteger(n) || n <= 0 || n > 0x100000000) throw new Error('secureInt range');
  const g = globalThis.crypto;
  if (!g || typeof g.getRandomValues !== 'function') throw new Error('Secure randomness unavailable');
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  let x: number;
  do {
    g.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % n;
}

export type Rng = (n: number) => number;

/** Unbiased Fisher–Yates over a full 52-card deck. The rng parameter exists only for tests. */
export function shuffledDeck(rng: Rng = secureInt): Card[] {
  const d = freshDeck();
  for (let i = d.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) throw new Error('rng out of range');
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

/** Random hex string with the given number of bytes of entropy (for ids, codes, secrets). */
export function secureHex(bytes: number): string {
  const g = globalThis.crypto;
  if (!g || typeof g.getRandomValues !== 'function') throw new Error('Secure randomness unavailable');
  const b = new Uint8Array(bytes);
  g.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function secureCode(length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += CODE_ALPHABET[secureInt(CODE_ALPHABET.length)];
  return s;
}
