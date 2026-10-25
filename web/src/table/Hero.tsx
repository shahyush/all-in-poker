import { useEffect, useState, type CSSProperties } from 'react';
import { parseChipAmount, type BestHand, type Card, type LegalActions, type PublicHand, type SeatState } from '@allin/engine/public';
import {Showdown} from './Showdown';
import {WinnerCelebration} from './WinnerCelebration';
import { PlayingCard } from './Card.tsx';
import { Sheet, fmt } from '../components/ui.tsx';
import { timeLeft } from '../lib/format.ts';

export interface HeroProps {
  awardReady?: boolean; winnerBurst?: boolean;
  seatNames: (string | null)[];
  hand: PublicHand | null; mySeat: number; me: SeatState | null; own: Card[] | null; ownHandId: string | null; now: number; busy: boolean; pending: string | null;
  legal: LegalActions | null; presentationUntil?: number; dealt: boolean; connected: boolean; isCash: boolean;
  made: BestHand | null; madeShown: boolean; madeSet: Set<Card> | null; onToggleMade(): void;
  onAct(action: 'fold' | 'check' | 'call' | 'raise', raiseTo?: number): void;
  onPropose(runs: 1 | 2): void; onReveal(what: number[] | 'all' | 'muck'): void; onReturn(post: boolean): void;
}

export function Hero(p: HeroProps) {
  const { hand, mySeat, me, own, now, busy, pending, legal, isCash } = p;
  const [composer, setComposer] = useState(false);
  const inHand = !!hand?.players.find((x) => x.seat === mySeat);
  const myHp = hand?.players.find((x) => x.seat === mySeat) ?? null;
  const myTurn = !!legal && legal.canAct;
  const deadline = myTurn ? hand?.deadline ?? null : null;
  const secs = timeLeft(deadline, now);
  const ready = now >= Math.max(hand?.actionReadyAt ?? 0, p.presentationUntil ?? 0);
  const frac = deadline ? Math.max(0, Math.min(1, (deadline - now) / 30000)) : 0;
  useEffect(() => { if (!myTurn) setComposer(false); }, [myTurn]);
  const showCards = own && hand && p.ownHandId === hand.id && myHp && !myHp.folded;
  const canPropose = isCash && myTurn && hand && !hand.boards && (hand.street === 'flop' || hand.street === 'turn') && hand.currentBet === 0 && !hand.players.some((x) => x.bet > 0) && !hand.proposedStreets.includes(hand.street) && hand.players.filter((x) => !x.folded).length > 1;
  const revealOpen = hand?.phase === 'result' && hand.result?.uncontested && hand.result.winnerSeat === mySeat && hand.revealDeadline !== null && now <= hand.revealDeadline;
  const revealed = new Set(myHp?.revealed ?? []);
  const winCards = new Set<Card>();
  if (p.awardReady && hand?.result) for (const a of hand.result.awards) for (const w of a.winners) if (w.seat === mySeat) for (const c of w.cards) winCards.add(c);
  const turnLabel = !p.connected ? 'Reconnecting…' : !ready ? 'Dealing…' : pending ? 'Sending…' : myTurn && ready ? (legal!.owed > 0 ? `Your turn · ${fmt(legal!.call)} to call` : 'Your turn') : hand?.phase === 'betting' && hand.actor !== null ? `Waiting for ${hand.actor === mySeat ? 'you' : p.seatNames[hand.actor] ?? 'seat ' + (hand.actor + 1)}` : hand?.phase === 'result' ? (revealOpen ? `Show your cards? ${timeLeft(hand.revealDeadline, now)}s` : 'Next hand shortly') : '';
  if (hand?.result && !hand.result.uncontested && p.awardReady && hand.result.awards.some(a => a.winners.some(w => w.cards.length === 5))) {
    return <Showdown key={hand.id} hand={hand} names={p.seatNames} stack={me?.stack} />;
  }
  return (
    <div className="g-hero">
      <div className="hero-top">
        <div className="own-cards" style={{'--hole-count': myHp?.holeCount ?? 2} as CSSProperties} aria-label={showCards ? 'Your cards' : 'Your cards appear here'} data-seat={mySeat} data-own>
          {showCards ? own!.map((c, i) => (<span className="deal-slot" data-slot={i} key={i}>
            {revealOpen || revealed.has(i)
              ? <PlayingCard key={i} card={c} as="button" label={`${revealed.has(i) ? 'Shown: ' : 'Tap to show: '}card ${i + 1}`} onClick={() => !revealed.has(i) && p.onReveal([i])} tag={revealed.has(i) ? 'Shown' : undefined} ariaPressed={revealed.has(i)} win={winCards.has(c)} hi={!!p.madeSet?.has(c)} />
              : <PlayingCard key={i} card={c} win={winCards.has(c)} dim={winCards.size > 0 && !winCards.has(c)} hi={!!p.madeSet?.has(c)} />}
          </span>)) : inHand && hand ? Array.from({ length: myHp?.holeCount || 2 }).map((_, i) => <span key={i} className="deal-slot" data-slot={i}><span className="pc back" aria-hidden="true" style={{ opacity: myHp?.folded ? 0.4 : 1 }} /></span>) : <span className="dock-note">{me ? (me.status === 'sitout' ? 'Sitting out' : hand ? 'Dealt in next hand' : '') : 'Watching'}</span>}
        </div>
        <div className={`hero-meta ${p.awardReady && (hand?.result?.totals[mySeat] ?? 0) > 0 ? 'hero-winner' : ''}`}>
          {p.winnerBurst && (hand?.result?.totals[mySeat] ?? 0) > 0 && <WinnerCelebration key={hand?.id} />}
          <span>{me ? 'Your stack' : ''}</span>
          <b>{me ? fmt(me.stack) : ''}</b>
          {myHp && myHp.bet > 0 && <span>In front {fmt(myHp.bet)}</span>}
          {myHp?.folded && <span>Folded</span>}
          {myHp?.allIn && !myHp.folded && <span>All-in</span>}
        </div>
      </div>
      {showCards && p.made && (
        <button type="button" className="hand-label" aria-pressed={p.madeShown} onClick={p.onToggleMade}>
          <span>{hand?.boards ? 'Board A' : 'Your hand'}</span><b>{p.made.name}</b>
        </button>
      )}
      <div className={`turn-line ${myTurn && secs <= 10 ? 'urgent' : ''}`} aria-live="polite"><span>{turnLabel}</span><span>{myTurn && ready && deadline ? `${secs}s` : ''}</span></div>
      <div className="turn-bar" aria-hidden="true"><i className="motion" style={{ width: (myTurn ? frac * 100 : 0) + '%' }} /></div>
      {me && me.status === 'sitout' && !hand?.players.some((x) => x.seat === mySeat) && (
        <div className="propose-row"><button type="button" onClick={() => p.onReturn(false)}>I'm back · wait for big blind</button>{me.owesBB && <button type="button" onClick={() => p.onReturn(true)}>Post and play</button>}</div>
      )}
      {revealOpen ? (
        <div className="reveal-row">
          <button type="button" className="btn-game" disabled={busy} onClick={() => p.onReveal('muck')}>Muck</button>
          <button type="button" className="btn-game btn-game-primary" disabled={busy} onClick={() => p.onReveal('all')}>Show all</button>
        </div>
      ) : hand?.phase === 'betting' ? (
        <>
          <div className="dock" role="group" aria-label="Actions">
            <button type="button" className="fold" disabled={!myTurn || busy || !ready} onClick={() => p.onAct('fold')}>Fold</button>
            <button type="button" className="call" disabled={!myTurn || busy || !ready} onClick={() => p.onAct(legal && legal.owed > 0 ? 'call' : 'check')}>{legal && legal.owed > 0 ? `Call ${fmt(legal.call)}` : 'Check'}</button>
            <button type="button" className="raise" disabled={!myTurn || busy || !ready || !legal?.raise} onClick={() => setComposer(true)}>{legal?.raise?.isBet ? 'Bet' : 'Raise'}</button>
          </div>
          <div className="dock-note">{!ready && inHand ? '' : legal?.raiseClosed && myTurn ? legal.raiseClosed : legal?.raise && legal.allInTo === null && legal.raise.maxTo < legal.stack + legal.bet ? `Max ${fmt(legal.raise.maxTo)}` : ''}</div>
          {canPropose && <div className="propose-row"><button type="button" disabled={busy || !ready || !hand!.canRunTwice} onClick={() => p.onPropose(2)}>Two boards · keep betting</button></div>}
        </>
      ) : null}
      {composer && legal?.raise && <Composer legal={legal} hand={hand!} onClose={() => setComposer(false)} onSubmit={(to) => { setComposer(false); p.onAct('raise', to); }} />}
    </div>
  );
}


function Composer({ legal, hand, onClose, onSubmit }: { legal: LegalActions; hand: PublicHand; onClose: () => void; onSubmit: (to: number) => void }) {
  const r = legal.raise!;
  const [text, setText] = useState(String(r.minTo));
  const val = parseChipAmount(text);
  const valid = val !== null && val >= r.minTo && val <= r.maxTo;
  const pot = legal.pot;
  const presets: { label: string; to: number }[] = [];
  const add = (label: string, to: number) => { to = Math.max(r.minTo, Math.min(r.maxTo, Math.floor(to))); if (!presets.some((x) => x.to === to)) presets.push({ label, to }); };
  add('Min', r.minTo);
  const potAfterCall = pot + legal.owed;
  add('½ pot', legal.bet + legal.owed + Math.floor(potAfterCall / 2));
  add('¾ pot', legal.bet + legal.owed + Math.floor(potAfterCall * 3 / 4));
  add('Pot', legal.bet + legal.owed + potAfterCall);
  if (legal.allInTo !== null) add('All-in', legal.allInTo); else add('Max', r.maxTo);
  const adds = val !== null ? Math.max(0, val - legal.bet) : null;
  const step = hand.bb;
  return (
    <Sheet title={r.isBet ? 'Bet' : 'Raise to'} onClose={onClose}>
      <div className="chips">{presets.map((x) => <button key={x.label} type="button" className="chip" aria-pressed={val === x.to} onClick={() => setText(String(x.to))}>{x.label} · {fmt(x.to)}</button>)}</div>
      <div className="row">
        <button type="button" className="chip" style={{ width: 48, padding: 0 }} aria-label="Less" onClick={() => setText(String(Math.max(r.minTo, (val ?? r.minTo) - step)))}>−</button>
        <input className="input" inputMode="numeric" aria-label="Amount" value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1, textAlign: 'center', fontSize: 20, fontWeight: 700 }} />
        <button type="button" className="chip" style={{ width: 48, padding: 0 }} aria-label="More" onClick={() => setText(String(Math.min(r.maxTo, (val ?? r.minTo) + step)))}>+</button>
      </div>
      <div className="fine">Between {fmt(r.minTo)} and {fmt(r.maxTo)}{adds !== null && valid ? ` · adds ${fmt(adds)}${val === legal.allInTo ? ' (all-in)' : ''}` : ''}</div>
      {!valid && text !== '' && <div className="error" role="alert">Enter a whole number between {fmt(r.minTo)} and {fmt(r.maxTo)}</div>}
      <button type="button" className="btn btn-primary" disabled={!valid} onClick={() => valid && onSubmit(val!)}>{r.isBet ? 'Bet' : 'Raise to'} {valid ? fmt(val!) : ''}</button>
    </Sheet>
  );
}
