import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { TransportError, type QueryOpts, type Row, type Transport, type Unsubscribe, type Where } from './types.ts';

/** Production transport: anonymous Supabase Auth session, Edge Function commands, PostgREST reads under RLS, Realtime change notifications. */
export class SupabaseTransport implements Transport {
  readonly mode = 'supabase' as const;
  client: SupabaseClient;
  private fnUrl: string;
  constructor(private url: string, private key: string) {
    this.client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'allin.auth' }, realtime: { params: { eventsPerSecond: 20 } } });
    this.fnUrl = url.replace(/\/$/, '') + '/functions/v1/api';
  }
  async ensureSession(): Promise<string> {
    const { data } = await this.client.auth.getSession();
    if (data.session?.user) return data.session.user.id;
    const r = await this.client.auth.signInAnonymously();
    if (r.error || !r.data.user) throw new TransportError('auth', r.error?.message ?? 'Could not start a session', 401);
    return r.data.user.id;
  }
  async signOut(): Promise<void> { await this.client.auth.signOut(); }
  private async token(): Promise<string> {
    const { data } = await this.client.auth.getSession();
    if (!data.session) throw new TransportError('unauthenticated', 'Session expired', 401);
    return data.session.access_token;
  }
  async cmd<T>(type: string, payload: Record<string, unknown> = {}, tableId?: string, actionId = crypto.randomUUID()): Promise<T> {
    const token = await this.token();
    let r: Response;
    try {
      r = await fetch(this.fnUrl + '/cmd', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token, apikey: this.key }, body: JSON.stringify({ actionId, type, tableId, payload }) });
    } catch { throw new TransportError('network', 'No connection. Check your network and try again.', 0); }
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
