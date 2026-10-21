import { useEffect, useState } from 'react';
import { Page, Field, Spinner } from '../components/ui.tsx';
import { useSession } from '../state/session.tsx';
import { rulesSummary } from '../lib/format.ts';
import type { TableRules } from '@allin/engine/public';
import { TransportError } from '../transport/index.ts';

interface TableRow { id: string; name: string; status: string; mode: string; config: TableRules; archived_at: string | null; state: { seats: unknown[]; hostPlayerId: string } }

export function LobbyPage({ go }: { go: (to: string) => void }) {
  const s = useSession();
  const [tables, setTables] = useState<TableRow[] | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const mem = await s.transport.query<{ table_id: string; status: string }>('table_members', { user_id: s.player!.id, status: 'active' });
        const ids = mem.map((m) => m.table_id);
        const rows = ids.length ? await s.transport.query<TableRow>('tables', { id: ids }) : [];
        if (live) setTables(rows.filter((r) => !r.archived_at));
      } catch { if (live) setTables([]); }
    })();
    return () => { live = false; };
  }, [s.transport, s.player]);
  async function joinByCode(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length !== 8) { setError('Invite codes have 8 letters and numbers'); return; }
    try { await s.transport.cmd('preview', { code: c }); go('/join/' + c); }
    catch (err) { setError(err instanceof TransportError ? err.message : 'Could not check that code'); }
  }
  const active = tables?.[0];
  return (
    <Page>
      <div className="stack" style={{ gap: 8 }}>
        <div className="eyebrow">Good to see you, {s.player!.name}</div>
        <h1>{active ? 'Your seat is live.' : 'Shall we deal you in?'}</h1>
      </div>
      {tables === null ? <Spinner /> : active ? (
        <button type="button" className="btn btn-primary" style={{ flexDirection: 'column', alignItems: 'flex-start', padding: 16, minHeight: 0, gap: 4 }} onClick={() => go('/table/' + active.id)}>
          <span className="eyebrow" style={{ color: 'inherit', opacity: 0.85 }}>{active.status === 'waiting' ? 'Waiting room' : 'In play'}</span>
          <span style={{ fontFamily: 'var(--display)', fontSize: 22, fontWeight: 400 }}>{active.name}</span>
          <span style={{ fontSize: 14, fontWeight: 500 }}>{rulesSummary(active.config).slice(0, 2).join(' · ')} · {active.state.seats.filter(Boolean).length} seated</span>
        </button>
      ) : null}
      <div className="grid2">
        <button type="button" className="btn btn-secondary" onClick={() => go('/create')} disabled={!!active}>Host a table</button>
        <button type="button" className="btn btn-secondary" onClick={() => go('/history')}>My evenings</button>
      </div>
      <form className="card-box" onSubmit={joinByCode}>
        <Field label="Join with an invite code" value={code} onChange={setCode} placeholder="e.g. K7PX2M9Q" autoComplete="off" error={error} />
        <button className="btn btn-secondary" type="submit" disabled={!!active}>See the table</button>
        {active && <p className="fine">Leave your current table before joining another.</p>}
      </form>
      <button type="button" className="btn btn-quiet" style={{ alignSelf: 'flex-start' }} onClick={() => go('/profile')}>Your player</button>
    </Page>
  );
}
