// All In — game API. Deno Edge Function entry. The server itself is runtime-agnostic (see server/src), bundled into ./bundle/server.js.
import { App, RestDb, SupabaseAuthenticator } from './bundle/server.js';

const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = new RestDb(url, serviceKey);
const auth = new SupabaseAuthenticator(url, serviceKey);
const app = new App(db, auth, {
  groupPassword: Deno.env.get('GROUP_PASSWORD') ?? undefined,
  corsOrigin: Deno.env.get('ALLIN_APP_ORIGIN') ?? 'https://shahyush.github.io',
});

Deno.serve(async (req: Request) => {
  const u = new URL(req.url);
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  let body: unknown = null;
  if (req.method === 'POST') { try { body = await req.json(); } catch { body = {}; } }
  const r = await app.handle({ method: req.method, path: u.pathname, headers, body });
  return new Response(r.body === null ? null : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...(r.headers ?? {}) } });
});
