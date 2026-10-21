import { useState } from 'react';
import { Field, Page, Sheet } from '../components/ui.tsx';
import { useSession, type Player } from '../state/session.tsx';
import { TransportError } from '../transport/index.ts';

export function ProfilePage({ go }: { go: (to: string) => void }) {
  const s = useSession();
  const me = s.player!;
  const [name, setName] = useState(me.name);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rot, setRot] = useState<{ current: string; next: string } | null>(null);
  const [forget, setForget] = useState(false);
  const [saved, setSaved] = useState(false);
  async function save() {
    setBusy(true); setErr(null);
    try { const r = await s.transport.cmd<{ player: Player }>('profile', { name }); s.setPlayer(r.player); setSaved(true); setTimeout(() => setSaved(false), 2000); }
    catch (e) { setErr(e instanceof TransportError ? e.message : 'Could not save'); } finally { setBusy(false); }
  }
  async function makeCode() {
    setBusy(true); setErr(null);
    try { const r = await s.transport.cmd<{ code: string }>('recovery_create'); setCode(r.code); }
    catch (e) { setErr(e instanceof TransportError ? e.message : 'Could not create a code'); } finally { setBusy(false); }
  }
  return (
    <Page back="Lobby" onBack={() => go('/')}>
      <div className="stack" style={{ gap: 8 }}><div className="eyebrow">Your player</div><h1>{me.name}</h1></div>
      <div className="stack">
        <Field label="Nickname" value={name} onChange={setName} maxLength={24} error={err} />
        <button type="button" className="btn btn-secondary" disabled={busy || name.trim() === me.name} onClick={save}>{saved ? 'Saved' : 'Save nickname'}</button>
      </div>
      <div className="card-box">
        <div className="eyebrow">Save my player code</div>
        <p className="fine">A private code that restores this player, with its history and seat, on a new phone or after your browser data is cleared. We only keep a fingerprint of it, so it is shown once. Creating a new code cancels the old one.</p>
        {code ? (
          <div className="stack" style={{ gap: 8 }}>
            <div className="code" aria-label="Player code">{code}</div>
            <div className="grid2">
              <button type="button" className="btn btn-secondary" onClick={() => navigator.clipboard?.writeText(code)}>Copy</button>
              <button type="button" className="btn btn-secondary" onClick={() => { const a = document.createElement('a'); a.href = 'data:text/plain,' + encodeURIComponent(`All In player code for ${me.name}\n${code}\nKeep this private.`); a.download = 'all-in-player-code.txt'; a.click(); }}>Download</button>
            </div>
            <p className="fine">Keep it private. Anyone with this code can become you at the table.</p>
          </div>
        ) : <button type="button" className="btn btn-primary" disabled={busy} onClick={makeCode}>Create my player code</button>}
      </div>
      {me.isOwner && (
        <div className="card-box">
          <div className="eyebrow">Group password</div>
          <p className="fine">You set up this group. Changing the password locks out new entries with the old one; existing players keep their identities.</p>
          {rot ? (
            <div className="stack">
              <Field label="Current password" type="password" value={rot.current} onChange={(v) => setRot({ ...rot, current: v })} />
              <Field label="New password" type="password" value={rot.next} onChange={(v) => setRot({ ...rot, next: v })} hint="At least 6 characters" />
              <div className="grid2"><button type="button" className="btn btn-secondary" onClick={() => setRot(null)}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy || rot.next.length < 6} onClick={async () => { setBusy(true); try { await s.transport.cmd('rotate_password', rot); setRot(null); s.toast('Password changed'); } catch (e) { setErr(e instanceof TransportError ? e.message : 'Failed'); } finally { setBusy(false); } }}>Change</button></div>
            </div>
          ) : <button type="button" className="btn btn-secondary" onClick={() => setRot({ current: '', next: '' })}>Change the group password</button>}
        </div>
      )}
      <div className="card-box">
        <div className="eyebrow">Privacy</div>
        <p className="fine">No email, phone, contacts or location. We store your nickname, your player and session identifiers, your play-chip records and the hand history needed to run the game. Table chat is deleted when a table ends. Our hosting providers keep ordinary operational logs. Chips have no monetary value.</p>
      </div>
      <button type="button" className="btn btn-danger" onClick={() => setForget(true)}>Forget this player on this device</button>
      {forget && (
        <Sheet title="Forget this player here?" onClose={() => setForget(false)}>
          <p className="lead">This device will no longer be {me.name}. Without a saved player code there is no way back to this player, its history or chips. Leave any table first.</p>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={async () => { setBusy(true); try { await s.transport.cmd('forget'); await s.transport.signOut(); localStorage.removeItem('allin.lastName'); s.setPlayer(null); await s.refresh(); go('/'); } catch (e) { setErr(e instanceof TransportError ? e.message : 'Failed'); setForget(false); } finally { setBusy(false); } }}>Forget</button>
          <button type="button" className="btn btn-secondary" onClick={() => setForget(false)}>Keep</button>
        </Sheet>
      )}
      {s.toastMsg && <div className="toast" role="status">{s.toastMsg}</div>}
    </Page>
  );
}
