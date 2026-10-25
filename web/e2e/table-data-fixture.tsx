import React from 'react';
import { createRoot } from 'react-dom/client';
import { SessionProvider } from '../src/state/session.tsx';
import { useTable } from '../src/state/table.ts';
function Probe() {
  const view = useTable('review');
  return <><output id="messages">{JSON.stringify(view.chat.map(m => m.id))}</output><output id="reactions">{JSON.stringify(view.reactions.map(r => r.id))}</output></>;
}
export function renderProbe() { createRoot(document.getElementById('root')!).render(<SessionProvider><Probe /></SessionProvider>); }
