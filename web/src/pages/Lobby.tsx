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
  const [checking, setChecking] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true; setLoadError(false);
    (async () => {
      try {
        const mem = await s.transport.query<{ table_id: string; status: string }>('table_members', { user_id: s.player!.id, status: 'active' });
        const ids = mem.map((m) => m.table_id);
        const rows = ids.length ? await s.transport.query<TableRow>('tables', { id: ids }) : [];
        if (live) setTables(rows.filter((r) => !r.archived_at));
      } catch { if (live) { setTables([]); setLoadError(true); } }
    })();
    return () => { live = false; };
  }, [s.transport, s.player, retry]);
  async function joinByCode(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length !== 8) { setError('Invite codes have 8 letters and numbers'); return; }
    if (checking) return;
    setChecking(true);
    try { await s.transport.cmd('preview', { code: c }); go('/join/' + c); }
    catch (err) { setError(err instanceof TransportError ? err.message : 'Could not check that code'); }
    finally { setChecking(false); }
  }
  const active = !!tables?.length;
  return (
    <Page>
      <div className="stack" style={{ gap: 8 }}>
        <div className="eyebrow">Good to see you, {s.player!.name}</div>
        <h1>{active ? 'Your tables.' : 'Shall we deal you in?'}</h1>
      </div>
      {tables === null ? <Spinner /> : tables.map(table => (
        <button key={table.id} type="button" className="btn btn-primary" style={{ flexDirection: 'column', alignItems: 'flex-start', padding: 16, minHeight: 0, gap: 4 }} onClick={() => go('/table/' + table.id)}>
          <span className="eyebrow" style={{ color: 'inherit', opacity: 0.85 }}>{table.status === 'waiting' ? 'Waiting room' : 'In play'}</span>
          <span style={{ fontFamily: 'var(--display)', fontSize: 22, fontWeight: 400 }}>{table.name}</span>
          <span style={{ fontSize: 14, fontWeight: 500 }}>{rulesSummary(table.config).slice(0, 2).join(' · ')} · {table.state.seats.filter(Boolean).length} seated</span>
        </button>
      ))}
      {loadError && <div className="notice" role="alert">Could not check your current table. <button className="btn btn-quiet" onClick={() => setRetry(n => n + 1)}>Try again</button></div>}
      <div className="grid2">
        <button type="button" className="btn btn-secondary" onClick={() => go('/create')} disabled={loadError || tables === null}>Host a table</button>
        <button type="button" className="btn btn-secondary" onClick={() => go('/history')}>History</button>
      </div>
      <form className="card-box" onSubmit={joinByCode}>
        <Field label="Join with an invite code" value={code} onChange={setCode} placeholder="e.g. K7PX2M9Q" autoComplete="off" error={error} />
        <button className="btn btn-secondary" type="submit" disabled={checking || loadError || tables === null} aria-busy={checking}>{checking ? 'Checking invite…' : 'See the table'}</button>
      </form>
      <button type="button" className="btn btn-quiet" style={{ alignSelf: 'flex-start' }} onClick={() => go('/profile')}>Profile</button>
    </Page>
  );
}
