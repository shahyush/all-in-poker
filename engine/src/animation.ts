/* Presentation planning only: no dealing, hidden cards, timers or chip mutations.
   Ported from the reviewed planner; the renderer consumes these steps. */
export interface DealStep { key: string; eventId: string; handId: string; type: 'card-back'; from: 'deck'; to: number; slot: number; delayMs: number; durationMs: number }
export interface DealPlan { eventId: string; handId: string; steps: DealStep[]; durationMs: number }

export function planDeal(opts: { eventId: string; handId: string; seatIds: number[]; buttonSeatId: number; holeCount: number; reducedMotion?: boolean }): DealPlan {
  const { eventId, handId, seatIds, buttonSeatId, holeCount, reducedMotion = false } = opts;
  if (!eventId || !handId || !Array.isArray(seatIds) || seatIds.length < 2 || seatIds.length > 9 || new Set(seatIds).size !== seatIds.length || ![2, 4, 5, 6].includes(holeCount) || seatIds.length * holeCount + 5 > 52) throw new Error('Invalid deal presentation');
  const button = seatIds.indexOf(buttonSeatId);
  if (button < 0) throw new Error('Button must be in the frozen dealt-seat order');
  const total = seatIds.length * holeCount;
  const travel = reducedMotion ? 0 : 180;
  const gap = reducedMotion ? 0 : Math.min(55, Math.floor((1500 - travel) / (total - 1)));
  const steps: DealStep[] = [];
  for (let round = 0; round < holeCount; round++) for (let k = 1; k <= seatIds.length; k++) {
    const index = steps.length;
    steps.push({ key: eventId + ':' + index, eventId, handId, type: 'card-back', from: 'deck', to: seatIds[(button + k) % seatIds.length], slot: round, delayMs: index * gap, durationMs: travel });
  }
  return { eventId, handId, steps, durationMs: (total - 1) * gap + travel };
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
