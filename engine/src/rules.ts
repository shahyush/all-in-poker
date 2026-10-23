import type { VariantId } from './evaluator.ts';

/** The single typed rule profile. Timers are server values in milliseconds. */
export const RULES = {
  // Real burns: one hidden card is consumed from the deck before the flop, turn and river (each board when run twice).
  // Burned cards never leave the server; clients only get a card-free "burn" event for a face-down animation.
  burnCards: true,
  variants: {
    holdem: { id: 'holdem', label: "Hold'em", short: 'NLH', holeCards: 2, limit: 'NL', maxDealt: 9 },
    omaha4: { id: 'omaha4', label: 'Omaha 4', short: 'PLO4', holeCards: 4, limit: 'PL', maxDealt: 9 },
    omaha5: { id: 'omaha5', label: 'Omaha 5', short: 'PLO5', holeCards: 5, limit: 'PL', maxDealt: 9 },
    omaha6: { id: 'omaha6', label: 'Omaha 6', short: 'PLO6', holeCards: 6, limit: 'PL', maxDealt: 7 },
  } as Record<VariantId, { id: VariantId; label: string; short: string; holeCards: number; limit: 'NL' | 'PL'; maxDealt: number }>,
  defaultVariant: 'holdem' as VariantId,
  timers: {
    choiceMs: 15000,
    choiceWarmupCapMs: 30000,
    bettingMs: 30000,
    voluntaryVoteMs: 8000,
    forcedOfferMs: 5000,
    revealMs: 10000,
    showdownMs: 7000,
    awardToNextChoiceMs: 3000,
    // There is deliberately no cap on the deal presentation: actionReadyAt waits the full dealTiming() for the cards
    // actually dealt (it scales with players × hole cards), and the betting clock starts only after it.
    boardStageMs: 1500,
    hostGraceMs: 30000,
    abandonmentMs: 30 * 60 * 1000,
    nobodyPresentHoldMs: 45000,
  },
  cash: { consecutiveTimeoutsToSitOut: 2 },
  tournament: { rebuys: false },
  seats: { min: 2, max: 9 },
  nicknameMax: 24,
  chatMax: 500,
} as const;

export const VARIANT_IDS: VariantId[] = ['holdem', 'omaha4', 'omaha5', 'omaha6'];

/** The curated set of one-tap message reactions. Shared by the client picker and the server allowlist so the two never
 *  drift. Kept small and legible at phone size; message bodies may still carry any emoji the picker inserts. */
export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '💰', '🙌', '😎', '🤯', '👏', '🎉'] as const;
export type Reaction = typeof REACTIONS[number];
export const isReaction = (s: unknown): s is Reaction => typeof s === 'string' && (REACTIONS as readonly string[]).includes(s);

/** Burns per full board when burn cards are on: one before the flop, one before the turn, one before the river. */
export const BURNS_PER_BOARD = 3;
/** Community streets still to come for a board holding `len` cards (0 → flop, turn, river). */
export function streetsLeft(len: number): number { return len === 0 ? 3 : len === 3 ? 2 : len === 4 ? 1 : 0; }
/** Cards needed for one full board with n dealt players of this variant, burns included when they are on. This is the
 *  deck-sufficiency rule: with burns, Omaha 5 fits eight players (40 + 5 + 3 = 48), not nine (45 + 8 = 53). */
export function cardsForOneBoard(n: number, variant: VariantId): number {
  return n * RULES.variants[variant].holeCards + 5 + (RULES.burnCards ? BURNS_PER_BOARD : 0);
}
export function variantAllowed(n: number, variant: VariantId): boolean {
  return n >= 2 && n <= RULES.variants[variant].maxDealt && cardsForOneBoard(n, variant) <= 52;
}
