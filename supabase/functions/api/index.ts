// All In — game API, asset-store entry. The server is runtime-agnostic (server/src) and bundled by `npm run bundle:function`
// into ./bundle/server.js. This entry fetches that exact bundle (sha256-pinned) from the `code` function, which serves it
// out of public.app_assets, because the deploy path available in this environment cannot ship the bundle file itself.
// static.ts is the standard entry (direct import) used by `supabase functions deploy`.
import '@supabase/supabase-js';
import { serve } from './serve.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUNDLE_SHA = 'ac48c67ecc8343d3165549188fecbaf1eb7ebb4b3368e0d92365bf33c33196d5';
const BUNDLE_URL = `${url}/functions/v1/code/server.js?sha=${BUNDLE_SHA}`;

async function sha256(text: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

serve((async () => {
  const res = await fetch(BUNDLE_URL);
  if (!res.ok) throw new Error(`bundle fetch failed: ${res.status}`);
  const text = await res.text();
  const sha = await sha256(text);
  if (sha !== BUNDLE_SHA) throw new Error(`bundle sha mismatch: ${sha}`);
  const src = text.replaceAll('"@supabase/supabase-js"', '"npm:@supabase/supabase-js@2.118.0"');
  const mod = await import(`data:text/javascript;base64,${btoa(unescape(encodeURIComponent(src)))}`);
  const db = new mod.RestDb(url, serviceKey);
  const fromDb = (await db.select('app_settings', { key: 'app_origins' }, { limit: 1 }).catch(() => []))[0]?.value as string | undefined;
  return new mod.App(db, new mod.SupabaseAuthenticator(url, serviceKey), {
    groupPassword: Deno.env.get('GROUP_PASSWORD') ?? undefined,
    corsOrigin: Deno.env.get('ALLIN_APP_ORIGIN') ?? fromDb ?? new URL(url).origin,
  });
})());
