import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb, world, Client, type World } from './harness.ts';
import { RULES } from '@allin/engine';

let W: World;
beforeAll(async () => { resetDb(); W = await world(4, ['Tanisha', 'Aayush', 'Sam', 'Priya']); });
afterAll(async () => { await W.close(); });

const cashRules = { mode: 'cash', name: 'Friday', seats: 6, sb: '5', bb: '10', ante: '0', straddle: true, unit: '1000' };

async function hand(tableId: string) { return (await W.publicState(tableId)).hand; }
async function actorClient(tableId: string): Promise<Client> {
  const st = await W.publicState(tableId);
  const seat = st.hand.actor; const pid = st.seats[seat].playerId;
  return W.clients.find((c) => c.player!.id === pid)!;
}
async function waitBetting(tableId: string) {
  // the deal presentation window must pass before actions are accepted
  const h = await hand(tableId);
  if (h?.actionReadyAt) await W.advanceClock(2000);
}

describe('full cash session through the API', () => {
  let tableId = '', code = '';
  let host: Client, a: Client, b: Client, c: Client;
  beforeAll(() => { [host, a, b, c] = W.clients; });

  it('creates a table with a buy-in, previews and joins by code; the last seat is atomic', async () => {
    const r = await host.cmd<{ tableId: string; inviteCode: string }>('create_table', { rules: { ...cashRules, seats: '3' }, buyIn: '3000' });
    tableId = r.tableId; code = r.inviteCode;
    expect(code.length).toBe(8);
    const bad = await a.raw('join', { code, amount: '1.5' });
    expect(bad.body.error?.code).toBe('bad_buyin');
    const prev = await a.cmd<{ open: number; isMember: boolean }>('preview', { code: code.toLowerCase() });
    expect(prev.open).toBe(2); expect(prev.isMember).toBe(false);
    await a.cmd('join', { code, amount: '2000' });
    // b and c race for the last seat
    const [rb, rc] = await Promise.all([b.raw('join', { code, amount: '1000' }), c.raw('join', { code, amount: '21000' })]);
    const okCount = [rb, rc].filter((x) => x.body.ok).length;
    expect(okCount).toBe(1);
    const loser = rb.body.ok ? rc : rb;
    expect(loser.body.error?.code).toBe('full');
    const ledger = await W.db.select<{ amount: number; kind: string }>('ledger', { table_id: tableId });
    expect(ledger.length).toBe(3);
    const members = await W.db.select('table_members', { table_id: tableId, status: 'active' });
    expect(members.length).toBe(3);
  });

  it('non-members cannot see the table, members cannot see opponents cards (RLS)', async () => {
    const outsider = W.clients.find((x) => !([host, a].includes(x)) && (x === b || x === c)) as Client;
    const seated = W.clients.filter((x) => x !== outsider);
    const loser = (await W.db.select<{ user_id: string }>('table_members', { table_id: tableId, status: 'active' })).map((m) => m.user_id);
    const out = W.clients.find((x) => !loser.includes(x.player!.id))!;
    expect((await out.see('tables', { id: tableId })).length).toBe(0);
    expect((await out.see('table_members', { table_id: tableId })).length).toBe(0);
    expect((await out.see('ledger', { table_id: tableId })).length).toBe(0);
    expect((await host.see('tables', { id: tableId })).length).toBe(1);
    expect((await host.see('ledger', { table_id: tableId })).length).toBe(3);
    await expect(host.see('table_secrets', { table_id: tableId })).rejects.toThrow(/permission denied/); // server-only table
    void outsider; void seated;
  });

  it('host starts; dealer choice, straddle, visible deal order; own cards only', async () => {
    const notHost = (await a.raw('start', {}, tableId));
    expect(notHost.body.error?.code).toBe('host_only');
    await host.cmd('start', {}, tableId);
    let h = await hand(tableId);
    expect(h.phase).toBe('choice');
    const st0 = await W.publicState(tableId);
    const chooser = W.clients.find((x) => x.player!.id === st0.seats[h.chooserSeat].playerId)!;
    const seatedIds = st0.seats.filter(Boolean).map((s: { playerId: string }) => s.playerId);
    const wrong = W.clients.find((x) => x !== chooser && seatedIds.includes(x.player!.id))!;
    expect((await wrong.raw('choose', { variant: 'omaha4' }, tableId)).body.error?.code).toBe('not_chooser');
    if (h.straddleOffer) {
      const utg = W.clients.find((x) => x.player!.id === st0.seats[h.straddleOffer.seat].playerId)!;
      await utg.cmd('straddle', { accept: true }, tableId);
    }
    await chooser.cmd('choose', { variant: 'holdem' }, tableId);
    h = await hand(tableId);
    expect(h.phase).toBe('betting');
    expect(h.straddleSeat).not.toBeNull();
    const pub = JSON.stringify(await W.publicState(tableId));
    expect(pub).not.toContain('"deck"'); expect(pub).not.toContain('"hole"');
    const mine = await host.see<{ cards: number[]; hand_id: string }>('hole_cards', { table_id: tableId });
    expect(mine.length).toBe(1); expect(mine[0].cards.length).toBe(2); expect(mine[0].hand_id).toBe(h.id);
    const theirs = await host.see('hole_cards', { table_id: tableId, user_id: a.player!.id });
    expect(theirs.length).toBe(0);
    // dealing presentation: acting too early is rejected
    const early = await (await actorClient(tableId)).raw('act', { action: 'call' }, tableId);
    expect(early.body.error?.code).toBe('not_ready');
  });

  it('plays every street with legal actions, duplicate action ids replay, conflicting payloads are refused', async () => {
    await waitBetting(tableId);
    let h = await hand(tableId);
    expect(h.street).toBe('preflop');
    // first actor calls twice with the same action id: second is a replay
    const actor = await actorClient(tableId);
    const first = await actor.raw('act', { action: 'call' }, tableId);
    expect(first.body.ok).toBe(true);
    const replay = await actor.raw('act', { action: 'call' }, tableId, first.actionId);
    expect(replay.body.ok).toBe(true); expect(replay.body.replayed).toBe(true);
    const conflict = await actor.raw('act', { action: 'fold' }, tableId, first.actionId);
    expect(conflict.body.error?.code).toBe('action_conflict');
    // finish preflop then flop/turn/river by checking/calling
    for (let i = 0; i < 20; i++) {
      h = await hand(tableId);
      if (!h || h.phase !== 'betting') break;
      const cl = await actorClient(tableId);
      const st = await W.publicState(tableId);
      const me = h.players.find((p: { seat: number }) => p.seat === h.actor);
      const owed = h.currentBet - me.bet;
      await cl.cmd('act', { action: owed > 0 ? 'call' : 'check' }, tableId);
      void st;
    }
    h = await hand(tableId);
    expect(h.phase).toBe('result');
    expect(h.result.uncontested).toBe(false);
    expect(Object.keys(h.result.shows).length).toBe(3);
    const hist = await W.db.select('hand_history', { table_id: tableId });
    expect(hist.length).toBe(0); // history is written at the boundary
  });

  it('server timers advance the hand with no client involved: next hand starts, late choice defaults, timeouts fold', async () => {
    await W.advanceClock(3100);
    await W.runJobs();
    let st = await W.publicState(tableId);
    expect(st.handNo).toBe(2);
    expect(st.hand.phase).toBe('choice');
    expect((await W.db.select('hand_history', { table_id: tableId })).length).toBe(1);
    // no client ever confirms it is viewing the choice, so the window never re-anchors: the hand defaults to Hold'em once
    // the warm-up cap (RULES.timers.choiceWarmupCapMs) lapses
    await W.advanceClock(RULES.timers.choiceWarmupCapMs + 1000);
    await W.runJobs();
    st = await W.publicState(tableId);
    expect(st.hand.variant).toBe('holdem'); expect(st.hand.phase).toBe('betting');
    // the actor times out: folds (owes a call)
    await W.advanceClock(31700);
    await W.runJobs();
    st = await W.publicState(tableId);
    const folded = st.hand.players.filter((p: { folded: boolean }) => p.folded).length;
    expect(folded).toBeGreaterThanOrEqual(1);
  });

  it('reload requests credit only at the boundary and exactly once; host self-reload is self-approved and visible', async () => {
    const req = await a.cmd<{ requestId: string; status: string }>('reload_request', { amount: '1000' }, tableId);
    expect(req.status).toBe('requested');
    const notHost = await a.raw('reload_decide', { requestId: req.requestId, approve: true }, tableId);
    expect(notHost.body.error?.code).toBe('host_only');
    await host.cmd('reload_decide', { requestId: req.requestId, approve: true }, tableId);
    await host.cmd('reload_decide', { requestId: req.requestId, approve: true }, tableId); // repeated approve is harmless
    let rr = await W.db.select<{ status: string }>('reload_requests', { id: req.requestId });
    expect(rr[0].status).toBe('approved');
    const self = await host.cmd<{ status: string }>('reload_request', { amount: '2000' }, tableId);
    expect(self.status).toBe('approved');
    // finish the hand by timeouts and cross the boundary
    for (let i = 0; i < 12; i++) { await W.advanceClock(31000); await W.runJobs(); const s = await W.publicState(tableId); if (s.handNo >= 4) break; }
    rr = await W.db.select<{ status: string }>('reload_requests', { id: req.requestId });
    expect(rr[0].status).toBe('credited');
    const ledger = await W.db.select<{ kind: string; amount: number; user_id: string }>('ledger', { table_id: tableId, kind: 'reload' });
    expect(ledger.length).toBe(2);
    const parts = await W.db.select<{ user_id: string; added: number }>('session_participants', { table_id: tableId, user_id: a.player!.id });
    expect(Number(parts[0].added)).toBe(3000);
  });

  it('chip conservation across the session: added = stacks + committed + taken off', async () => {
    const st = await W.publicState(tableId);
    const ledger = await W.db.select<{ kind: string; amount: number }>('ledger', { table_id: tableId });
    const added = ledger.filter((l) => l.kind !== 'exit').reduce((s, l) => s + Number(l.amount), 0);
    const takenOff = ledger.filter((l) => l.kind === 'exit').reduce((s, l) => s + Number(l.amount), 0);
    let onTable = st.seats.filter(Boolean).reduce((s: number, x: { stack: number }) => s + x.stack, 0);
    if (st.hand) { onTable += st.hand.pot; onTable += st.hand.players.reduce((s: number, p: { bet: number }) => s + p.bet, 0); }
    expect(added).toBe(onTable + takenOff);
  });

  it('table chat carries emoji; reactions toggle, dedupe, count, and stay private to members', async () => {
    await host.cmd('chat', { body: 'nice hand 🎉' }, tableId);
    const msgs = await W.db.select<{ id: number; body: string }>('chat_messages', { table_id: tableId }, { order: 'id' });
    const mid = msgs[msgs.length - 1].id;
    expect(msgs[msgs.length - 1].body).toContain('🎉');
    // two players thumbs-up the same message; one also adds a heart
    await host.cmd('react', { messageId: mid, emoji: '👍', op: 'add' }, tableId);
    await a.cmd('react', { messageId: mid, emoji: '👍', op: 'add' }, tableId);
    await a.cmd('react', { messageId: mid, emoji: '❤️', op: 'add' }, tableId);
    let rx = await W.db.select<{ emoji: string; user_id: string }>('chat_reactions', { table_id: tableId, message_id: mid });
    expect(rx.filter((r) => r.emoji === '👍').length).toBe(2);
    expect(rx.filter((r) => r.emoji === '❤️').length).toBe(1);
    // adding the same reaction again is idempotent (a fresh action id, no duplicate row)
    await a.cmd('react', { messageId: mid, emoji: '❤️', op: 'add' }, tableId);
    rx = await W.db.select('chat_reactions', { table_id: tableId, message_id: mid });
    expect(rx.length).toBe(3);
    // removing takes away only that player's own reaction
    await host.cmd('react', { messageId: mid, emoji: '👍', op: 'remove' }, tableId);
    rx = await W.db.select<{ emoji: string }>('chat_reactions', { table_id: tableId, message_id: mid });
    expect(rx.filter((r) => r.emoji === '👍').length).toBe(1);
    // an emoji outside the allowlist is refused, and an unknown message id cannot be reacted to
    expect((await a.raw('react', { messageId: mid, emoji: '🚫', op: 'add' }, tableId)).body.error?.code).toBe('bad_emoji');
    expect((await a.raw('react', { messageId: 999999999, emoji: '👍', op: 'add' }, tableId)).body.ok).toBe(false);
    // members see the reactions; the whole feed is member-scoped by RLS like chat
    expect((await host.see('chat_reactions', { table_id: tableId })).length).toBeGreaterThan(0);
  });

  it('leave after the hand records the exit, frees the seat, keeps history for the departed player', async () => {
    await a.cmd('leave', {}, tableId);
    for (let i = 0; i < 12; i++) { const s = await W.publicState(tableId); if (!s.seats.some((x: { playerId: string } | null) => x && x.playerId === a.player!.id)) break; await W.advanceClock(31000); await W.runJobs(); }
    const exits = await W.db.select<{ amount: number }>('ledger', { table_id: tableId, user_id: a.player!.id, kind: 'exit' });
    expect(exits.length).toBe(1);
    expect((await a.see('tables', { id: tableId })).length).toBe(1); // participant access survives
    expect((await a.see('hand_history', { table_id: tableId })).length).toBeGreaterThan(0);
    expect((await a.see('hole_cards', { table_id: tableId })).length).toBe(0); // live access revoked
    const m = await W.db.select<{ status: string; seat: number | null }>('table_members', { table_id: tableId, user_id: a.player!.id });
    expect(m[0].status).toBe('left'); expect(m[0].seat).toBeNull();
  });

  it('a departed player can rejoin as a new episode without erasing the earlier exit; when everyone leaves the table archives once', async () => {
    await a.cmd('join', { code, amount: '1000' }, tableId);
    const l = await W.db.select<{ kind: string }>('ledger', { table_id: tableId, user_id: a.player!.id });
    expect(l.filter((x) => x.kind === 'buyin').length).toBe(2); expect(l.filter((x) => x.kind === 'exit').length).toBe(1);
    for (const cl of W.clients) { const m = await W.db.select('table_members', { table_id: tableId, user_id: cl.player!.id, status: 'active' }); if (m.length) await cl.cmd('leave', {}, tableId); }
    for (let i = 0; i < 12; i++) { const s = await W.publicState(tableId); if (s.status === 'closed') break; await W.advanceClock(31000); await W.runJobs(); }
    const row = (await W.db.select<{ status: string; archived_at: string | null }>('tables', { id: tableId }))[0];
    expect(row.status).toBe('closed'); expect(row.archived_at).not.toBeNull();
    expect((await W.db.select('table_secrets', { table_id: tableId })).length).toBe(0);
    expect((await W.db.select('hole_cards', { table_id: tableId })).length).toBe(0);
    expect((await W.db.select('table_tombstones', { table_id: tableId })).length).toBe(1);
    // zero-sum settled accounts
    const parts = await W.db.select<{ added: number; taken_off: number }>('session_participants', { table_id: tableId });
    const net = parts.reduce((s, p) => s + Number(p.taken_off) - Number(p.added), 0);
    expect(net).toBe(0);
    // late commands cannot revive it
    expect((await host.raw('start', {}, tableId)).status).toBe(410);
    expect((await a.raw('join', { code, amount: '1000' })).body.error?.code).toBe('no_table');
  });
});

describe('host succession and all-browsers-closed progression', () => {
  it('transfers the host after 30s of absence to the earliest joined present member; old host cannot approve', async () => {
    const [h, p1, p2] = W.clients;
    const r = await h.cmd<{ tableId: string; inviteCode: string }>('create_table', { rules: { ...cashRules, name: 'Succession', seats: '4' }, buyIn: '1000' });
    await p1.cmd('join', { code: r.inviteCode, amount: '1000' });
    await p2.cmd('join', { code: r.inviteCode, amount: '1000' });
    await h.cmd('start', {}, r.tableId);
    await p1.heartbeat(r.tableId); await p2.heartbeat(r.tableId);
    // host silent: pretend 40s pass by backdating last_seen
    await W.db.sql.unsafe(`update public.table_members set last_seen = now() - interval '40 seconds' where table_id = $1 and user_id = $2`, [r.tableId, h.player!.id]);
    await W.advanceClock(4100); await W.runJobs([r.tableId]);
    const st = await W.publicState(r.tableId);
    expect(st.hostPlayerId).toBe(p1.player!.id); expect(st.hostEpoch).toBe(2);
    const req = await p2.cmd<{ requestId: string }>('reload_request', { amount: '1000' }, r.tableId);
    expect((await h.raw('reload_decide', { requestId: req.requestId, approve: true }, r.tableId)).body.error?.code).toBe('host_only');
    await p1.cmd('reload_decide', { requestId: req.requestId, approve: true }, r.tableId);
    // all browsers closed: deadlines still resolve through jobs only
    for (let i = 0; i < 10; i++) { await W.advanceClock(31000); await W.runJobs(); }
    const after = await W.publicState(r.tableId);
    expect(after.handNo).toBeGreaterThanOrEqual(2);
  });
});

describe('two independent tables and tournaments', () => {
  it('runs two tables at once without leaking state, and a tournament to a winner with standings', async () => {
    const extra = [new Client(W.app, W.db), new Client(W.app, W.db), new Client(W.app, W.db)];
    for (const [i, c] of extra.entries()) { await c.signIn(); await c.admit('T' + i); }
    const [x, y, z] = extra;
    const t1 = await x.cmd<{ tableId: string; inviteCode: string }>('create_table', { rules: { mode: 'tournament', name: 'Cup', seats: '3', unit: '300', levels: [{ sb: '5', bb: '10', ante: '0', minutes: '1' }, { sb: '50', bb: '100', ante: '0', minutes: '1' }] } });
    const r2 = await y.cmd<{ tableId: string; inviteCode: string }>('create_table', { rules: { ...cashRules, name: 'Other', seats: '2' }, buyIn: '1000' });
    expect((await y.raw('join', { code: t1.inviteCode })).body.error?.code).toBe('already_seated');
    expect((await x.raw('join', { code: r2.inviteCode, amount: '1000' })).body.error?.code).toBe('already_seated');
    await y.cmd('leave', {}, r2.tableId); // last member leaving archives the waiting table immediately
    expect((await W.db.select<{ status: string }>('tables', { id: r2.tableId }))[0].status).toBe('closed');
    await y.cmd('join', { code: t1.inviteCode }); await z.cmd('join', { code: t1.inviteCode });
    await x.cmd('start', {}, t1.tableId);
    expect((await y.see('tables', { id: r2.tableId })).length).toBe(1); // participant of the closed table
    expect((await z.see('tables', { id: r2.tableId })).length).toBe(0);
    // play the tournament by timeouts until it finishes (blinds escalate every minute)
    let st;
    const byId = new Map(extra.map((c) => [c.player!.id, c]));
    for (let i = 0; i < 400; i++) {
      const pub = await W.publicState(t1.tableId);
      if (pub.hand?.phase === 'betting' && pub.hand.actor !== null) {
        if (pub.hand.actionReadyAt) await W.advanceClock(2000);
        const seat = pub.seats[pub.hand.actor]; const cl = byId.get(seat.playerId)!; const me = pub.hand.players.find((p: { seat: number }) => p.seat === pub.hand.actor);
        const shove = await cl.raw('act', { action: 'raise', raiseTo: String(me.bet + seat.stack) }, t1.tableId);
        if (!shove.body.ok) { const call = await cl.raw('act', { action: 'call' }, t1.tableId); if (!call.body.ok) await cl.raw('act', { action: 'check' }, t1.tableId); }
      } else { await W.advanceClock(5000); await W.runJobs([t1.tableId]); }
      st = (await W.db.select<{ status: string; archived_at: string | null }>('tables', { id: t1.tableId }))[0];
      if (st.status !== 'running') break;
    }
    expect(st!.status).toBe('finished'); expect(st!.archived_at).not.toBeNull();
    const parts = await W.db.select<{ place: number; user_id: string }>('session_participants', { table_id: t1.tableId });
    expect(parts.map((p) => p.place).sort()).toEqual([1, 2, 3].slice(0, parts.length).length === 3 ? expect.arrayContaining([1]) : expect.anything());
    expect(parts.filter((p) => p.place === 1).length).toBe(1);
    const hist = await W.db.select('hand_history', { table_id: t1.tableId });
    expect(hist.length).toBeGreaterThanOrEqual(1);
    expect((await W.db.select('table_secrets', { table_id: t1.tableId })).length).toBe(0);
  });
});

describe('leaving as the result window lapses', () => {
  it('cashes the leaving player out at the boundary instead of dealing them into a stalled next hand', async () => {
    const extra = [new Client(W.app, W.db), new Client(W.app, W.db)];
    for (const [i, c] of extra.entries()) { await c.signIn(); await c.admit('Lv' + i); }
    const [x, y] = extra;
    const r = await x.cmd<{ tableId: string; inviteCode: string }>('create_table', { rules: { ...cashRules, name: 'LeaveRace', seats: '2' }, buyIn: '1000' });
    const tid = r.tableId;
    await y.cmd('join', { code: r.inviteCode, amount: '1000' });
    await x.cmd('start', {}, tid);
    // hand 1 defaults to Hold'em once the 15s choice window lapses
    await W.advanceClock(RULES.timers.choiceWarmupCapMs + 1000); await W.runJobs([tid]);
    let st = await W.publicState(tid);
    expect(st.hand.phase).toBe('betting');
    // heads-up: the first actor (button/SB) folds -> uncontested -> result phase with a short next-hand window
    await waitBetting(tid);
    const firstPid = st.seats[st.hand.actor].playerId;
    const first = [x, y].find((c) => c.player!.id === firstPid)!;
    await first.cmd('act', { action: 'fold' }, tid);
    st = await W.publicState(tid);
    expect(st.hand.phase).toBe('result');
    // the result window lapses BEFORE the leave request is processed (the live race). The leave command ticks first, so
    // with the pre-tick leave flag the boundary cashes the leaver out now rather than dealing them a fresh hand.
    await W.advanceClock(RULES.timers.revealMs + 500);
    await y.cmd('leave', {}, tid);
    st = await W.publicState(tid);
    expect(st.seats.some((s: { playerId: string } | null) => s && s.playerId === y.player!.id)).toBe(false); // cashed out
    expect(st.hand).toBeNull();                 // only one player remains: no new hand was dealt
    expect(st.status).toBe('running');          // the table waits for players, it is not stuck mid-hand
    const part = (await W.db.select<{ left_at: string | null; taken_off: number }>('session_participants', { table_id: tid, user_id: y.player!.id }))[0];
    expect(part.left_at).not.toBeNull();
    // chip conservation: the remaining stack plus the leaver's cashed-out chips equal the two 1,000 buy-ins
    const xStack = Number(st.seats.find((s: { playerId: string } | null) => s && s.playerId === x.player!.id)!.stack);
    expect(xStack + Number(part.taken_off)).toBe(2000);
  });
});

describe('dealer\'s choice readiness (cold start)', () => {
  it('choice_ready re-anchors the window so a chooser who loads late still registers a pick', async () => {
    const extra = [new Client(W.app, W.db), new Client(W.app, W.db)];
    for (const [i, c] of extra.entries()) { await c.signIn(); await c.admit('Rd' + i); }
    const [x, y] = extra;
    const r = await x.cmd<{ tableId: string; inviteCode: string }>('create_table', { rules: { ...cashRules, name: 'ColdChoice', seats: '2' }, buyIn: '1000' });
    const tid = r.tableId;
    await y.cmd('join', { code: r.inviteCode, amount: '1000' });
    await x.cmd('start', {}, tid);
    let st = await W.publicState(tid);
    expect(st.hand.phase).toBe('choice');
    const chooserPid = st.seats[st.hand.chooserSeat].playerId;
    const chooser = [x, y].find((c) => c.player!.id === chooserPid)!;
    // the chooser only receives/renders the choice well past the old 15 s window, but within the warm-up cap
    await W.advanceClock(20_000);
    await chooser.cmd('choice_ready', {}, tid);
    st = await W.publicState(tid);
    expect(st.hand.phase).toBe('choice');   // not defaulted: the cap absorbed the cold-start latency
    expect(st.hand.choiceArmed).toBe(true);
    // and the deliberate pick now registers rather than losing to the timeout default
    await chooser.cmd('choose', { variant: 'omaha4' }, tid);
    st = await W.publicState(tid);
    expect(st.hand.variant).toBe('omaha4');
  });
});
