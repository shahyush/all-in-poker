import type { Authenticator } from './auth.ts';
import type { Db } from './db.ts';
import { ApiError } from './errors.ts';
import { canonicalJson, sha256Hex, constantTimeEqual } from './crypto.ts';
import { Handlers, isUuid, type Env, type Player, type Receipt } from './handlers.ts';
import { EngineError } from '@allin/engine';

export interface ApiRequest { method: string; path: string; headers: Record<string, string>; body: unknown }
export interface ApiResponse { status: number; body: unknown; headers?: Record<string, string> }

const PRE_ADMISSION = new Set(['admit', 'recover', 'me']);
const TABLE_CMDS = new Set(['start', 'choose', 'straddle', 'act', 'propose', 'vote', 'reveal', 'sitout', 'return', 'post_pref', 'straddle_pref', 'leave', 'cancel_leave', 'remove', 'reload_request', 'reload_cancel', 'reload_decide', 'chat', 'transfer_host']);

export class App {
  handlers: Handlers;
  constructor(private db: Db, private auth: Authenticator, private env: Env & { jobKey?: string; corsOrigin?: string }) {
    this.handlers = new Handlers(db, env);
  }

  cors(): Record<string, string> {
    return {
      'Access-Control-Allow-Origin': this.env.corsOrigin ?? '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-allin-job',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin',
    };
  }

  async handle(req: ApiRequest): Promise<ApiResponse> {
    const h = this.cors();
    if (req.method === 'OPTIONS') return { status: 204, body: null, headers: h };
    if (req.method !== 'POST') return { status: 405, body: { ok: false, error: { code: 'method', message: 'POST only' } }, headers: h };
    const path = req.path.replace(/\/+$/, '');
    const correlationId = crypto.randomUUID().slice(0, 8);
    try {
      if (path.endsWith('/jobs')) return { status: 200, body: await this.jobs(req), headers: h };
      if (path.endsWith('/cmd')) return { status: 200, body: await this.cmd(req), headers: h };
      return { status: 404, body: { ok: false, error: { code: 'not_found', message: 'Unknown endpoint' } }, headers: h };
    } catch (e) {
      if (e instanceof ApiError) return { status: e.status, body: { ok: false, error: { code: e.code, message: e.message, detail: e.detail ?? null }, correlationId }, headers: h };
      if (e instanceof EngineError) return { status: 409, body: { ok: false, error: { code: e.code, message: e.message, detail: null }, correlationId }, headers: h };
      console.error('[allin]', correlationId, (e as Error).name, (e as Error).message);
      return { status: 500, body: { ok: false, error: { code: 'server_error', message: 'Something went wrong on our side. Please try again.' }, correlationId }, headers: h };
    }
  }

  private jobKeyCache: { value: string; at: number } | null = null;
  private async jobKey(): Promise<string> {
    if (this.env.jobKey) return this.env.jobKey;
    if (this.jobKeyCache && Date.now() - this.jobKeyCache.at < 60_000) return this.jobKeyCache.value;
    const rows = await this.db.select<{ value: string }>('app_settings', { key: 'job_key' }, { limit: 1 });
    const value = rows[0]?.value ?? '';
    this.jobKeyCache = { value, at: Date.now() };
    return value;
  }

  private async jobs(req: ApiRequest): Promise<unknown> {
    const key = req.headers['x-allin-job'] ?? '';
    const expected = await this.jobKey();
    if (!expected || !constantTimeEqual(new TextEncoder().encode(key), new TextEncoder().encode(expected))) throw new ApiError(403, 'forbidden', 'Not allowed');
    const body = (req.body ?? {}) as { tableIds?: string[]; limit?: number };
    const ids: string[] = Array.isArray(body.tableIds) && body.tableIds.every(isUuid) ? body.tableIds : await this.db.rpc<string[]>('allin_claim_due', { limit: body.limit ?? 10 });
    const results: Record<string, string> = {};
    for (const id of ids) {
      try { await this.handlers.runTable(id); results[id] = 'ok'; }
      catch (e) { results[id] = (e as Error).message; console.error('[allin job]', id, (e as Error).message); }
    }
    return { ok: true, ran: ids.length, results };
  }

  private async cmd(req: ApiRequest): Promise<unknown> {
    const { authUid } = await this.auth.verify(req.headers['authorization'] ?? null);
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const type = String(body.type ?? '');
    const actionId = body.actionId;
    const tableId = body.tableId as string | undefined;
    const payload = (body.payload && typeof body.payload === 'object' ? body.payload : {}) as Record<string, unknown>;
    if (!isUuid(actionId)) throw new ApiError(400, 'bad_action_id', 'actionId must be a UUID');
    const requestHash = await sha256Hex(canonicalJson({ type, tableId: tableId ?? null, payload }));
    const H = this.handlers;

    if (type === 'me') {
      const player = await H.playerFor(authUid);
      return { ok: true, result: { player, authUid } };
    }
    if (type === 'admit') return this.finish(await H.admit(authUid, payload));
    if (type === 'recover') return this.finish(await H.recover(authUid, payload));

    const player = await H.playerFor(authUid);
    if (!player) throw new ApiError(403, 'not_admitted', 'Enter your nickname and the group password first');
    const receipt: Receipt = { user_id: player.id, action_id: actionId, request_hash: requestHash, status: 200, result: null };

    // replay protection for every admitted command
    const prior = await this.db.select<{ request_hash: string; status: number; result: unknown }>('command_receipts', { user_id: player.id, action_id: actionId }, { limit: 1 });
    if (prior.length) {
      if (prior[0].request_hash !== requestHash) throw new ApiError(409, 'action_conflict', 'That action id was already used for a different command');
      return { ok: true, result: prior[0].result, replayed: true };
    }

    let out: { result: unknown } | null = null;
    if (TABLE_CMDS.has(type)) {
      if (!isUuid(tableId)) throw new ApiError(400, 'bad_table', 'tableId required');
      if (type === 'start') out = await H.start(player, receipt, tableId);
      else if (type === 'reload_request' || type === 'reload_cancel' || type === 'reload_decide') out = await H.reload(player, receipt, tableId, type, payload);
      else if (type === 'chat') out = await H.chat(player, receipt, tableId, payload, authUid);
      else if (type === 'transfer_host') out = await H.transferHost(player, receipt, tableId, payload);
      else out = await H.game(player, receipt, tableId, type, payload);
      return { ok: true, result: out.result };
    }
    switch (type) {
      case 'create_table': out = await H.createTable(player, receipt, payload); break;
      case 'join': out = await H.join(player, receipt, payload); break;
      case 'preview': out = await H.preview(player, authUid, payload); break;
      case 'profile': out = await H.updateProfile(player, payload); break;
      case 'recovery_create': out = await H.createRecoveryCode(player); break;
      case 'rotate_password': out = await H.rotateGroupPassword(player, authUid, payload); break;
      case 'forget': out = await H.forget(player); break;
      default: throw new ApiError(400, 'bad_type', 'Unknown command');
    }
    if (!['preview'].includes(type)) await this.db.rpc('allin_receipt', { ...receipt, result: out.result });
    return { ok: true, result: out.result };
  }

  private finish(r: { result: unknown }): unknown { return { ok: true, result: r.result }; }
}

export type { Player };
