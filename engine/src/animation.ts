/* Presentation planning only: no dealing, hidden cards, timers or chip mutations.
   Ported from the reviewed planner; the renderer consumes these steps. */
export interface DealStep { key: string; eventId: string; handId: string; type: 'card-back'; from: 'deck'; to: number; slot: number; delayMs: number; durationMs: number }
export interface DealPlan { eventId: string; handId: string; steps: DealStep[]; durationMs: number }

// Single source of deal pacing, shared by the server (which sets the deal-presentation window before betting opens, so
// a longer deal never eats a player's decision time — the betting clock starts after it) and the client animation.
// Deliberate by design: every card has the same clear travel and a constant readable gap after it, so the total
// duration SCALES with the number of cards dealt. A full table or an Omaha game simply takes longer to deal rather
// than compressing back into a blur; it is never capped, because the deal happens before anyone has to act.
export const DEAL_TRAVEL_MS = 320;
export const DEAL_GAP_MS = 210;
export function dealTiming(total: number, reducedMotion = false): { travel: number; gap: number; total: number } {
  if (reducedMotion || total <= 0) return { travel: 0, gap: 0, total: 0 };
  const gap = total > 1 ? DEAL_GAP_MS : 0;
  return { travel: DEAL_TRAVEL_MS, gap, total: (total - 1) * gap + DEAL_TRAVEL_MS };
}

export function planDeal(opts: { eventId: string; handId: string; seatIds: number[]; buttonSeatId: number; holeCount: number; reducedMotion?: boolean }): DealPlan {
  const { eventId, handId, seatIds, buttonSeatId, holeCount, reducedMotion = false } = opts;
  if (!eventId || !handId || !Array.isArray(seatIds) || seatIds.length < 2 || seatIds.length > 9 || new Set(seatIds).size !== seatIds.length || ![2, 4, 5, 6].includes(holeCount) || seatIds.length * holeCount + 5 > 52) throw new Error('Invalid deal presentation');
  const button = seatIds.indexOf(buttonSeatId);
  if (button < 0) throw new Error('Button must be in the frozen dealt-seat order');
  const total = seatIds.length * holeCount;
  const { travel, gap } = dealTiming(total, reducedMotion);
  const steps: DealStep[] = [];
  for (let round = 0; round < holeCount; round++) for (let k = 1; k <= seatIds.length; k++) {
    const index = steps.length;
    steps.push({ key: eventId + ':' + index, eventId, handId, type: 'card-back', from: 'deck', to: seatIds[(button + k) % seatIds.length], slot: round, delayMs: index * gap, durationMs: travel });
  }
  return { eventId, handId, steps, durationMs: dealTiming(total, reducedMotion).total };
}

export interface BoardStep { key: string; type: 'board-reveal'; board: 'A' | 'B'; slot: number; delayMs: number; durationMs: number }
export function planBoard(opts: { eventId: string; handId: string; fromCount: number; toCount: number; board?: 'A' | 'B'; reducedMotion?: boolean }): { eventId: string; handId: string; durationMs: number; steps: BoardStep[] } {
  const { eventId, handId, fromCount, toCount, board = 'A', reducedMotion = false } = opts;
  if (!eventId || !handId || !['A', 'B'].includes(board) || ![[0, 3], [3, 4], [4, 5]].some(([a, b]) => a === fromCount && b === toCount)) throw new Error('Invalid board transition');
  return { eventId, handId, durationMs: reducedMotion ? 0 : 240, steps: Array.from({ length: toCount - fromCount }, (_, i) => ({ key: eventId + ':' + i, type: 'board-reveal' as const, board, slot: fromCount + i, delayMs: reducedMotion ? 0 : i * 60, durationMs: reducedMotion ? 0 : 240 })) };
}

/** Accepts events strictly in increasing sequence; a snapshot resume skips missed visual effects. */
export class EventGate {
  lastSequence: number;
  constructor(lastSequence = 0) { this.lastSequence = lastSequence; }
  accept(sequence: number): boolean {
    if (!Number.isSafeInteger(sequence) || sequence <= this.lastSequence) return false;
    this.lastSequence = sequence;
    return true;
  }
  resume(snapshotSequence: number): void {
    if (!Number.isSafeInteger(snapshotSequence) || snapshotSequence < 0) throw new Error('Invalid sequence');
    this.lastSequence = Math.max(this.lastSequence, snapshotSequence);
  }
}
