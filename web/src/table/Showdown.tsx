import {useState} from 'react';
import type {Card, PublicHand} from '@allin/engine/public';
import {PlayingCard} from './Card';
import {WinnerCelebration} from './WinnerCelebration';
import {fmt} from '../components/ui';

/** Awards use public cards; optional foldedCards come only from the viewer’s private hand. */
export function Showdown({hand, names, stack, mySeat, foldedCards}: {hand: PublicHand; names: (string | null)[]; stack?: number; mySeat: number; foldedCards?: Card[]}) {
  const [selected, setSelected] = useState(0);
  const seen = new Set<string>();
  const wins = (hand.result?.awards ?? []).flatMap(a => a.winners.map(w => ({...w, board: a.board}))).filter(w => {
    const key = `${w.board}:${w.seat}`;
    if (seen.has(key)) return false;
    seen.add(key); return w.cards.length === 5;
  });
  const win = wins[Math.max(0, Math.min(selected, wins.length - 1))];
  if (!win) return null;
  const board = hand.boards?.[win.board] ?? hand.board;
  const usedHole = win.cards.filter(c => !board.includes(c)).length;
  return <section className="g-hero showdown-hero" aria-label="Winning hand">
    {(wins.length > 1 || !!foldedCards?.length) && <div className="showdown-tabs" role="group" aria-label="Show winning hands">{wins.map((w, i) =>
      <button key={`${w.board}:${w.seat}`} aria-pressed={i === selected} onClick={() => setSelected(i)}>{hand.boards ? `${w.board === 0 ? 'A' : 'B'} · ` : ''}{names[w.seat] ?? 'Player'}</button>
    )}{foldedCards?.length ? <button aria-pressed={selected === -1} onClick={() => setSelected(-1)}>My folded hand</button> : null}</div>}
    <div className="showdown-heading">{selected !== -1 && win.seat === mySeat && <WinnerCelebration />}<strong>{selected === -1 ? 'Your folded hand' : `${names[win.seat] ?? 'Player'} wins ${fmt(hand.result!.totals[win.seat] ?? 0)}`}</strong>{stack !== undefined && <span>Your stack {fmt(stack)}</span>}</div>
    <div className="showdown-hand-name">{selected === -1 ? 'Only visible to you' : win.name}</div>
    <div className="showdown-caption">{selected === -1 ? 'Your private cards' : `Best five · ${usedHole} hole + ${5 - usedHole} board`}</div>
    <div className="showdown-cards">{(selected === -1 && foldedCards ? foldedCards : win.cards).map(c => <div className="showdown-card-source" data-source={selected === -1 || !board.includes(c) ? "hole" : "board"} key={c}><PlayingCard card={c} win={selected !== -1} /><span>{selected === -1 || !board.includes(c) ? 'Hole' : 'Board'}</span></div>)}</div>
  </section>;
}
