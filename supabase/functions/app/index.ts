// All In — hosts the PWA at https://<project>.supabase.co/functions/v1/app/ from public.app_assets ('web/<path>').
// Static files only; hashed assets are immutable, the shell (index.html, sw.js, manifest) is always revalidated.
// Unknown paths fall back to index.html so the in-app router can handle /t/<table>, /join/<code> and friends.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8', png: 'image/png', svg: 'image/svg+xml', ico: 'image/x-icon', txt: 'text/plain; charset=utf-8',
  woff2: 'font/woff2', woff: 'font/woff',
};
const b64decode = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const cache = new Map<string, { body: Uint8Array | string; encoding: string; updated: string }>();

async function load(path: string) {
  const hit = cache.get(path);
  if (hit && !/^web\/(index\.html|sw\.js|manifest\.webmanifest)$/.test(path)) return hit;
  const { data, error } = await client.from('app_assets').select('body, encoding, updated_at').eq('path', path).limit(1);
  if (error || !data?.length) return null;
  const row = data[0];
  const entry = { body: row.encoding === 'base64' ? b64decode(row.body) : row.body, encoding: row.encoding, updated: row.updated_at };
  cache.set(path, entry);
  return entry;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('GET only', { status: 405 });
  const u = new URL(req.url);
  let rel = u.pathname.replace(/^\/app\/?/, '').replace(/^\/+/, '');
  if (u.pathname === '/app') return Response.redirect(`${u.origin}/functions/v1/app/`, 301);
  if (rel.includes('..') || !/^[a-z0-9._\/-]*$/i.test(rel)) return new Response('Not found', { status: 404 });
  let entry = rel ? await load(`web/${rel}`) : null;
  let isShell = false;
  if (!entry && !/\.[a-z0-9]+$/i.test(rel)) { entry = await load('web/index.html'); rel = 'index.html'; isShell = true; }
  if (!entry) return new Response('Not found', { status: 404 });
  const ext = rel.split('.').pop() ?? '';
  const immutable = rel.startsWith('assets/');
  return new Response(req.method === 'HEAD' ? null : entry.body, {
    status: 200,
    headers: {
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
      ...(isShell || rel === 'index.html' ? { 'referrer-policy': 'same-origin' } : {}),
    },
  });
});
