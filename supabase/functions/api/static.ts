// All In — game API, standard entry: imports the committed bundle directly. Used by `supabase functions deploy api`
// (supabase/config.toml points here). index.ts is the equivalent entry for deployments that cannot ship the bundle file.
import { App, RestDb, SupabaseAuthenticator } from './bundle/server.js';
import { serve } from './serve.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = new RestDb(url, serviceKey);
serve(Promise.resolve(new App(db, new SupabaseAuthenticator(url, serviceKey), await corsEnv(db))));

async function corsEnv(d: InstanceType<typeof RestDb>) {
  // allowed browser origins: env wins, else app_settings.app_origins (comma list), else the project origin only
  const fromDb = (await d.select('app_settings', { key: 'app_origins' }, { limit: 1 }).catch(() => []))[0]?.value as string | undefined;
  return { groupPassword: Deno.env.get('GROUP_PASSWORD') ?? undefined, corsOrigin: Deno.env.get('ALLIN_APP_ORIGIN') ?? fromDb ?? new URL(url).origin };
}
