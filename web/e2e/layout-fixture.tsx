// Browser-only geometry fixture: real UI components, public synthetic state, no backend or hidden deck.
// Imported only by layout.spec.ts through the dev server; never by the production entry point.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { SeatView } from '../src/table/Seat';
import { Centre } from '../src/table/Centre';
import { DealerButton } from '../src/table/DealerButton';
import { Hero } from '../src/table/Hero';
import { seatPositions } from '../src/table/geometry';
import '../src/theme.css';
import '../src/table/table.css';
export function renderLayout(count: number, holes: number, twice: boolean, shown = false, result = false, acting = false, folded = false, isCash = true, spectator = false) {
  const now = Date.now();
  const seats = Array.from({ length: count }, (_, i) => ({ playerId: String(i), name: ['You', 'Stu', 'TR45', 'Sne'][i] ?? `Player ${i}`, stack: 900, status: 'in' }));
  const hand: any = { id: 'layout', handNo: 1, phase: 'betting', street: 'flop', actor: acting ? 0 : 1, button: count - 1, pot: 300, board: [2, 11, 24], boards: twice ? [[2, 11, 24, 31, 43], [2, 11, 24, 33, 45]] : null,
    players: seats.map((s, i) => ({ seat: i, playerId: s.playerId, holeCount: holes, bet: acting ? 0 : 20, paid: 100, revealed: [], folded: folded && i === 0 })), canRunTwice: true, proposedStreets: [], currentBet: 0, deadline: now + 30000 };
  if (result) {
    hand.phase = 'result';
    hand.result = { uncontested: false, totals: twice ? {1:150,0:150} : {1:300}, awards: [{board:0, winners:[{seat:1, name:'Two pair, Kings and Eights', cards:[26,27,2,11,24]}]}, ...(twice ? [{board:1, winners:[{seat:0, name:'Flush, Ace high', cards:[15,16,24,33,45]}]}] : [])], shows: {}, boards: hand.boards ?? [hand.board] };
  }
  const pos = seatPositions(count, 0, innerWidth > parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--vh')));
  const noop = () => {};
  const root = document.getElementById('root')!;
  (window as any).__layoutRoot ??= createRoot(root);
  (window as any).__layoutRoot.render(<div className="game">
    <div className="g-head"><div className="g-head-row"><div className="g-title">Sunday Afternoon</div><button className="g-icon">☰</button></div><div className="g-stakes"><b>Omaha {holes} · Pot limit</b><span>Blinds 10/20</span><span>Hand 1</span></div><div className="g-recap"><span className="g-recap-tag">Last hand</span><span className="g-recap-body">Nine Player 5 won 45 — Three of a kind, Fives · Nine Player 7 won 45 — Flush, King high</span></div></div>
    <div className="g-surface"><div className="felt"/><DealerButton seat={hand.button} />{seats.map((s, j) => !spectator && j === 0 ? null : <SeatView key={j} index={j} seat={s as any} hand={hand} pos={pos[j]} isHost={false} present now={now} isMe={false} shownCards={shown ? Array.from({length: holes}, (_, i) => i + 26) : null} winCards={null} won={result && j === 1 ? 300 : null} winnerBurst={result && j === 1} />)}<Centre t={{seats, status: 'running'} as any} hand={hand} now={now} mySeat={spectator ? -1 : 0} busy={false} onChoose={noop} onStraddle={noop} onVote={noop} onPots={noop} newBoardKeys={new Set()} /></div>
    {spectator && !result ? <div className="g-hero spectator-dock"><strong>Watching</strong><span className="dock-note">Private cards stay hidden</span><button className="btn-game btn-game-primary">Take a seat</button></div> : <Hero awardReady={result} winnerBurst={result} seatNames={seats.map(s => s.name)} hand={hand} mySeat={0} me={seats[0] as any} own={Array.from({length: holes}, (_, i) => i + 15)} ownHandId="layout" now={now} busy={false} pending={null} legal={acting ? {canAct:true, owed:0, call:0, raise:null, raiseClosed:null} as any : null} dealt connected isCash={isCash} made={{name:'Pair of Aces'} as any} madeShown={false} madeSet={null} onToggleMade={noop} onAct={noop} onPropose={noop} onReveal={noop} onReturn={noop} />}
  </div>);
}


export async function renderChipCollection() {
  const {ChipSweep}=await import('../src/table/ChipSweep');
  const root=createRoot(document.getElementById('root')!);
  root.render(<div style={{position:'relative',width:400,height:500}}>
    <div className="pot" style={{position:'absolute',left:160,top:100,width:80,height:30}} />
    <ChipSweep from={{left:10,top:80}} />
  </div>);
  return ()=>root.unmount();
}
