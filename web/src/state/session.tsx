import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createTransport, TransportError, type Transport } from '../transport/index.ts';

export interface Player { id: string; name: string; avatar: string | null; isOwner: boolean }
interface SessionState { ready: boolean; player: Player | null; authUid: string | null; error: string | null }
interface SessionApi extends SessionState {
  transport: Transport;
  refresh(): Promise<void>;
  setPlayer(p: Player | null): void;
  clockOffset: number; // serverNow - Date.now()
  toast(msg: string): void;
  toastMsg: string | null;
}

const Ctx = createContext<SessionApi | null>(null);
const transport = createTransport();

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ ready: false, player: null, authUid: null, error: null });
  const [clockOffset, setClockOffset] = useState(0);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const uid = await transport.ensureSession();
      const me = await transport.cmd<{ player: Player | null }>('me');
      setState({ ready: true, player: me.player, authUid: uid, error: null });
    } catch (e) {
      setState({ ready: true, player: null, authUid: null, error: e instanceof TransportError ? e.message : 'Could not reach the server' });
    }
  }, []);
  useEffect(() => {
    void refresh();
    let cancelled = false;
    const sync = async () => { const t0 = Date.now(); const s = await transport.serverNow().catch(() => null); if (s && !cancelled) { const t1 = Date.now(); setClockOffset(s - (t0 + t1) / 2); } };
    void sync();
    const id = setInterval(sync, 120_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [refresh]);
  const toast = useCallback((msg: string) => { setToastMsg(msg); setTimeout(() => setToastMsg((m) => (m === msg ? null : m)), 2600); }, []);
  const api = useMemo<SessionApi>(() => ({ ...state, transport, refresh, setPlayer: (player) => setState((s) => ({ ...s, player })), clockOffset, toast, toastMsg }), [state, refresh, clockOffset, toast, toastMsg]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
export function useSession(): SessionApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('SessionProvider missing');
  return v;
}
