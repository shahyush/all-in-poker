// Card ids are integers 0..51: rank = id % 13 (0 = Two … 12 = Ace), suit = floor(id / 13) (0 c, 1 d, 2 h, 3 s).
export type Card = number;
export const RANKS = '23456789TJQKA';
export const SUITS = 'cdhs';
export const SUIT_SYMBOL: Record<string, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };
export const RANK_NAME = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];

export const rankOf = (c: Card): number => c % 13;
export const suitOf = (c: Card): number => Math.floor(c / 13);
export const isCard = (c: unknown): c is Card => Number.isInteger(c) && (c as number) >= 0 && (c as number) <= 51;

export function cardStr(c: Card): string {
  if (!isCard(c)) throw new Error('Invalid card id');
  return RANKS[rankOf(c)] + SUITS[suitOf(c)];
}
export function parseCard(s: string): Card {
  const r = RANKS.indexOf(s[0]), su = SUITS.indexOf(s[1]);
  if (s.length !== 2 || r < 0 || su < 0) throw new Error('Invalid card text ' + s);
  return r + 13 * su;
}
export function cardLabel(c: Card): string {
  return `${RANK_NAME[rankOf(c)]} of ${['clubs', 'diamonds', 'hearts', 'spades'][suitOf(c)]}`;
}
export function assertUniqueCards(cards: readonly Card[]): void {
  const seen = new Set<number>();
  for (const c of cards) {
    if (!isCard(c)) throw new Error('Invalid card id');
    if (seen.has(c)) throw new Error('Duplicate card');
    seen.add(c);
  }
}
export function freshDeck(): Card[] {
  return Array.from({ length: 52 }, (_, i) => i);
}
