import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Card, PublicEvent, VariantId } from '@allin/engine/public';
import { currentBest, boardPresentationMs, showdownOrder, RULES } from '@allin/engine/public';
import { useSession } from '../state/session.tsx';
import { useNow, type TableView } from '../state/table.ts';
import { TransportError } from '../transport/index.ts';
import { SeatView } from './Seat.tsx';
import { Centre } from './Centre.tsx';
import { Hero } from './Hero.tsx';
import { AccountsSheet, ChatSheet, MenuSheet, PotSheet, ReloadSheet, RulesSheet } from './Sheets.tsx';
import { betPosition, seatPositions } from './geometry.ts';
import { DealerButton } from './DealerButton.tsx';
import { reducedMotionPreferred, runBurnAnimation, runDealAnimation } from './animator.ts';
import { limitLabel, variantLabel } from '../lib/format.ts';
import { playCue } from '../lib/sound.ts';
import { fmt } from '../components/ui.tsx';
import './table.css';

import { ChipSweep } from './ChipSweep';

export function TablePage({ view, go }: { view: TableView; go: (to: string) => void }) {
  const s = useSession();
  const row = view.row!; const t = row.state; const hand = t.hand;
  const me = s.player!;
  const mySeatIdx = t.seats.findIndex((x) => x && x.playerId === me.id);
  const mySeat = mySeatIdx;
  const meSeat = mySeatIdx >= 0 ? t.seats[mySeatIdx] : null;
  const isHost = t.hostPlayerId === me.id;
  const now = useNow(true, s.clockOffset);
  const [pending, setPending] = useState<string | null>(null);
  const [chosen, setChosen] = useState<VariantId | null>(null);        // confirmed by the server (locked in)
  const [submitting, setSubmitting] = useState<VariantId | null>(null); // sent, awaiting the server's acceptance
  const [sheet, setSheet] = useState<null | 'menu' | 'chat' | 'accounts' | 'pots' | 'rules' | 'reload'>(null);
  const [draft, setDraft] = useState('');
  const [seenChat, setSeenChat] = useState(-1);
  const [err, setErr] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [landscape, setLandscape] = useState(() => window.innerWidth > window.innerHeight && window.innerHeight < 500);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const update = () => { const {width, height} = root.getBoundingClientRect(); setLandscape(width > height && height < 500); };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // ---- event gate + animations ----
  const lastSeq = useRef<number>(-1);
  const [dealt, setDealt] = useState(true);           // false while the deal animation is in flight
  const [newBoardKeys, setNewBoardKeys] = useState<Set<string>>(new Set());
  const [presentationUntil, setPresentationUntil] = useState(0);
  const [boardLead, setBoardLead] = useState(0);        // ms the current board reveal waits for a preceding burn to show
  const [sweeps, setSweeps] = useState<{ id: number; left: number; top: number }[]>([]);
  const sweepId = useRef(0);
  const boardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelAnim = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const events = t.events ?? [];
    if (lastSeq.current === -1) { lastSeq.current = t.seq; return; }         // snapshot resume: no replay
    const fresh = events.filter((e) => e.seq > lastSeq.current);
    if (!fresh.length) return;
    const gap = fresh[0].seq > lastSeq.current + 1 && events.length >= 60;
    lastSeq.current = t.seq;
    if (gap) { cancelAnim.current?.(); cancelAnim.current = null; setDealt(true); return; }                                      // missed too much: jump to settled view
    const reduced = reducedMotionPreferred();
    let lead = 0; // a burn announced just before a street: the street's reveal waits this long so the burn is seen first
    const boardKeys = new Set<string>();
    let boardDuration = 0;
    for (const ev of fresh) {
      if (ev.handId !== hand?.id) continue;
      if (ev.type === 'deal' && hand?.phase === 'betting' && now < (hand.actionReadyAt ?? 0) && ev.handId === hand.id && rootRef.current) {
        cancelAnim.current?.();
        setDealt(false);
        cancelAnim.current = runDealAnimation(rootRef.current, ev as Extract<PublicEvent, { type: 'deal' }>, hand.id, reduced, () => { setDealt(true); cancelAnim.current = null; });
      }
      if (ev.type === 'burn' && rootRef.current) {
        // the server burned a hidden card ahead of a street: one face-down card leaves the deck. The event carries no
        // card, so nothing can be exposed here.
        lead = runBurnAnimation(rootRef.current, reduced);
      }
      if (ev.type === 'board') {
        const keys = (ev as Extract<PublicEvent, { type: 'board' }>).cards.map((c) => `${(ev as { board: number }).board}:${c}`);
        boardDuration += boardPresentationMs(ev.cards.length);
        for (const key of keys) boardKeys.add(key);
        setPresentationUntil(reduced ? 0 : now + boardDuration);
        setBoardLead(lead);
        setNewBoardKeys(new Set(boardKeys));
        if (boardTimer.current) clearTimeout(boardTimer.current);
        boardTimer.current = setTimeout(() => setNewBoardKeys(new Set()), boardDuration + 20);
        lead = 0;
        // the previous street's bets have just collected into the pot: sweep a chip in from each contesting seat
        if (!reduced && hand) {
          const pos = seatPositions(t.seats.length, Math.max(0, mySeat), landscape);
          const spots = hand.players.filter((p) => !p.folded && pos[p.seat]).map((p) => { const bp = betPosition(pos[p.seat], landscape); return { id: sweepId.current++, left: bp.left, top: bp.top }; });
          if (spots.length) { setSweeps((cur) => [...cur, ...spots]); const ids = new Set(spots.map((sp) => sp.id)); setTimeout(() => setSweeps((cur) => cur.filter((sp) => !ids.has(sp.id))), 650); }
        }
      }
    }
  }, [t.seq, t.events, hand]);
  useEffect(() => () => { cancelAnim.current?.(); if (boardTimer.current) clearTimeout(boardTimer.current); }, []);
  useEffect(() => { const h = () => { if (cancelAnim.current) { cancelAnim.current(); cancelAnim.current = null; setDealt(true); } }; window.addEventListener('orientationchange', h); return () => window.removeEventListener('orientationchange', h); }, []);
  // hand changed without an animation (reconnect/mid-hand): show settled cards
  useEffect(() => { if (!hand || hand.phase !== 'betting' || (hand.actionReadyAt && now >= hand.actionReadyAt + 2000)) setDealt(true); }, [hand?.id, hand?.phase, hand?.actionReadyAt, now, hand]);
  // clear the local dealer's-choice lock once the hand moves on or a new hand begins
  useEffect(() => { if (hand?.phase !== 'choice') { setChosen(null); setSubmitting(null); } }, [hand?.phase, hand?.id]);
  // Pick a variant: show "Submitting" until the server accepts, only then "Locked in". A failed request clears the
  // pending state (no optimistic lock) so the chooser sees the error and can simply tap again — the first command has
  // already resolved, so retrying never stacks a duplicate.
  const choose = useCallback(async (v: VariantId) => {
    if (submitting || chosen) return;
    setSubmitting(v); setErr(null);
    try { await s.transport.cmd('choose', { variant: v }, row.id); await view.reload('game'); setChosen(v); }
    catch (e) { const msg = e instanceof TransportError ? e.message : 'Could not reach the server'; setErr(msg); s.toast(msg); }
    finally { setSubmitting(null); }
  }, [submitting, chosen, s, row.id, view]);

  const run = useCallback(async (type: string, payload: Record<string, unknown> = {}) => {
    setPending(type); setErr(null);
    try { await s.transport.cmd(type, payload, row.id); await view.reload(type === 'chat' ? 'chat' : 'game'); }
    catch (e) { const msg = e instanceof TransportError ? e.message : 'Could not reach the server'; setErr(msg); s.toast(msg); throw e; }
    finally { setPending(null); }
  }, [s, row.id, view]);
  const quiet = useCallback(async (type: string, payload: Record<string, unknown> = {}) => { try { await run(type, payload); return true; } catch { return false; /* toast shown */ } }, [run]);
  // fire-and-forget command that does NOT flip `pending` (so it never disables the action/choice controls)
  const silent = useCallback(async (type: string, payload: Record<string, unknown> = {}) => { try { await s.transport.cmd(type, payload, row.id); await view.reload(type === 'chat' ? 'chat' : 'game'); } catch { /* ignore */ } }, [s, row.id, view]);
  // Readiness: the moment the chooser's client actually displays the choice, confirm it to the server so the usable
  // dealer's-choice window is re-anchored from here. This stops cold-start/idle discovery latency from eating the window.
  const readyRef = useRef<string | null>(null);
  useEffect(() => {
    if (hand && hand.phase === 'choice' && hand.chooserSeat === mySeat && readyRef.current !== hand.id) {
      readyRef.current = hand.id;
      void silent('choice_ready');
    }
  }, [hand, hand?.id, hand?.phase, hand?.chooserSeat, mySeat, silent]);
  // Once we have asked to leave, drive the transition to the session summary ourselves. The exit commits at the next hand
  // boundary; rather than depend on the table-state poll noticing our seat vanish (which can lag on a cold/idle transport),
  // poll our own participant row for `left_at` and navigate as soon as it is recorded.
  useEffect(() => {
    if (!meSeat?.leaving || row.mode !== 'cash') return;
    let stop = false; let timer: ReturnType<typeof setTimeout>;
    const check = async (): Promise<void> => {
      try {
        const parts = await s.transport.query<{ left_at: string | null }>('session_participants', { table_id: row.id, user_id: me.id });
        if (!stop && parts[0]?.left_at) { go('/session/' + row.id); return; }
      } catch { /* ignore and retry */ }
      if (!stop) timer = setTimeout(() => void check(), 2500);
    };
    timer = setTimeout(() => void check(), 2500);
    return () => { stop = true; clearTimeout(timer); };
  }, [meSeat?.leaving, row.mode, row.id, me.id, s.transport, go]);

  const names = useMemo(() => { const m = new Map<string, string>(); for (const x of t.seats) if (x) m.set(x.playerId, x.name); for (const p of view.participants) if (!m.has(p.user_id)) m.set(p.user_id, p.name); return m; }, [t.seats, view.participants]);
  const presence = useMemo(() => { const m = new Map<string, boolean>(); for (const mm of view.members) m.set(mm.user_id, !!mm.last_seen && now - new Date(mm.last_seen).getTime() < 30000); return m; }, [view.members, now]);
  const positions = useMemo(() => seatPositions(t.seats.length, Math.max(0, mySeat), landscape), [t.seats.length, mySeat, landscape]);
  // place a small table marker (dealer button, blind chip) just inside a seat, toward the felt centre
  const legal = hand?.phase === 'betting' && hand.actor === mySeat ? hand.actorLegal : null;
  const myTurn = !!legal?.canAct && hand?.phase === 'betting';
  // optional sound cues (no-op unless the player turned them on): a chime on the rising edge of our turn, and on a win
  const cuedTurn = useRef(false);
  useEffect(() => { if (myTurn && !cuedTurn.current) { cuedTurn.current = true; playCue('turn'); } else if (!myTurn) cuedTurn.current = false; }, [myTurn]);
  const wonCueRef = useRef<string | null>(null);
  useEffect(() => { if (hand?.result && (hand.result.totals[mySeat] ?? 0) > 0 && wonCueRef.current !== hand.id) { wonCueRef.current = hand.id; playCue('win'); } }, [hand?.id, hand?.result, mySeat]);
  const turnCue = myTurn ? `Your turn${legal!.owed ? ` · ${fmt(legal!.call)} to call` : ''}` : hand?.phase === 'choice' && hand.chooserSeat === mySeat ? 'Your deal: pick the game' : null;
  const unread = seenChat < 0 ? 0 : view.chat.filter((c) => c.id > seenChat && c.user_id !== me.id).length;
  useEffect(() => { if (sheet === 'chat' && view.chat.length) setSeenChat(view.chat[view.chat.length - 1].id); }, [sheet, view.chat]);
  useEffect(() => { if (seenChat === -1 && view.loaded) setSeenChat(view.chat.length ? view.chat[view.chat.length - 1].id : 0); }, [view.chat, view.loaded, seenChat]);

  const stakes: string[] = [];
  if (hand?.variant) stakes.push(`${variantLabel(hand.variant)} · ${limitLabel(hand.variant)}`); else stakes.push("Dealer's Choice");
  if (row.mode === 'tournament' && t.tournament) { const L = row.config.levels[hand?.level ?? t.tournament.level]; stakes.push(`${row.config.levels.length === 1 ? "Blinds" : `Level ${(hand?.level ?? t.tournament.level) + 1} ·`} ${hand?.sb ?? L.sb}/${hand?.bb ?? L.bb}${L.ante ? ` a${L.ante}` : ''}`); }
  else stakes.push(`Blinds ${hand?.sb ?? row.config.sb}/${hand?.bb ?? row.config.bb}${(hand?.ante ?? row.config.ante) ? ` · ante ${hand?.ante ?? row.config.ante}` : ''}`);
  const notice = !view.connected ? 'Reconnecting…' : t.closeRequested ? 'Table closes after this hand' : t.error ? 'This table stopped after a problem. Tell the host.' : err ?? (t.waitingReason ?? '');

  // the viewer's own best made hand so far (flop onward), with the contributing cards for an on-tap highlight
  const made = useMemo(() => {
    const own = view.own; const b = hand?.board ?? [];
    if (!hand || !hand.variant || hand.phase === 'result' || !own || own.handId !== hand.id) return null;
    try { return currentBest(own.cards, b, hand.variant); } catch { return null; }
  }, [hand, view.own]);
  const [madeShown, setMadeShown] = useState(false);
  useEffect(() => { setMadeShown(false); }, [hand?.id]);
  const madeSet = useMemo(() => (madeShown && made ? new Set<Card>(made.cards) : null), [madeShown, made]);

  const resultAge = hand?.result && hand.nextAt ? now - (hand.nextAt - (hand.result.uncontested ? RULES.timers.revealMs : RULES.timers.showdownMs)) : 0;
  const revealCount = Object.keys(hand?.result?.shows ?? {}).length;
  const revealStep = Math.min(650, Math.floor((RULES.timers.showdownMs - 3500) / Math.max(1, revealCount)));
  const awardDelay = hand?.result?.uncontested ? 0 : 700 + revealCount * revealStep;
  const awardReady = !!hand?.result && resultAge >= awardDelay;
  // Keep the mount eligible throughout the result: slow delivery must not miss a 2.2s server-time window.
  const winnerBurst = awardReady;
  const winTotals = awardReady ? hand?.result?.totals ?? {} : {};
  const winCardsBySeat = new Map<number, Card[]>();
  if (awardReady && hand?.result) for (const a of hand.result.awards) for (const w of a.winners) winCardsBySeat.set(w.seat, [...(winCardsBySeat.get(w.seat) ?? []), ...w.cards]);
  // Final-street aggressor first, otherwise clockwise from left of the button; never winner-dependent.
  const revealDelay = new Map<number, number>();
  if (hand?.result && !hand.result.uncontested && hand.result.shows && hand.button !== null) {
    const shown = new Set(Object.keys(hand.result.shows).map(Number));
    const n = t.seats.length;
    showdownOrder(hand.log, hand.button, n, [...shown]).forEach((seat, index) => revealDelay.set(seat, 500 + index * revealStep));
  }

  // Compact last-hand recap: captured when a hand settles, shown through the next hand. Winner, amount and the made-hand
  // name only — never a mucked hole card (we read awards/totals, which expose nothing a loser kept face-down).
  const [recap, setRecap] = useState<{ handNo: number; uncontested: boolean; wins: { who: string; amount: number; hand: string }[] } | null>(null);
  const recapForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hand?.result || recapForRef.current === hand.id) return;
    recapForRef.current = hand.id;
    const res = hand.result;
    const cat = new Map<number, string>();
    for (const a of res.awards) for (const w of a.winners) if (w.name) cat.set(w.seat, w.name);
    const wins = Object.entries(res.totals).map(([seat, amount]) => ({ who: t.seats[+seat]?.name ?? 'Seat', amount: amount as number, hand: cat.get(+seat) ?? '' })).filter((w) => w.amount > 0);
    if (wins.length) setRecap({ handNo: hand.handNo, uncontested: res.uncontested, wins });
  }, [hand?.id, hand?.result, hand?.handNo, t.seats]);

  return (
    <div className="game" ref={rootRef}>
      <div className="g-head">
        <div className="g-head-row">
          <div className="g-title">{row.name}</div>
          <div className="deal-station" aria-hidden="true">
            <span className="deck-anchor pc back" data-deck />
            <span className={`burn-pile pc back ${hand?.log.some(e => e.t === 'burn') ? 'has-burn' : ''}`} data-burn-pile />
          </div>
          <button type="button" className="g-icon" aria-label={unread ? `Chat, ${unread} unread` : 'Chat'} onClick={() => setSheet('chat')}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17H6.5A2.5 2.5 0 0 1 4 14.5z" /></svg>
            {unread > 0 && <span className="badge">{unread}</span>}
          </button>
          <button type="button" className="g-icon" aria-label="Table menu" onClick={() => setSheet('menu')}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </div>
        <div className="g-stakes">{stakes.map((x, i) => <span key={i}>{i === 0 ? <b>{x}</b> : x}</span>)}{hand && <span>Hand {hand.handNo}</span>}{t.orbit && t.orbit.variant && t.orbit.handsTotal > 1 && <span>Orbit {Math.min(t.orbit.handsPlayed, t.orbit.handsTotal)}/{t.orbit.handsTotal}</span>}</div>
        {recap && (!hand?.result || hand.handNo !== recap.handNo) && (
          <div className="g-recap" role="status" aria-label="Last hand result">
            <span className="g-recap-tag">Last hand</span>
            <span className="g-recap-body">{recap.wins.map((w, i) => <span key={i}>{i > 0 ? ' · ' : ''}{w.who} won {fmt(w.amount)}</span>)}</span>
          </div>
        )}
        <div className="g-notice" role="status">{notice}</div>
      </div>
      <div className="g-surface">
        <div className="felt" aria-hidden="true" />
        {meSeat && <div className="g-own-seat" data-seat={mySeat} />}

        {sweeps.map((sp) => <ChipSweep key={sp.id} from={{ left: sp.left, top: sp.top }} />)}
        {t.seats.map((seat, i) => {
          if (i === mySeatIdx) return null;
          if (!seat) return <span key={i} className="seat-empty" style={{ left: positions[i].left + '%', top: positions[i].top + '%' }} aria-hidden="true" />;
          const shows = hand?.result?.shows?.[i] ?? null;
          const revealed = hand?.revealedCards?.[i];
          const shown: Card[] | null = shows ? shows : revealed && revealed.length ? Array.from({ length: hand!.players.find((p) => p.seat === i)?.holeCount ?? 0 }, (_, k) => revealed.find((r) => r.index === k)?.card ?? null).filter((c): c is Card => c !== null) : null;
          return <SeatView key={i} index={i} seat={seat} hand={hand} pos={positions[i]} isHost={seat.playerId === t.hostPlayerId} present={presence.get(seat.playerId) ?? false} now={now} isMe={false} shownCards={shown} winCards={winCardsBySeat.get(i) ?? null} won={winTotals[i] ?? null} revealDelayMs={revealDelay.get(i)} winnerBurst={winnerBurst} />;
        })}
        {hand && hand.button !== null && positions[hand.button] && <DealerButton seat={hand.button} />}
        <Centre awardReady={awardReady} t={t} hand={hand} now={now} mySeat={mySeat} busy={pending !== null} chosen={chosen} submitting={submitting} onChoose={(v: VariantId) => void choose(v)} onStraddle={(a) => void quiet('straddle', { accept: a })} onVote={(c) => void quiet('vote', { choice: c })} onPots={() => setSheet('pots')} newBoardKeys={newBoardKeys} boardLeadMs={boardLead} madeBoard={madeSet} />
      </div>
      {!meSeat && !hand?.result ? <div className="g-hero spectator-dock"><strong>Watching</strong><span className="dock-note">Private cards stay hidden</span><button className="btn-game btn-game-primary" disabled={t.closeRequested || !t.seats.some(seat => !seat)} onClick={() => go('/seat/' + row.invite_code)}>Take a seat</button></div> : <Hero awardReady={awardReady} winnerBurst={winnerBurst} seatNames={t.seats.map((x) => x?.name ?? null)} hand={hand} mySeat={mySeat} me={meSeat} own={view.own?.cards ?? null} ownHandId={view.own?.handId ?? null} now={now} busy={pending !== null} pending={pending} legal={legal} presentationUntil={presentationUntil} dealt={dealt} connected={view.connected} isCash={row.mode === 'cash'}
        onAct={(a, to) => void quiet('act', a === 'raise' ? { action: 'raise', raiseTo: String(to) } : { action: a })}
        onPropose={(runs) => void quiet('propose', { runs })} onReveal={(what) => void quiet('reveal', what === 'all' || what === 'muck' ? { what } : { indices: what })} onReturn={(post) => void quiet('return', { post })}
        made={made} madeShown={madeShown} madeSet={madeSet} onToggleMade={() => setMadeShown((v) => !v)} />}
      {sheet === 'chat' && <ChatSheet chat={view.chat} reactions={view.reactions} names={names} myId={me.id} onSend={(body) => run('chat', { body })} onReact={async (messageId, emoji, op) => { await s.transport.cmd('react', { messageId, emoji, op }, row.id); await view.reload('chat'); }} onClose={() => setSheet(null)} turnCue={turnCue} onReturn={() => setSheet(null)} draft={draft} setDraft={setDraft} />}
      {sheet === 'menu' && <MenuSheet t={t} rules={row.config} myId={me.id} isHost={isHost} members={view.members} reloads={view.reloads} names={names} onClose={() => setSheet(null)} run={quiet} open={(x) => setSheet(x)} go={go} turnCue={turnCue} onReturn={() => setSheet(null)} />}
      {sheet === 'accounts' && <AccountsSheet t={t} ledger={view.ledger} participants={view.participants} mode={row.mode} onClose={() => setSheet(null)} turnCue={turnCue} onReturn={() => setSheet(null)} />}
      {sheet === 'pots' && hand?.result && <PotSheet hand={hand} t={t} onClose={() => setSheet(null)} />}
      {sheet === 'rules' && <RulesSheet rules={row.config} onClose={() => setSheet(null)} />}
      {sheet === 'reload' && <ReloadSheet unit={row.config.unit} onClose={() => setSheet(null)} run={run} />}
      {s.toastMsg && <div className="toast" role="status">{s.toastMsg}</div>}
    </div>
  );
}
