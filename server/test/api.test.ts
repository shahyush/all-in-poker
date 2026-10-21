import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb, world, type World, GROUP_PASSWORD } from './harness.ts';

let W: World;
beforeAll(async () => { resetDb(); W = await world(0); });
afterAll(async () => { await W.close(); });

async function newClient(name: string) { const { Client } = await import('./harness.ts'); const c = new Client(W.app, W.db); await c.signIn(); await c.admit(name); return c; }

describe('admission and identity', () => {
  it('bootstrap admission creates the hashed group password and the owner; wrong password is refused; anonymous session alone sees nothing', async () => {
    const gs = await W.db.select('group_settings', { id: 1 });
    expect(gs.length).toBe(0);
    const a = await newClient('Tanisha');
    expect((await W.db.select<{ is_owner: boolean }>('profiles', { id: a.player!.id }))[0].is_owner).toBe(true);
    expect((await W.db.select('group_settings', { id: 1 })).length).toBe(1);
    const b = await (async () => { const { Client } = await import('./harness.ts'); const c = new Client(W.app, W.db); await c.signIn(); return c; })();
    const bad = await b.raw('admit', { nickname: 'Sam', password: 'nope' });
    expect(bad.status).toBe(403);
    const blocked = await b.raw('create_table', { rules: {} });
    expect(blocked.body.error?.code).toBe('not_admitted');
    expect((await b.see('profiles', {})).length).toBe(0);
    await b.admit('Sam');
    expect((await W.db.select<{ is_owner: boolean }>('profiles', { id: b.player!.id }))[0].is_owner).toBe(false);
    // two Sams are two players
    const c = await newClient('Sam');
    expect(c.player!.id).not.toBe(b.player!.id);
  });
  it('rate limits repeated wrong passwords', async () => {
    const { Client } = await import('./harness.ts');
    const x = new Client(W.app, W.db); await x.signIn();
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await x.raw('admit', { nickname: 'X', password: 'wrong' })).status;
    expect(last).toBe(429);
  });
  it('recovery: a saved player code restores the player on a fresh session, rotates the code and detaches the old session', async () => {
    const a = await newClient('Aayush');
    const { code } = await a.cmd<{ code: string }>('recovery_create');
    expect(code.replace(/-/g, '').length).toBe(26);
    const { Client } = await import('./harness.ts');
    const fresh = new Client(W.app, W.db); await fresh.signIn();
    const wrong = await fresh.raw('recover', { code: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GG' });
    expect(wrong.status).toBe(403);
    const r = await fresh.cmd<{ player: { id: string } }>('recover', { code: code.toLowerCase() });
    expect(r.player.id).toBe(a.player!.id);
    // the old session is no longer bound
    const me = await a.raw('me');
    expect((me.body.result as { player: unknown }).player).toBeNull();
    // the code cannot be reused
    const again = new Client(W.app, W.db); await again.signIn();
    expect((await again.raw('recover', { code })).status).toBe(403);
    // a device that already has a player cannot recover another
    const other = await newClient('Other');
    const { code: code2 } = await fresh.cmd<{ code: string }>('recovery_create');
    expect((await other.raw('recover', { code: code2 })).status).toBe(409);
  });
  it('owner can rotate the group password; nickname/password never select an existing identity', async () => {
    const owner = W.clients[0] ?? (await W.db.select<{ auth_user_id: string; id: string }>('profiles', { is_owner: true }))[0];
    const { Client } = await import('./harness.ts');
    const o = new Client(W.app, W.db); o.authUid = (owner as { auth_user_id: string }).auth_user_id; o.player = { id: (owner as { id: string }).id, name: 'Tanisha' };
    await o.cmd('rotate_password', { current: GROUP_PASSWORD, next: 'new-secret-9' });
    const n = new Client(W.app, W.db); await n.signIn();
    expect((await n.raw('admit', { nickname: 'Tanisha', password: GROUP_PASSWORD })).status).toBe(403);
    const r = await n.cmd<{ player: { id: string } }>('admit', { nickname: 'Tanisha', password: 'new-secret-9' });
    expect(r.player.id).not.toBe(o.player.id);
    await o.cmd('rotate_password', { current: 'new-secret-9', next: GROUP_PASSWORD });
  });
});
