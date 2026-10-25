// Browser-only geometry fixture: real UI components, public synthetic state, no backend or hidden deck.
// Imported only by layout.spec.ts through the dev server; never by the production entry point.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { SeatView } from '../src/table/Seat';
import { Centre } from '../src/table/Centre';
import { Hero } from '../src/table/Hero';
import { seatPositions } from '../src/table/geometry';
import '../src/theme.css';
import '../src/table/table.css';
export function renderLayout(count: number, holes: number, twice: boolean, shown = false, result = false) {
  const now = Date.now();
  const seats = Array.from({ length: count }, (_, i) => ({ playerId: String(i), name: ['You', 'Stu', 'TR45', 'Sne'][i] ?? `Player ${i}`, stack: 900, status: 'in' }));
  const hand: any = { id: 'layout', handNo: 1, phase: 'betting', street: 'flop', actor: 1, button: 0, pot: 300, board: [2, 11, 24], boards: twice ? [[2, 11, 24, 31, 43], [2, 11, 24, 33, 45]] : null,
    players: seats.map((s, i) => ({ seat: i, playerId: s.playerId, holeCount: holes, bet: 20, paid: 100, revealed: [] })), proposedStreets: [], currentBet: 0, deadline: now + 30000 };
  if (result) {
    hand.phase = 'result';
    hand.result = { uncontested: false, totals: {1: 300}, awards: [], shows: {}, boards: hand.boards ?? [hand.board] };
  }
  const pos = seatPositions(count, 0, innerWidth > innerHeight);
  const noop = () => {};
  const root = document.getElementById('root')!;
  (window as any).__layoutRoot ??= createRoot(root);
  (window as any).__layoutRoot.render(<div className="game">
    <div className="g-head"><div className="g-head-row"><div className="g-title">Sunday Afternoon</div><button className="g-icon">☰</button></div><div className="g-stakes"><b>Omaha {holes} · Pot limit</b><span>Blinds 10/20</span><span>Hand 1</span></div></div>
    <div className="g-surface"><div className="felt"/>{seats.slice(1).map((s, j) => <SeatView key={j} index={j + 1} seat={s as any} hand={hand} pos={pos[j + 1]} isHost={false} present now={now} isMe={false} shownCards={shown ? Array.from({length: holes}, (_, i) => i + 26) : null} winCards={null} won={null} />)}<Centre t={{seats, status: 'running'} as any} hand={hand} now={now} mySeat={0} busy={false} onChoose={noop} onStraddle={noop} onVote={noop} onPots={noop} newBoardKeys={new Set()} /></div>
    <Hero seatNames={seats.map(s => s.name)} hand={hand} mySeat={0} me={seats[0] as any} own={Array.from({length: holes}, (_, i) => i + 15)} ownHandId="layout" now={now} busy={false} pending={null} legal={null} dealt connected isCash made={null} madeShown={false} madeSet={null} onToggleMade={noop} onAct={noop} onPropose={noop} onReveal={noop} onReturn={noop} />
  </div>);
}
