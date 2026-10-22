import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb, world, type World } from './harness.ts';

// Regression: the production scheduler function failed with "column reference key is ambiguous" whenever a table was due,
// which stalled every hand at its first timer. The local pg_net stand-in (bootstrap_local.sql) records the call instead.
let W: World;
beforeAll(async () => { resetDb(); W = await world(2, ['Tanisha', 'Aayush']); });
afterAll(async () => { await W.close(); });

describe('allin_dispatch_due', () => {
  it('claims the due table, leases it and posts the job with the job key header', async () => {
    const [host, guest] = W.clients;
    const { tableId, inviteCode } = await host.cmd<{ tableId: string; inviteCode: string }>('create_table', { rules: { mode: 'cash', name: 'Due', seats: 4, sb: 5, bb: 10, ante: 0, straddle: false, unit: 100, levels: [] }, buyIn: 1000 });
    await guest.cmd('join', { code: inviteCode, amount: 1000 });
    await host.cmd('start', {}, tableId);
    await W.db.sql`insert into public.app_settings (key, value) values ('function_url', 'https://example.test/functions/v1/api'), ('anon_key', 'anon'), ('job_key', 'k-123') on conflict (key) do update set value = excluded.value`;
    await W.advanceClock(31_000); // past the dealer's-choice warm-up cap (RULES.timers.choiceWarmupCapMs); the table is now due
    const before = await W.db.sql`select count(*)::int as n from net.local_calls`;
    const [{ allin_dispatch_due: ran }] = await W.db.sql`select public.allin_dispatch_due()`;
    expect(ran).toBe(1);
    const calls = await W.db.sql`select url, body, headers from net.local_calls order by id desc limit 1`;
    expect(calls[0].url).toBe('https://example.test/functions/v1/api/jobs');
    expect(calls[0].headers['x-allin-job']).toBe('k-123');
    expect(calls[0].body.tableIds).toEqual([tableId]);
    const after = await W.db.sql`select count(*)::int as n from net.local_calls`;
    expect(after[0].n).toBe(before[0].n + 1);
    const [row] = await W.db.sql`select job_lease_until is not null as leased from public.tables where id = ${tableId}`;
    expect(row.leased).toBe(true);
    // a second tick inside the lease window dispatches nothing
    const [{ allin_dispatch_due: again }] = await W.db.sql`select public.allin_dispatch_due()`;
    expect(again).toBe(0);
  });
});
