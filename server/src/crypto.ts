const enc = new TextEncoder();

function toHex(b: ArrayBuffer | Uint8Array): string { return Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join(''); }
function fromHex(h: string): Uint8Array { return new Uint8Array((h.match(/.{2}/g) ?? []).map((x) => parseInt(x, 16))); }

export async function sha256Hex(s: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

/** Stable JSON with sorted keys so identical commands hash identically regardless of key order. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(o[k])).join(',') + '}';
}

export const PBKDF2_ITERATIONS = 210000;
export async function pbkdf2(password: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256);
  return new Uint8Array(bits);
}
export function randomBytes(n: number): Uint8Array { const b = new Uint8Array(n); crypto.getRandomValues(b); return b; }
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}
/** bytea text form for Postgres JSON transport */
export const byteaHex = (b: Uint8Array): string => '\\x' + toHex(b);
export const parseBytea = (s: string | Uint8Array): Uint8Array => (typeof s === 'string' ? fromHex(s.startsWith('\\x') ? s.slice(2) : s) : new Uint8Array(s));

const B32 = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // 30 symbols, no 0/O/1/I/L/U
/** Player recovery code: 26 symbols from a 30-symbol alphabet (~127.6 bits), grouped for reading. */
export function newRecoveryCode(): string {
  const b = randomBytes(26);
  let s = '';
  for (let i = 0; i < 26; i++) {
    // rejection sampling per symbol
    let x = b[i];
    while (x >= 240) { x = randomBytes(1)[0]; }
    s += B32[x % 30];
  }
  return s.match(/.{1,4}/g)!.join('-');
}
export function normalizeCode(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}
