export type Row = object;
export interface Where { [k: string]: unknown }
export interface QueryOpts { order?: string; asc?: boolean; limit?: number }
export interface CmdError { code: string; message: string; status: number; correlationId?: string }
export type Unsubscribe = () => void;

export interface Transport {
  readonly mode: 'dev' | 'supabase';
  ensureSession(): Promise<string>;                      // returns auth uid
  signOut(): Promise<void>;
  cmd<T = unknown>(type: string, payload?: Record<string, unknown>, tableId?: string, actionId?: string): Promise<T>;
  query<T extends Row = Row>(table: string, where: Where, opts?: QueryOpts): Promise<T[]>;
  /** Subscribes to row changes for a table-scoped resource; the callback receives fresh rows (full refetch or payload). */
  subscribe(table: string, tableId: string, cb: () => void, opts?: { pollMs?: number }): Unsubscribe;
  heartbeat(tableId: string): Promise<void>;
  serverNow(): Promise<number>;
}

export class TransportError extends Error implements CmdError {
  constructor(public code: string, message: string, public status: number, public correlationId?: string) { super(message); this.name = 'TransportError'; }
}
