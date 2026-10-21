import { useEffect } from 'react';
import { useSession } from './state/session.tsx';
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

export default function App() {
  const s = useSession();
  const { path, go } = useRoute();
  useEffect(() => {
    const dest = sessionStorage.getItem('allin.dest');
    if (s.player && dest) { sessionStorage.removeItem('allin.dest'); go(dest, true); }
  }, [s.player, go]);
  if (!s.ready) return <Page><Spinner /></Page>;
  if (s.error && !s.player) return <Page><h1>Can't reach the table.</h1><p className="lead">{s.error}</p><button type="button" className="btn btn-primary" onClick={() => void s.refresh()}>Try again</button></Page>;
  if (!s.player) {
    if (path !== '/' && !sessionStorage.getItem('allin.dest')) sessionStorage.setItem('allin.dest', path);
    return <EntryPage destination={path.startsWith('/join/') ? path : null} />;
  }
  const m = path.match(/^\/(join|table|session)\/([A-Za-z0-9-]+)$/);
  if (m?.[1] === 'join') return <InvitePage code={m[2].toUpperCase()} go={go} />;
  if (m?.[1] === 'table') return <TableRoute id={m[2]} go={go} />;
  if (m?.[1] === 'session') return <SessionPage tableId={m[2]} go={go} />;
  if (path === '/create') return <CreatePage go={go} />;
  if (path === '/profile') return <ProfilePage go={go} />;
  if (path === '/history') return <HistoryPage go={go} />;
  return <LobbyPage go={go} />;
}
