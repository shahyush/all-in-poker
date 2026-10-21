import {
  computeDue, publicView, privateCards, seatOf, tick, type Effect, type TableState, type TickContext,
} from '@allin/engine';
import type { Db } from './db.ts';
import { ApiError } from './errors.ts';

export interface MemberRow { user_id: string; role: string; seat: number | null; status: string; last_seen: number | null; joined_at: number; name: string; avatar: string | null }
export interface TableRow { id: string; name: string; host_id: string; invite_code: string; config: Record<string, unknown>; status: string; version: number; mode: string; seats: number; host_epoch: number; due_at: number | null; archived_at: string | null; summary: unknown; seq: number; created_at: number }
export interface Loaded { row: TableRow; t: TableState; members: MemberRow[]; now: number }

export interface CommitExtras {
  receipt?: { user_id: string; action_id: string; request_hash: string; status: number; result: unknown };
  members?: Record<string, unknown>[];
  ledger?: Record<string, unknown>[];
  participants?: Record<string, unknown>[];
  reloads?: Record<string, unknown>[];
  chat?: Record<string, unknown>[];
  touch?: string;
  create?: { name: string; host_id: string; invite_code: string; config: unknown; mode: string; seats: number };
}

export async function loadTable(db: Db, tableId: string): Promise<Loaded> {
  const r = await db.rpc<{ found: boolean; now: number; table: TableRow; secret: TableState | null; members: MemberRow[] }>('allin_load', { table_id: tableId });
  if (!r.found) throw new ApiError(404, 'not_found', 'That table no longer exists');
  if (!r.secret) throw new ApiError(410, 'archived', 'This table has ended');
  return { row: r.table, t: r.secret, members: r.members, now: Number(r.now) };
}

export function presenceOf(members: MemberRow[]): Record<string, number> {
  const p: Record<string, number> = {};
  for (const m of members) if (m.status === 'active' && m.last_seen) p[m.user_id] = Number(m.last_seen);
  return p;
}

/** Translate engine effects into commit payload fragments. */
export function effectsToPayload(t: TableState, effects: Effect[], memberNames: Map<string, string>, approved: { id: string; user_id: string; amount: number }[]): CommitExtras & { history: unknown[]; archive?: unknown; diagnostic?: unknown } {
  const out: CommitExtras & { history: unknown[]; archive?: unknown; diagnostic?: unknown } = { members: [], ledger: [], participants: [], reloads: [], history: [] };
  const used = new Set<string>();
  for (const e of effects) {
    switch (e.type) {
      case 'exit':
        out.ledger!.push({ user_id: e.playerId, kind: 'exit', amount: e.amount, source_id: `${t.id}:exit:${e.playerId}:${e.handNo}:${t.version}`, hand_no: e.handNo });
        out.participants!.push({ user_id: e.playerId, left_at: true, taken_off_delta: e.amount, final_stack: 0 });
        out.members!.push({ user_id: e.playerId, status: e.reason === 'removed' ? 'removed' : 'left', seat: null });
        break;
      case 'credit_applied': {
        const req = e.id ? approved.find((r) => r.id === e.id) : approved.find((r) => r.user_id === e.playerId && r.amount === e.amount && !used.has(r.id));
        if (req) {
          used.add(req.id);
          out.ledger!.push({ user_id: e.playerId, kind: 'reload', amount: e.amount, source_id: `reload:${req.id}`, hand_no: e.handNo });
          out.reloads!.push({ id: req.id, status: 'credited', from_status: 'approved', credited_hand_no: e.handNo });
          out.participants!.push({ user_id: e.playerId, added_delta: e.amount });
        }
        break;
      }
      case 'history': out.history.push({ hand_no: e.handNo, hand_id: (e.record as { handId?: string }).handId ?? null, record: e.record }); break;
      case 'eliminated': out.participants!.push({ user_id: e.playerId, place: e.place, final_stack: 0 }); break;
      case 'tournament_finished':
        if (e.winnerPlayerId) { const i = seatOf(t, e.winnerPlayerId); out.participants!.push({ user_id: e.winnerPlayerId, place: 1, final_stack: i >= 0 ? t.seats[i]!.stack : null }); }
        break;
      case 'archive': {
        for (const s of t.seats) if (s) out.participants!.push({ user_id: s.playerId, final_stack: s.stack, left_at: true });
        out.archive = { reason: e.reason, summary: { reason: e.reason, mode: t.rules.mode, hands: t.handNo, status: t.status, tournament: t.tournament ? { eliminations: t.tournament.eliminations, winnerPlayerId: t.tournament.winnerPlayerId, entrants: t.tournament.entrants } : null, endedAt: t.lastActivityAt } };
        break;
      }
      case 'invariant_failure': out.diagnostic = { kind: 'invariant', message: e.message }; break;
    }
  }
  void memberNames;
  return out;
}

export interface CommitResult { ok: boolean; version?: number; conflict?: boolean; duplicate?: boolean; receipt?: { status: number; result: unknown; request_hash: string } }

/** Persist a transition with CAS on the table version, plus hole cards when a new hand was dealt. */
export async function commitTable(db: Db, loaded: Loaded | null, after: TableState, effects: Effect[], extras: CommitExtras, approved: { id: string; user_id: string; amount: number }[] = []): Promise<CommitResult> {
  computeDue(after);
  const names = new Map<string, string>();
  for (const s of after.seats) if (s) names.set(s.playerId, s.name);
  const fx = effectsToPayload(after, effects, names, approved);
  const before = loaded?.t ?? null;
  const dealtNow = !!after.hand && !!after.hand.variant;
  const newDeal = dealtNow && (!before || !before.hand || before.hand.id !== after.hand!.id || !before.hand.variant);
  const holeCards = newDeal
    ? after.hand!.players.map((p) => { const pc = privateCards(after, p.playerId)!; return { user_id: p.playerId, hand_no: after.hand!.handNo, hand_id: pc.handId, cards: pc.cards }; })
    : undefined;
  if (after.error) fx.diagnostic = { kind: 'invariant', message: after.error, state: after };
  const payload = {
    table_id: after.id,
    expected_version: loaded ? loaded.row.version : -1,
    create: !loaded,
    ...(extras.create ?? {}),
    status: after.status,
    host_id: after.hostPlayerId,
    host_epoch: after.hostEpoch,
    due_at: after.dueAt,
    started_at: after.startedAt,
    seq: after.seq,
    public_state: publicView(after),
    private_state: after,
    hole_cards: holeCards,
    history: fx.history,
    ledger: [...(fx.ledger ?? []), ...(extras.ledger ?? [])],
    members: [...(fx.members ?? []), ...(extras.members ?? [])],
    participants: [...(fx.participants ?? []), ...(extras.participants ?? [])],
    reloads: [...(fx.reloads ?? []), ...(extras.reloads ?? [])],
    chat: extras.chat ?? [],
    receipt: extras.receipt ?? null,
    touch: extras.touch ?? null,
    archive: fx.archive ?? null,
    diagnostic: fx.diagnostic ?? null,
  };
  const r = await db.rpc<CommitResult>('allin_commit', payload);
  if (r.ok) after.version = r.version!;
  return r;
}

export { tick, type TickContext };
