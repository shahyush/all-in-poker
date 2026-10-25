import {useState} from 'react';
import type {PublicHand} from '@allin/engine/public';
import {PlayingCard} from './Card';
import {WinnerCelebration} from './WinnerCelebration';
import {fmt} from '../components/ui';

/** Only server-published award cards are used: never infer or expose mucked hands. */
export function Showdown({hand, names, stack, mySeat}: {hand: PublicHand; names: (string | null)[]; stack?: number; mySeat: number}) {
  const [selected, setSelected] = useState(0);
  const seen = new Set<string>();
  const wins = (hand.result?.awards ?? []).flatMap(a => a.winners.map(w => ({...w, board: a.board}))).filter(w => {
    const key = `${w.board}:${w.seat}`;
    if (seen.has(key)) return false;
    seen.add(key); return w.cards.length === 5;
  });
  const win = wins[Math.min(selected, wins.length - 1)];
  if (!win) return null;
  return <section className="g-hero showdown-hero" aria-label="Winning hand">
    {wins.length > 1 && <div className="showdown-tabs" role="group" aria-label="Show winning hands">{wins.map((w, i) =>
      <button key={`${w.board}:${w.seat}`} aria-pressed={i === selected} onClick={() => setSelected(i)}>{hand.boards ? `${w.board === 0 ? 'A' : 'B'} · ` : ''}{names[w.seat] ?? 'Player'}</button>
    )}</div>}
    <div className="showdown-heading">{win.seat === mySeat && <WinnerCelebration />}<strong>{names[win.seat] ?? 'Player'} wins {fmt(hand.result!.totals[win.seat] ?? 0)}</strong>{stack !== undefined && <span>Your stack {fmt(stack)}</span>}</div>
    <div className="showdown-cards">{win.cards.map(c => <PlayingCard key={c} card={c} win />)}</div>
    <div className="showdown-hand-name">{win.name}</div>
  </section>;
}
