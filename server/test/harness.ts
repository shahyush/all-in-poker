import { App } from '../src/app.ts';
import { PgDb } from '../src/db-postgres.ts';
import { DevAuthenticator } from '../src/auth.ts';
import { execSync } from 'node:child_process';

export const DB_URL = process.env.ALLIN_DB_URL ?? 'postgres://postgres@127.0.0.1:54329/allin_test';
export const GROUP_PASSWORD = 'friday-night';
export const JOB_KEY = 'test-job-key';

export function resetDb(): void {
  execSync('./scripts/local-db-reset.sh', { cwd: new URL('../..', import.meta.url).pathname, stdio: 'ignore' });
}

export class Client {
  authUid = '';
  player: { id: string; name: string } | null = null;
  constructor(public app: App, public db: PgDb) {}
  async signIn(): Promise<void> {
    this.authUid = crypto.randomUUID();
    await this.db.sql.unsafe('insert into auth.users (id) values ($1)', [this.authUid]);
  }
  async raw(type: string, payload: Record<string, unknown> = {}, tableId?: string, actionId = crypto.randomUUID()) {
    const r = await this.app.handle({ method: 'POST', path: '/cmd', headers: { authorization: 'Bearer dev:' + this.authUid }, body: { actionId, type, tableId, payload } });
    return { status: r.status, body: r.body as { ok: boolean; result?: unknown; error?: { code: string; message: string }; replayed?: boolean }, actionId };
  }
  async cmd<T = Record<string, unknown>>(type: string, payload: Record<string, unknown> = {}, tableId?: string): Promise<T> {
    const r = await this.raw(type, payload, tableId);
    if (!r.body.ok) throw new Error(`${type} failed ${r.status} ${r.body.error?.code}: ${r.body.error?.message}`);
    return r.body.result as T;
  }
  async admit(name: string, password = GROUP_PASSWORD): Promise<void> {
    const r = await this.cmd<{ player: { id: string; name: string } }>('admit', { nickname: name, password });
    this.player = r.player;
  }
  /** Read a table as this identity would through PostgREST (RLS enforced). */
  async see<T = Record<string, unknown>>(table: string, where: Record<string, unknown>): Promise<T[]> {
    return this.db.selectAs<T>(this.authUid, table, where);
  }
  async heartbeat(tableId: string): Promise<void> {
    await this.db.sql.begin(async (tx) => {
      await tx.unsafe(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: this.authUid, role: 'authenticated' })]);
      await tx.unsafe('set local role authenticated');
      await tx.unsafe('select public.heartbeat($1::uuid)', [tableId]);
    });
  }
}

export interface World { db: PgDb; app: App; clients: Client[]; runJobs: (ids?: string[]) => Promise<unknown>; publicState: (tableId: string) => Promise<any>; privateState: (tableId: string) => Promise<any>; advanceClock: (ms: number) => Promise<void>; close: () => Promise<void> }

export async function world(n: number, names?: string[]): Promise<World> {
  const db = new PgDb(DB_URL);
  const app = new App(db, new DevAuthenticator(), { groupPassword: GROUP_PASSWORD, jobKey: JOB_KEY });
  const clients: Client[] = [];
  for (let i = 0; i < n; i++) { const c = new Client(app, db); await c.signIn(); await c.admit(names?.[i] ?? `Player${i + 1}`); clients.push(c); }
  return {
    db, app, clients,
    runJobs: (ids?: string[]) => app.handle({ method: 'POST', path: '/jobs', headers: { 'x-allin-job': JOB_KEY }, body: ids ? { tableIds: ids } : {} }).then((r) => r.body),
    publicState: async (tableId) => (await db.select<{ state: unknown }>('tables', { id: tableId }))[0]?.state,
    privateState: async (tableId) => (await db.select<{ secret: unknown }>('table_secrets', { table_id: tableId }))[0]?.secret,
    // Tests cannot move the database clock; instead they rewind stored deadlines so that "now" is past them.
    advanceClock: async (ms) => {
      await db.sql.unsafe(`update public.table_secrets set secret = public.allin_shift_time(secret, $1::bigint)`, [-ms as never]);
      await db.sql.unsafe(`update public.tables set due_at = due_at - make_interval(secs => $1::double precision / 1000.0) where due_at is not null`, [ms]);
    },
    close: () => db.end(),
  };
}
