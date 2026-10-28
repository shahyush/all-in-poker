import {
  RULES, act, cancelLeave, chooseVariant, choiceReady, createTable, eligibleToStart, parseChipAmount, propose, renamePlayer,
  requestLeave, requestReturn, requestSitOut, respondStraddle, respondVote, reveal, seatOf, seatPlayer, secureCode,
  setPostToPlay, setStraddlePref, startTable, tick, transferHost, validateRules, isChipInt, isReaction, type Effect, type TableRules, type TableState, type TickContext, type VariantId,
} from '@allin/engine';
import type { Db } from './db.ts';
import { ApiError, bad } from './errors.ts';
import { byteaHex, constantTimeEqual, newRecoveryCode, normalizeCode, parseBytea, pbkdf2, PBKDF2_ITERATIONS, randomBytes, sha256Hex } from './crypto.ts';
import { commitTable, loadTable, presenceOf, type CommitExtras, type Loaded } from './tables.ts';

export interface Player { id: string; name: string; avatar: string | null; isOwner: boolean }
export interface Env { groupPassword?: string; appOrigin?: string }
export interface HandlerResult { status?: number; result: unknown; }
export type Receipt = { user_id: string; action_id: string; request_hash: string; status: number; result: unknown };

type ProfileRow = { id: string; display_name: string; avatar: string | null; auth_user_id: string | null; status: string; is_owner: boolean; admitted_at: string | null };

const NAME_RE = /^[\p{L}\p{N}\p{P}\p{S}\p{Zs}\p{M}\p{Emoji}]{1,24}$/u;
export function cleanName(raw: unknown): string {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!s || [...s].length > RULES.nicknameMax || !NAME_RE.test(s)) bad(400, 'bad_name', 'Pick a nickname of 1 to 24 characters');
  return s;
}
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === 'string' && uuidRe.test(s);

export class Handlers {
  constructor(private db: Db, private env: Env) {}

  // ---------- identity ----------
  /** One call: the caller's active player plus any prior receipt for this action id (replay protection). */
  async begin(authUid: string, actionId: string | null): Promise<{ player: Player | null; receipt: { request_hash: string; status: number; result: unknown } | null }> {
    const r = await this.db.rpc<{ player: { id: string; display_name: string; avatar: string | null; is_owner: boolean } | null; receipt: { request_hash: string; status: number; result: unknown } | null }>('allin_begin', { auth_uid: authUid, action_id: actionId });
    const p = r.player;
    return { player: p ? { id: p.id, name: p.display_name, avatar: p.avatar, isOwner: p.is_owner } : null, receipt: r.receipt ?? null };
  }
  async playerFor(authUid: string): Promise<Player | null> {
    const rows = await this.db.select<ProfileRow>('profiles', { auth_user_id: authUid, status: 'active' }, { limit: 1 });
    if (!rows.length) return null;
    const r = rows[0];
    return { id: r.id, name: r.display_name, avatar: r.avatar, isOwner: r.is_owner };
  }

  private async rateLimit(key: string, kind: string, limit: number, windowS: number, message: string): Promise<void> {
    const c = await this.db.rpc<number>('allin_attempt', { key, kind, limit, window_s: windowS });
    if (c >= limit) bad(429, 'rate_limited', message);
  }

  private async verifyGroupPassword(password: string, authUid: string): Promise<{ bootstrap: boolean }> {
    const rows = await this.db.select<{ password_hash: string; password_salt: string; iterations: number }>('group_settings', { id: 1 });
    if (!rows.length) {
      const boot = this.env.groupPassword;
      if (!boot) bad(503, 'not_configured', 'The group password has not been set up yet');
      const a = new TextEncoder().encode(password.normalize('NFKC')), b = new TextEncoder().encode(boot!.normalize('NFKC'));
      if (!constantTimeEqual(a, b)) bad(403, 'wrong_password', 'That group password is not right');
      void authUid;
      return { bootstrap: true };
    }
    const r = rows[0];
    const derived = await pbkdf2(password, parseBytea(r.password_salt), r.iterations);
    if (!constantTimeEqual(derived, parseBytea(r.password_hash))) bad(403, 'wrong_password', 'That group password is not right');
    return { bootstrap: false };
  }

  async admit(authUid: string, p: { nickname?: unknown; password?: unknown }): Promise<HandlerResult> {
    const existing = await this.playerFor(authUid);
    if (existing) return { result: { player: existing, already: true } };
    const name = cleanName(p.nickname);
    const password = String(p.password ?? '');
    if (!password || password.length > 200) bad(400, 'bad_password', 'Enter the group password');
    await this.rateLimit(authUid, 'admit', 10, 600, 'Too many tries. Wait a few minutes and try again.');
    const { bootstrap } = await this.verifyGroupPassword(password, authUid);
    const r = await this.db.rpc<{ ok: boolean; player: ProfileRow; reason?: string }>('allin_admit', {
      auth_user_id: authUid, display_name: name, bootstrap, ...(bootstrap ? await this.hashPassword(password) : {}),
    });
    if (!r.ok) bad(409, r.reason ?? 'admit_failed', 'Could not admit you, please try again');
    return { result: { player: { id: r.player.id, name: r.player.display_name, avatar: r.player.avatar, isOwner: r.player.is_owner } } };
  }

  private async hashPassword(password: string): Promise<{ password_hash: string; password_salt: string; iterations: number }> {
    const salt = randomBytes(16);
    const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
    return { password_hash: byteaHex(hash), password_salt: byteaHex(salt), iterations: PBKDF2_ITERATIONS };
  }

  async rotateGroupPassword(player: Player, authUid: string, p: { current?: unknown; next?: unknown }): Promise<HandlerResult> {
    if (!player.isOwner) bad(403, 'owner_only', 'Only the group owner can change the password');
    const next = String(p.next ?? '');
    if (next.length < 6 || next.length > 200) bad(400, 'bad_password', 'Use at least 6 characters');
    await this.rateLimit(authUid, 'rotate', 5, 600, 'Too many tries');
    await this.verifyGroupPassword(String(p.current ?? ''), authUid);
    await this.db.rpc('allin_set_group_password', { ...(await this.hashPassword(next)), rotated_by: player.id });
    return { result: { ok: true } };
  }

  async updateProfile(player: Player, p: { name?: unknown; avatar?: unknown }): Promise<HandlerResult> {
    const name = p.name !== undefined ? cleanName(p.name) : undefined;
    let avatar: string | null | undefined;
    if (p.avatar !== undefined) { avatar = p.avatar === null ? null : String(p.avatar); if (avatar && [...avatar].length > 2) bad(400, 'bad_avatar', 'Avatar is one or two characters'); }
    await this.db.rpc('allin_update_profile', { player_id: player.id, display_name: name ?? null, avatar: avatar === undefined ? '__keep__' : avatar });
    // propagate the name into any live table state the player is seated at
    if (name) {
      const seats = await this.db.select<{ table_id: string }>('table_members', { user_id: player.id, status: 'active' });
      for (const s of seats) {
        try { await this.withTable(s.table_id, null, (L) => { renamePlayer(L.t, player.id, name); return { effects: [], result: null }; }); } catch { /* best effort */ }
      }
    }
    return { result: { player: { ...player, name: name ?? player.name, avatar: avatar === undefined ? player.avatar : avatar } } };
  }

  async createRecoveryCode(player: Player): Promise<HandlerResult> {
    const code = newRecoveryCode();
    const verifier = await sha256Hex(normalizeCode(code));
    await this.db.rpc('allin_recovery_create', { player_id: player.id, verifier: byteaHex(new Uint8Array(verifier.match(/.{2}/g)!.map((x) => parseInt(x, 16)))) });
    return { result: { code } };
  }

  async recover(authUid: string, p: { code?: unknown }): Promise<HandlerResult> {
    const existing = await this.playerFor(authUid);
    if (existing) bad(409, 'already_player', 'This device already has a player. Forget it first if you want to restore a different one.');
    const code = normalizeCode(String(p.code ?? ''));
    if (code.length < 20) bad(400, 'bad_code', 'That does not look like a player code');
    await this.rateLimit(authUid, 'recover', 5, 900, 'Too many tries. Wait 15 minutes and try again.');
    const verifier = await sha256Hex(code);
    const r = await this.db.rpc<{ ok: boolean; reason?: string; player?: ProfileRow }>('allin_recover', { auth_user_id: authUid, verifier: byteaHex(new Uint8Array(verifier.match(/.{2}/g)!.map((x) => parseInt(x, 16)))) });
    if (!r.ok) bad(403, 'bad_code', 'That player code is not valid any more');
    const pr = r.player!;
    return { result: { player: { id: pr.id, name: pr.display_name, avatar: pr.avatar, isOwner: pr.is_owner }, codeRotated: true } };
  }

  async forget(player: Player): Promise<HandlerResult> {
    const seats = await this.db.select<{ table_id: string }>('table_members', { user_id: player.id, status: 'active' });
    if (seats.length) bad(409, 'seated', 'Leave your table before forgetting this player on this device');
    await this.db.rpc('allin_unbind', { player_id: player.id });
    return { result: { ok: true } };
  }

  // ---------- tables ----------
  private async withTable<T = unknown>(tableId: string, receipt: Receipt | null, fn: (L: Loaded, ctx: TickContext) => { effects: Effect[]; result: unknown; extras?: CommitExtras }, prepare?: (L: Loaded) => void): Promise<{ result: T; duplicate?: Receipt }> {
    if (!isUuid(tableId)) bad(400, 'bad_table', 'Unknown table');
    for (let attempt = 0; attempt < 4; attempt++) {
      const L = await loadTable(this.db, tableId);
      const approved = L.approved;
      const ctx: TickContext = { presence: presenceOf(L.members), credits: approved.map((r) => ({ playerId: r.user_id, amount: Number(r.amount), id: r.id })) };
      const before = structuredClone(L.t);
      // prepare runs AFTER the compare-and-set base is captured but BEFORE deadlines are resolved, so an intent such as
      // "leaving" is honoured by any hand boundary that this pre-tick advances (otherwise the leaver is dealt the next hand).
      if (prepare) prepare(L);
      const pre = tick(L.t, L.now, ctx);
      const out = fn(L, ctx);
      const effects = [...pre, ...out.effects];
      const r = await commitTable(this.db, { ...L, t: before }, L.t, effects, { ...(out.extras ?? {}), receipt: receipt ?? undefined }, approved);
      if (r.ok) return { result: out.result as T };
      if (r.duplicate && r.receipt) return { result: r.receipt.result as T, duplicate: { ...receipt!, status: r.receipt.status, result: r.receipt.result } };
      if (!r.conflict) bad(500, 'commit_failed', 'Could not save that, please try again');
    }
    return bad(409, 'busy', 'The table changed, please try again');
  }

  private seatFor(L: Loaded, player: Player): number {
    const i = seatOf(L.t, player.id);
    if (i === -1) bad(403, 'not_seated', 'You are not seated at this table');
    return i;
  }
  private requireHost(L: Loaded, player: Player): void {
    if (L.t.hostPlayerId !== player.id) bad(403, 'host_only', 'Only the host can do that');
  }

  async createTable(player: Player, receipt: Receipt, p: { rules?: unknown; buyIn?: unknown }): Promise<HandlerResult> {
    const raw = (p.rules ?? {}) as Record<string, unknown>;
    const int = (v: unknown) => parseChipAmount(v) ?? NaN;
    const rules: TableRules = validateRules({
      orbitBlindStep: raw.orbitBlindStep === 5 ? 5 : undefined,
      mode: raw.mode === 'tournament' ? 'tournament' : 'cash', name: String(raw.name ?? ''), seats: int(raw.seats),
      sb: int(raw.sb), bb: int(raw.bb), ante: raw.ante === undefined || raw.ante === '' ? 0 : int(raw.ante), straddle: !!raw.straddle, unit: int(raw.unit),
      levels: Array.isArray(raw.levels) ? (raw.levels as Record<string, unknown>[]).map((L) => ({ sb: int(L.sb), bb: int(L.bb), ante: L.ante === undefined || L.ante === '' ? 0 : int(L.ante), minutes: int(L.minutes) })) : [],
    });
    const buyIn = rules.mode === 'tournament' ? rules.unit : parseChipAmount(p.buyIn);
    if (buyIn === null || buyIn <= 0 || buyIn % rules.unit !== 0) bad(400, 'bad_buyin', `Buy-in must be a positive multiple of ${rules.unit}`);
    const now = Number(await this.db.rpc<number>('allin_now', {}));
    const id = crypto.randomUUID();
    const t = createTable(id, rules, player.id, now);
    const seat = seatPlayer(t, { playerId: player.id, name: player.name }, buyIn!, now, null);
    for (let attempt = 0; attempt < 3; attempt++) {
      const invite = secureCode(8);
      const r = await commitTable(this.db, null, t, [], {
        receipt,
        create: { name: rules.name, host_id: player.id, invite_code: invite, config: rules, mode: rules.mode, seats: rules.seats },
        members: [{ user_id: player.id, role: 'host', seat, status: 'active' }],
        ledger: [{ user_id: player.id, kind: 'buyin', amount: buyIn, source_id: `${id}:buyin:${player.id}:0`, hand_no: 0 }],
        participants: [{ user_id: player.id, name: player.name, added_delta: buyIn }],
      }).catch((e: Error) => (/duplicate key value.*invite_code/.test(e.message) ? null : Promise.reject(e)));
      if (r === null) continue;
      if (r.duplicate) return { result: r.receipt!.result };
      return { result: { tableId: id, inviteCode: invite } };
    }
    return bad(500, 'create_failed', 'Could not create the table');
  }

  async preview(player: Player, authUid: string, p: { code?: unknown }): Promise<HandlerResult> {
    const code = String(p.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 8) bad(400, 'bad_code', 'Enter the 8-character invite code');
    await this.rateLimit(authUid, 'invite', 30, 600, 'Too many invite attempts, wait a few minutes');
    const rows = await this.db.select<{ id: string; name: string; host_id: string; status: string; mode: string; seats: number; config: TableRules; archived_at: string | null; state: { seats: unknown[]; hostPlayerId: string } }>('tables', { invite_code: code }, { limit: 1 });
    if (!rows.length) bad(404, 'no_table', 'No table with that code');
    const r = rows[0];
    const host = await this.db.select<{ display_name: string }>('profiles', { id: r.state?.hostPlayerId ?? r.host_id }, { limit: 1 });
    const occupied = (r.state?.seats ?? []).filter(Boolean).length;
    const member = await this.db.select('table_members', { table_id: r.id, user_id: player.id, status: 'active' });
    return { result: { tableId: r.id, name: r.name, host: host[0]?.display_name ?? 'Host', status: r.archived_at ? 'closed' : r.status, mode: r.mode, rules: r.config, seats: r.seats, occupied, open: r.seats - occupied, isMember: member.length > 0 } };
  }

  async join(player: Player, receipt: Receipt, p: { code?: unknown; amount?: unknown; seat?: unknown; watch?: unknown }): Promise<HandlerResult> {
    const code = String(p.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const rows = await this.db.select<{ id: string; archived_at: string | null }>('tables', { invite_code: code }, { limit: 1 });
    if (!rows.length || rows[0].archived_at) bad(404, 'no_table', 'That invite is no longer open');
    const tableId = rows[0].id;
    const amount = parseChipAmount(p.amount);
    const r = await this.withTable(tableId, receipt, (L) => {
      if (L.t.closeRequested || !['waiting', 'running'].includes(L.t.status)) bad(409, 'closed', 'This table has closed');
      if (seatOf(L.t, player.id) !== -1) return { effects: [], result: { tableId, already: true } };
      if (p.watch === true) return { effects: [], result: { tableId, watching: true }, extras: {
        members: [{ user_id: player.id, role: 'player', seat: null, status: 'active' }], touch: player.id,
      } };
      const unit = L.t.rules.unit;
      const buyIn = L.t.rules.mode === 'tournament' ? unit : amount;
      if (buyIn === null || buyIn <= 0 || buyIn % unit !== 0) bad(400, 'bad_buyin', `Buy-in must be a positive multiple of ${unit}`);
      const seat = seatPlayer(L.t, { playerId: player.id, name: player.name }, buyIn!, L.now, typeof p.seat === 'number' ? p.seat : null);
      const episode = L.members.filter((m) => m.user_id === player.id).length; // rejoin creates a new ledger episode
      return {
        effects: [], result: { tableId, seat },
        extras: {
          members: [{ user_id: player.id, role: 'player', seat, status: 'active' }],
          ledger: [{ user_id: player.id, kind: 'buyin', amount: buyIn, source_id: `${tableId}:buyin:${player.id}:${L.t.handNo}:${L.row.version}:${episode}`, hand_no: L.t.handNo }],
          participants: [{ user_id: player.id, name: player.name, added_delta: buyIn, rejoined: true }, ...(L.t.tournament?.eliminations ?? []).map(e => ({ user_id: e.playerId, place: e.place }))],
          touch: player.id,
        },
      };
    });
    return { result: r.result };
  }

  async start(player: Player, receipt: Receipt, tableId: string): Promise<HandlerResult> {
    const r = await this.withTable(tableId, receipt, (L, ctx) => {
      this.requireHost(L, player);
      if (L.t.status === 'running') return { effects: [], result: { already: true } };
      const e = eligibleToStart(L.t); if (!e.ok) bad(409, 'not_enough_players', e.reason);
      const effects = startTable(L.t, L.now, ctx);
      return { effects, result: { ok: true }, extras: { touch: player.id } };
    });
    return { result: r.result };
  }

  async game(player: Player, receipt: Receipt, tableId: string, type: string, p: Record<string, unknown>): Promise<HandlerResult> {
    // For leave/remove, record the leaving intent BEFORE the pre-tick resolves any due boundary, so a hand that starts in
    // that pre-tick excludes the departing player instead of dealing them in (which would strand the table on timeouts).
    const prepare = type === 'close_table' ? (L: Loaded): void => { this.requireHost(L, player); L.t.closeRequested = true; } : (type === 'leave' || type === 'remove') ? (L: Loaded): void => {
      const targetId = type === 'remove' ? String(p.playerId ?? '') : player.id;
      const i = seatOf(L.t, targetId);
      if (i === -1) return;
      const tourneyRunning = L.t.rules.mode === 'tournament' && L.t.status === 'running';
      if (!tourneyRunning || type === 'remove') { L.t.seats[i]!.leaving = true; L.t.seats[i]!.leaveReason = type === 'remove' ? 'removed' : 'leave'; }
    } : undefined;
    const r = await this.withTable(tableId, receipt, (L, ctx) => {
      const t = L.t; const now = L.now;
      if (t.error) bad(409, 'table_error', 'This table stopped after a problem. Please tell the host.');
      // leave/remove: the pre-tick (with the leaving flag already set) may have cashed the player out at a boundary. If so
      // the seat is gone and the exit is already in the pre-tick effects — nothing more to do.
      if (type === 'close_table') return { effects: [], result: { ok: true }, extras: { touch: player.id } };
      if (type === 'leave') {
        const eff = seatOf(t, player.id) !== -1 ? requestLeave(t, player.id, 'leave', now, ctx) : [];
        const extras: CommitExtras = { touch: player.id };
        // Hide a departed player from the active dashboard, retaining their LPS stack in play.
        if (seatOf(t, player.id) === -1 || (t.rules.mode === 'tournament' && t.status === 'running')) extras.members = [{ user_id: player.id, status: 'left', seat: null }];
        return { effects: eff, result: { ok: true, version: L.row.version + 1 }, extras };
      }
      if (type === 'remove') {
        this.requireHost(L, player);
        const target = String(p.playerId);
        if (target === player.id) bad(400, 'self', 'Use Leave to leave your own table');
        const eff = seatOf(t, target) !== -1 ? requestLeave(t, target, 'removed', now, ctx) : [];
        const extras: CommitExtras = { touch: player.id };
        if (t.rules.mode === 'tournament') extras.members = [{ user_id: target, status: 'removed', seat: null }];
        return { effects: eff, result: { ok: true }, extras };
      }
      const seat = this.seatFor(L, player);
      let effects: Effect[] = [];
      switch (type) {
        case 'choose': effects = chooseVariant(t, seat, String(p.variant) as VariantId, now, ctx); break;
        case 'choice_ready': effects = choiceReady(t, seat, now, ctx); break;
        case 'straddle': effects = respondStraddle(t, seat, !!p.accept, now, ctx); break;
        case 'act': {
          const a = String(p.action);
          if (a === 'raise') { const to = parseChipAmount(p.raiseTo); if (to === null) bad(400, 'bad_amount', 'Enter a whole number of chips'); effects = act(t, seat, { type: 'raise', raiseTo: to! }, now, ctx); }
          else if (a === 'fold' || a === 'check' || a === 'call') effects = act(t, seat, { type: a }, now, ctx);
          else bad(400, 'bad_action', 'Unknown action');
          break;
        }
        case 'propose': effects = propose(t, seat, p.runs === 2 ? 2 : 1, now, ctx); break;
        case 'vote': effects = respondVote(t, seat, String(p.choice) as 'agree', now, ctx); break;
        case 'reveal': {
          const what = p.what === 'all' || p.what === 'muck' ? p.what : Array.isArray(p.indices) ? (p.indices as unknown[]).map((x) => Number(x)) : bad(400, 'bad_reveal', 'Nothing to reveal');
          effects = reveal(t, seat, what as 'all', now, ctx); break;
        }
        case 'sitout': effects = tick(t, now, ctx); requestSitOut(t, player.id, now); break;
        case 'return': effects = tick(t, now, ctx); requestReturn(t, player.id, !!p.post, now); effects.push(...tick(t, now, ctx)); break;
        case 'post_pref': setPostToPlay(t, player.id, !!p.post); break;
        case 'straddle_pref': setStraddlePref(t, player.id, !!p.pref); break;
        case 'cancel_leave': cancelLeave(t, player.id); break;
        default: bad(400, 'bad_type', 'Unknown command');
      }
      return { effects, result: { ok: true, version: L.row.version + 1 }, extras: { touch: player.id } };
    }, prepare);
    return { result: r.result };
  }

  async reload(player: Player, receipt: Receipt, tableId: string, type: 'reload_request' | 'reload_cancel' | 'reload_decide', p: Record<string, unknown>): Promise<HandlerResult> {
    const r = await this.withTable(tableId, receipt, (L) => {
      const t = L.t;
      if (t.rules.mode !== 'cash') bad(400, 'not_cash', 'Tournament stacks cannot be reloaded');
      const seat = this.seatFor(L, player);
      if (type === 'reload_request') {
        const amount = parseChipAmount(p.amount);
        if (amount === null || amount <= 0 || amount % t.rules.unit !== 0) bad(400, 'bad_amount', `Reload must be a positive multiple of ${t.rules.unit}`);
        if (t.seats[seat]!.leaving) bad(409, 'leaving', 'You are leaving this table');
        const id = isUuid(p.requestId) ? p.requestId : crypto.randomUUID();
        const extras: CommitExtras = { touch: player.id };
        if (t.hostPlayerId === player.id) {
          // host self-reload: explicitly self-approved and visible in the accounts log
          extras.reloads = [{ id, user_id: player.id, amount, insert: true }, { id, status: 'approved', from_status: 'requested', decided_by: player.id, host_epoch: t.hostEpoch }];
        } else extras.reloads = [{ id, user_id: player.id, amount, insert: true }];
        return { effects: [], result: { requestId: id, status: t.hostPlayerId === player.id ? 'approved' : 'requested' }, extras };
      }
      if (type === 'reload_cancel') {
        const id = String(p.requestId);
        return { effects: [], result: { ok: true }, extras: { reloads: [{ id, status: 'cancelled', from_status: 'requested' }], touch: player.id } };
      }
      this.requireHost(L, player);
      const id = String(p.requestId);
      return { effects: [], result: { ok: true }, extras: { reloads: [{ id, status: p.approve ? 'approved' : 'rejected', from_status: 'requested', decided_by: player.id, host_epoch: t.hostEpoch }], touch: player.id } };
    });
    return { result: r.result };
  }

  async chat(player: Player, receipt: Receipt, tableId: string, p: { body?: unknown }, authUid: string): Promise<HandlerResult> {
    const body = String(p.body ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim();
    if (!body) bad(400, 'empty', 'Write something first');
    if ([...body].length > RULES.chatMax) bad(400, 'too_long', 'Keep it under 500 characters');
    if (!isUuid(tableId)) bad(400, 'bad_table', 'Unknown table');
    // A chat message changes no game state, so it must NOT fight the table-version CAS (withTable): under a burst, the
    // retries there could all lose to a concurrent action and the message was dropped with 409 'busy' — reactions never
    // had this because allin_react writes directly. Write chat the same way, keyed on the command's action_id so a
    // retry after a lost response re-sends the same id and the insert no-ops (exactly-once, no double-post).
    // Membership, the rate limit (20 per 30 s) and the command receipt are all handled inside allin_chat: one round
    // trip instead of four, which is what made a burst of sends crawl on the hosted stack.
    const result = { ok: true };
    const r = await this.db.rpc<{ ok: boolean; error?: string }>('allin_chat', { table_id: tableId, user_id: player.id, body, action_id: receipt.action_id, auth_uid: authUid, receipt: { ...receipt, result } });
    if (!r.ok) {
      if (r.error === 'not_member') bad(403, 'not_member', 'Join the table first');
      if (r.error === 'rate_limited') bad(429, 'rate_limited', 'Slow down a little');
      bad(500, 'chat_failed', 'Could not send that, please try again');
    }
    return { result };
  }

  async react(player: Player, receipt: Receipt, tableId: string, p: { messageId?: unknown; emoji?: unknown; op?: unknown }, authUid: string): Promise<HandlerResult> {
    if (!isUuid(tableId)) bad(400, 'bad_table', 'Unknown table');
    if (!isReaction(p.emoji)) bad(400, 'bad_emoji', 'Pick a reaction');
    const messageId = Number(p.messageId);
    if (!Number.isInteger(messageId) || messageId <= 0) bad(400, 'bad_message', 'Unknown message');
    const op = p.op === 'remove' ? 'remove' : 'add';
    // only a member of this table may react (keeps reactions private to the table, like chat)
    const member = await this.db.select('table_members', { table_id: tableId, user_id: player.id, status: 'active' }, { limit: 1 });
    if (!member.length) bad(403, 'not_member', 'Join the table first');
    await this.rateLimit(authUid, 'react', 60, 30, 'Slow down a little');
    await this.db.rpc('allin_react', { table_id: tableId, message_id: messageId, user_id: player.id, emoji: p.emoji, op });
    // react does not pass through allin_commit (no game state), so record its receipt here for replay protection
    const result = { ok: true };
    await this.db.rpc('allin_receipt', { ...receipt, result });
    return { result };
  }

  async transferHost(player: Player, receipt: Receipt, tableId: string, p: { playerId?: unknown }): Promise<HandlerResult> {
    const r = await this.withTable(tableId, receipt, (L) => {
      this.requireHost(L, player);
      const target = String(p.playerId);
      if (seatOf(L.t, target) === -1) bad(404, 'not_seated', 'That player is not here');
      transferHost(L.t, target, L.now);
      return { effects: [], result: { ok: true }, extras: { touch: player.id, members: [{ user_id: target, role: 'host' }, { user_id: player.id, role: 'player' }] } };
    });
    return { result: r.result };
  }

  /** Timer job: resolve due deadlines for one table. Idempotent. */
  async runTable(tableId: string): Promise<{ ok: boolean; version?: number }> {
    try {
      const r = await this.withTable(tableId, null, () => ({ effects: [], result: null }));
      void r;
      return { ok: true };
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'archived' || e.code === 'not_found')) return { ok: true };
      throw e;
    }
  }

  // unused import guard
  static _types(): [typeof isChipInt, TableState | null] { return [isChipInt, null]; }
}
