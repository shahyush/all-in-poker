/** Chip amounts are integers. Hard technical ceiling per credit and per table liability. */
export const MAX_CHIPS = 1_000_000_000_000; // 10^12, exactly representable, below 2^53

/** Parse a canonical positive integer string. Rejects decimals, signs, exponents, separators, junk. */
export function parseChipAmount(input: unknown): number | null {
  if (typeof input === 'number') {
    if (!Number.isInteger(input) || input < 0 || input > MAX_CHIPS) return null;
    return input;
  }
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!/^(0|[1-9][0-9]*)$/.test(s)) return null;
  if (s.length > 13) return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n > MAX_CHIPS) return null;
  return n;
}

export function isChipInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_CHIPS;
}

export function checkedAdd(a: number, b: number): number {
  const s = a + b;
  if (!Number.isSafeInteger(s) || s > MAX_CHIPS || s < 0) throw new Error('Chip amount out of range');
  return s;
}

export function formatChips(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-GB').format(n);
}
