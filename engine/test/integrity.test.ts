import { describe, it, expect, vi } from 'vitest';
import { makeTable, start, seededRng, totalChips, ctxAll } from './helpers.ts';
import { act, legalActions, tick, publicView, privateCards, respondVote, canRunTwice } from '../src/table.ts';
import { secureInt, shuffledDeck } from '../src/random.ts';
import { boardPresentationMs, planBoard, planDeal, showdownOrder } from '../src/animation.ts';
import type { HandState } from '../src/types.ts';
import type { VariantId } from '../src/evaluator.ts';

describe('deck and chip integrity under varied legal play', () => {
  for (const [variant, max] of [['holdem',9],['omaha4',9],['omaha5',8],['omaha6',7]] as [VariantId,number][]) {
    it(`${variant}: 250 seeded hands, varying seats, stacks, folds, raises and runouts`, () => {
      for (let seed=1;seed<=250;seed++) {
        const rng=seededRng(seed*7919), count=2+rng(max-1);
        const stacks=Array.from({length:count},()=>20+10*rng(100));
        const {t,now,ctx}=makeTable(stacks,{unit:10},1_000_000,rng);
        let clock=start(t,now,ctx,variant), steps=0;
        const h=t.hand!, initial=stacks.reduce((a,b)=>a+b,0);
        while (h.phase!=='result' && steps++<300) {
          expect(totalChips(t)).toBe(initial);
          expect(new Set(h.deck).size).toBe(52);
          expect(h.cursor).toBeLessThanOrEqual(52);
          verifyConsumedDeck(h);
          for (const key of ['deck','cursor','hole','burned','runoutQueue']) expect(publicView(t).hand).not.toHaveProperty(key);
          expect(privateCards(t,'not-a-player')).toBeNull();
          for (let seat=0;seat<count;seat++) expect(privateCards(t,'p'+seat)?.cards).toEqual(h.hole[seat]);
          for (const seat of t.seats) if(seat) expect(Number.isSafeInteger(seat.stack)&&seat.stack>=0).toBe(true);
          const context=ctxAll(t,clock,rng);
          if(h.phase==='betting' && h.actor!==null) {
            clock=Math.max(clock,h.actionReadyAt??0);
            const seat=h.actor, legal=legalActions(t,seat,clock), choice=rng(10);
            if(choice===0) act(t,seat,{type:'fold'},clock,context);
            else if(choice<4 && legal.raise) act(t,seat,{type:'raise',raiseTo:choice===1?legal.raise.maxTo:legal.raise.minTo},clock,context);
            else act(t,seat,{type:legal.check?'check':'call'},clock,context);
          } else if(h.phase==='offer' && h.vote) {
            const electorate=[...h.vote.electorate];
            const answer=canRunTwice(h)&&seed%2===0?'twice':'once';
            for(const seat of electorate) if(h.phase==='offer') respondVote(t,seat,answer,clock,context);
          } else { clock=Math.max(clock+1,t.dueAt??clock+1000); tick(t,clock,ctxAll(t,clock,rng)); }
        }
        expect(h.phase,`seed ${seed}`).toBe('result');
        expect(totalChips(t)).toBe(initial);
        verifyConsumedDeck(h);
        for(const award of h.result!.awards) for(const winner of award.winners) expect(h.players.find(p=>p.seat===winner.seat)?.folded).toBe(false);
      }
    },60_000);
  }
});

it('cryptographic sampling rejects modulo bias and fails closed without entropy',()=>{
  let calls=0;
  try {
    vi.stubGlobal('crypto',{getRandomValues:(a:Uint32Array)=>{a[0]=calls++===0?0xffffffff:51;return a;}});
    expect(secureInt(52)).toBe(51); expect(calls).toBe(2);
    vi.stubGlobal('crypto',undefined);
    expect(()=>shuffledDeck()).toThrow('Secure randomness unavailable');
  } finally {vi.unstubAllGlobals();}
});
it('deal order and board presentation retain their complete timing',()=>{
  const plan=planDeal({eventId:'1',handId:'h',seatIds:[0,1,2],buttonSeatId:1,holeCount:4});
  expect(plan.steps.map(s=>s.to)).toEqual([2,0,1,2,0,1,2,0,1,2,0,1]);
  const board=planBoard({eventId:'2',handId:'h',fromCount:0,toCount:3});
  expect(board.steps[0].delayMs).toBe(500);
  expect(board.durationMs).toBe(board.steps[2].delayMs+board.steps[2].durationMs);
  expect(board.durationMs).toBe(boardPresentationMs(3));
  expect(planBoard({eventId:'2',handId:'h',fromCount:0,toCount:3,reducedMotion:true}).durationMs).toBe(0);
});
it('showdown starts at the final street aggressor, or left of the button when checked down',()=>{
  expect(showdownOrder([{t:'bet',seat:2,to:20,amount:20,allIn:false}],0,4,[0,1,2,3])).toEqual([2,3,0,1]);
  expect(showdownOrder([{t:'bet',seat:2,to:20,amount:20,allIn:false},{t:'street',street:'river',cards:[1],board:0},{t:'check',seat:1}],0,4,[0,1,2,3])).toEqual([1,2,3,0]);
});

function verifyConsumedDeck(h: HandState) {
  const boards=h.boards??[h.board];
  for(const board of boards) expect(new Set(board).size).toBe(board.length);
  if(h.boards) for(const board of boards) expect(board.slice(0,h.board.length)).toEqual(h.board);
  const community=h.boards ? [...h.board,...h.boards.flatMap(board=>board.slice(h.board.length))] : h.board;
  const consumed=[...Object.values(h.hole).flat(),...h.burned,...community,...h.runoutQueue.flatMap(stage=>stage.cards)];
  expect(new Set(consumed).size).toBe(consumed.length);
  expect(consumed.length).toBe(h.cursor);
  expect([...consumed].sort((a,b)=>a-b)).toEqual(h.deck.slice(0,h.cursor).sort((a,b)=>a-b));
}

it('all-in hands remain private until every runout vote resolves',()=>{
  const {t,now,ctx}=makeTable([1000,1000,1000]);
  const clock=start(t,now,ctx), h=t.hand!;
  const folded=h.actor!;
  act(t,folded,{type:'fold'},clock,ctx);
  const raiser=h.actor!;
  act(t,raiser,{type:'raise',raiseTo:legalActions(t,raiser,clock).raise!.maxTo},clock,ctx);
  act(t,h.actor!,{type:'call'},clock,ctx);
  expect(publicView(t).hand!.revealedCards).toEqual({});
  tick(t,t.dueAt!,ctx);
  const voters=[...h.vote!.electorate];
  respondVote(t,voters[0],'once',clock,ctx);
  expect(h.phase).toBe('offer');
  expect(publicView(t).hand!.revealedCards).toEqual({});
  respondVote(t,voters[1],'twice',clock,ctx);
  const publicHand=publicView(t).hand!;
  expect(publicHand.phase).toBe('runout');
  expect(publicHand.revealedCards[folded]).toBeUndefined();
  for(const player of h.players.filter(p=>!p.folded)) expect(publicHand.revealedCards[player.seat].map(x=>x.card)).toEqual(h.hole[player.seat]);
});
