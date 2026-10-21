import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Card, PublicEvent, VariantId } from '@allin/engine/public';
import { useSession } from '../state/session.tsx';
import { useNow, type TableView } from '../state/table.ts';
import { TransportError } from '../transport/index.ts';
import { SeatView } from './Seat.tsx';
import { Centre } from './Centre.tsx';
import { Hero } from './Hero.tsx';
import { AccountsSheet, ChatSheet, MenuSheet, PotSheet, ReloadSheet, RulesSheet } from './Sheets.tsx';
import { betPosition, seatPositions } from './geometry.ts';
import { reducedMotionPreferred, runDealAnimation } from './animator.ts';
import { limitLabel, variantLabel } from '../lib/format.ts';
import { fmt } from '../components/ui.tsx';
import './table.css';

export function TablePage({ view, go }: { view: TableView; go: (to: string) => void }) {
  const s = useSession();
  const row = view.row!; const t = row.state; const hand = t.hand;
  const me = s.player!;
  const mySeatIdx = t.seats.findIndex((x) => x && x.playerId === me.id);
  const mySeat = mySeatIdx >= 0 ? mySeatIdx : 0;
  const meSeat = mySeatIdx >= 0 ? t.seats[mySeatIdx] : null;
  const isHost = t.hostPlayerId === me.id;
  const now = useNow(true, s.clockOffset);
  const [pending, setPending] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | 'menu' | 'chat' | 'accounts' | 'pots' | 'rules' | 'reload'>(null);
  const [draft, setDraft] = useState('');
  const [seenChat, setSeenChat] = useState(-1);
  const [err, setErr] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [landscape, setLandscape] = useState(() => window.innerWidth > window.innerHeight && window.innerHeight < 500);
  useEffect(() => { const h = () => setLandscape(window.innerWidth > window.innerHeight && window.innerHeight < 500); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); }, []);

  // ---- event gate + animations ----
  const lastSeq = useRef<number>(-1);
  const [dealt, setDealt] = useState(true);           // false while the deal animation is in flight
  const [newBoardKeys, setNewBoardKeys] = useState<Set<string>>(new Set());
  const cancelAnim = useRef<(() => void) | null>(null);
  useEffect(() => {
    const events = t.events ?? [];
    if (lastSeq.current === -1) { lastSeq.current = t.seq; return; }         // snapshot resume: no replay
    const fresh = events.filter((e) => e.seq > lastSeq.current);
    if (!fresh.length) return;
    const gap = fresh[0].seq > lastSeq.current + 1 && events.length >= 60;
    lastSeq.current = t.seq;
    if (gap) { setDealt(true); return; }                                      // missed too much: jump to settled view
    const reduced = reducedMotionPreferred();
    for (const ev of fresh) {
      if (ev.type === 'deal' && hand && ev.handId === hand.id && rootRef.current) {
        cancelAnim.current?.();
        setDealt(false);
        cancelAnim.current = runDealAnimation(rootRef.current, ev as Extract<PublicEvent, { type: 'deal' }>, hand.id, reduced, () => { setDealt(true); cancelAnim.current = null; });
      }
      if (ev.type === 'board') {
        const keys = (ev as Extract<PublicEvent, { type: 'board' }>).cards.map((c) => `${(ev as { board: number }).board}:${c}`);
        setNewBoardKeys(new Set(keys));
        setTimeout(() => setNewBoardKeys(new Set()), 600);
      }
    }
  }, [t.seq, t.events, hand]);
  useEffect(() => () => { cancelAnim.current?.(); }, []);
  useEffect(() => { const h = () => { if (cancelAnim.current) { cancelAnim.current(); cancelAnim.current = null; setDealt(true); } }; window.addEventListener('orientationchange', h); return () => window.removeEventListener('orientationchange', h); }, []);
  // hand changed without an animation (reconnect/mid-hand): show settled cards
  useEffect(() => { if (!hand || hand.phase !== 'betting' || (hand.actionReadyAt && now >= hand.actionReadyAt + 2000)) setDealt(true); }, [hand?.id, hand?.phase, hand?.actionReadyAt, now, hand]);

  const run = useCallback(async (type: string, payload: Record<string, unknown> = {}) => {
    setPending(type); setErr(null);
    try { await s.transport.cmd(type, payload, row.id); await view.reload(); }
    catch (e) { const msg = e instanceof TransportError ? e.message : 'Could not reach the server'; setErr(msg); s.toast(msg); throw e; }
    finally { setPending(null); }
  }, [s, row.id, view]);
  const quiet = useCallback(async (type: string, payload: Record<string, unknown> = {}) => { try { await run(type, payload); } catch { /* toast shown */ } }, [run]);

  const names = useMemo(() => { const m = new Map<string, string>(); for (const x of t.seats) if (x) m.set(x.playerId, x.name); for (const p of view.participants) if (!m.has(p.user_id)) m.set(p.user_id, p.name); return m; }, [t.seats, view.participants]);
  const presence = useMemo(() => { const m = new Map<string, boolean>(); for (const mm of view.members) m.set(mm.user_id, !!mm.last_seen && now - new Date(mm.last_seen).getTime() < 30000); return m; }, [view.members, now]);
  const positions = useMemo(() => seatPositions(t.seats.length, mySeat, landscape), [t.seats.length, mySeat, landscape]);
  const legal = hand?.phase === 'betting' && hand.actor === mySeat ? hand.actorLegal : null;
  const myTurn = !!legal?.canAct && hand?.phase === 'betting';
  const turnCue = myTurn ? `Your turn${legal!.owed ? ` · ${fmt(legal!.call)} to call` : ''}` : hand?.phase === 'choice' && hand.chooserSeat === mySeat ? 'Your deal: pick the game' : null;
  const unread = seenChat < 0 ? 0 : view.chat.filter((c) => c.id > seenChat && c.user_id !== me.id).length;
  useEffect(() => { if (sheet === 'chat' && view.chat.length) setSeenChat(view.chat[view.chat.length - 1].id); }, [sheet, view.chat]);
  useEffect(() => { if (seenChat === -1 && view.loaded) setSeenChat(view.chat.length ? view.chat[view.chat.length - 1].id : 0); }, [view.chat, view.loaded, seenChat]);

  const stakes: string[] = [];
  if (hand?.variant) stakes.push(`${variantLabel(hand.variant)} · ${limitLabel(hand.variant)}`); else stakes.push("Dealer's Choice");
  if (row.mode === 'tournament' && t.tournament) { const L = row.config.levels[hand?.level ?? t.tournament.level]; stakes.push(`Level ${(hand?.level ?? t.tournament.level) + 1} · ${L.sb}/${L.bb}${L.ante ? ` a${L.ante}` : ''}`); }
  else stakes.push(`Blinds ${hand?.sb ?? row.config.sb}/${hand?.bb ?? row.config.bb}${(hand?.ante ?? row.config.ante) ? ` · ante ${hand?.ante ?? row.config.ante}` : ''}`);
  const notice = !view.connected ? 'Reconnecting… the server clock keeps running' : t.error ? 'This table stopped after a problem. Tell the host.' : err ?? (hand?.phase === 'result' ? 'Next hand in a moment' : t.waitingReason ?? '');

  const winTotals = hand?.result?.totals ?? {};
  const winCardsBySeat = new Map<number, Card[]>();
  if (hand?.result) for (const a of hand.result.awards) for (const w of a.winners) winCardsBySeat.set(w.seat, [...(winCardsBySeat.get(w.seat) ?? []), ...w.cards]);

  return (
    <div className="game" ref={rootRef}>
      <div className="g-head">
        <div className="g-head-row">
          <div className="g-title">{row.name}</div>
          <button type="button" className="g-icon" aria-label={unread ? `Chat, ${unread} unread` : 'Chat'} onClick={() => setSheet('chat')}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17H6.5A2.5 2.5 0 0 1 4 14.5z" /></svg>
            {unread > 0 && <span className="badge">{unread}</span>}
          </button>
          <button type="button" className="g-icon" aria-label="Table menu" onClick={() => setSheet('menu')}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </div>
        <div className="g-stakes">{stakes.map((x, i) => <span key={i}>{i === 0 ? <b>{x}</b> : x}</span>)}{hand && <span>Hand {hand.handNo}</span>}</div>
        <div className="g-notice" role="status">{notice}</div>
      </div>
      <div className="g-surface">
        <div className="felt" aria-hidden="true" />
        <span className="deck-anchor" data-deck aria-hidden="true" />
        {t.seats.map((seat, i) => {
          if (i === mySeatIdx) return null;
          if (!seat) return <span key={i} className="seat-empty" style={{ left: positions[i].left + '%', top: positions[i].top + '%' }} aria-hidden="true" />;
          const shows = hand?.result?.shows?.[i] ?? null;
          const revealed = hand?.revealedCards?.[i];
          const shown: Card[] | null = shows ? shows : revealed && revealed.length ? Array.from({ length: hand!.players.find((p) => p.seat === i)?.holeCount ?? 0 }, (_, k) => revealed.find((r) => r.index === k)?.card ?? null).filter((c): c is Card => c !== null) : null;
          return <SeatView key={i} index={i} seat={seat} hand={hand} pos={positions[i]} betPos={betPosition(positions[i], landscape)} isHost={seat.playerId === t.hostPlayerId} present={presence.get(seat.playerId) ?? false} now={now} isMe={false} shownCards={shown} winCards={winCardsBySeat.get(i) ?? null} won={winTotals[i] ?? null} />;
        })}
        <Centre t={t} hand={hand} now={now} mySeat={mySeat} busy={pending !== null} onChoose={(v: VariantId) => void quiet('choose', { variant: v })} onStraddle={(a) => void quiet('straddle', { accept: a })} onVote={(c) => void quiet('vote', { choice: c })} onPots={() => setSheet('pots')} newBoardKeys={newBoardKeys} />
      </div>
      <Hero seatNames={t.seats.map((x) => x?.name ?? null)} hand={hand} mySeat={mySeat} me={meSeat} own={view.own?.cards ?? null} ownHandId={view.own?.handId ?? null} now={now} busy={pending !== null} pending={pending} legal={legal} dealt={dealt} connected={view.connected} isCash={row.mode === 'cash'}
        onAct={(a, to) => void quiet('act', a === 'raise' ? { action: 'raise', raiseTo: String(to) } : { action: a })}
        onPropose={(runs) => void quiet('propose', { runs })} onReveal={(what) => void quiet('reveal', what === 'all' || what === 'muck' ? { what } : { indices: what })} onReturn={(post) => void quiet('return', { post })} />
      {sheet === 'chat' && <ChatSheet chat={view.chat} names={names} myId={me.id} onSend={(body) => run('chat', { body })} onClose={() => setSheet(null)} turnCue={turnCue} onReturn={() => setSheet(null)} draft={draft} setDraft={setDraft} />}
      {sheet === 'menu' && <MenuSheet t={t} rules={row.config} myId={me.id} isHost={isHost} members={view.members} reloads={view.reloads} names={names} onClose={() => setSheet(null)} run={quiet} open={(x) => setSheet(x)} go={go} turnCue={turnCue} onReturn={() => setSheet(null)} />}
      {sheet === 'accounts' && <AccountsSheet t={t} ledger={view.ledger} participants={view.participants} mode={row.mode} onClose={() => setSheet(null)} turnCue={turnCue} onReturn={() => setSheet(null)} />}
      {sheet === 'pots' && hand?.result && <PotSheet hand={hand} t={t} onClose={() => setSheet(null)} />}
      {sheet === 'rules' && <RulesSheet rules={row.config} onClose={() => setSheet(null)} />}
      {sheet === 'reload' && <ReloadSheet unit={row.config.unit} onClose={() => setSheet(null)} run={run} />}
      {s.toastMsg && <div className="toast" role="status">{s.toastMsg}</div>}
    </div>
  );
}
