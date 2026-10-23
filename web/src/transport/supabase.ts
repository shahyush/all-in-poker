import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

const MIRROR_KEY = 'allin.auth.mirror';
import { TransportError, type QueryOpts, type Row, type Transport, type Unsubscribe, type Where } from './types.ts';

/** Production transport: anonymous Supabase Auth session, Edge Function commands, PostgREST reads under RLS, Realtime change notifications. */
export class SupabaseTransport implements Transport {
  readonly mode = 'supabase' as const;
  client: SupabaseClient;
  private fnUrl: string;
  private watching = false;
  private lastAuthError: string | null = null;
  constructor(private url: string, private key: string) {
    this.client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'allin.auth' }, realtime: { params: { eventsPerSecond: 20 } } });
    this.fnUrl = url.replace(/\/$/, '') + '/functions/v1/api';
  }
  /** Mirror of the current tokens, kept in our own storage so a session auth-js drops (seen on iOS Safari) can be restored
   *  with the same identity instead of silently creating a new anonymous player. */
  private mirror(): { access_token: string; refresh_token: string } | null {
    try { const raw = localStorage.getItem(MIRROR_KEY); return raw ? (JSON.parse(raw) as { access_token: string; refresh_token: string }) : null; } catch { return null; }
  }
  private watch(): void {
    if (this.watching) return;
    this.watching = true;
    this.client.auth.onAuthStateChange((event, session) => {
      try {
        if (session?.access_token && session.refresh_token) { localStorage.setItem(MIRROR_KEY, JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token })); this.setRealtimeAuth(session.access_token); }
        else if (event === 'SIGNED_OUT') localStorage.removeItem(MIRROR_KEY);
      } catch { /* storage unavailable: nothing to mirror */ }
    });
  }
  private async restore(): Promise<Session | null> {
    const m = this.mirror();
    if (!m) return null;
    const { data, error } = await this.client.auth.setSession({ access_token: m.access_token, refresh_token: m.refresh_token }).catch((e: Error) => ({ data: { session: null }, error: e }));
    if (data.session) { this.lastAuthError = null; this.setRealtimeAuth(data.session.access_token); return data.session; }
    this.lastAuthError = error?.message ?? 'restore failed';
    try { localStorage.removeItem(MIRROR_KEY); } catch { /* ignore */ }
    return null;
  }
  private setRealtimeAuth(token: string | undefined): void {
    try { if (token) this.client.realtime.setAuth(token); } catch { /* realtime optional */ }
  }
  async ensureSession(): Promise<string> {
    this.watch();
    const { data, error } = await this.client.auth.getSession();
    if (data.session?.user) { this.setRealtimeAuth(data.session.access_token); return data.session.user.id; }
    if (error) this.lastAuthError = error.message;
    const restored = await this.restore();
    if (restored?.user) return restored.user.id;
    const r = await this.client.auth.signInAnonymously();
    if (r.error || !r.data.user) throw new TransportError('auth', r.error?.message ?? 'Could not start a session', 401);
    this.setRealtimeAuth(r.data.session?.access_token);
    return r.data.user.id;
  }
  async signOut(): Promise<void> { try { localStorage.removeItem(MIRROR_KEY); } catch { /* ignore */ } await this.client.auth.signOut(); }
  private async token(): Promise<string> {
    this.watch();
    const first = await this.client.auth.getSession();
    if (first.data.session) return first.data.session.access_token;
    if (first.error) this.lastAuthError = first.error.message;
    // auth-js returned no session: try a refresh, then our mirrored tokens. Never mint a new anonymous identity here:
    // that would detach an admitted player from their device without telling them.
    const refreshed = await this.client.auth.refreshSession().catch((e: Error) => ({ data: { session: null }, error: e }));
    if (refreshed.data.session) return refreshed.data.session.access_token;
    if (refreshed.error) this.lastAuthError = refreshed.error.message;
    const restored = await this.restore();
    if (restored) return restored.access_token;
    throw new TransportError('unauthenticated', `Your session was lost on this device${this.lastAuthError ? ` (${this.lastAuthError})` : ''}. Reload the app; if your player is gone, restore it with your player code.`, 401);
  }
  async cmd<T>(type: string, payload: Record<string, unknown> = {}, tableId?: string, actionId = crypto.randomUUID()): Promise<T> {
    const token = await this.token();
    let r: Response;
    try {
      r = await fetch(this.fnUrl + '/cmd', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token, apikey: this.key }, body: JSON.stringify({ actionId, type, tableId, payload }), signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      if ((e as Error)?.name === 'TimeoutError') throw new TransportError('timeout', 'The server did not answer. Check your connection and try again.', 0);
      throw new TransportError('network', 'No connection. Check your network and try again.', 0);
    }
    let j: { ok: boolean; result?: T; error?: { code: string; message: string }; correlationId?: string };
    try { j = await r.json(); } catch { throw new TransportError('bad_response', 'Unexpected reply from the server', r.status); }
    if (!j.ok) throw new TransportError(j.error?.code ?? 'error', j.error?.message ?? 'Request failed', r.status, j.correlationId);
    return j.result as T;
  }
  async query<T extends Row>(table: string, where: Where, opts: QueryOpts = {}): Promise<T[]> {
    let q = this.client.from(table).select('*');
    for (const [k, v] of Object.entries(where)) q = Array.isArray(v) ? q.in(k, v) : v === null ? q.is(k, null) : q.eq(k, v as never);
    if (opts.order) q = q.order(opts.order, { ascending: opts.asc !== false });
    if (opts.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) throw new TransportError(error.code ?? 'query', error.message, 400);
    return (data ?? []) as T[];
  }
  subscribe(table: string, tableId: string, cb: () => void): Unsubscribe {
    const filter = table === 'tables' ? `id=eq.${tableId}` : `table_id=eq.${tableId}`;
    const ch = this.client.channel(`t:${table}:${tableId}:${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table, filter }, () => cb())
      .subscribe((status) => { if (status === 'SUBSCRIBED') cb(); });
    // safety poll: realtime can drop events; a slow poll keeps the view honest without being the primary driver
    const poll = setInterval(cb, 5000);
    return () => { clearInterval(poll); this.client.removeChannel(ch); };
  }
  async heartbeat(tableId: string): Promise<void> {
    await this.client.rpc('heartbeat', { t: tableId }).then(() => undefined, () => undefined);
  }
  async serverNow(): Promise<number> {
    const { data, error } = await this.client.rpc('allin_now');
    if (error || typeof data !== 'number') return Date.now();
    return Number(data);
  }
}
