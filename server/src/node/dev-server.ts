/* Local development/test server: same App as production, direct Postgres, dev authentication, polling-friendly query endpoint.
   Never deployed. */
import http from 'node:http';
import { App } from '../app.ts';
import { PgDb } from '../db-postgres.ts';
import { DevAuthenticator } from '../auth.ts';

const DB_URL = process.env.ALLIN_DB_URL ?? 'postgres://postgres@127.0.0.1:54329/allin_dev';
const PORT = Number(process.env.ALLIN_PORT ?? 8787);
const JOB_KEY = process.env.ALLIN_JOB_KEY ?? 'dev-job-key';
const db = new PgDb(DB_URL);
const app = new App(db, new DevAuthenticator(), { groupPassword: process.env.ALLIN_GROUP_PASSWORD ?? 'friday-night', jobKey: JOB_KEY });

const QUERYABLE: Record<string, string[]> = {
  tables: ['id', 'invite_code'], table_members: ['table_id', 'user_id'], hole_cards: ['table_id', 'user_id'], chat_messages: ['table_id'], chat_reactions: ['table_id'],
  hand_history: ['table_id'], ledger: ['table_id'], reload_requests: ['table_id'], session_participants: ['table_id', 'user_id'], profiles: ['id'],
};

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const s = Buffer.concat(chunks).toString('utf8');
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v[0] : String(v ?? '');
  const send = (status: number, body: unknown, extra: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...app.cors(), ...extra });
    res.end(body === null ? '' : JSON.stringify(body));
  };
  try {
    if (req.method === 'OPTIONS') return send(204, null);
    if (url.pathname === '/dev/signin' && req.method === 'POST') {
      // emulate anonymous sign-in: create an auth user row
      const id = crypto.randomUUID();
      await db.sql.unsafe('insert into auth.users (id) values ($1)', [id]);
      return send(200, { token: 'dev:' + id, authUid: id });
    }
    if (url.pathname === '/dev/query' && req.method === 'POST') {
      // reads under the caller's RLS identity, like PostgREST would
      const token = (headers['authorization'] ?? '').replace(/^Bearer\s+/i, '');
      const authUid = token.startsWith('dev:') ? token.slice(4) : null;
      const body = (await readJson(req)) as { table: string; where: Record<string, unknown>; order?: string; asc?: boolean; limit?: number };
      const allowed = QUERYABLE[body.table];
      if (!allowed || !Object.keys(body.where ?? {}).every((k) => allowed.includes(k))) return send(400, { error: 'bad query' });
      const rows = await db.selectAs(authUid, body.table, body.where ?? {}, { order: body.order, asc: body.asc, limit: body.limit ?? 200 });
      return send(200, rows);
    }
    if (url.pathname === '/dev/heartbeat' && req.method === 'POST') {
      const token = (headers['authorization'] ?? '').replace(/^Bearer\s+/i, '');
      const authUid = token.startsWith('dev:') ? token.slice(4) : null;
      const body = (await readJson(req)) as { tableId: string };
      await db.sql.begin(async (tx) => {
        await tx.unsafe(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: authUid, role: 'authenticated' })]);
        await tx.unsafe('set local role authenticated');
        await tx.unsafe('select public.heartbeat($1::uuid)', [body.tableId]);
      });
      return send(200, { ok: true });
    }
    if (url.pathname === '/dev/now') return send(200, { now: Number(await db.rpc('allin_now', {})) });
    if (url.pathname === '/dev/shift' && req.method === 'POST') {
      // test-only: make stored deadlines look older so the job runner resolves them now
      const body = (await readJson(req)) as { ms: number };
      await db.sql.unsafe(`update public.table_secrets set secret = public.allin_shift_time(secret, $1::bigint)`, [-body.ms as never]);
      await db.sql.unsafe(`update public.tables set due_at = due_at - make_interval(secs => $1::double precision / 1000.0) where due_at is not null`, [body.ms as never]);
      return send(200, { ok: true });
    }
    const body = await readJson(req);
    const r = await app.handle({ method: req.method ?? 'GET', path: url.pathname, headers, body });
    return send(r.status, r.body, r.headers);
  } catch (e) {
    console.error(e);
    return send(500, { ok: false, error: { code: 'dev_server', message: (e as Error).message } });
  }
});

// local job ticker: emulates pg_cron + pg_net (every second, claim due tables and run them)
const ticker = setInterval(async () => {
  try { await app.handle({ method: 'POST', path: '/jobs', headers: { 'x-allin-job': JOB_KEY }, body: {} }); } catch (e) { console.error('ticker', (e as Error).message); }
}, Number(process.env.ALLIN_TICK_MS ?? 1000));

server.listen(PORT, '127.0.0.1', () => console.log(`allin dev server on http://127.0.0.1:${PORT}`));
process.on('SIGTERM', () => { clearInterval(ticker); server.close(); db.end(); });
