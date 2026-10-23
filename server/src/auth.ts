import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from './errors.ts';

export interface AuthContext { authUid: string }
export interface Authenticator { verify(authorization: string | null): Promise<AuthContext> }

/** Production: verify the user's JWT through Supabase Auth with the service client. */
export class SupabaseAuthenticator implements Authenticator {
  private client: SupabaseClient;
  // Verified tokens are remembered for a short while inside this isolate (bounded), so a warm isolate answers the
  // same player's next commands without a round trip to Auth. The first use of a token is always verified by Auth.
  private cache = new Map<string, { uid: string; until: number }>();
  constructor(url: string, serviceKey: string) { this.client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }); }
  async verify(authorization: string | null): Promise<AuthContext> {
    const token = (authorization ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!token) throw new ApiError(401, 'unauthenticated', 'Sign-in required');
    const hit = this.cache.get(token);
    if (hit && hit.until > Date.now()) return { authUid: hit.uid };
    const { data, error } = await this.client.auth.getUser(token);
    if (error || !data.user) throw new ApiError(401, 'unauthenticated', 'Session expired, please reopen the app');
    // cache no longer than the token itself lives (exp claim), capped at five minutes; drop the oldest beyond 200 entries
    let exp = 0; try { exp = Number(JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))).exp) * 1000; } catch { exp = 0; }
    const until = Math.min(Date.now() + 5 * 60_000, exp || Date.now() + 60_000);
    if (this.cache.size >= 200) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(token, { uid: data.user.id, until });
    return { authUid: data.user.id };
  }
}

/** Development/test only: trusts an explicit header. Never used by the Edge Function. */
export class DevAuthenticator implements Authenticator {
  async verify(authorization: string | null): Promise<AuthContext> {
    const token = (authorization ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!/^dev:[0-9a-f-]{36}$/.test(token)) throw new ApiError(401, 'unauthenticated', 'Sign-in required');
    return { authUid: token.slice(4) };
  }
}
