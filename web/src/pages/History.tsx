import { useEffect, useState } from 'react';
import { Page, Spinner, fmt, KV } from '../components/ui.tsx';
import { useSession } from '../state/session.tsx';
import type { LedgerRow, ParticipantRow } from '../state/table.ts';
import type { TableRules } from '@allin/engine/public';
import { ordinal } from '../table/Seat.tsx';

interface Row { id: string; name: string; mode: string; status: string; created_at: string; archived_at: string | null; config: TableRules; summary: { tournament?: { winnerPlayerId: string | null; eliminations: { playerId: string; place: number }[] }; legacy?: boolean } | null; state?: { seats: ({ playerId: string; stack: number; leaving?: boolean } | null)[]; hand: { players: { seat: number; bet: number }[] } | null } | null }

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

type Status = 'playing' | 'leaving' | 'finished';
interface Account { userId: string; name: string; isMe: boolean; buyin: number; rebuys: number; added: number; takenOff: number; stack: number; committed: number; inPlay: number; net: number; status: Status; leftAt: string | null; place: number | null }
const statusLabel: Record<Status, string> = { playing: 'Playing', leaving: 'Leaving', finished: 'Finished' };
const sign = (n: number) => `${n > 0 ? '+' : ''}${fmt(n)}`;

export function SessionPage({ tableId, go }: { tableId: string; go: (to: string) => void }) {
  const s = useSession();
  const [row, setRow] = useState<Row | null>(null);
  const [parts, setParts] = useState<ParticipantRow[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [hands, setHands] = useState<{ hand_no: number; results: { variant: string; players: { name: string; won: number; folded: boolean; shown: number[] | null; revealed: number[] }[]; board: number[]; boards: number[][] | null; result: { uncontested: boolean } } }[]>([]);
  const [showHands, setShowHands] = useState(false);
  useEffect(() => {
    let stop = false; let tries = 0; let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async (): Promise<void> => {
      tries += 1;
      const t = await s.transport.query<Row>('tables', { id: tableId });
      if (stop) return; setRow(t[0] ?? null);
      const p = await s.transport.query<ParticipantRow>('session_participants', { table_id: tableId });
      if (stop) return; setParts(p);
      try { setLedger(await s.transport.query<LedgerRow>('ledger', { table_id: tableId }, { order: 'id' })); } catch { /* keep */ }
      setHands(await s.transport.query('hand_history', { table_id: tableId }, { order: 'hand_no', asc: false, limit: 100 }) as never);
      // keep re-fetching briefly until this viewer's own exit is written (it lands a beat after they leave) or all settled
      const mine = p.find((x) => x.user_id === s.player!.id);
      const done = !!t[0]?.archived_at || !!mine?.left_at;
      if (!done && !stop && tries < 10) timer = setTimeout(() => void load().catch(() => undefined), 2000);
    };
    void load().catch(() => setRow(null));
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [s.transport, tableId]);
  if (!row) return <Page back="History" onBack={() => go('/history')}><Spinner /></Page>;
  const cash = row.mode === 'cash';
  const seats = row.state?.seats ?? [];
  const liveHand = row.state?.hand ?? null;
  const seatIdx = (pid: string) => seats.findIndex((x) => x && x.playerId === pid);

  // Build each player's account from the ledger (the traceable record): the first buy-in, later rebuys, and withdrawals.
  // A still-seated player's remaining chips come from the live table state, never from session_participants (which only
  // records a final stack at cash-out). Chips at the table are never treated as a loss — they are counted in net.
  const account = (p: ParticipantRow): Account => {
    const mine = ledger.filter((l) => l.user_id === p.user_id);
    const bs = mine.filter((l) => l.kind === 'buyin').sort((a, b) => a.id - b.id);
    const buyin = Number(bs[0]?.amount ?? 0);
    const rebuys = bs.slice(1).reduce((a, l) => a + Number(l.amount), 0);
    const added = bs.reduce((a, l) => a + Number(l.amount), 0) || Number(p.added);
    const takenOff = mine.filter((l) => l.kind === 'exit').reduce((a, l) => a + Number(l.amount), 0) || Number(p.taken_off);
    const i = seatIdx(p.user_id);
    const seated = i >= 0;
    const stack = seated ? Number(seats[i]!.stack) : 0;
    const committed = seated ? (liveHand?.players.find((pl) => pl.seat === i)?.bet ?? 0) : 0;
    const inPlay = stack + committed;
    const status: Status = p.left_at ? 'finished' : seated && seats[i]!.leaving ? 'leaving' : seated ? 'playing' : 'finished';
    return { userId: p.user_id, name: p.name, isMe: p.user_id === s.player!.id, buyin, rebuys, added, takenOff, stack, committed, inPlay, net: takenOff + inPlay - added, status, leftAt: p.left_at, place: p.place };
  };
  const accounts = parts.map(account);
  const mine = accounts.find((a) => a.isMe) ?? null;
  const others = accounts.filter((a) => !a.isMe);
  const settled = !cash || !!row.archived_at || accounts.every((a) => a.status === 'finished');
  const allNets = accounts.reduce((t, a) => t + a.net, 0);
  const totalAdded = accounts.reduce((t, a) => t + a.added, 0);
  const totalOff = accounts.reduce((t, a) => t + a.takenOff, 0);
  const totalIn = accounts.reduce((t, a) => t + a.inPlay, 0);
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');

  return (
    <Page back="History" onBack={() => go('/history')}>
      <div className="stack" style={{ gap: 8 }}><div className="eyebrow">{new Date(row.created_at).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })} · {cash ? 'Cash' : 'Tournament'}{row.status === 'abandoned' ? ' · abandoned' : ''}</div><h1>{row.name}</h1></div>

      {/* My own result — complete and fixed once I have left, provisional while I am still playing. */}
      {mine && cash && (
        <div className="card-box" style={{ gap: 8 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="eyebrow" style={{ margin: 0 }}>Your result{mine.status === 'finished' ? '' : ' so far'}</div>
            <span className={`acct-tag ${mine.status}`}>{mine.status === 'leaving' ? 'Leaving after this hand' : statusLabel[mine.status]}</span>
          </div>
          <KV rows={[
            ['Buy-in', fmt(mine.buyin)],
            ...(mine.rebuys > 0 ? [['Rebuys', fmt(mine.rebuys)] as [string, string]] : []),
            ['Total added', fmt(mine.added)],
            ['Chips taken off', fmt(mine.takenOff)],
            ...(mine.status !== 'finished' ? [['Still at the table', fmt(mine.inPlay)] as [string, string]] : []),
            [mine.status === 'finished' ? 'Net' : 'Net so far', sign(mine.net)],
            ...(mine.leftAt ? [['Left at', when(mine.leftAt)] as [string, string]] : []),
          ]} />
          {mine.status === 'leaving' && <p className="fine">You are leaving after this hand — your result becomes final once it settles.</p>}
          {mine.status === 'playing' && <p className="fine">Provisional: chips still in front of you are counted, not lost.</p>}
        </div>
      )}
      {mine && !cash && <KV rows={[['Your place', mine.place ? ordinal(mine.place) : row.status === 'abandoned' ? 'Unfinished' : '—']]} />}

      {/* Everyone else — clearly separated, each marked Playing / Leaving / Finished; active results are provisional. */}
      {others.length > 0 && (
        <div>
          <div className="eyebrow" style={{ padding: '8px 0' }}>{cash ? 'Table accounts' : 'Final standings'}</div>
          {others.slice().sort((a, b) => cash ? b.net - a.net : (a.place ?? 99) - (b.place ?? 99)).map((a) => (
            <div className="kv" key={a.userId} style={{ alignItems: 'flex-start' }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span>{!cash && a.place ? `${ordinal(a.place)} · ` : ''}{a.name} <span className={`acct-tag ${a.status}`}>{statusLabel[a.status]}</span></span>
                {cash && a.status !== 'finished' && <span className="fine">added {fmt(a.added)} · stack {fmt(a.stack)}{a.committed ? ` · ${fmt(a.committed)} in this hand` : ''}</span>}
                {cash && a.status === 'finished' && <span className="fine">added {fmt(a.added)} · took off {fmt(a.takenOff)}</span>}
              </span>
              {cash && <span style={{ textAlign: 'right', fontWeight: 600, color: a.net < 0 ? 'var(--danger)' : 'inherit' }}>{sign(a.net)}<br /><span className="fine" style={{ fontWeight: 400 }}>{a.status === 'finished' ? 'final' : 'provisional'}</span></span>}
              {!cash && <span style={{ fontWeight: 600 }}>{a.place === 1 ? 'Winner' : ''}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Whole-table reconciliation: during play, chips account across withdrawals + stacks; settled, all nets are zero. */}
      {cash && (
        <div className="card-box" style={{ gap: 6 }}>
          {settled
            ? <div className="row" style={{ justifyContent: 'space-between' }}><b>Settled</b><span style={{ fontWeight: 700 }}>all nets {sign(allNets)}</span></div>
            : <div className="row" style={{ justifyContent: 'space-between' }}><b>In progress</b><span className="fine">final once everyone cashes out</span></div>}
          <div className="kv" style={{ padding: '4px 0' }}><span className="fine">Added</span><span className="fine">{fmt(totalAdded)}</span></div>
          <div className="kv" style={{ padding: '4px 0' }}><span className="fine">Taken off + still at the table</span><span className="fine">{fmt(totalOff)} + {fmt(totalIn)} = {fmt(totalOff + totalIn)}</span></div>
          {!settled && totalOff + totalIn !== totalAdded && <p className="error">Chips do not reconcile — tell the host.</p>}
        </div>
      )}

      <button type="button" className="btn btn-secondary" onClick={() => setShowHands(!showHands)}>{showHands ? 'Hide hands' : `Hands (${hands.length})`}</button>
      {showHands && hands.map((h) => <div key={h.hand_no} className="card-box" style={{ gap: 4 }}><b>Hand {h.hand_no} · {h.results.variant}</b><span className="fine">{h.results.players.filter((p) => p.won > 0).map((p) => `${p.name} +${fmt(p.won)}`).join(', ') || '—'}{h.results.result?.uncontested ? ' · everyone else folded' : ''}</span></div>)}
      <p className="fine">{cash ? 'Net = chips taken off + chips still at the table − chips added. Each amount comes from the recorded buy-ins, rebuys and withdrawals. All nets sum to zero once everyone has cashed out.' : 'Tournament chips are not play-chip profit or loss.'}</p>
    </Page>
  );
}
