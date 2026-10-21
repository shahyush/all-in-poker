import postgres from 'postgres';
import { DbError, type Db } from './db.ts';

const IDENT = /^[a-z_][a-z0-9_]*$/;
function ident(s: string): string { if (!IDENT.test(s)) throw new DbError('bad identifier'); return s; }

/** Direct Postgres implementation (local development, integration tests). */
export class PgDb implements Db {
  sql: ReturnType<typeof postgres>;
  constructor(url: string) { this.sql = postgres(url, { max: 8, prepare: false, onnotice: () => {} }); }
  async rpc<T>(name: string, payload: unknown): Promise<T> {
    const n = ident(name);
    try {
      const rows = await this.sql.unsafe(`select public.${n}($1::jsonb) as r`, [payload as never]);
      return rows[0].r as T;
    } catch (e) { throw new DbError((e as Error).message); }
  }
  private buildWhere(where: Record<string, unknown>): { clause: string; params: unknown[] } {
    const parts: string[] = []; const params: unknown[] = [];
    for (const [k, v] of Object.entries(where)) {
      if (Array.isArray(v)) { params.push(v); parts.push(`${ident(k)} = any($${params.length})`); }
      else if (v === null) parts.push(`${ident(k)} is null`);
      else { params.push(v); parts.push(`${ident(k)} = $${params.length}`); }
    }
    return { clause: parts.length ? 'where ' + parts.join(' and ') : '', params };
  }
  async select<T>(table: string, where: Record<string, unknown>, opts: { order?: string; asc?: boolean; limit?: number } = {}): Promise<T[]> {
    const { clause, params } = this.buildWhere(where);
    const order = opts.order ? `order by ${ident(opts.order)} ${opts.asc === false ? 'desc' : 'asc'}` : '';
    const limit = opts.limit ? `limit ${Math.floor(opts.limit)}` : '';
    const rows = await this.sql.unsafe(`select * from public.${ident(table)} ${clause} ${order} ${limit}`, params as never[]);
    return rows as unknown as T[];
  }
  async selectAs<T>(authUid: string | null, table: string, where: Record<string, unknown>, opts: { order?: string; asc?: boolean; limit?: number } = {}): Promise<T[]> {
    const { clause, params } = this.buildWhere(where);
    const order = opts.order ? `order by ${ident(opts.order)} ${opts.asc === false ? 'desc' : 'asc'}` : '';
    const limit = opts.limit ? `limit ${Math.floor(opts.limit)}` : '';
    const role = authUid ? 'authenticated' : 'anon';
    const claims = authUid ? JSON.stringify({ sub: authUid, role }) : JSON.stringify({ role });
    return this.sql.begin(async (tx) => {
      await tx.unsafe(`select set_config('request.jwt.claims', $1, true)`, [claims]);
      await tx.unsafe(`set local role ${role}`);
      const rows = await tx.unsafe(`select * from public.${ident(table)} ${clause} ${order} ${limit}`, params as never[]);
      return rows as unknown as T[];
    }) as Promise<T[]>;
  }
  async end(): Promise<void> { await this.sql.end(); }
}
