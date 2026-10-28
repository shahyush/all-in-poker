import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SessionProvider, useSession} from '../src/state/session';
import {TablePage} from '../src/table/TablePage';
import {makeTable, start} from '../../engine/test/helpers';
import {publicView} from '../../engine/src/table';
import type {TableView} from '../src/state/table';
import '../src/theme.css';
function Probe() {
  const session = useSession();
  const [version, setVersion] = useState(1);
  const [state] = useState(() => {
    const {t, now, ctx} = makeTable([1000,1000,1000], {}, Date.now());
    start(t, now, ctx);
    t.hand!.actor = 0;
    t.hand!.actionReadyAt = now;
    t.hand!.deadline = now + 15000;
    return publicView(t, now);
  });
  (window as any).publishActionVersion = setVersion;
  if (!session.player) return null;
  const row = {id:'review', version, state, name:'Feedback', status:'running', mode:'cash', config:state.rules, invite_code:'review', host_id:'p0', archived_at:null, summary:null};
  const view = {row, members:[], chat:[], reactions:[], reloads:[], ledger:[], participants:[], own:null, loaded:true, connected:true, error:null, reload:async()=>{}} as TableView;
  return <TablePage view={view} go={()=>{}}/>;
}
export function renderActionProbe() {createRoot(document.getElementById('root')!).render(<SessionProvider><Probe/></SessionProvider>);}
