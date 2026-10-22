import type { VariantId } from './evaluator.ts';

/** The single typed rule profile. Timers are server values in milliseconds. */
export const RULES = {
  burnCards: false,
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
    revealMs: 6000,
    showdownMs: 7000,
    awardToNextChoiceMs: 3000,
    dealPresentationMaxMs: 1500,
    boardStageMs: 1100,
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

/** Cards needed for one full board with n dealt players of this variant (no burns). */
export function cardsForOneBoard(n: number, variant: VariantId): number {
  return n * RULES.variants[variant].holeCards + 5;
}
export function variantAllowed(n: number, variant: VariantId): boolean {
  return n >= 2 && n <= RULES.variants[variant].maxDealt && cardsForOneBoard(n, variant) <= 52;
}
