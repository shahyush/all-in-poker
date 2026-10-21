// All In — asset store behind the private repository.
//   GET  /code/<name>      serves public.app_assets 'edge/<name>' (the hash-pinned API bundle imported by the `api` function)
//   POST /code/upload      upserts assets; authenticated by a one-time upload token (sha256 kept in app_settings.upload_token_sha)
// Only the service role (this function) can read or write app_assets; clients never touch it.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const TYPES: Record<string, string> = { js: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8', txt: 'text/plain; charset=utf-8' };
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (bytes: Uint8Array) => hex(await crypto.subtle.digest('SHA-256', bytes));
const b64decode = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function upload(req: Request): Promise<Response> {
  const token = req.headers.get('x-allin-upload') ?? '';
  if (!token) return json(401, { ok: false, error: 'missing token' });
  const { data: setting } = await client.from('app_settings').select('value').eq('key', 'upload_token_sha').limit(1);
  const expected = setting?.[0]?.value ?? '';
  const got = await sha256(new TextEncoder().encode(token));
  if (!expected || !timingSafeEqual(got, expected)) return json(403, { ok: false, error: 'bad token' });
  let body: { files?: { path: string; body: string; encoding?: string; sha256: string }[]; prune?: string } = {};
  try { body = await req.json(); } catch { return json(400, { ok: false, error: 'json body required' }); }
  const files = Array.isArray(body.files) ? body.files : [];
  if (files.length > 64) return json(400, { ok: false, error: 'too many files' });
  const written: string[] = [];
  for (const f of files) {
    if (typeof f.path !== 'string' || !/^(web|edge)\/[a-z0-9][a-z0-9._\/-]{0,200}$/i.test(f.path) || f.path.includes('..')) return json(400, { ok: false, error: `bad path ${String(f.path)}` });
    const encoding = f.encoding === 'base64' ? 'base64' : 'utf8';
    const bytes = encoding === 'base64' ? b64decode(f.body) : new TextEncoder().encode(f.body);
    if (bytes.byteLength > 2_000_000) return json(413, { ok: false, error: `too large ${f.path}` });
    const sha = await sha256(bytes);
    if (sha !== f.sha256) return json(400, { ok: false, error: `sha mismatch ${f.path}: ${sha}` });
    const { error } = await client.from('app_assets').upsert({ path: f.path, body: f.body, encoding, updated_at: new Date().toISOString() }, { onConflict: 'path' });
    if (error) return json(500, { ok: false, error: error.message });
    written.push(f.path);
  }
  // prune: remove 'web/' assets not in this upload (hashed bundles from older releases), never 'edge/'
  if (body.prune === 'web' && written.length) {
    const { data: all } = await client.from('app_assets').select('path').like('path', 'web/%');
    const stale = (all ?? []).map((r) => r.path as string).filter((p) => !written.includes(p));
    if (stale.length) await client.from('app_assets').delete().in('path', stale);
  }
  return json(200, { ok: true, written });
}

Deno.serve(async (req: Request) => {
  const name = new URL(req.url).pathname.replace(/^\/code\/?/, '').replace(/^\/+/, '');
  if (req.method === 'POST') return name === 'upload' ? upload(req) : new Response('Not found', { status: 404 });
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('GET only', { status: 405 });
  if (!/^[a-z0-9][a-z0-9._-]{0,120}$/i.test(name)) return new Response('Not found', { status: 404 });
  const { data, error } = await client.from('app_assets').select('body, updated_at').eq('path', `edge/${name}`).limit(1);
  if (error) return new Response('Storage error', { status: 500 });
  if (!data?.length) return new Response('Not found', { status: 404 });
  const ext = name.split('.').pop() ?? 'txt';
  return new Response(req.method === 'HEAD' ? null : data[0].body, {
    status: 200,
    headers: { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable', 'x-asset-updated': data[0].updated_at },
  });
});
