import { useEffect, useMemo, useState } from 'react';
import { Field, KV, Page, Spinner, fmt } from '../components/ui.tsx';
import { useSession } from '../state/session.tsx';
import { parseChipAmount, type TableRules } from '@allin/engine/public';
import { rulesRows } from '../lib/format.ts';
import { TransportError } from '../transport/index.ts';

interface Preview { tableId: string; name: string; host: string; status: string; mode: string; rules: TableRules; seats: number; occupied: number; open: number; isMember: boolean }

export function InvitePage({ code, go, takingSeat = false }: { code: string; takingSeat?: boolean; go: (to: string, replace?: boolean) => void }) {
  const s = useSession();
  const [p, setP] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mult, setMult] = useState('1');
  const [busy, setBusy] = useState(false);
  const [intent, setIntent] = useState<'seat' | 'watch'>('seat');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setErr(null); setP(null);
    // A cold edge boot can fail the first preview with a transient server error; retry once before showing a dead end.
    const load = () => s.transport.cmd<Preview>('preview', { code });
    load().catch(() => new Promise((res) => setTimeout(res, 1500)).then(() => { if (cancelled) throw new Error('Cancelled'); return load(); }))
      .then((r) => { if (cancelled) return; setP(r); if (r.isMember && !takingSeat) go('/table/' + r.tableId, true); })
      .catch((e) => { if (!cancelled) setErr(e instanceof TransportError ? e.message : 'Could not load this invite'); });
    return () => { cancelled = true; };
  }, [code, s.transport, go, retry, takingSeat]);
  const unit = p?.rules.unit ?? 0;
  const m = parseChipAmount(mult);
  const total = m && m > 0 ? m * unit : null;
  const options = useMemo(() => [1, 2, 3, 5].map((k) => ({ k, label: fmt(k * unit) })), [unit]);
  async function join(watch = false) {
    if (!p || busy) return;
    setBusy(true); setIntent(watch ? 'watch' : 'seat'); setErr(null);
    try { const r = await s.transport.cmd<{ tableId: string }>('join', { code, watch, amount: total != null ? String(total) : '0' }); go('/table/' + r.tableId, true); }
    catch (e) { setErr(e instanceof TransportError ? e.message : 'Could not join'); setBusy(false); }
  }
  if (err && !p) return <Page back="Lobby" onBack={() => go('/')}><h1>Could not open the invite.</h1><p className="lead">{err}</p><button className="btn btn-primary" type="button" onClick={() => setRetry(n => n + 1)}>Try again</button><button className="btn btn-secondary" type="button" onClick={() => go('/')}>Back to the lobby</button></Page>;
  if (!p) return <Page><Spinner label="Opening your invite" /></Page>;
  const closed = p.status !== 'waiting' && p.status !== 'running';

  return (
    <Page back="Lobby" onBack={() => go('/')}>
      <div className="stack" style={{ gap: 8 }}>
        <div className="eyebrow">You're invited</div>
        <h1>{p.name}</h1>
        <p className="lead">{p.host} is hosting. {p.mode === 'cash' ? 'Pull up a seat.' : 'One bank each. Last player with chips wins.'}</p>
      </div>
      <KV rows={[['Format', p.mode === 'cash' ? 'Cash · play chips' : 'Last player standing'], ...rulesRows(p.rules), ['Seats open', `${p.open} of ${p.seats}`]]} />
      {closed ? <div className="notice">This table has ended. Nothing was charged.</div>
        : p.open <= 0 ? <div className="notice">The table is full. Ask {p.host} to tell you when a seat opens; nothing has been charged.</div>
        : (
          <div className="stack">
            {p.mode === 'cash' && (
              <>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Choose your buy-in</div>
                <div className="chips">{options.map((o) => <button key={o.k} type="button" className="chip" aria-pressed={mult === String(o.k)} onClick={() => setMult(String(o.k))}>{o.label}</button>)}</div>
                <Field label={`Or a number of ${fmt(unit)}-chip units`} inputMode="numeric" value={mult} onChange={setMult} error={m === null || m <= 0 ? 'Enter a whole number of units' : null} hint={total ? `Buy-in ${fmt(total)}` : undefined} />
              </>
            )}
            {err && <div className="error" role="alert">{err}{busy ? '' : <> · <button type="button" className="btn-quiet" style={{ minHeight: 'auto', padding: 0 }} onClick={() => void join(intent === 'watch')}>Try again</button></>}</div>}
            <button type="button" className="btn btn-primary" disabled={busy || (p.mode === 'cash' && !total)} onClick={() => void join()} aria-busy={busy}>{busy && intent === 'seat' ? 'Joining…' : p.mode === 'cash' ? `Join table · buy-in ${fmt(total ?? 0)}` : `Join game · ${fmt(unit)} chips`}</button>
            {busy && <p className="fine" role="status" aria-live="polite">{intent === 'watch' ? 'Opening the table…' : 'Taking your seat…'}</p>}
            <p className="fine">{p.status === 'running' ? 'Join between hands. The current hand stays unchanged.' : 'Play chips only.'}</p>
          </div>
        )}
      {!closed && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void join(true)}>{busy && intent === 'watch' ? 'Opening…' : 'Watch table'}</button>}
      {p.open <= 0 && err && <p className="error" role="alert">{err}</p>}
    </Page>
  );
}
