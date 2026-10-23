import { useState } from 'react';
import { Field, Page } from '../components/ui.tsx';
import { useSession, type Player } from '../state/session.tsx';
import { TransportError } from '../transport/index.ts';

export function EntryPage({ destination }: { destination: string | null }) {
  const s = useSession();
  const [name, setName] = useState(() => localStorage.getItem('allin.lastName') ?? '');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'enter' | 'restore'>('enter');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      if (mode === 'enter') {
        const r = await s.transport.cmd<{ player: Player }>('admit', { nickname: name, password });
        localStorage.setItem('allin.lastName', name.trim());
        s.setPlayer(r.player);
      } else {
        // after "forget" there is no auth session on this device; the command path never mints one on its own (that
        // could silently detach an admitted player), so establish the session explicitly before restoring by code
        await s.transport.ensureSession();
        const r = await s.transport.cmd<{ player: Player }>('recover', { code });
        s.setPlayer(r.player);
      }
    } catch (err) { setError(err instanceof TransportError ? err.message : 'Could not reach the server'); }
    finally { setBusy(false); }
  }
  return (
    <Page>
      <div className="stack" style={{ gap: 8 }}>
        <div className="eyebrow">{destination ? 'You are invited' : 'An evening with friends'}</div>
        <h1>{mode === 'enter' ? 'Your seat is waiting.' : 'Welcome back.'}</h1>
        <p className="lead">{mode === 'enter' ? 'Pick a nickname and enter the group password from your host.' : 'Enter the player code you saved earlier to pick up your player, history and seat.'}</p>
      </div>
      <form className="stack" onSubmit={submit}>
        {mode === 'enter' ? (
          <>
            <Field label="Your nickname" name="nickname" value={name} onChange={setName} placeholder="What your friends call you" autoComplete="nickname" maxLength={24} />
            <Field label="Group password" name="password" type="password" value={password} onChange={setPassword} placeholder="Shared by your host" autoComplete="current-password" />
          </>
        ) : (
          <Field label="Player code" name="code" value={code} onChange={setCode} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX" autoComplete="off" />
        )}
        {error && <div className="error" role="alert">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy}>{mode === 'enter' ? 'Continue' : 'Restore my player'}</button>
        <button className="btn btn-quiet" type="button" onClick={() => { setMode(mode === 'enter' ? 'restore' : 'enter'); setError(null); }} style={{ alignSelf: 'flex-start' }}>{mode === 'enter' ? 'I saved a player code' : 'Back to entry'}</button>
      </form>
      <p className="fine">No email or phone number. We keep your nickname, your play-chip records and what is needed to run the game. Play chips only, never money.</p>
    </Page>
  );
}
