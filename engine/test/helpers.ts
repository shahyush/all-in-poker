import { createTable, seatPlayer, startTable, tick, chooseVariant, act, legalActions, type TickContext } from '../src/table.ts';
import type { TableRules, TableState } from '../src/types.ts';
import type { VariantId } from '../src/evaluator.ts';
import { parseCard, type Card } from '../src/cards.ts';
import type { Rng } from '../src/random.ts';

/** Deterministic rng for tests (mulberry32). Production never uses this. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return (n: number) => Math.floor(rnd() * n);
}
/** rng that produces a fixed deck order (first cards listed first) and seat index 0 for button choice. */
export function fixedDeckRng(top: string[]): Rng {
  // Fisher–Yates picks j=rng(i+1) for i from 51 down; to force deck order we need the final permutation to start with `top`.
  // Simplest: rng that returns 0 for button picks and uses a precomputed swap plan for the shuffle.
  const want: Card[] = top.map(parseCard);
  const rest: Card[] = Array.from({ length: 52 }, (_, i) => i).filter((c) => !want.includes(c));
  const target = [...want, ...rest];
  // simulate: d starts as 0..51; at step i we choose j so that d[i] becomes target[i]
  const d = Array.from({ length: 52 }, (_, i) => i);
  const plan: number[] = [];
  for (let i = 51; i > 0; i--) { const j = d.indexOf(target[i]); plan.push(j); [d[i], d[j]] = [d[j], d[i]]; }
  let k = 0;
  return (n: number) => { if (n === 52 - k && k < 51) return plan[k++]; return 0; };
}

export const BASE: TableRules = { mode: 'cash', name: 'Test', seats: 9, sb: 5, bb: 10, ante: 0, straddle: false, unit: 1000, levels: [] };

export function ctxAll(t: TableState, now: number, rng?: Rng, credits?: TickContext['credits']): TickContext {
  const presence: Record<string, number> = {};
  for (const s of t.seats) if (s) presence[s.playerId] = now;
  return { presence, rng, credits };
}

export function makeTable(stacks: number[], rules: Partial<TableRules> = {}, now = 1_000_000, rng: Rng = seededRng(1)): { t: TableState; now: number; ctx: TickContext } {
  const r = { ...BASE, ...rules, seats: rules.seats ?? Math.max(2, stacks.length) };
  const t = createTable('tbl', r, 'p0', now);
  stacks.forEach((s, i) => seatPlayer(t, { playerId: 'p' + i, name: 'P' + i }, s, now, i));
  const ctx = ctxAll(t, now, rng);
  return { t, now, ctx };
}

export function start(t: TableState, now: number, ctx: TickContext, variant: VariantId = 'holdem'): number {
  startTable(t, now, ctx);
  const h = t.hand!;
  chooseVariant(t, h.chooserSeat, variant, now, ctx);
  return now + (t.hand!.actionReadyAt! - now);
}

/** Drive betting with check/call until predicate or no hand. */
export function autoplay(t: TableState, now: number, ctx: TickContext, until: (t: TableState) => boolean, maxSteps = 500): number {
  for (let i = 0; i < maxSteps; i++) {
    if (until(t)) return now;
    ctx = { ...ctx, presence: Object.fromEntries(t.seats.filter((s) => s).map((s) => [s!.playerId, now])) };
    const h = t.hand;
    if (!h) { tick(t, now, ctx); now += 1000; continue; }
    if (h.phase === 'choice') { chooseVariant(t, h.chooserSeat, 'holdem', now, ctx); continue; }
    if (h.phase === 'betting' && h.actor !== null) {
      if (h.actionReadyAt && now < h.actionReadyAt) now = h.actionReadyAt;
      const la = legalActions(t, h.actor, now);
      act(t, h.actor, { type: la.check ? 'check' : 'call' }, now, ctx);
      continue;
    }
    if (t.dueAt !== null) { now = Math.max(now, t.dueAt); tick(t, now, ctx); continue; }
    tick(t, now, ctx); now += 1000;
  }
  throw new Error('autoplay exhausted');
}

export function totalChips(t: TableState): number {
  let s = 0; for (const x of t.seats) if (x) s += x.stack;
  if (t.hand) { s += t.hand.pot; for (const p of t.hand.players) s += p.bet; }
  return s;
}
