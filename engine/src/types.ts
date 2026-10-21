import type { Card } from './cards.ts';
import type { VariantId } from './evaluator.ts';
import type { PotAward } from './pots.ts';

export type Mode = 'cash' | 'tournament';
export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type HandPhase = 'choice' | 'betting' | 'vote' | 'offer' | 'runout' | 'result';
export type TableStatus = 'waiting' | 'running' | 'finished' | 'abandoned' | 'closed';

export interface Level { sb: number; bb: number; ante: number; minutes: number }

export interface TableRules {
  mode: Mode;
  name: string;
  seats: number;            // 2–9 physical seats
  sb: number;               // cash blinds (tournament uses levels)
  bb: number;
  ante: number;             // per dealt player, 0 = off (cash)
  straddle: boolean;        // cash only
  unit: number;             // cash buy-in unit; tournament starting stack
  levels: Level[];          // tournament schedule (ordered)
}

export interface SeatState {
  playerId: string;
  name: string;
  stack: number;
  status: 'in' | 'sitout' | 'waiting';   // waiting: seated but not yet dealt into a hand (new arrival)
  owesBB: boolean;
  owesSB: boolean;
  postToPlay: boolean;
  sitOutRequested: boolean;
  returnRequested: boolean;
  leaving: boolean;                      // leave or host removal queued for the next boundary
  leaveReason: 'leave' | 'removed' | null;
  consecutiveTimeouts: number;
  joinedAt: number;
  joinSeq: number;
  straddlePref: boolean;
  handStartStack: number | null;         // tournament tie ranking
  eliminatedPlace: number | null;
}

export interface HandPlayer {
  seat: number;
  playerId: string;
  holeCount: number;
  folded: boolean;
  allIn: boolean;
  left: boolean;          // departed mid-hand but still a pot claimant
  bet: number;            // this street
  paid: number;           // whole hand, including antes and dead posts
  acted: boolean;         // has acted this street
  lastFaced: number;      // currentBet when this player last acted this street
  stackStart: number;
  revealed: number[];     // hole indices revealed publicly (uncontested winner only)
  shown: boolean;         // full hand exposed at showdown
}

export interface Vote {
  kind: 'proposal' | 'offer';
  runs: 1 | 2;                       // proposal: proposed runs
  proposer: number | null;
  electorate: number[];
  votes: Record<number, 'agree' | 'decline' | 'once' | 'twice'>;
  deadline: number;
  street: Street;
  suspendedActor: number | null;
  remainingMs: number;
}

export interface RunoutStage { board: 0 | 1; cards: Card[]; street: Street; at: number }

export interface HandResult {
  uncontested: boolean;
  winnerSeat: number | null;         // uncontested winner
  refunds: { seat: number; amount: number }[];
  pots: { amount: number; eligible: number[] }[];
  awards: PotAward[];
  totals: Record<number, number>;
  boards: Card[][];
  shows: Record<number, Card[]>;     // publicly exposed full hands at showdown
}

export interface HandState {
  id: string;
  handNo: number;
  variant: VariantId | null;
  phase: HandPhase;
  street: Street;
  button: number;
  sbSeat: number | null;
  bbSeat: number | null;
  straddleSeat: number | null;
  chooserSeat: number;
  sb: number;
  bb: number;
  ante: number;
  level: number | null;
  players: HandPlayer[];
  pot: number;                       // collected from earlier streets
  board: Card[];
  boards: Card[][] | null;           // two full boards when run twice
  currentBet: number;
  lastFullRaise: number;
  actor: number | null;
  deadline: number | null;
  actionReadyAt: number | null;
  choiceDeadline: number | null;
  straddleOffer: { seat: number; decided: boolean; accepted: boolean } | null;
  vote: Vote | null;
  proposedStreets: Street[];
  bettingLocked: boolean;
  runs: 1 | 2;
  runoutQueue: RunoutStage[];
  result: HandResult | null;
  revealDeadline: number | null;
  nextAt: number | null;
  startedAt: number;
  // private
  deck: Card[];
  cursor: number;
  hole: Record<number, Card[]>;
  log: PublicLogEntry[];
}

export type PublicLogEntry =
  | { t: 'post'; seat: number; amount: number; kind: 'ante' | 'sb' | 'bb' | 'straddle' | 'dead' }
  | { t: 'fold' | 'check'; seat: number; timeout?: boolean }
  | { t: 'call' | 'bet' | 'raise'; seat: number; to: number; amount: number; allIn: boolean; timeout?: boolean }
  | { t: 'street'; street: Street; cards: Card[]; board: 0 | 1 }
  | { t: 'vote'; kind: 'proposal' | 'offer'; outcome: 'agreed' | 'declined' | 'expired' | 'once' | 'twice'; runs: 1 | 2 }
  | { t: 'award'; seat: number; amount: number; board: 0 | 1; potIndex: number; name: string }
  | { t: 'refund'; seat: number; amount: number }
  | { t: 'reveal'; seat: number; indices: number[]; cards: Card[] };

export interface TournamentState {
  startedAt: number;
  level: number;                     // index into rules.levels used by the current/next hand
  eliminations: { playerId: string; name: string; place: number; handNo: number }[];
  entrants: { playerId: string; name: string }[];
  finishedAt: number | null;
  winnerPlayerId: string | null;
}

export interface TableState {
  id: string;
  rules: TableRules;
  status: TableStatus;
  version: number;
  seq: number;
  seats: (SeatState | null)[];
  button: number | null;
  prevBB: number | null;
  prevSB: number | null;               // previous small-blind position (dead-button rule)
  handNo: number;
  hand: HandState | null;
  hostPlayerId: string;
  hostEpoch: number;
  createdAt: number;
  startedAt: number | null;
  nextSeq: number;                   // join sequence counter
  tournament: TournamentState | null;
  waitingReason: string | null;
  dueAt: number | null;
  events: PublicEvent[];             // recent public events (bounded)
  error: string | null;              // invariant failure halts the table
  lastActivityAt: number;
}

export type PublicEvent = { seq: number; handId: string | null; at: number } & (
  | { type: 'deal'; order: number[]; holeCount: number; button: number; variant: VariantId; durationMs: number }
  | { type: 'board'; board: 0 | 1; street: Street; cards: Card[] }
  | { type: 'action'; seat: number; action: string; amount: number; to: number }
  | { type: 'award'; awards: { seat: number; amount: number }[] }
  | { type: 'showdown' }
  | { type: 'reveal'; seat: number; indices: number[]; cards: Card[] }
  | { type: 'choice'; variant: VariantId; seat: number; timeout: boolean }
  | { type: 'hand_end' }
  | { type: 'seat'; seat: number; change: 'join' | 'leave' | 'sitout' | 'return' | 'eliminated' }
  | { type: 'host'; playerId: string }
  | { type: 'level'; level: number }
  | { type: 'status'; status: TableStatus }
);

export type Effect =
  | { type: 'exit'; playerId: string; amount: number; handNo: number; reason: 'leave' | 'removed' | 'closed' }
  | { type: 'credit_applied'; playerId: string; amount: number; handNo: number; id: string | null }
  | { type: 'history'; handNo: number; record: unknown }
  | { type: 'eliminated'; playerId: string; place: number; handNo: number }
  | { type: 'tournament_finished'; winnerPlayerId: string | null; abandoned: boolean }
  | { type: 'archive'; reason: 'all_left' | 'abandoned' | 'finished' }
  | { type: 'invariant_failure'; message: string };

export class EngineError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; this.name = 'EngineError'; }
}
export const fail: (code: string, message: string) => never = (code, message) => { throw new EngineError(code, message); };
export type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
