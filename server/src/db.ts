/** Minimal database boundary: every server-side write goes through a service-only SQL function taking one jsonb argument. */
export interface Db {
  rpc<T = unknown>(name: string, payload: unknown): Promise<T>;
  /** Service-role select helper for simple reads (table, filters). */
  select<T = Record<string, unknown>>(table: string, where: Record<string, unknown>, opts?: { order?: string; asc?: boolean; limit?: number }): Promise<T[]>;
  /** Dev/test only: run a read under a user's RLS identity. Production never calls this. */
  selectAs?<T = Record<string, unknown>>(authUid: string | null, table: string, where: Record<string, unknown>, opts?: { order?: string; asc?: boolean; limit?: number }): Promise<T[]>;
}

export class DbError extends Error {
  constructor(message: string, public code?: string) { super(message); this.name = 'DbError'; }
}
