import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from './errors.ts';

export interface AuthContext { authUid: string }
export interface Authenticator { verify(authorization: string | null): Promise<AuthContext> }

/** Production: verify the user's JWT through Supabase Auth with the service client. */
export class SupabaseAuthenticator implements Authenticator {
  private client: SupabaseClient;
  constructor(url: string, serviceKey: string) { this.client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }); }
  async verify(authorization: string | null): Promise<AuthContext> {
    const token = (authorization ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!token) throw new ApiError(401, 'unauthenticated', 'Sign-in required');
    const { data, error } = await this.client.auth.getUser(token);
    if (error || !data.user) throw new ApiError(401, 'unauthenticated', 'Session expired, please reopen the app');
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
