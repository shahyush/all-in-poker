import { useEffect, useRef, useState } from 'react';
import type { PublicHand, PublicTable, TableRules } from '@allin/engine/public';
import { REACTIONS } from '@allin/engine/public';
import { soundEnabled, setSoundEnabled, playCue } from '../lib/sound.ts';
import { Sheet, KV, fmt } from '../components/ui.tsx';
import type { ChatRow, LedgerRow, MemberRow, ParticipantRow, ReactionRow, ReloadRow } from '../state/table.ts';

// a few more faces for composing a message, on top of the one-tap reaction set
const COMPOSE_EMOJI = [...REACTIONS, '😅', '😍', '🤔', '😬', '🙃', '😤', '🥳', '💀', '🫡', '👀', '🤝', '🍀', '♠️', '♥️', '♦️', '♣️', '🃏', '🤑', '😭', '🤷'];
import { rulesRows } from '../lib/format.ts';
import { PlayingCard } from './Card.tsx';
import { ordinal } from './Seat.tsx';

const common = { turnCue: undefined as string | null | undefined };

export function ChatSheet({ chat, reactions, names, myId, onSend, onReact, onClose, turnCue, onReturn, draft, setDraft }: { chat: ChatRow[]; reactions: ReactionRow[]; names: Map<string, string>; myId: string; onSend: (body: string) => Promise<void>; onReact: (messageId: number, emoji: string, op: 'add' | 'remove') => void; onClose: () => void; turnCue: string | null; onReturn: () => void; draft: string; setDraft: (s: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [stuck, setStuck] = useState(true);
  const [picker, setPicker] = useState(false);          // compose emoji picker
  const [reactFor, setReactFor] = useState<number | null>(null); // which message's reaction picker is open
  // mirror the draft synchronously so a failed send can be reconciled against whatever the player has typed since
  const draftRef = useRef(draft);
  const write = (v: string) => { const s = v.slice(0, 500); draftRef.current = s; setDraft(s); };
  useEffect(() => { if (stuck && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [chat, reactions, stuck]);
  const who = (id: string) => (id === myId ? 'You' : names.get(id) ?? 'Player');
  // group a message's reactions by emoji, preserving who reacted and whether I'm one of them
  const byMessage = new Map<number, Map<string, { count: number; mine: boolean; names: string[] }>>();
  for (const r of reactions) {
    let g = byMessage.get(r.message_id); if (!g) { g = new Map(); byMessage.set(r.message_id, g); }
    let e = g.get(r.emoji); if (!e) { e = { count: 0, mine: false, names: [] }; g.set(r.emoji, e); }
    e.count++; e.names.push(who(r.user_id)); if (r.user_id === myId) e.mine = true;
  }
  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = draftRef.current.trim(); if (!body) return; // read the synchronous mirror, not the lagging React state
    // clear optimistically so the input is free for the next message the instant this one is sent; a rapid second
    // message (or fast typing during the round-trip) is never wiped.
    setErr(null); write(''); setPicker(false); setBusy(true);
    try { await onSend(body); }
    catch (x) {
      setErr((x as Error).message);
      // the send failed: put the failed message back, keeping anything the player typed in the meantime (both survive)
      const newer = draftRef.current.trim();
      write(newer && newer !== body ? `${body}\n${newer}` : body);
    } finally { setBusy(false); }
  }
  function addEmoji(e: string) { write(draftRef.current + e); inputRef.current?.focus(); }
  return (
    <Sheet title="Table chat" onClose={onClose} turnCue={turnCue} onReturn={onReturn}>
      <div ref={listRef} onScroll={() => { const el = listRef.current!; setStuck(el.scrollHeight - el.scrollTop - el.clientHeight < 40); }} className="chat-list">
        {chat.length === 0 && <p className="fine">No messages yet.</p>}
        {chat.map((m) => {
          const groups = [...(byMessage.get(m.id)?.entries() ?? [])];
          const mine = m.user_id === myId;
          return (
            <div key={m.id} className={`chat-msg ${mine ? 'mine' : ''}`}>
              <span className="fine"><b>{who(m.user_id)}</b> · {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="chat-body">{m.body}</span>
              <div className="react-row">
                {groups.map(([emoji, g]) => (
                  <button key={emoji} type="button" className={`react-chip ${g.mine ? 'mine' : ''}`} aria-pressed={g.mine}
                    aria-label={`${emoji}, ${g.count}, from ${g.names.join(', ')}. Tap to ${g.mine ? 'remove your' : 'add your'} reaction`} title={g.names.join(', ')}
                    onClick={() => onReact(m.id, emoji, g.mine ? 'remove' : 'add')}><span aria-hidden="true">{emoji}</span><span className="react-n">{g.count}</span></button>
                ))}
                <button type="button" className="react-add" aria-label="Add a reaction" aria-expanded={reactFor === m.id} onClick={() => setReactFor(reactFor === m.id ? null : m.id)}>☺＋</button>
              </div>
              {groups.length > 0 && <div className="react-who fine">{groups.map(([emoji, g]) => `${emoji} ${g.names.join(', ')}`).join('   ')}</div>}
              {reactFor === m.id && (
                <div className="react-grid" role="group" aria-label="Choose a reaction">
                  {REACTIONS.map((e) => { const mineE = !!byMessage.get(m.id)?.get(e)?.mine; return <button key={e} type="button" className={mineE ? 'on' : undefined} aria-pressed={mineE} onClick={() => { onReact(m.id, e, mineE ? 'remove' : 'add'); setReactFor(null); }}>{e}</button>; })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!stuck && <button type="button" className="btn btn-quiet" onClick={() => { setStuck(true); listRef.current!.scrollTop = listRef.current!.scrollHeight; }}>Jump to newest</button>}
      {picker && (
        <div className="emoji-grid" role="group" aria-label="Insert an emoji">
          {COMPOSE_EMOJI.map((e) => <button key={e} type="button" onClick={() => addEmoji(e)}>{e}</button>)}
        </div>
      )}
      <form className="row chat-compose" onSubmit={send}>
        <button type="button" className="emoji-btn" aria-label={picker ? 'Hide emoji' : 'Add emoji'} aria-expanded={picker} aria-pressed={picker} onClick={() => setPicker((v) => !v)}>☺</button>
        <input ref={inputRef} className="input" aria-label="Message" value={draft} onChange={(e) => write(e.target.value)} onFocus={() => { setPicker(false); setTimeout(() => inputRef.current?.scrollIntoView({ block: 'nearest' }), 100); }} maxLength={500} placeholder="Say something" />
        <button type="submit" className="btn btn-primary" disabled={!draft.trim()} aria-busy={busy} style={{ minHeight: 48 }}>Send</button>
      </form>
      {err && <div className="error" role="alert">{err}</div>}
    </Sheet>
  );
}

export function AccountsSheet({ t, ledger, participants, mode, onClose, turnCue, onReturn }: { t: PublicTable; ledger: LedgerRow[]; participants: ParticipantRow[]; mode: string; onClose: () => void; turnCue: string | null; onReturn: () => void }) {
  const rows = accountsRows(t, ledger, participants);
  const settled = rows.every((r) => r.status === 'finished');
  const allNets = rows.reduce((a, r) => a + r.net, 0);
  const tag: Record<string, string> = { playing: 'Playing', leaving: 'Leaving', finished: 'Finished' };
  return (
    <Sheet title={mode === 'cash' ? 'Table accounts' : 'Standings'} onClose={onClose} turnCue={turnCue} onReturn={onReturn}>
      {mode === 'cash' ? (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead><tr style={{ textAlign: 'right', color: 'var(--muted)', fontSize: 12 }}><th style={{ textAlign: 'left', padding: '6px 0' }}>Player</th><th>Added</th><th>In play</th><th>Taken off</th><th>Net</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.id} style={{ textAlign: 'right', borderTop: '1px solid var(--line)' }}><td style={{ textAlign: 'left', padding: '8px 0', overflowWrap: 'anywhere' }}>{r.name} <span className={`acct-tag ${r.status}`}>{tag[r.status]}</span></td><td>{fmt(r.added)}</td><td>{fmt(r.inPlay)}</td><td>{fmt(r.takenOff)}</td><td style={{ fontWeight: 700, color: r.net < 0 ? 'var(--danger)' : 'inherit' }}>{r.net > 0 ? '+' : ''}{fmt(r.net)}{r.status !== 'finished' ? <div className="fine" style={{ fontWeight: 400 }}>provisional</div> : null}</td></tr>)}</tbody>
            </table>
            <div className="kv" style={{ borderTop: '2px solid var(--line)', marginTop: 4 }}><span className="fine">{settled ? 'Settled · all nets' : 'All nets so far'}</span><span style={{ fontWeight: 700 }}>{allNets > 0 ? '+' : ''}{fmt(allNets)}</span></div>
          </div>
          <p className="fine" style={{ marginTop: 8 }}>In play = stack plus chips committed this hand. Net = in play + taken off − added — chips still at the table are counted, never a loss. All nets sum to zero once everyone cashes out.</p>
        </>
      ) : <Standings t={t} participants={participants} />}
    </Sheet>
  );
}

export function accountsRows(t: PublicTable, ledger: LedgerRow[], participants: ParticipantRow[]) {
  void ledger;
  const byId = new Map<string, { id: string; name: string; added: number; takenOff: number; inPlay: number; net: number; status: 'playing' | 'leaving' | 'finished' }>();
  for (const p of participants) byId.set(p.user_id, { id: p.user_id, name: p.name, added: Number(p.added), takenOff: Number(p.taken_off), inPlay: 0, net: 0, status: 'finished' });
  t.seats.forEach((s, i) => { if (!s) return; const r = byId.get(s.playerId); if (r) { r.inPlay = s.stack + (t.hand?.players.find((p) => p.seat === i)?.bet ?? 0); r.status = s.leaving ? 'leaving' : 'playing'; } });
  for (const r of byId.values()) r.net = r.inPlay + r.takenOff - r.added;
  return [...byId.values()].sort((a, b) => b.net - a.net);
}

export function Standings({ t, participants }: { t: PublicTable; participants: ParticipantRow[] }) {
  const rows = t.seats.filter((s): s is NonNullable<typeof s> => !!s).map((s) => ({ name: s.name, stack: s.stack, place: s.eliminatedPlace })).sort((a, b) => (a.place ?? 0) - (b.place ?? 0) || b.stack - a.stack);
  void participants;
  return <div>{rows.map((r, i) => <div className="list-row" key={i}><span>{r.place ? `${ordinal(r.place)} · ` : ''}{r.name}</span><span style={{ fontWeight: 600 }}>{r.place && r.place > 1 ? 'Out' : fmt(r.stack)}</span></div>)}</div>;
}

export function PotSheet({ hand, t, onClose }: { hand: PublicHand; t: PublicTable; onClose: () => void }) {
  const res = hand.result!;
  const name = (i: number) => t.seats[i]?.name ?? `Seat ${i + 1}`;
  return (
    <Sheet title="Pot detail" onClose={onClose}>
      {res.refunds.map((r, i) => <div className="kv" key={'r' + i}><span>Returned to {name(r.seat)}</span><span>{fmt(r.amount)}</span></div>)}
      {res.awards.map((a, i) => (
        <div key={i} className="card-box" style={{ gap: 6 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}><b>{res.pots.length > 1 ? (a.potIndex === 0 ? 'Main pot' : `Side pot ${a.potIndex}`) : 'Pot'}{hand.boards ? ` · Board ${a.board === 0 ? 'A' : 'B'}` : ''}</b><span>{fmt(a.amount)}</span></div>
          <div className="fine">Eligible: {a.eligible.map(name).join(', ')}</div>
          {a.winners.map((w) => <div key={w.seat} className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}><span>{name(w.seat)} {w.name ? `· ${w.name}` : ''}</span><span className="row" style={{ gap: 2 }}>{w.cards.map((c) => <PlayingCard key={c} card={c} size="sm" />)}<b style={{ marginLeft: 6 }}>+{fmt(w.amount)}</b></span></div>)}
        </div>
      ))}
      {Object.keys(res.shows).length > 0 && <div className="stack" style={{ gap: 6 }}><div className="eyebrow">Showdown hands</div>{Object.entries(res.shows).map(([s, cards]) => <div key={s} className="row" style={{ justifyContent: 'space-between' }}><span>{name(+s)}</span><span className="row" style={{ gap: 2 }}>{cards.map((c) => <PlayingCard key={c} card={c} size="sm" />)}</span></div>)}</div>}
    </Sheet>
  );
}

export function RulesSheet({ rules, onClose }: { rules: TableRules; onClose: () => void }) {
  return (
    <Sheet title="House rules" onClose={onClose}>
      <KV rows={rulesRows(rules)} />
      <div className="stack" style={{ gap: 8, fontSize: 14 }}>
        <p style={{ margin: 0 }}>Dealer's Choice every hand: the dealer picks within 4 seconds, otherwise Hold'em. Hold'em is no limit; Omaha 4, 5 and 6 are pot limit and use exactly two hole cards with three from the board. Omaha 6 needs seven or fewer players.</p>
        <p style={{ margin: 0 }}>Each turn has 30 seconds. A timeout checks when it can, otherwise folds.{rules.mode === 'cash' ? ' Two missed turns in a row sits you out until you return.' : ''}</p>
        {rules.mode === 'cash' && <p style={{ margin: 0 }}>On the flop or turn, before any bet, the player to act may propose running it once or twice. If everyone still in agrees, betting ends and the rest is dealt. When nobody can bet any more, everyone chooses once or twice within 5 seconds; any once means once. Board A takes the odd chip. Odd chips in ties go clockwise from the dealer.</p>}
        <p style={{ margin: 0 }}>At a showdown every live hand is shown. If everyone else folds, only the winner may show cards, for 3 seconds.</p>
        {rules.mode === 'cash' ? <p style={{ margin: 0 }}>Reloads are any whole multiple of the buy-in unit, approved by the host, added before the next hand. New and returning players wait for the big blind, or post it to play straight away.</p> : <p style={{ margin: 0 }}>Freezeout: no rebuys. Levels run on the server clock from the start; a hand keeps the blinds it started with. Simultaneous bust-outs rank by the stack they started the hand with.</p>}
        <p className="fine">Play chips only. No money, no rake. Shuffles are cryptographically random on the server; nobody at the table can see the deck.</p>
      </div>
    </Sheet>
  );
}

export function MenuSheet(p: { t: PublicTable; rules: TableRules; myId: string; isHost: boolean; members: MemberRow[]; reloads: ReloadRow[]; names: Map<string, string>; onClose: () => void; run: (type: string, payload?: Record<string, unknown>) => Promise<void>; open: (s: 'accounts' | 'rules' | 'reload') => void; go: (to: string) => void; turnCue: string | null; onReturn: () => void }) {
  const me = p.t.seats.find((s) => s && s.playerId === p.myId) ?? null;
  const pendingMine = p.reloads.filter((r) => r.user_id === p.myId && (r.status === 'requested' || r.status === 'approved'));
  const pendingOthers = p.isHost ? p.reloads.filter((r) => r.status === 'requested' && r.user_id !== p.myId) : [];
  const [confirm, setConfirm] = useState<null | 'leave' | string>(null);
  const cash = p.rules.mode === 'cash';
  return (
    <Sheet title={p.t.rules.name} onClose={p.onClose} turnCue={p.turnCue} onReturn={p.onReturn}>
      <div className="grid2">
        <button type="button" className="btn btn-secondary" onClick={() => p.open('accounts')}>{cash ? 'Accounts' : 'Standings'}</button>
        <button type="button" className="btn btn-secondary" onClick={() => p.open('rules')}>Rules</button>
      </div>
      {me && cash && <button type="button" className="btn btn-secondary" onClick={() => p.open('reload')}>Reload chips</button>}
      {pendingMine.map((r) => <div className="notice" key={r.id}>Reload {fmt(Number(r.amount))}: {r.status === 'approved' ? 'approved, added before the next hand' : 'waiting for the host'} {r.status === 'requested' && <button type="button" className="btn btn-quiet" onClick={() => p.run('reload_cancel', { requestId: r.id })}>Cancel</button>}</div>)}
      {pendingOthers.map((r) => <div className="notice row" key={r.id} style={{ justifyContent: 'space-between' }}><span>{p.names.get(r.user_id) ?? 'Player'} asks for {fmt(Number(r.amount))}</span><span className="row"><button type="button" className="btn btn-quiet" onClick={() => p.run('reload_decide', { requestId: r.id, approve: false })}>Reject</button><button type="button" className="btn btn-primary" style={{ minHeight: 40, padding: '0 12px' }} onClick={() => p.run('reload_decide', { requestId: r.id, approve: true })}>Approve</button></span></div>)}
      {me && cash && (me.status === 'in' ? (
        <button type="button" className="btn btn-secondary" onClick={() => { void p.run('sitout'); p.onClose(); }}>Sit out after this hand</button>
      ) : (
        <div className="grid2"><button type="button" className="btn btn-secondary" onClick={() => { void p.run('return', { post: false }); p.onClose(); }}>I'm back · wait for BB</button><button type="button" className="btn btn-secondary" onClick={() => { void p.run('return', { post: true }); p.onClose(); }}>Post and play</button></div>
      ))}
      {me && cash && p.rules.straddle && <label className="toggle"><span>Straddle automatically when I'm first to act</span><input type="checkbox" checked={me.straddlePref} onChange={(e) => void p.run('straddle_pref', { pref: e.target.checked })} /></label>}
      <label className="toggle"><span>Reduce motion</span><input type="checkbox" defaultChecked={localStorage.getItem('allin.reducedMotion') === '1'} onChange={(e) => { try { localStorage.setItem('allin.reducedMotion', e.target.checked ? '1' : '0'); } catch { /* ignore */ } document.documentElement.toggleAttribute('data-reduce-motion', e.target.checked); }} /></label>
      <label className="toggle"><span>Sound effects</span><input type="checkbox" defaultChecked={soundEnabled()} onChange={(e) => { setSoundEnabled(e.target.checked); if (e.target.checked) playCue('turn'); }} /></label>
      {p.isHost && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="eyebrow">Host</div>
          {p.t.seats.map((s, i) => s && s.playerId !== p.myId ? <div className="list-row" key={i}><span>{s.name}</span><span className="row"><button type="button" className="btn btn-quiet" onClick={() => void p.run('transfer_host', { playerId: s.playerId })}>Make host</button><button type="button" className="btn btn-quiet" style={{ color: 'var(--danger)' }} onClick={() => setConfirm(s.playerId)}>Remove</button></span></div> : null)}
        </div>
      )}
      {me && (me.leaving && me.leaveReason === 'leave' ? <button type="button" className="btn btn-secondary" onClick={() => void p.run('cancel_leave')}>Stay after all</button> : <button type="button" className="btn btn-danger" onClick={() => setConfirm('leave')}>{cash ? 'Leave after this hand' : 'Leave the tournament'}</button>)}
      {!me && <button type="button" className="btn btn-secondary" onClick={() => p.go('/')}>Back to the lobby</button>}
      {confirm && (
        <div className="card-box">
          <b>{confirm === 'leave' ? (cash ? 'Leave after this hand? Your chips are taken off and recorded.' : 'Leave the tournament? Your stack stays in play and keeps posting blinds until it is gone.') : `Remove ${p.names.get(confirm) ?? 'this player'} after the hand?`}</b>
          <div className="grid2"><button type="button" className="btn btn-secondary" onClick={() => setConfirm(null)}>Keep playing</button><button type="button" className="btn btn-danger" onClick={async () => { await p.run(confirm === 'leave' ? 'leave' : 'remove', confirm === 'leave' ? {} : { playerId: confirm }); setConfirm(null); if (confirm === 'leave' && !cash) p.go('/'); }}>Confirm</button></div>
        </div>
      )}
    </Sheet>
  );
}

export function ReloadSheet({ unit, onClose, run }: { unit: number; onClose: () => void; run: (type: string, payload?: Record<string, unknown>) => Promise<void> }) {
  const [mult, setMult] = useState('1');
  const [err, setErr] = useState<string | null>(null);
  const m = parseInt(mult, 10);
  const ok = /^[1-9][0-9]*$/.test(mult);
  // A stable request id per chosen amount: retrying after a lost response reuses it, so the server's on-conflict insert
  // can never create a second request for the same intent. Changing the amount starts a fresh intent (new id).
  const reqId = useRef(crypto.randomUUID());
  useEffect(() => { reqId.current = crypto.randomUUID(); }, [mult]);
  return (
    <Sheet title="Reload chips" onClose={onClose}>
      <div className="chips">{[1, 2, 3, 5].map((k) => <button key={k} type="button" className="chip" aria-pressed={mult === String(k)} onClick={() => setMult(String(k))}>{fmt(k * unit)}</button>)}</div>
      <label className="field"><span>Or a number of {fmt(unit)}-chip units</span><input className="input" inputMode="numeric" value={mult} onChange={(e) => setMult(e.target.value)} aria-invalid={!ok} />{!ok && <span className="error">Whole number of units</span>}</label>
      {err && <div className="error" role="alert">{err}</div>}
      <button type="button" className="btn btn-primary" disabled={!ok} onClick={async () => { try { await run('reload_request', { requestId: reqId.current, amount: String(m * unit) }); onClose(); } catch (e) { setErr((e as Error).message); } }}>Request {ok ? fmt(m * unit) : ''}</button>
      <p className="fine">The host approves reloads. Chips are added before the next hand.</p>
    </Sheet>
  );
}
void common;
