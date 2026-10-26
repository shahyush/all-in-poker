import type { Card, PublicHand, SeatState } from '@allin/engine/public';
import {WinnerCelebration} from './WinnerCelebration';
import { PlayingCard } from './Card.tsx';
import { fmt } from '../components/ui.tsx';

export interface SeatProps {
  winnerBurst?: boolean;
  index: number; seat: SeatState; hand: PublicHand | null; pos: { left: number; top: number };
  isHost: boolean; present: boolean; now: number; isMe: boolean; shownCards: Card[] | null; winCards: Card[] | null; won: number | null; revealDelayMs?: number;
}

export function SeatView({ index, seat, hand, pos, isHost, present, now, isMe, shownCards, winCards, won, revealDelayMs, winnerBurst }: SeatProps) {
  const hp = hand?.players.find((p) => p.seat === index) ?? null;
  const inHand = !!hp;
  const actor = hand?.phase === 'betting' && hand.actor === index;
  const status: string[] = [];
  if (seat.eliminatedPlace) status.push(`Out · ${ordinal(seat.eliminatedPlace)}`);
  else if (hp?.folded) status.push('Folded');
  else if (hp?.allIn) status.push('All-in');
  else if (!inHand && seat.status === 'sitout') status.push('Sitting out');
  else if (!inHand && hand) status.push(seat.owesBB ? 'Waiting for big blind' : 'Next hand');
  if (!present && !seat.eliminatedPlace) status.push('Away');
  if (seat.leaving) status.push('Leaving');
  const chooser = hand?.phase === 'choice' && hand.chooserSeat === index;
  // the blind badge sits on the plaque's corner (opposite the dealer button), so it never covers a name or stack
  const blind = hand && hand.street === 'preflop'
    ? hand.sbSeat === index ? { cls: 'sb', text: 'SB', label: `Small blind ${fmt(hand.sb)}` }
      : hand.bbSeat === index ? { cls: 'bb', text: 'BB', label: `Big blind ${fmt(hand.bb)}` }
        : hand.straddleSeat === index ? { cls: 'str', text: 'STR', label: `Straddle ${fmt(hand.bb * 2)}` } : null
    : null;
  const label = `Seat ${index + 1}, ${seat.name}${isMe ? ' (you)' : ''}, ${fmt(seat.stack)} chips${status.length ? ', ' + status.join(', ') : ''}${actor ? ', to act' : ''}${hand?.button === index ? ', dealer' : ''}`;
  const remaining = actor && hand?.deadline ? Math.min(1, Math.max(0, hand.deadline - now) / 30000) : 0;
  const backs = hp && !hp.folded && !shownCards ? hp.holeCount : 0;
  return (
    <div className={`seat ${actor ? 'is-actor' : ''} ${hp?.folded ? 'is-folded' : ''} ${won != null && won > 0 ? 'is-winner' : ''} ${hp?.allIn && !hp.folded ? 'is-allin' : ''}`} style={{ left: pos.left < 20 ? '40px' : pos.left > 80 ? 'calc(100% - 40px)' : pos.left + '%', top: pos.top + '%' }} data-seat={index} aria-label={label} role="group">
      <div className="seat-cards" aria-hidden={shownCards ? undefined : 'true'}>
        {shownCards ? shownCards.map((c, i) => <PlayingCard key={i} card={c} size="sm" win={!!winCards && winCards.includes(c)} dim={!!winCards && !winCards.includes(c)} flip delayMs={revealDelayMs} />)
          : Array.from({ length: Math.min(backs, 6) }).map((_, i) => <span key={i} className="deal-slot" data-slot={i}><span className="pc back sm" style={{ opacity: 0.95 }} /></span>)}
      </div>
      <div className="seat-core">
        {won && winnerBurst ? <WinnerCelebration key={hand?.id} /> : null}
        <span className="seat-avatar" aria-hidden="true">{initialOf(seat.name)}</span>
        <span className={`seat-name${hand?.button === index ? ' has-dealer' : ''}`}>{isHost ? '★ ' : ''}{seat.name}</span>
        <span className="seat-stack">{fmt(seat.stack)}</span>
        <span className="seat-status">{chooser ? 'Choosing' : status[0] ?? ''}</span>
        {hp && hp.bet > 0 && <span className="seat-wager" aria-label={`Bet ${fmt(hp.bet)}`}>Bet {fmt(hp.bet)}</span>}
        {actor && <span className="timer-ring" aria-hidden="true"><i style={{ transform: `scaleX(${remaining})` }} /></span>}
        {blind && <span className={`blind-chip ${blind.cls}`} aria-label={blind.label}>{blind.text}</span>}
      </div>
    </div>
  );
}
export function ordinal(n: number): string { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
/** First letter of a name for the avatar disc; emoji-safe (takes the first grapheme-ish code point). */
function initialOf(name: string): string { const t = name.trim(); return t ? [...t][0]!.toUpperCase() : '?'; }
