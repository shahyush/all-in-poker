import { TransportError, type QueryOpts, type Row, type Transport, type Unsubscribe, type Where } from './types.ts';

/** Local development transport against the Node dev server (polling instead of realtime). */
export class DevTransport implements Transport {
  readonly mode = 'dev' as const;
  private token: string | null = null;
  constructor(private base: string) {}
  private signingIn: Promise<string> | null = null;
  ensureSession(): Promise<string> {
    if (!this.signingIn) this.signingIn = this.startSession().finally(() => { this.signingIn = null; });
    return this.signingIn;
  }
  private async startSession(): Promise<string> {
    const saved = localStorage.getItem('allin.dev.token');
    if (saved) { this.token = saved; return saved.slice(4); }
    const r = await fetch(this.base + '/dev/signin', { method: 'POST' });
    const j = await r.json();
    this.token = j.token; localStorage.setItem('allin.dev.token', j.token);
    return j.authUid;
  }
  async signOut(): Promise<void> { localStorage.removeItem('allin.dev.token'); this.token = null; }
  async cmd<T>(type: string, payload: Record<string, unknown> = {}, tableId?: string, actionId = crypto.randomUUID()): Promise<T> {
    const r = await fetch(this.base + '/cmd', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.token }, body: JSON.stringify({ actionId, type, tableId, payload }) });
    const j = await r.json();
    if (!j.ok) throw new TransportError(j.error?.code ?? 'error', j.error?.message ?? 'Request failed', r.status, j.correlationId);
    return j.result as T;
  }
  async query<T extends Row>(table: string, where: Where, opts: QueryOpts = {}): Promise<T[]> {
    const r = await fetch(this.base + '/dev/query', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.token }, body: JSON.stringify({ table, where, ...opts }) });
    if (!r.ok) throw new TransportError('query', 'Query failed', r.status);
    return (await r.json()) as T[];
  }
  subscribe(table: string, tableId: string, cb: () => void): Unsubscribe {
    void table; void tableId;
    const id = setInterval(cb, 600);
    return () => clearInterval(id);
  }
  async heartbeat(tableId: string): Promise<void> {
    await fetch(this.base + '/dev/heartbeat', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.token }, body: JSON.stringify({ tableId }) }).catch(() => undefined);
  }
  async serverNow(): Promise<number> { const r = await fetch(this.base + '/dev/now'); return (await r.json()).now; }
}
