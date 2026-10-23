import { useEffect, useState } from 'react';
import { useSession } from './state/session.tsx';
import { onUpdateReady, applyUpdate } from './lib/pwa.ts';
import { useRoute } from './state/router.tsx';
import { EntryPage } from './pages/Entry.tsx';
import { LobbyPage } from './pages/Lobby.tsx';
import { CreatePage } from './pages/Create.tsx';
import { InvitePage } from './pages/Invite.tsx';
import { WaitingPage } from './pages/Waiting.tsx';
import { ProfilePage } from './pages/Profile.tsx';
import { HistoryPage, SessionPage } from './pages/History.tsx';
import { TablePage } from './table/TablePage.tsx';
import { useTable } from './state/table.ts';
import { Page, Spinner } from './components/ui.tsx';

function TableRoute({ id, go }: { id: string; go: (to: string, replace?: boolean) => void }) {
  const view = useTable(id);
  const s = useSession();
  useEffect(() => { if (view.error === 'gone') go('/', true); }, [view.error, go]);
  if (!view.loaded || !view.row) return <Page><Spinner label="Opening the table" /></Page>;
  const r = view.row;
  const seated = r.state.seats.some((x) => x && x.playerId === s.player!.id);
  if (r.archived_at || r.status === 'closed' || r.status === 'finished' || r.status === 'abandoned') return <SessionPage tableId={id} go={go} />;
  if (r.status === 'waiting') return <WaitingPage view={view} go={go} />;
  if (!seated && r.mode === 'cash') return <SessionPage tableId={id} go={go} />;
  return <TablePage view={view} go={go} />;
}

// Unobtrusive "a new build is ready" pill. Tapping it applies the waiting service worker and reloads into the fresh
// shell — the player chooses when, so an update never interrupts a hand. Without this, an installed PWA can run a stale
// build indefinitely (the new worker waits until every instance is closed).
function UpdatePrompt() {
  const [ready, setReady] = useState(false);
  useEffect(() => { onUpdateReady(() => setReady(true)); }, []);
  if (!ready) return null;
  return <button type="button" className="update-pill" onClick={() => applyUpdate()}>Update ready · tap to refresh</button>;
}

export default function App() {
  const s = useSession();
  const { path, go } = useRoute();
  useEffect(() => {
    const dest = sessionStorage.getItem('allin.dest');
    if (s.player && dest) { sessionStorage.removeItem('allin.dest'); go(dest, true); }
  }, [s.player, go]);
  const m = path.match(/^\/(join|table|session)\/([A-Za-z0-9-]+)$/);
  let page: React.ReactNode;
  if (!s.ready) page = <Page><Spinner /></Page>;
  else if (s.error && !s.player) page = <Page><h1>Can't reach the table.</h1><p className="lead">{s.error}</p><button type="button" className="btn btn-primary" onClick={() => void s.refresh()}>Try again</button></Page>;
  else if (!s.player) {
    if (path !== '/' && !sessionStorage.getItem('allin.dest')) sessionStorage.setItem('allin.dest', path);
    page = <EntryPage destination={path.startsWith('/join/') ? path : null} />;
  }
  else if (m?.[1] === 'join') page = <InvitePage code={m[2].toUpperCase()} go={go} />;
  else if (m?.[1] === 'table') page = <TableRoute id={m[2]} go={go} />;
  else if (m?.[1] === 'session') page = <SessionPage tableId={m[2]} go={go} />;
  else if (path === '/create') page = <CreatePage go={go} />;
  else if (path === '/profile') page = <ProfilePage go={go} />;
  else if (path === '/history') page = <HistoryPage go={go} />;
  else page = <LobbyPage go={go} />;
  return <>{page}<UpdatePrompt /></>;
}
