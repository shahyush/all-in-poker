import { useState } from 'react';
import { KV, Page, Sheet } from '../components/ui.tsx';
import { useSession } from '../state/session.tsx';
import type { TableView } from '../state/table.ts';
import { rulesRows } from '../lib/format.ts';
import { absoluteUrl } from '../state/router.tsx';
import { TransportError } from '../transport/index.ts';
import { fmt } from '../components/ui.tsx';

export function WaitingPage({ view, go }: { view: TableView; go: (to: string) => void }) {
  const s = useSession();
  const row = view.row!; const st = row.state;
  const me = s.player!;
  const isHost = st.hostPlayerId === me.id;
  const seated = st.seats.map((x, i) => ({ x, i })).filter((q) => q.x);
  const funded = seated.filter((q) => q.x!.stack > 0).length;
  const canStart = funded >= 2;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);
  const inviteUrl = absoluteUrl('/join/' + row.invite_code);
  async function run(type: string, payload: Record<string, unknown> = {}) {
    setBusy(true); setErr(null);
    try { await s.transport.cmd(type, payload, row.id); await view.reload(); return true; }
    catch (e) { setErr(e instanceof TransportError ? e.message : 'Something went wrong'); return false; }
    finally { setBusy(false); }
  }
  async function share() {
    const text = `Join my All In table "${row.name}": ${inviteUrl} (code ${row.invite_code})`;
    try {
      if (navigator.share) { await navigator.share({ title: 'All In', text, url: inviteUrl }); return; }
      await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch { /* cancelled share is not a success */ }
  }
  const hostName = st.seats.find((x) => x && x.playerId === st.hostPlayerId)?.name ?? 'The host';
  return (
    <Page back="Lobby" onBack={() => go('/')}>
      <div className="stack" style={{ gap: 8 }}>
        <div className="eyebrow">{row.mode === 'cash' ? 'Cash table · play chips' : 'Last player standing'}</div>
        <h1>{row.name}</h1>
        <p className="lead">{canStart ? (isHost ? 'Everyone here is ready when you are.' : `${hostName} starts the game. Your seat and chips are saved.`) : 'Waiting for one more player.'}</p>
      </div>
      <div>
        {seated.map(({ x, i }) => (
          <div className="list-row" key={i}>
            <span className="row" style={{ minWidth: 0 }}><span className="avatar" aria-hidden="true">{x!.name.slice(0, 1).toUpperCase()}</span><span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}><span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{x!.name}{x!.playerId === me.id ? ' (you)' : ''}</span><span className="fine">{x!.playerId === st.hostPlayerId ? 'Host' : `Seat ${i + 1}`}</span></span></span>
            <span className="row"><span style={{ fontWeight: 600 }}>{fmt(x!.stack)}</span>{isHost && x!.playerId !== me.id && <button type="button" className="btn btn-quiet" onClick={() => setRemoveTarget({ id: x!.playerId, name: x!.name })}>Remove</button>}</span>
          </div>
        ))}
        {Array.from({ length: st.seats.length - seated.length }).map((_, k) => <div className="list-row" key={'e' + k} style={{ borderBottomStyle: 'dashed', color: 'var(--muted)', fontSize: 14 }}><span>Open seat</span></div>)}
      </div>
      <KV rows={rulesRows(row.config)} />
      {isHost && (
        <div className="stack" style={{ gap: 6 }}>
          <button type="button" className="btn btn-primary" disabled={!canStart || busy} aria-busy={busy} onClick={() => run('start')}>{busy ? 'Starting…' : 'Start the game'}</button>
          {!canStart && <div className="fine" style={{ textAlign: 'center' }}>Needs two players with chips.</div>}
        </div>
      )}
      {err && <div className="error" role="alert">{err}</div>}
      <div className="card-box">
        <div className="eyebrow">Invite</div>
        <div className="code">{row.invite_code}</div>
        <div className="fine" style={{ overflowWrap: 'anywhere' }}>{inviteUrl}</div>
        <div className="grid2">
          <button type="button" className="btn btn-secondary" onClick={share}>{copied ? 'Copied' : typeof navigator.share === 'function' ? 'Share invite' : 'Copy invite'}</button>
          <button type="button" className="btn btn-secondary" onClick={async () => { try { await navigator.clipboard.writeText(inviteUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* unsupported */ } }}>Copy link</button>
        </div>
      </div>
      <button type="button" className="btn btn-danger" onClick={() => setConfirmLeave(true)}>Leave the room</button>
      {confirmLeave && (
        <Sheet title="Leave the room?" onClose={() => setConfirmLeave(false)}>
          {err && <div className="error" role="alert">{err}</div>}
          <p className="lead">Your buy-in comes back to you as chips taken off. {isHost && seated.length > 1 ? 'Hosting passes to the next player.' : ''}</p>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={async () => { if (await run('leave')) { setConfirmLeave(false); go('/'); } }}>Leave</button>
          <button type="button" className="btn btn-secondary" onClick={() => setConfirmLeave(false)}>Stay</button>
        </Sheet>
      )}
      {removeTarget && (
        <Sheet title={`Remove ${removeTarget.name}?`} onClose={() => setRemoveTarget(null)}>
          {err && <div className="error" role="alert">{err}</div>}
          <p className="lead">They keep their history. Their chips are recorded as taken off.</p>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={async () => { if (await run('remove', { playerId: removeTarget.id })) setRemoveTarget(null); }}>Remove</button>
          <button type="button" className="btn btn-secondary" onClick={() => setRemoveTarget(null)}>Keep</button>
        </Sheet>
      )}
    </Page>
  );
}
