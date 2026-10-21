import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DbError, type Db } from './db.ts';

/** Production implementation over PostgREST with the service key (Edge Function). */
export class RestDb implements Db {
  client: SupabaseClient;
  constructor(url: string, serviceKey: string) {
    this.client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  async rpc<T>(name: string, payload: unknown): Promise<T> {
    const { data, error } = await this.client.rpc(name, { p: payload });
    if (error) throw new DbError(error.message, error.code);
    return data as T;
  }
  async select<T>(table: string, where: Record<string, unknown>, opts: { order?: string; asc?: boolean; limit?: number } = {}): Promise<T[]> {
    let q = this.client.from(table).select('*');
    for (const [k, v] of Object.entries(where)) q = Array.isArray(v) ? q.in(k, v) : v === null ? q.is(k, null) : q.eq(k, v as never);
    if (opts.order) q = q.order(opts.order, { ascending: opts.asc !== false });
    if (opts.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) throw new DbError(error.message, error.code);
    return (data ?? []) as T[];
  }
}
