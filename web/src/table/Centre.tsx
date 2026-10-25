import { BOARD_GAP_MS, RULES, variantAllowed, type Card, type PublicHand, type PublicTable, type VariantId, VARIANT_IDS } from '@allin/engine/public';
import { PlayingCard, SlotCard } from './Card.tsx';
import { fmt } from '../components/ui.tsx';
import { timeLeft } from '../lib/format.ts';

export interface CentreProps {
  awardReady?: boolean;
  t: PublicTable; hand: PublicHand | null; now: number; mySeat: number; busy: boolean;
  chosen?: VariantId | null; submitting?: VariantId | null;
  onChoose(v: VariantId): void; onStraddle(accept: boolean): void; onVote(choice: string): void; onPots(): void;
  newBoardKeys: Set<string>;
  boardLeadMs?: number;              // delay before fresh board cards flip, so a preceding burn animation is seen first
  madeBoard?: Set<Card> | null;
}

export function Centre({ awardReady = true, t, hand, now, mySeat, busy, chosen, submitting, onChoose, onStraddle, onVote, onPots, newBoardKeys, boardLeadMs, madeBoard }: CentreProps) {
  if (!hand) {
    return <div className="centre"><div className="centre-card"><div className="centre-title">{t.status === 'running' ? (t.waitingReason ?? 'Waiting') : 'Paused'}</div><div className="centre-copy">{t.status === 'running' ? 'Hands continue automatically.' : ''}</div></div></div>;
  }
  const seatName = (i: number | null) => (i === null ? '' : t.seats[i]?.name ?? 'Seat');
  const pot = hand.pot + hand.players.reduce((a, p) => a + p.bet, 0);
  if (hand.phase === 'choice') {
    const isChooser = hand.chooserSeat === mySeat;
    const secs = timeLeft(hand.choiceDeadline, now);
    const offer = hand.straddleOffer && hand.straddleOffer.seat === mySeat && !hand.straddleOffer.decided;
    return (
      <div className="centre">
        <div className="centre-card">
          <div className="centre-copy">Hand {hand.handNo} · Dealer's Choice{isChooser ? ' · Your deal' : ` · ${seatName(hand.chooserSeat)}`}</div>
          <div className="centre-title">{isChooser ? 'Pick the game' : `${seatName(hand.chooserSeat)} is choosing`}</div>
          <div className="centre-copy" aria-live="polite">{submitting ? <>Submitting <strong>{RULES.variants[submitting].label}</strong>…</> : chosen ? <>Locked in — dealing <strong>{RULES.variants[chosen].label}</strong>…</> : <>Hold'em deals in <strong>{secs}s</strong> if nobody chooses.</>}</div>
          {isChooser && (
            <div className="choice-grid" role="group" aria-label="Choose the game">
              {VARIANT_IDS.map((v) => { const ok = variantAllowed(hand.players.length, v); const isSubmitting = submitting === v; const locked = chosen === v; const picked = isSubmitting || locked; return <button key={v} type="button" className={picked ? 'chosen' : undefined} aria-pressed={picked} disabled={!ok || busy || chosen != null || submitting != null} onClick={() => onChoose(v)}><span>{RULES.variants[v].label}</span><span>{isSubmitting ? 'Submitting…' : locked ? 'Locked in' : ok ? (RULES.variants[v].limit === 'NL' ? 'No limit' : 'Pot limit') : 'Too many players'}</span></button>; })}
            </div>
          )}
          {offer && (
            <div className="stack" style={{ gap: 6 }}>
              <div className="centre-copy">You're first to act. Straddle {fmt(2 * hand.bb)}? It's live and you get the last option.</div>
              <div className="row" style={{ justifyContent: 'center' }}>
                <button type="button" className="btn-game" disabled={busy} onClick={() => onStraddle(false)}>Skip</button>
                <button type="button" className="btn-game btn-game-primary" disabled={busy} onClick={() => onStraddle(true)}>Straddle {fmt(2 * hand.bb)}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
  const boards: { label: string | null; cards: Card[] }[] = hand.boards ? [{ label: 'Board A', cards: hand.boards[0] }, { label: 'Board B', cards: hand.boards[1] }] : [{ label: null, cards: hand.board }];
  const res = hand.result;
  return (
    <div className="centre">
      {!res && <div className="pot">Pot<b>{fmt(pot)}</b></div>}
      {boards.map((b, bi) => {
        const winCards = new Set<Card>();
        if (res && awardReady) for (const a of res.awards) if (a.board === bi) for (const w of a.winners) for (const c of w.cards) winCards.add(c);
        const freshOrder = b.cards.map((c, i) => (newBoardKeys.has(`${bi}:${c}`) ? i : -1)).filter((i) => i >= 0);
        return (
        <div key={bi} className="stack" style={{ gap: 2, alignItems: 'center' }}>
          {b.label && <div className="board-label">{b.label}</div>}
          <div className="board" aria-label={b.label ?? 'Community cards'}>
            {Array.from({ length: 5 }).map((_, i) => { if (b.cards[i] === undefined) return <SlotCard key={'s' + i} />; const fresh = newBoardKeys.has(`${bi}:${b.cards[i]}`); return <PlayingCard key={b.cards[i]} card={b.cards[i]} win={res && awardReady ? winCards.has(b.cards[i]) : false} dim={res ? winCards.size > 0 && !winCards.has(b.cards[i]) : false} hi={!res && !!madeBoard?.has(b.cards[i])} flip={fresh} delayMs={fresh ? (boardLeadMs ?? 0) + freshOrder.indexOf(i) * BOARD_GAP_MS + (bi === 1 && newBoardKeys.size > freshOrder.length ? 860 : 0) : undefined} />; })}
          </div>
        </div>
        );
      })}
      {!res && <div className="board-label">{hand.street === 'preflop' && hand.board.length === 0 ? 'Pre-flop' : hand.street}</div>}
      {hand.phase === 'vote' && hand.vote && (
        <div className="centre-card" role="group" aria-label="Runout proposal">
          <div className="row" style={{ justifyContent: 'space-between' }}><b>{hand.vote.runs === 2 ? 'Play two boards?' : 'Run the board?'}</b><span>{timeLeft(hand.vote.deadline, now)}s</span></div>
          <div className="centre-copy">{hand.vote.runs === 2 ? 'Betting continues. Each board wins half the pot.' : 'Betting ends if everyone agrees.'}</div>
          {hand.vote.electorate.includes(mySeat) && !hand.vote.answered.includes(mySeat) ? (
            <div className="row" style={{ justifyContent: 'center' }}>
              <button type="button" className="btn-game" disabled={busy} onClick={() => onVote('decline')}>No</button>
              <button type="button" className="btn-game btn-game-primary" disabled={busy} onClick={() => onVote('agree')}>Agree</button>
            </div>
          ) : <div className="centre-copy">{hand.vote.answered.length} of {hand.vote.electorate.length} answered</div>}
        </div>
      )}
      {hand.phase === 'offer' && hand.vote && (
        <div className="centre-card" role="group" aria-label="Runout">
          <div className="centre-copy">No more betting. Runs once in <strong>{timeLeft(hand.vote.deadline, now)}s</strong> unless everyone picks twice.</div>
          {hand.vote.electorate.includes(mySeat) && !hand.vote.answered.includes(mySeat) ? (
            <div className="row" style={{ justifyContent: 'center' }}>
              <button type="button" className="btn-game" disabled={busy} onClick={() => onVote('once')}>Run once</button>
              <button type="button" className="btn-game btn-game-primary" disabled={busy || !hand.canRunTwice} onClick={() => onVote('twice')}>Run twice</button>
            </div>
          ) : <div className="centre-copy">{hand.vote.answered.length} of {hand.vote.electorate.length} answered</div>}
        </div>
      )}
      {res && !awardReady && <div className="showdown-title">Showdown</div>}
      {res && awardReady && (
        <div className="result-strip">
          {(res.uncontested ? Object.entries(res.totals) : []).map(([seat, amt]) => {
            const names = res.awards.filter((a) => a.winners.some((w) => w.seat === +seat)).map((a) => a.winners.find((w) => w.seat === +seat)!.name).filter(Boolean);
            return <div key={seat} className="centre-title">{seatName(+seat)} wins {fmt(amt)}{names[0] ? <div className="centre-copy">{[...new Set(names)].join(' / ')}</div> : null}</div>;
          })}
          <button type="button" className="btn-link" onClick={onPots}>{res.uncontested ? 'Everyone else folded · Pot detail' : 'Showdown · Pot detail'}</button>
        </div>
      )}
    </div>
  );
}
