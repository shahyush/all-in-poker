import { bestHand, type VariantId } from './evaluator.ts';
import type { Card } from './cards.ts';

export interface Contributor { seat: number; paid: number; folded: boolean }
export interface Pot { amount: number; eligible: number[] }

/** Uncalled excess: the top contributor's chips above the second-highest contribution are returned before pots. */
export function uncalledExcess(players: readonly Contributor[]): { seat: number; amount: number } | null {
  const sorted = players.filter((p) => p.paid > 0).sort((a, b) => b.paid - a.paid);
  if (sorted.length === 0) return null;
  const top = sorted[0];
  const second = sorted[1]?.paid ?? 0;
  if (top.paid > second) return { seat: top.seat, amount: top.paid - second };
  return null;
}

/** Side pots from sorted contribution thresholds. Folded chips count; folded players are not eligible. */
export function buildPots(players: readonly Contributor[]): Pot[] {
  const levels = [...new Set(players.filter((p) => p.paid > 0).map((p) => p.paid))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const L of levels) {
    let amount = 0;
    for (const p of players) amount += Math.max(0, Math.min(p.paid, L) - prev);
    const eligible = players.filter((p) => !p.folded && p.paid >= L).map((p) => p.seat).sort((a, b) => a - b);
    if (amount > 0) {
      const last = pots[pots.length - 1];
      if (last && last.eligible.join() === eligible.join()) last.amount += amount;
      else pots.push({ amount, eligible });
    }
    prev = L;
  }
  return pots;
}

/** Order seats clockwise starting left of the button. */
export function clockwiseFrom(button: number, seatCount: number, seats: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i <= seatCount && out.length < seats.length; i++) {
    const s = (button + i) % seatCount;
    if (seats.includes(s)) out.push(s);
  }
  return out;
}

/** Split an amount among winners; odd chips go clockwise from the left of the button. */
export function splitAmong(winners: readonly number[], amount: number, button: number, seatCount: number): { seat: number; amount: number }[] {
  const ordered = clockwiseFrom(button, seatCount, winners);
  const share = Math.floor(amount / ordered.length);
  let rem = amount - share * ordered.length;
  return ordered.map((seat) => ({ seat, amount: share + (rem-- > 0 ? 1 : 0) }));
}

export interface PotAward {
  potIndex: number;
  board: 0 | 1;
  amount: number;
  eligible: number[];
  winners: { seat: number; amount: number; name: string; cards: Card[] }[];
  hands: { seat: number; name: string; score: number; cards: Card[] }[];
}

/** Award every pot on every board. Board A (index 0) receives the odd chip when a pot is split across two boards. */
export function awardPots(
  pots: readonly Pot[],
  boards: readonly Card[][],
  hole: Record<number, Card[]>,
  variant: VariantId,
  button: number,
  seatCount: number,
): { awards: PotAward[]; totals: Record<number, number> } {
  const awards: PotAward[] = [];
  const totals: Record<number, number> = {};
  pots.forEach((pot, potIndex) => {
    const runs = boards.length;
    const base = Math.floor(pot.amount / runs);
    let rem = pot.amount - base * runs;
    for (let r = 0; r < runs; r++) {
      const amt = base + (rem-- > 0 ? 1 : 0);
      if (amt === 0) continue;
      let winners: number[];
      let hands: PotAward['hands'] = [];
      if (pot.eligible.length === 1) {
        winners = pot.eligible.slice();
      } else {
        hands = pot.eligible.map((seat) => {
          const b = bestHand(hole[seat], boards[r], variant);
          return { seat, name: b.name, score: b.score, cards: b.cards };
        });
        const top = Math.max(...hands.map((h) => h.score));
        winners = hands.filter((h) => h.score === top).map((h) => h.seat);
      }
      const split = splitAmong(winners, amt, button, seatCount);
      const payout = split.map((w) => {
        const h = hands.find((x) => x.seat === w.seat);
        return { seat: w.seat, amount: w.amount, name: h?.name ?? '', cards: h?.cards ?? [] };
      });
      for (const w of payout) totals[w.seat] = (totals[w.seat] || 0) + w.amount;
      awards.push({ potIndex, board: r as 0 | 1, amount: amt, eligible: pot.eligible.slice(), winners: payout, hands });
    }
  });
  return { awards, totals };
}
