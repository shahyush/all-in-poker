import { useEffect, useState } from 'react';
import { Page, Spinner, fmt, KV } from '../components/ui.tsx';
import { useSession } from '../state/session.tsx';
import type { ParticipantRow } from '../state/table.ts';
import type { TableRules } from '@allin/engine/public';
import { ordinal } from '../table/Seat.tsx';

interface Row { id: string; name: string; mode: string; status: string; created_at: string; archived_at: string | null; config: TableRules; summary: { tournament?: { winnerPlayerId: string | null; eliminations: { playerId: string; place: number }[] }; legacy?: boolean } | null }

export function HistoryPage({ go }: { go: (to: string) => void }) {
  const s = useSession();
  const [rows, setRows] = useState<(Row & { me: ParticipantRow | null })[] | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const parts = await s.transport.query<ParticipantRow & { table_id: string }>('session_participants', { user_id: s.player!.id });
        const ids = parts.map((p) => p.table_id);
        const tables = ids.length ? await s.transport.query<Row>('tables', { id: ids }, { order: 'created_at', asc: false }) : [];
        setRows(tables.map((t) => ({ ...t, me: parts.find((p) => p.table_id === t.id) ?? null })));
      } catch { setRows([]); }
    })();
  }, [s.transport, s.player]);
  return (
    <Page back="Lobby" onBack={() => go('/')}>
      <div className="stack" style={{ gap: 8 }}><div className="eyebrow">Your history</div><h1>My evenings</h1></div>
      {rows === null ? <Spinner /> : rows.length === 0 ? <p className="lead">No evenings yet. Host a table or open an invite.</p> : (
        <div>
          {rows.map((r) => {
            const live = !r.archived_at;
            const net = r.me ? Number(r.me.taken_off) + Number(r.me.final_stack ?? 0) * (live ? 0 : 1) - Number(r.me.added) : 0;
            const place = r.me?.place ?? null;
            return (
              <button type="button" key={r.id} className="list-row" style={{ width: '100%', textAlign: 'left' }} onClick={() => go((live ? '/table/' : '/session/') + r.id)}>
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}><span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{r.name}</span><span className="fine">{new Date(r.created_at).toLocaleDateString([], { day: 'numeric', month: 'short' })} · {r.mode === 'cash' ? 'Cash' : 'Tournament'}{live ? ' · in progress' : r.status === 'abandoned' ? ' · abandoned' : ''}</span></span>
                <span style={{ fontWeight: 700, color: r.mode === 'cash' && !live && net < 0 ? 'var(--danger)' : 'inherit' }}>{live ? 'Open' : r.mode === 'cash' ? `${net > 0 ? '+' : ''}${fmt(net)}` : place ? ordinal(place) : '—'}</span>
              </button>
            );
          })}
        </div>
      )}
    </Page>
  );
}

export function SessionPage({ tableId, go }: { tableId: string; go: (to: string) => void }) {
  const s = useSession();
  const [row, setRow] = useState<Row | null>(null);
  const [parts, setParts] = useState<ParticipantRow[]>([]);
  const [hands, setHands] = useState<{ hand_no: number; results: { variant: string; players: { name: string; won: number; folded: boolean; shown: number[] | null; revealed: number[] }[]; board: number[]; boards: number[][] | null; result: { uncontested: boolean } } }[]>([]);
  const [showHands, setShowHands] = useState(false);
  useEffect(() => {
    let stop = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async (): Promise<void> => {
      tries += 1;
      const t = await s.transport.query<Row>('tables', { id: tableId });
      if (stop) return;
      setRow(t[0] ?? null);
      const p = await s.transport.query<ParticipantRow>('session_participants', { table_id: tableId });
      if (stop) return;
      setParts(p);
      setHands(await s.transport.query('hand_history', { table_id: tableId }, { order: 'hand_no', asc: false, limit: 100 }) as never);
      // Wait for the confirmed exit: a player who just left reaches this summary a beat before the boundary writes their
      // taken-off figure. Keep re-fetching (briefly) until this viewer's own row shows left_at, or the table is archived.
      const mine = p.find((x) => x.user_id === s.player!.id);
      const settled = !!(t[0]?.archived_at) || !!mine?.left_at;
      if (!settled && !stop && tries < 10) timer = setTimeout(() => void load().catch(() => undefined), 2000);
    };
    void load().catch(() => setRow(null));
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [s.transport, tableId]);
  if (!row) return <Page back="History" onBack={() => go('/history')}><Spinner /></Page>;
  const me = parts.find((p) => p.user_id === s.player!.id);
  const cash = row.mode === 'cash';
  const net = (p: ParticipantRow) => Number(p.taken_off) + Number(p.final_stack ?? 0) * (row.archived_at ? 0 : 1) - Number(p.added);
  return (
    <Page back="History" onBack={() => go('/history')}>
      <div className="stack" style={{ gap: 8 }}><div className="eyebrow">{new Date(row.created_at).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })} · {cash ? 'Cash' : 'Tournament'}{row.status === 'abandoned' ? ' · abandoned' : ''}</div><h1>{row.name}</h1></div>
      {me && cash && <KV rows={[['Chips added', fmt(Number(me.added))], ['Chips taken off', fmt(Number(me.taken_off))], ['Net', `${net(me) > 0 ? '+' : ''}${fmt(net(me))}`]]} />}
      {me && !cash && <KV rows={[['Your place', me.place ? ordinal(me.place) : row.status === 'abandoned' ? 'Unfinished' : '—']]} />}
      <div>
        <div className="eyebrow" style={{ padding: '8px 0' }}>{cash ? 'Everyone' : 'Final standings'}</div>
        {parts.slice().sort((a, b) => cash ? net(b) - net(a) : (a.place ?? 99) - (b.place ?? 99)).map((p) => <div className="kv" key={p.user_id}><span style={{ color: 'inherit' }}>{!cash && p.place ? `${ordinal(p.place)} · ` : ''}{p.name}{p.user_id === s.player!.id ? ' (you)' : ''}</span><span>{cash ? `${net(p) > 0 ? '+' : ''}${fmt(net(p))}` : p.place === 1 ? 'Winner' : ''}</span></div>)}
      </div>
      <button type="button" className="btn btn-secondary" onClick={() => setShowHands(!showHands)}>{showHands ? 'Hide hands' : `Hands (${hands.length})`}</button>
      {showHands && hands.map((h) => <div key={h.hand_no} className="card-box" style={{ gap: 4 }}><b>Hand {h.hand_no} · {h.results.variant}</b><span className="fine">{h.results.players.filter((p) => p.won > 0).map((p) => `${p.name} +${fmt(p.won)}`).join(', ') || '—'}{h.results.result?.uncontested ? ' · everyone else folded' : ''}</span></div>)}
      <p className="fine">{cash ? 'Net = chips taken off + final stack − chips added. Settled nets across everyone sum to zero.' : 'Tournament chips are not play-chip profit or loss.'}</p>
    </Page>
  );
}
