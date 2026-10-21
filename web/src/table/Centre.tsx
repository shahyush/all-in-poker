import { RULES, variantAllowed, type Card, type PublicHand, type PublicTable, type VariantId, VARIANT_IDS } from '@allin/engine/public';
import { PlayingCard, SlotCard } from './Card.tsx';
import { fmt } from '../components/ui.tsx';
import { timeLeft } from '../lib/format.ts';

export interface CentreProps {
  t: PublicTable; hand: PublicHand | null; now: number; mySeat: number; busy: boolean;
  onChoose(v: VariantId): void; onStraddle(accept: boolean): void; onVote(choice: string): void; onPots(): void;
  newBoardKeys: Set<string>;
}

export function Centre({ t, hand, now, mySeat, busy, onChoose, onStraddle, onVote, onPots, newBoardKeys }: CentreProps) {
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
          <div className="centre-copy" aria-live="off">Hold'em deals in <strong>{secs}s</strong> if nobody chooses.</div>
          {isChooser && (
            <div className="choice-grid" role="group" aria-label="Choose the game">
              {VARIANT_IDS.map((v) => { const ok = variantAllowed(hand.players.length, v); return <button key={v} type="button" disabled={!ok || busy} onClick={() => onChoose(v)}><span>{RULES.variants[v].label}</span><span>{ok ? (RULES.variants[v].limit === 'NL' ? 'No limit' : 'Pot limit') : 'Too many players'}</span></button>; })}
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
  const winCards = new Set<Card>();
  if (res) for (const a of res.awards) for (const w of a.winners) for (const c of w.cards) winCards.add(c);
  return (
    <div className="centre">
      {!res && <div className="pot">Pot<b>{fmt(pot)}</b></div>}
      {boards.map((b, bi) => (
        <div key={bi} className="stack" style={{ gap: 2, alignItems: 'center' }}>
          {b.label && <div className="board-label">{b.label}</div>}
          <div className="board" aria-label={b.label ?? 'Community cards'}>
            {Array.from({ length: 5 }).map((_, i) => (b.cards[i] !== undefined ? <PlayingCard key={b.cards[i]} card={b.cards[i]} win={res ? winCards.has(b.cards[i]) : false} dim={res ? winCards.size > 0 && !winCards.has(b.cards[i]) : false} flip={newBoardKeys.has(`${bi}:${b.cards[i]}`)} /> : <SlotCard key={'s' + i} />))}
          </div>
        </div>
      ))}
      {!res && <div className="board-label">{hand.street === 'preflop' && hand.board.length === 0 ? 'Pre-flop' : hand.street}</div>}
      {hand.phase === 'vote' && hand.vote && (
        <div className="centre-card" role="group" aria-label="Runout proposal">
          <div className="row" style={{ justifyContent: 'space-between' }}><b>{seatName(hand.vote.proposer)} proposes: run it {hand.vote.runs === 2 ? 'twice' : 'once'}</b><span>{timeLeft(hand.vote.deadline, now)}s</span></div>
          <div className="centre-copy">Everyone agrees: betting ends for this hand. Silence counts as no.</div>
          {hand.vote.electorate.includes(mySeat) && !hand.vote.answered.includes(mySeat) ? (
            <div className="row" style={{ justifyContent: 'center' }}>
              <button type="button" className="btn-game" disabled={busy} onClick={() => onVote('decline')}>Keep playing</button>
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
      {res && (
        <div className="result-strip">
          {Object.entries(res.totals).map(([seat, amt]) => {
            const names = res.awards.filter((a) => a.winners.some((w) => w.seat === +seat)).map((a) => a.winners.find((w) => w.seat === +seat)!.name).filter(Boolean);
            return <div key={seat} className="centre-title">{seatName(+seat)} wins {fmt(amt)}{names[0] ? <div className="centre-copy">{[...new Set(names)].join(' / ')}</div> : null}</div>;
          })}
          <button type="button" className="btn-link" onClick={onPots}>{res.uncontested ? 'Everyone else folded · Pot detail' : 'Showdown · Pot detail'}</button>
        </div>
      )}
    </div>
  );
}
