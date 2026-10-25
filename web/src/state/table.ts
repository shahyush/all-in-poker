import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PublicTable, Card, TableRules } from '@allin/engine/public';
import { coalescedRefresh } from './refresh.ts';
import { useSession } from './session.tsx';

export interface TableRow { id: string; name: string; status: string; mode: string; config: TableRules; invite_code: string; host_id: string; version: number; state: PublicTable; archived_at: string | null; summary: unknown }
export interface MemberRow { user_id: string; role: string; seat: number | null; status: string; last_seen: string | null; joined_at: string }
export interface ChatRow { id: number; user_id: string; body: string; created_at: string }
export interface ReactionRow { id: number; message_id: number; user_id: string; emoji: string; created_at: string }
export interface ReloadRow { id: string; user_id: string; amount: number; status: string; requested_at: string; decided_at: string | null; credited_hand_no: number | null }
export interface LedgerRow { id: number; user_id: string; kind: string; amount: number; hand_no: number; created_at: string }
export interface ParticipantRow { user_id: string; name: string; added: number; taken_off: number; final_stack: number | null; place: number | null; left_at: string | null }
export interface OwnCards { handId: string; cards: Card[] }

export interface TableView {
  row: TableRow | null;
  members: MemberRow[];
  chat: ChatRow[];
  reactions: ReactionRow[];
  reloads: ReloadRow[];
  ledger: LedgerRow[];
  participants: ParticipantRow[];
  own: OwnCards | null;
  error: string | null;
  loaded: boolean;
  reload(scope?: 'game' | 'chat' | 'all'): Promise<void>;
  connected: boolean;
}

/** Live table subscription: public row + own cards + chat + reloads + ledger, refreshed on realtime signals. */
export function useTable(tableId: string): TableView {
  const s = useSession();
  const t = s.transport;
  const [row, setRow] = useState<TableRow | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [chat, setChat] = useState<ChatRow[]>([]);
  const [reactions, setReactions] = useState<ReactionRow[]>([]);
  const [reloads, setReloads] = useState<ReloadRow[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [own, setOwn] = useState<OwnCards | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [connected, setConnected] = useState(true);
  const ownRef = useRef<OwnCards | null>(null);
  const versionRef = useRef(-1);
  const stateRef = useRef<PublicTable | null>(null);

  const loadTable = useMemo(() => coalescedRefresh(async () => {
    try {
      let rows = await t.query<TableRow>('tables', { id: tableId });
      if (!rows.length) {
        // An empty read can be transient (a token refresh mid-flight, a cold read). "gone" navigates away and resets
        // everything on screen — an open sheet, a half-typed chat message — so confirm it with a second read first.
        await new Promise((res) => setTimeout(res, 900));
        rows = await t.query<TableRow>('tables', { id: tableId });
        if (!rows.length) { setError('unavailable'); setConnected(false); setLoaded(true); return; }
      }
      const r = rows[0];
      // never regress to an older version (out-of-order delivery)
      if (r.version < versionRef.current) return;
      versionRef.current = r.version;
      stateRef.current = r.state;
      setRow(previous => previous?.version === r.version && previous.archived_at === r.archived_at ? previous : r);
      setError(null); setLoaded(true); setConnected(true);
    } catch { setConnected(false); setLoaded(true); }
  }), [t, tableId]);
  const loadOwn = useMemo(() => coalescedRefresh(async () => {
    const currentHand = stateRef.current?.hand;
    if (currentHand && ownRef.current?.handId === currentHand.id) return;
    try {
      const rows = await t.query<{ hand_id: string; cards: number[] }>('hole_cards', { table_id: tableId, user_id: s.player!.id });
      ownRef.current = rows.length ? { handId: rows[0].hand_id, cards: rows[0].cards } : null;
      setOwn(ownRef.current);
    } catch { /* keep last */ }
  }), [t, tableId, s.player]);
  const loadMembers = useMemo(() => coalescedRefresh(async () => { try { setMembers(await t.query<MemberRow>('table_members', { table_id: tableId })); } catch { /* ignore */ } }), [t, tableId]);
  const loadChat = useMemo(() => coalescedRefresh(async () => { try { setChat((await t.query<ChatRow>('chat_messages', { table_id: tableId }, { order: 'id', asc: false, limit: 200 })).reverse()); } catch { /* keep the last successful chat */ } }), [t, tableId]);
  const loadReactions = useMemo(() => coalescedRefresh(async () => { try { setReactions(await t.query<ReactionRow>('chat_reactions', { table_id: tableId }, { order: 'id', asc: false, limit: 1000 })); } catch { /* ignore */ } }), [t, tableId]);
  const loadReloads = useMemo(() => coalescedRefresh(async () => { try { setReloads(await t.query<ReloadRow>('reload_requests', { table_id: tableId }, { order: 'requested_at' })); } catch { /* ignore */ } }), [t, tableId]);
  const loadLedger = useMemo(() => coalescedRefresh(async () => {
    try { setLedger(await t.query<LedgerRow>('ledger', { table_id: tableId }, { order: 'id' })); setParticipants(await t.query<ParticipantRow>('session_participants', { table_id: tableId })); } catch { /* ignore */ }
  }), [t, tableId]);
  const reload = useCallback(async (scope: 'game' | 'chat' | 'all' = 'all') => {
    if (scope === 'chat') { await Promise.all([loadChat(), loadReactions()]); return; }
    await loadTable();
    await loadOwn();
    if (scope === 'all') await Promise.all([loadMembers(), loadChat(), loadReactions(), loadReloads(), loadLedger()]);
  }, [loadTable, loadOwn, loadMembers, loadChat, loadReactions, loadReloads, loadLedger]);

  useEffect(() => {
    versionRef.current = -1;
    void reload();
    const subs = [
      t.subscribe('tables', tableId, () => { void reload('game'); }, { pollMs: 0 }),
      t.subscribe('ledger', tableId, loadLedger, { pollMs: 15000 }),
      t.subscribe('session_participants', tableId, loadLedger, { pollMs: 0 }),
      t.subscribe('hole_cards', tableId, loadOwn, { pollMs: 0 }),
      t.subscribe('chat_messages', tableId, loadChat),
      t.subscribe('chat_reactions', tableId, loadReactions),
      t.subscribe('reload_requests', tableId, loadReloads),
      t.subscribe('table_members', tableId, loadMembers, { pollMs: 10000 }),
    ];
    // Adaptive poll: realtime postgres_changes are not guaranteed on every network/host, and the game has windows
    // shorter than any safe fixed poll (4 s dealer's choice, 3 s reveal). Poll fast while a short window or the local
    // player's turn is live, slow when idle. Realtime (above) still delivers instantly when it works; this is the floor.
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const pollInterval = (): number => {
      const st = stateRef.current;
      if (!st) return 2000;
      if (st.status !== 'running' && st.status !== 'waiting') return 6000;
      if (st.status === 'waiting') return 1500;
      const h = st.hand;
      if (!h) return 2500;
      if (h.phase === 'choice' || h.phase === 'vote' || h.phase === 'offer' || h.phase === 'runout' || h.phase === 'result') return 700;
      if (h.phase === 'betting') {
        const mySeat = st.seats.findIndex((x) => x && x.playerId === s.player!.id);
        return h.actor === mySeat ? 600 : 1000;
      }
      return 2000;
    };
    const pollLoop = () => {
      if (disposed) return;
      pollTimer = setTimeout(async () => { if (document.visibilityState === 'visible' && navigator.onLine) await reload('game'); pollLoop(); }, pollInterval());
    };
    pollLoop();
    const heartbeat = coalescedRefresh(async () => { if (document.visibilityState === 'visible' && navigator.onLine) await t.heartbeat(tableId); });
    const hb = setInterval(() => { void heartbeat(); }, 10_000);
    void heartbeat();
    const vis = () => { if (document.visibilityState === 'visible') { void reload(); void heartbeat(); } };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('online', vis);
    window.addEventListener('focus', vis);
    return () => { disposed = true; subs.forEach((u) => u()); if (pollTimer) clearTimeout(pollTimer); clearInterval(hb); document.removeEventListener('visibilitychange', vis); window.removeEventListener('online', vis); window.removeEventListener('focus', vis); };
  }, [t, tableId, reload, loadTable, loadOwn, loadChat, loadReactions, loadReloads, loadMembers, loadLedger]);

  return { row, members, chat, reactions, reloads, ledger, participants, own, error, loaded, reload, connected };
}

/** Server-clock aware ticking value (re-renders at ~4Hz while a deadline is pending). */
export function useNow(active: boolean, offset: number): number {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now() + offset), 250);
    setNow(Date.now() + offset);
    return () => clearInterval(id);
  }, [active, offset]);
  return active ? now : Date.now() + offset;
}
