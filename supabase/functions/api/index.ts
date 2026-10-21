// All In — game API. Deno Edge Function entry. The server itself is runtime-agnostic (see server/src) and is bundled by
// `npm run bundle:function` into ./bundle/server.js. The deployed function imports the same bundle (hash-pinned) from the
// `code` function, which serves it out of public.app_assets because the repository is private.
// Local/CI deploys may instead import './bundle/server.js' directly; both files carry the same sha256.
import { App, RestDb, SupabaseAuthenticator } from 'https://vlnkslhmmbkkvbpvzuiw.supabase.co/functions/v1/code/server.js?sha=4598de2ed203bf3b7053bf4ec537884da0401d1b559bb08dd4f8f873cc6a7457';

const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = new RestDb(url, serviceKey);
const auth = new SupabaseAuthenticator(url, serviceKey);
const app = new App(db, auth, {
  groupPassword: Deno.env.get('GROUP_PASSWORD') ?? undefined,
  corsOrigin: Deno.env.get('ALLIN_APP_ORIGIN') ?? `${new URL(url).origin},https://shahyush.github.io`,
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
