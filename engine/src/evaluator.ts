import { assertUniqueCards, rankOf, suitOf, RANK_NAME, type Card } from './cards.ts';

export const CATEGORIES = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'] as const;

/** Score of exactly five cards. Higher is better; equal scores tie. Suits never break ties. */
export function eval5(c: readonly Card[]): number {
  if (c.length !== 5) throw new Error('eval5 needs five cards');
  const ranks = c.map(rankOf).sort((a, b) => b - a);
  const s0 = suitOf(c[0]);
  const flush = c.every((x) => suitOf(x) === s0);
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  let straightHigh = -1;
  if (groups.length === 5) {
    if (ranks[0] - ranks[4] === 4) straightHigh = ranks[0];
    else if (ranks[0] === 12 && ranks[1] === 3 && ranks[4] === 0) straightHigh = 3; // wheel: five high
  }
  let cat: number, tb: number[];
  if (straightHigh >= 0 && flush) { cat = 8; tb = [straightHigh]; }
  else if (groups[0][1] === 4) { cat = 7; tb = [groups[0][0], groups[1][0]]; }
  else if (groups[0][1] === 3 && groups[1][1] === 2) { cat = 6; tb = [groups[0][0], groups[1][0]]; }
  else if (flush) { cat = 5; tb = ranks; }
  else if (straightHigh >= 0) { cat = 4; tb = [straightHigh]; }
  else if (groups[0][1] === 3) { cat = 3; tb = groups.map((g) => g[0]); }
  else if (groups[0][1] === 2 && groups[1][1] === 2) { cat = 2; tb = groups.map((g) => g[0]); }
  else if (groups[0][1] === 2) { cat = 1; tb = groups.map((g) => g[0]); }
  else { cat = 0; tb = ranks; }
  let s = cat;
  for (let i = 0; i < 5; i++) s = s * 16 + (tb[i] ?? 0);
  return s;
}

export function categoryOf(score: number): number {
  return Math.floor(score / 16 ** 5);
}

export function describeScore(score: number): string {
  const cat = categoryOf(score);
  const tb: number[] = [];
  let s = score % 16 ** 5;
  for (let i = 4; i >= 0; i--) { tb[i] = s % 16; s = Math.floor(s / 16); }
  const R = (r: number) => RANK_NAME[r];
  const Rs = (r: number) => R(r) + (r === 4 ? 'es' : 's');
  switch (cat) {
    case 8: return tb[0] === 12 ? 'Royal flush' : `Straight flush, ${R(tb[0])} high`;
    case 7: return `Four of a kind, ${Rs(tb[0])}`;
    case 6: return `Full house, ${Rs(tb[0])} over ${Rs(tb[1])}`;
    case 5: return `Flush, ${R(tb[0])} high`;
    case 4: return `Straight, ${R(tb[0])} high`;
    case 3: return `Three of a kind, ${Rs(tb[0])}`;
    case 2: return `Two pair, ${Rs(tb[0])} and ${Rs(tb[1])}`;
    case 1: return `Pair of ${Rs(tb[0])}`;
    default: return `${R(tb[0])} high`;
  }
}

export function* combos<T>(arr: readonly T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) { yield acc.slice(); return; }
  for (let i = start; i <= arr.length - (k - acc.length); i++) {
    acc.push(arr[i]);
    yield* combos(arr, k, i + 1, acc);
    acc.pop();
  }
}

export type VariantId = 'holdem' | 'omaha4' | 'omaha5' | 'omaha6';
export interface BestHand { score: number; cards: Card[]; name: string }

/** Hold'em: best five of all seven (0–2 hole). Omaha: exactly two hole + exactly three board. */
export function bestHand(hole: readonly Card[], board: readonly Card[], variant: VariantId): BestHand {
  assertUniqueCards([...hole, ...board]);
  if (board.length !== 5) throw new Error('Complete board required');
  let best: BestHand = { score: -1, cards: [], name: '' };
  if (variant === 'holdem') {
    if (hole.length !== 2) throw new Error("Hold'em needs two hole cards");
    for (const five of combos([...hole, ...board], 5)) {
      const s = eval5(five);
      if (s > best.score) best = { score: s, cards: five, name: '' };
    }
  } else {
    const need = { omaha4: 4, omaha5: 5, omaha6: 6 }[variant];
    if (hole.length !== need) throw new Error('Omaha hole count mismatch');
    for (const h2 of combos(hole, 2)) for (const b3 of combos(board, 3)) {
      const five = [...h2, ...b3];
      const s = eval5(five);
      if (s > best.score) best = { score: s, cards: five, name: '' };
    }
  }
  best.name = describeScore(best.score);
  return best;
}
