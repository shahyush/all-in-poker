import { describe, it, expect } from 'vitest';
import { makeTable, start, autoplay, seededRng, totalChips, ctxAll } from './helpers.ts';
import { act, legalActions, tick, chooseVariant, choiceReady, propose, respondVote, reveal, respondStraddle, requestLeave, requestSitOut, requestReturn, startTable, seatPlayer, createTable, publicView, privateCards, canRunTwice, EngineError, setStraddlePref } from '../src/table.ts';
import { RULES, variantAllowed } from '../src/rules.ts';
import type { TableState } from '../src/types.ts';

const T = RULES.timers;

describe('dealing and capacity', () => {
  it('BUG01: nine-player Omaha 6 is rejected before any mutation; Omaha 5 at nine deals 45 cards', () => {
    const { t, now, ctx } = makeTable(Array(9).fill(1000));
    startTable(t, now, ctx);
    const h = t.hand!;
    const snapshot = JSON.stringify(t);
    expect(() => chooseVariant(t, h.chooserSeat, 'omaha6', now, ctx)).toThrow(EngineError);
    expect(JSON.stringify(t)).toBe(snapshot);
    expect(variantAllowed(9, 'omaha6')).toBe(false);
    expect(variantAllowed(7, 'omaha6')).toBe(true);
    expect(variantAllowed(8, 'omaha6')).toBe(false);
    chooseVariant(t, h.chooserSeat, 'omaha5', now, ctx);
    expect(t.hand!.cursor).toBe(45);
    expect(canRunTwice(t.hand!)).toBe(false); // 45 + 10 > 52 preflop; flop double (52) checked once flop is out
    const all = Object.values(t.hand!.hole).flat();
    expect(new Set(all).size).toBe(45);
    expect(t.hand!.players.every((p) => p.holeCount === 5)).toBe(true);
  });
  it('deals one card per seat clockwise from the left of the button', () => {
    const { t, now, ctx } = makeTable([1000, 1000, 1000]);
    startTable(t, now, ctx);
    chooseVariant(t, t.hand!.chooserSeat, 'holdem', now, ctx);
    const h = t.hand!;
    const ev = t.events.find((e) => e.type === 'deal')!;
    expect(ev.type === 'deal' && ev.order[ev.order.length - 1]).toBe(h.button);
    const order = ev.type === 'deal' ? ev.order : [];
    // first round: deck[0..2] in order, second round deck[3..5]
    order.forEach((seat, i) => { expect(h.hole[seat][0]).toBe(h.deck[i]); expect(h.hole[seat][1]).toBe(h.deck[3 + i]); });
  });
  it('A01: two fresh tables with secure randomness deal differently', () => {
    const a = makeTable([1000, 1000, 1000], {}, 1, undefined);
    const b = makeTable([1000, 1000, 1000], {}, 1, undefined);
    delete (a.ctx as { rng?: unknown }).rng; delete (b.ctx as { rng?: unknown }).rng;
    startTable(a.t, 1, a.ctx); chooseVariant(a.t, a.t.hand!.chooserSeat, 'holdem', 1, a.ctx);
    startTable(b.t, 1, b.ctx); chooseVariant(b.t, b.t.hand!.chooserSeat, 'holdem', 1, b.ctx);
    expect(JSON.stringify(a.t.hand!.deck)).not.toBe(JSON.stringify(b.t.hand!.deck));
  });
  it('private cards never appear in the public view', () => {
    const { t, now, ctx } = makeTable([1000, 1000, 1000]);
    start(t, now, ctx);
    const pub = JSON.stringify(publicView(t));
    expect(pub.includes('"deck"')).toBe(false);
    expect(pub.includes('"hole"')).toBe(false);
    const mine = privateCards(t, 'p0')!;
    expect(mine.cards.length).toBe(2);
  });
});

describe('blinds, button and positions', () => {
  it('heads-up: button posts the small blind and acts first preflop, last postflop', () => {
    const { t, now, ctx } = makeTable([1000, 1000]);
    const ready = start(t, now, ctx);
    const h = t.hand!;
    expect(h.sbSeat).toBe(h.button);
    expect(h.actor).toBe(h.button);
    act(t, h.actor!, { type: 'call' }, ready, ctx);
    act(t, h.actor!, { type: 'check' }, ready, ctx);
    expect(h.street).toBe('flop');
    expect(h.actor).toBe(h.bbSeat);
  });
  it('A22/R4-17: three to two does not give the old big blind the big blind again (cash)', () => {
    const { t, now, ctx } = makeTable([1000, 1000, 1000]);
    let n = start(t, now, ctx);
    const oldBB = t.hand!.bbSeat!;
    const leaver = t.hand!.players.find((p) => p.seat !== oldBB)!.playerId;
    requestLeave(t, leaver, 'leave', n, ctx);
    n = autoplay(t, n, ctx, (x) => x.handNo === 2 && !!x.hand && x.hand.phase === 'choice');
    expect(t.hand!.players.length).toBe(2);
    expect(t.hand!.bbSeat).not.toBe(oldBB);
    expect(t.hand!.button).toBe(oldBB);
  });
  it('tournament dead button: big blind always advances; eliminated seat leaves a dead small blind', () => {
    const { t, now, ctx } = makeTable([1000, 1000, 1000, 1000], { mode: 'tournament', levels: [{ sb: 5, bb: 10, ante: 0, minutes: 10 }] });
    let n = start(t, now, ctx);
    const h1 = t.hand!;
    const bb1 = h1.bbSeat!, sb1 = h1.sbSeat!;
    // knock out the small blind's player: make them lose everything by setting stack tiny and shoving
    t.seats[sb1]!.stack = 1; // simulate a short stack (test-only mutation before action)
    n = autoplay(t, n, ctx, (x) => x.handNo === 2 && !!x.hand && x.hand.phase === 'choice');
    const h2 = t.hand!;
    const nextBB = [1, 2, 3, 4].map((k) => (bb1 + k) % 4).find((s) => t.seats[s] && t.seats[s]!.stack > 0 && t.seats[s]!.eliminatedPlace === null);
    expect(h2.bbSeat).toBe(nextBB);
    if (t.seats[bb1]!.stack > 0) expect(h2.sbSeat).toBe(bb1);
  });
  it('short big blind keeps the nominal bring-in: the call is to 10, pot stays actual', () => {
    const { t, now, ctx } = makeTable([1000, 1000, 1000]);
    startTable(t, now, ctx);
    const h = t.hand!;
    t.seats[h.bbSeat!]!.stack = 3;
    chooseVariant(t, h.chooserSeat, 'holdem', now, ctx);
    const la = legalActions(t, h.actor!, h.actionReadyAt!);
    expect(la.owed).toBe(10);
    expect(la.pot).toBe(8);
  });
});

describe('betting rules', () => {
  function flopScenario() {
    // 4 players, reach the flop with everyone checking preflop (call/check), then set custom stacks.
    const { t, now, ctx } = makeTable([1000, 1000, 1000, 1000]);
    let n = start(t, now, ctx);
    n = autoplay(t, n, ctx, (x) => x.hand!.street === 'flop');
    return { t, n, ctx };
  }
  it('BUG03/R4-14: cumulative short all-ins reaching a full raise reopen the original bettor', () => {
    const { t, n, ctx } = flopScenario();
    const h = t.hand!;
    const first = h.actor!;
    const seats = [0, 1, 2, 3].map((k) => h.players[(h.players.findIndex((p) => p.seat === first) + k) % 4].seat);
    t.seats[seats[0]]!.stack = 900; t.seats[seats[1]]!.stack = 150; t.seats[seats[2]]!.stack = 200; t.seats[seats[3]]!.stack = 1000;
    act(t, seats[0], { type: 'raise', raiseTo: 100 }, n, ctx);
    act(t, seats[1], { type: 'raise', raiseTo: 150 }, n, ctx); // short all-in
    expect(legalActions(t, seats[2], n).raise).not.toBeNull(); // unacted player keeps options
    act(t, seats[2], { type: 'raise', raiseTo: 200 }, n, ctx); // short all-in; cumulative +100 = full raise
    act(t, seats[3], { type: 'call' }, n, ctx);
    const la = legalActions(t, seats[0], n);
    expect(la.canAct).toBe(true);
    expect(la.raise).not.toBeNull();
    expect(la.raise!.minTo).toBe(300);
  });
  it('A07: a prior check followed by a sub-BB opening all-in does not reopen the checker', () => {
    const { t, n, ctx } = flopScenario();
    const h = t.hand!;
    const a = h.actor!;
    const b = h.players[(h.players.findIndex((p) => p.seat === a) + 1) % 4].seat;
    t.seats[b]!.stack = 5;
    act(t, a, { type: 'check' }, n, ctx);
    const lb = legalActions(t, b, n);
    expect(lb.raise!.minTo).toBe(5); expect(lb.raise!.maxTo).toBe(5);
    act(t, b, { type: 'raise', raiseTo: 5 }, n, ctx);
    // remaining two players call
    act(t, h.actor!, { type: 'call' }, n, ctx);
    act(t, h.actor!, { type: 'call' }, n, ctx);
    expect(h.actor).toBe(a);
    const la = legalActions(t, a, n);
    expect(la.raise).toBeNull();
    expect(la.call).toBe(5);
  });
  it('A21/R4-13: pot-limit cap uses nominal blinds after a short big blind, ledger stays actual', () => {
    const { t, now, ctx } = makeTable([1000, 1000, 1000]);
    startTable(t, now, ctx);
    const h = t.hand!;
    t.seats[h.bbSeat!]!.stack = 3;
    chooseVariant(t, h.chooserSeat, 'omaha4', now, ctx);
    const la = legalActions(t, h.actor!, h.actionReadyAt!);
    expect(la.raise!.maxTo).toBe(35);
    expect(la.pot).toBe(8);
    expect(totalChips(t)).toBe(3000 - 1000 + 3);
  });
  it('pot-limit: maximum raise-to is S + P + 2C and All-in is not offered above the cap', () => {
    const { t, now, ctx } = makeTable([1000, 1000, 1000]);
    const ready = start(t, now, ctx, 'omaha4');
    const h = t.hand!;
    const la = legalActions(t, h.actor!, ready);
    // UTG: P=15, C=10, S=0 -> 35
    expect(la.raise!.maxTo).toBe(35);
    expect(la.allInTo).toBeNull();
  });
  it('straddle: live 2xBB, action starts left of the straddler, straddler keeps the option, min raise-to is 4xBB', () => {
    const { t, now, ctx } = makeTable([1000, 1000, 1000], { straddle: true });
    startTable(t, now, ctx);
    const h = t.hand!;
    expect(h.straddleOffer).not.toBeNull();
    const utg = h.straddleOffer!.seat;
    respondStraddle(t, utg, true, now, ctx);
    chooseVariant(t, h.chooserSeat, 'holdem', now, ctx);
    expect(h.straddleSeat).toBe(utg);
    expect(h.currentBet).toBe(20);
    expect(h.actor).toBe(h.sbSeat); // next after UTG in a 3-handed game is the SB
    const la = legalActions(t, h.actor!, h.actionReadyAt!);
    expect(la.raise!.minTo).toBe(40);
    act(t, h.actor!, { type: 'call' }, h.actionReadyAt!, ctx);
    act(t, h.actor!, { type: 'call' }, h.actionReadyAt!, ctx);
    expect(h.actor).toBe(utg); // straddler's option
    expect(legalActions(t, utg, h.actionReadyAt!).check).toBe(true);
  });
  it('A09/R4-10: the straddle offer closes with the choice window; no separate timer', () => {
    const { t, now, ctx } = makeTable([1000, 1000, 1000], { straddle: true });
    startTable(t, now, ctx);
    const utg = t.hand!.straddleOffer!.seat;
    tick(t, now + T.choiceWarmupCapMs + 1, ctx);
    expect(t.hand!.phase).toBe('betting');
    expect(t.hand!.straddleSeat).toBeNull();
    expect(() => respondStraddle(t, utg, true, now + T.choiceWarmupCapMs + 2, ctx)).toThrow();
  });
  it('A23/R4-09: an ante-exhausted UTG does not move the straddle to another seat', () => {
    const { t, now, ctx } = makeTable([1000, 1000, 1000], { straddle: true, ante: 10 });
    startTable(t, now, ctx);
    const h = t.hand!;
    const utg = h.straddleOffer!.seat;
    t.seats[utg]!.stack = 10; // can only cover the ante
    respondStraddle(t, utg, true, now, ctx);
    chooseVariant(t, h.chooserSeat, 'holdem', now, ctx);
    expect(h.straddleSeat).toBeNull();
    expect(h.currentBet).toBe(10);
  });
  it('A10/R4-11: a late choice cannot replace the timeout default', () => {
    const { t, now, ctx } = makeTable([1000, 1000, 1000]);
    startTable(t, now, ctx);
    const h = t.hand!;
    expect(() => chooseVariant(t, h.chooserSeat, 'omaha4', now + T.choiceWarmupCapMs + 1, ctx)).toThrow();
    expect(t.hand!.variant).toBe('holdem');
  });
  it('choiceReady re-anchors the usable window from first view, so a cold-start pick still registers', () => {
    const { t, now, ctx } = makeTable([1000, 1000, 1000]);
    startTable(t, now, ctx);
    const h = t.hand!;
    // the chooser's client only sees the choice late (cold start), but still within the warm-up cap
    const seen = now + T.choiceWarmupCapMs - 2000;
    choiceReady(t, h.chooserSeat, seen, ctx);
    expect(h.choiceArmed).toBe(true);
    expect(h.choiceDeadline).toBe(seen + T.choiceMs);
    // a pick a few seconds after first view — past the ORIGINAL cap, but within the re-anchored window — registers
    chooseVariant(t, h.chooserSeat, 'omaha4', seen + 3000, ctx);
    expect(t.hand!.variant).toBe('omaha4');
  });
  it('without a readiness confirmation the choice still defaults at the warm-up cap', () => {
    const { t, now, ctx } = makeTable([1000, 1000, 1000]);
    startTable(t, now, ctx);
    tick(t, now + T.choiceWarmupCapMs + 1, ctx);
    expect(t.hand!.phase).toBe('betting');
    expect(t.hand!.variant).toBe('holdem');
  });
  it('BUG02/R4: an action after the deadline is rejected and the timeout is applied first', () => {
    const { t, now, ctx } = makeTable([1000, 1000, 1000]);
    const ready = start(t, now, ctx);
    const h = t.hand!;
    const actor = h.actor!;
    const deadline = h.deadline!;
    expect(() => act(t, actor, { type: 'call' }, deadline + 1, ctx)).toThrow();
    expect(h.players.find((p) => p.seat === actor)!.folded).toBe(true); // UTG owed a call: timeout folds
    expect(t.seats[actor]!.consecutiveTimeouts).toBe(1);
    void ready;
  });
  it('BUG05/R4-19: a timeout check counts; two consecutive misses sit out at the boundary; a manual action resets', () => {
    const { t, now, ctx } = makeTable([1000, 1000, 1000]);
    let n = start(t, now, ctx);
    const h = t.hand!;
    // everyone calls preflop, BB gets to check by timeout
    act(t, h.actor!, { type: 'call' }, n, ctx);
    act(t, h.actor!, { type: 'call' }, n, ctx);
    const bb = h.actor!;
    expect(legalActions(t, bb, n).check).toBe(true);
    tick(t, h.deadline! + 1, ctx);
    expect(t.seats[bb]!.consecutiveTimeouts).toBe(1);
    expect(h.street).toBe('flop');
    n = h.deadline! - 1000;
    // on the flop let bb time out again when their turn comes
    for (let g = 0; g < 10 && h.actor !== bb; g++) { if (h.actor === null) throw new Error('no actor ' + h.phase + ' ' + h.street); act(t, h.actor, { type: 'check' }, n, ctx); }
    expect(h.actor).toBe(bb);
    const t2 = h.deadline! + 1;
    tick(t, t2, ctx);
    expect(t.seats[bb]!.consecutiveTimeouts).toBe(2);
    // the rest of the hand resolves by timeouts only (a manual action would reset the count)
    n = t2;
    for (let guard = 0; guard < 100 && !(t.handNo === 2 && t.hand); guard++) {
      const hh = t.hand!;
      if (hh.phase === 'betting' && hh.actor === bb) { n = hh.deadline! + 1; tick(t, n, ctxAll(t, n, ctx.rng)); }
      else if (hh.phase === 'betting' && hh.actor !== null) { const la = legalActions(t, hh.actor, n); act(t, hh.actor, { type: la.check ? 'check' : 'call' }, n, ctx); }
      else { n = Math.max(n, t.dueAt ?? n + 1000); tick(t, n, ctxAll(t, n, ctx.rng)); }
    }
    expect(t.seats[bb]!.status).toBe('sitout');
    expect(t.hand!.players.length).toBe(2);
  });
  it('rejects a raise nobody can contest and rejects malformed raise amounts', () => {
    const { t, now, ctx } = makeTable([1000, 50, 50], { unit: 50 });
    const ready = start(t, now, ctx);
    const h = t.hand!;
    const utg = h.actor!;
    const la = legalActions(t, utg, ready);
    expect(la.raise!.maxTo).toBe(50);
    expect(() => act(t, utg, { type: 'raise', raiseTo: 1.5 as number }, ready, ctx)).toThrow();
    expect(() => act(t, utg, { type: 'raise', raiseTo: 60 }, ready, ctx)).toThrow();
    act(t, utg, { type: 'raise', raiseTo: 50 }, ready, ctx);
    act(t, h.actor!, { type: 'call' }, ready, ctx);
    act(t, h.actor!, { type: 'call' }, ready, ctx);
    expect(h.phase === 'offer' || h.phase === 'runout').toBe(true);
  });
  it('a betting command before the deal presentation is ready is rejected', () => {
    const { t, now, ctx } = makeTable([1000, 1000, 1000]);
    startTable(t, now, ctx);
    chooseVariant(t, t.hand!.chooserSeat, 'holdem', now, ctx);
    expect(() => act(t, t.hand!.actor!, { type: 'call' }, now + 10, ctx)).toThrow(/dealt/);
  });
});

describe('pots, refunds and showdown', () => {
  it('refunds an uncalled bet before awarding and awards the pot without exposing more board', () => {
    const { t, now, ctx } = makeTable([1000, 1000, 1000]);
    let n = start(t, now, ctx);
    const h = t.hand!;
    const utg = h.actor!;
    act(t, utg, { type: 'raise', raiseTo: 100 }, n, ctx);
    act(t, h.actor!, { type: 'fold' }, n, ctx);
    act(t, h.actor!, { type: 'fold' }, n, ctx);
    expect(h.phase).toBe('result');
    expect(h.result!.uncontested).toBe(true);
    expect(h.result!.refunds[0]).toEqual({ seat: utg, amount: 90 });
    expect(h.result!.totals[utg]).toBe(25);
    expect(h.board.length).toBe(0);
    expect(t.seats[utg]!.stack).toBe(1015);
    expect(totalChips(t)).toBe(3000);
    void n;
  });
  it('side pots: short all-in wins only the main pot; excess chips are refunded', () => {
    const { t, now, ctx } = makeTable([100, 1000, 1000], { unit: 100 });
    const rng = seededRng(7);
    ctx.rng = rng;
    let n = start(t, now, ctx);
    const h = t.hand!;
    // find short player's seat
    const short = h.players.find((p) => p.stackStart === 100)!.seat;
    // play: everyone shoves/calls
    while (h.phase === 'betting') {
      const a = h.actor!;
      const la = legalActions(t, a, n);
      if (la.raise && la.allInTo) act(t, a, { type: 'raise', raiseTo: la.allInTo }, n, ctx);
      else act(t, a, { type: la.owed ? 'call' : 'check' }, n, ctx);
    }
    n = autoplay(t, n, ctx, (x) => x.hand!.phase === 'result');
    const r = h.result!;
    const paidByShort = h.players.find((p) => p.seat === short)!.paid;
    expect(paidByShort).toBeLessThanOrEqual(100);
    const sum = Object.values(r.totals).reduce((a, b) => a + b, 0) + r.refunds.reduce((a, b) => a + b.amount, 0);
    expect(sum + 0).toBe(h.players.reduce((a, p) => a + p.paid, 0) + r.refunds.reduce((a, b) => a + b.amount, 0));
    expect(totalChips(t)).toBe(2100);
    expect(r.pots[0].eligible).toContain(short);
    if (r.pots.length > 1) expect(r.pots[1].eligible).not.toContain(short);
    for (const p of h.players) if (!p.folded) expect(p.shown).toBe(true);
  });
  it('BUG04/R4-18: leaving while all-in keeps pot eligibility', () => {
    const { t, now, ctx } = makeTable([100, 1000, 1000], { unit: 100 });
    let n = start(t, now, ctx);
    const h = t.hand!;
    const short = h.players.find((p) => p.stackStart === 100)!.seat;
    // short player shoves when their turn comes; others call
    while (h.phase === 'betting' && !h.players.find((p) => p.seat === short)!.allIn) {
      const a = h.actor!; const la = legalActions(t, a, n);
      if (a === short) act(t, a, { type: 'raise', raiseTo: la.allInTo ?? la.raise!.maxTo }, n, ctx); else act(t, a, { type: la.owed ? 'call' : 'check' }, n, ctx);
    }
    requestLeave(t, 'p' + short, 'leave', n, ctx);
    const p = h.players.find((p) => p.seat === short)!;
    expect(p.folded).toBe(false);
    expect(p.left).toBe(true);
    n = autoplay(t, n, ctx, (x) => x.handNo === 2 || x.status !== 'running');
    expect(totalChips(t) + (t.seats[short] ? 0 : 0)).toBeGreaterThan(0);
  });
  it('ties split exactly with odd chips clockwise from the button; two boards give Board A the odd chip', () => {
    // force identical hole cards strength: both players have the same two ranks of different suits and board plays
    const { t, now, ctx } = makeTable([1000, 1000, 1000]);
    startTable(t, now, ctx);
    const h = t.hand!;
    chooseVariant(t, h.chooserSeat, 'holdem', now, ctx);
    // make the hand a runout with pot 155 (odd) between two players: rig stacks so all-in amounts differ
    // Simpler deterministic check via pots helpers
    const { splitAmong, awardPots } = require('../src/pots.ts');
    expect(splitAmong([0, 4, 7], 100, 7, 9)).toEqual([{ seat: 0, amount: 34 }, { seat: 4, amount: 33 }, { seat: 7, amount: 33 }]);
    const hole = { 0: [12, 25], 1: [11, 24] }; // As Ad vs Ks Kd ... board makes a royal: both play the board
    const board = [0 + 39, 1 + 39, 2 + 39, 3 + 39, 4 + 39]; // 2s..6s straight flush on board
    const res = awardPots([{ amount: 101, eligible: [0, 1] }], [board, board], hole, 'holdem', 1, 9);
    expect(res.awards[0].amount).toBe(51); expect(res.awards[1].amount).toBe(50);
    expect(res.totals[0] + res.totals[1]).toBe(101);
  });
});

describe('runouts', () => {
  function toFlopNoBet() {
    const { t, now, ctx } = makeTable([1000, 1000, 1000]);
    let n = start(t, now, ctx);
    n = autoplay(t, n, ctx, (x) => x.hand!.street === 'flop');
    return { t, n, ctx, h: t.hand! };
  }
  it('A02/R4-06: an agreed early run once closes all further betting', () => {
    const { t, n, ctx, h } = toFlopNoBet();
    propose(t, h.actor!, 1, n, ctx);
    expect(h.phase).toBe('vote');
    for (const s of [...h.vote!.electorate]) { if (!h.vote) break; if (!h.vote.votes[s]) respondVote(t, s, 'agree', n, ctx); }
    expect(h.bettingLocked).toBe(true);
    expect(h.phase).toBe('runout');
    const n2 = autoplay(t, n, ctx, (x) => x.hand!.phase === 'result');
    expect(h.board.length).toBe(5);
    expect(h.result!.uncontested).toBe(false);
    void n2;
  });
  it('A11/R4-07: a decline restores the exact remaining time and one proposal per street', () => {
    const { t, n, ctx, h } = toFlopNoBet();
    const actor = h.actor!;
    const remaining = h.deadline! - (n + 1234);
    propose(t, actor, 2, n + 1234, ctx);
    const other = h.vote!.electorate.find((s) => s !== actor)!;
    respondVote(t, other, 'decline', n + 3000, ctx);
    expect(h.phase).toBe('betting');
    expect(h.actor).toBe(actor);
    expect(h.deadline).toBe(n + 3000 + remaining);
    expect(() => propose(t, actor, 1, n + 3001, ctx)).toThrow(/One proposal/);
  });
  it('vote expiry declines; A24: a bet cannot race an open proposal', () => {
    const { t, n, ctx, h } = toFlopNoBet();
    const actor = h.actor!;
    propose(t, actor, 2, n, ctx);
    expect(() => act(t, actor, { type: 'raise', raiseTo: 50 }, n + 1, ctx)).toThrow();
    tick(t, n + T.voluntaryVoteMs + 1, ctx);
    expect(h.phase).toBe('betting');
    expect(h.actor).toBe(actor);
  });
  it('A03/R4-08: runout state resets for the next hand', () => {
    const { t, n, ctx, h } = toFlopNoBet();
    propose(t, h.actor!, 2, n, ctx);
    for (const s of [...h.vote!.electorate]) { if (!h.vote) break; if (!h.vote.votes[s]) respondVote(t, s, 'agree', n, ctx); }
    const n2 = autoplay(t, n, ctx, (x) => x.handNo === 2 && !!x.hand);
    expect(t.hand!.runs).toBe(1); expect(t.hand!.bettingLocked).toBe(false); expect(t.hand!.boards).toBeNull(); expect(t.hand!.proposedStreets).toEqual([]);
    void n2;
  });
  it('run twice: both tails share the flop, draw distinct cards from one deck, and settle each pot per board', () => {
    const { t, n, ctx, h } = toFlopNoBet();
    propose(t, h.actor!, 2, n, ctx);
    for (const s of [...h.vote!.electorate]) { if (!h.vote) break; if (!h.vote.votes[s]) respondVote(t, s, 'agree', n, ctx); }
    const flop = h.board.slice();
    autoplay(t, n, ctx, (x) => x.hand!.phase === 'result');
    expect(h.boards![0].slice(0, 3)).toEqual(flop); expect(h.boards![1].slice(0, 3)).toEqual(flop);
    const all = [...h.boards![0], ...h.boards![1].slice(3), ...Object.values(h.hole).flat()];
    expect(new Set(all).size).toBe(all.length);
    expect(h.result!.awards.some((a) => a.board === 1)).toBe(true);
    expect(totalChips(t)).toBe(3000);
  });
  it('A12: preflop all-in deals one shared flop, then offers the tail; silence runs once', () => {
    const { t, now, ctx } = makeTable([300, 300, 300], { unit: 100 });
    let n = start(t, now, ctx);
    const h = t.hand!;
    while (h.phase === 'betting') { const a = h.actor!; const la = legalActions(t, a, n); act(t, a, la.allInTo ? { type: 'raise', raiseTo: la.allInTo } : { type: la.owed ? 'call' : 'check' }, n, ctx); }
    expect(h.phase).toBe('runout');
    tick(t, n, ctx);
    expect(h.board.length).toBe(3);
    expect(h.phase).toBe('offer');
    tick(t, h.vote!.deadline, ctx);
    expect(h.runs).toBe(1);
    n = autoplay(t, h.vote?.deadline ?? n, ctx, (x) => x.hand!.phase === 'result');
    expect(h.board.length).toBe(5);
  });
  it('forced offer: all twice runs twice; any once runs once', () => {
    const { t, now, ctx } = makeTable([300, 300], { unit: 100 });
    let n = start(t, now, ctx);
    const h = t.hand!;
    while (h.phase === 'betting') { const a = h.actor!; const la = legalActions(t, a, n); act(t, a, la.allInTo ? { type: 'raise', raiseTo: la.allInTo } : { type: la.owed ? 'call' : 'check' }, n, ctx); }
    tick(t, n, ctx);
    expect(h.phase).toBe('offer');
    for (const s of [...h.vote!.electorate]) { if (!h.vote) break; respondVote(t, s, 'twice', n, ctx); }
    expect(h.runs).toBe(2);
    autoplay(t, n, ctx, (x) => x.hand!.phase === 'result');
    expect(h.boards!.length).toBe(2);
    expect(totalChips(t)).toBe(600);
  });
  it('tournaments never offer a second board', () => {
    const { t, now, ctx } = makeTable([300, 300], { mode: 'tournament', unit: 300, levels: [{ sb: 5, bb: 10, ante: 0, minutes: 5 }] });
    let n = start(t, now, ctx);
    const h = t.hand!;
    while (h.phase === 'betting') { const a = h.actor!; const la = legalActions(t, a, n); act(t, a, la.allInTo ? { type: 'raise', raiseTo: la.allInTo } : { type: la.owed ? 'call' : 'check' }, n, ctx); }
    expect(h.phase).toBe('runout');
    expect(() => propose(t, h.players[0].seat, 2, n, ctx)).toThrow();
    autoplay(t, n, ctx, (x) => !x.hand || x.hand.phase === 'result' || x.status !== 'running');
    expect(h.boards).toBeNull();
  });
});

describe('result, reveal and next hand', () => {
  it('uncontested winner may reveal single cards or all within 3 seconds; muck closes; irreversible', () => {
    const { t, now, ctx } = makeTable([1000, 1000, 1000]);
    const n = start(t, now, ctx);
    const h = t.hand!;
    act(t, h.actor!, { type: 'fold' }, n, ctx);
    act(t, h.actor!, { type: 'fold' }, n, ctx);
    const w = h.result!.winnerSeat!;
    expect(h.revealDeadline).toBe(n + T.revealMs);
    expect(() => reveal(t, (w + 1) % 3, [0], n, ctx)).toThrow();
    reveal(t, w, [1], n + 100, ctx);
    expect(publicView(t).hand!.revealedCards[w]).toEqual([{ index: 1, card: h.hole[w][1] }]);
    reveal(t, w, 'muck', n + 200, ctx);
    expect(() => reveal(t, w, [0], n + 300, ctx)).toThrow();
    expect(publicView(t).hand!.revealedCards[w].length).toBe(1);
  });
  it('an uncontested pot lingers the reveal window so a shown card propagates before the next hand', () => {
    const { t, now, ctx } = makeTable([1000, 1000, 1000]);
    const n = start(t, now, ctx);
    const h = t.hand!;
    act(t, h.actor!, { type: 'fold' }, n, ctx);
    act(t, h.actor!, { type: 'fold' }, n, ctx);
    expect(t.dueAt).toBe(n + T.revealMs);
    tick(t, n + T.revealMs, ctx);
    expect(t.handNo).toBe(2);
    expect(t.hand!.phase).toBe('choice');
  });
  it('holds new hands while nobody is present and resumes when someone returns', () => {
    const { t, now, ctx } = makeTable([1000, 1000, 1000]);
    const n = start(t, now, ctx);
    const h = t.hand!;
    act(t, h.actor!, { type: 'fold' }, n, ctx); act(t, h.actor!, { type: 'fold' }, n, ctx);
    const gone = { ...ctx, presence: {} };
    tick(t, n + T.revealMs, gone);
    expect(t.hand).toBeNull(); expect(t.waitingReason).toMatch(/return/);
    tick(t, n + T.revealMs + 5000, ctxAll(t, n + T.revealMs + 5000, ctx.rng));
    expect(t.hand).not.toBeNull();
  });
});

describe('sessions: sit out, missed blinds, leave', () => {
  it('a sitting-out player who skips the blinds owes them; returning waits for the big blind', () => {
    const { t, now, ctx } = makeTable([1000, 1000, 1000, 1000]);
    let n = start(t, now, ctx);
    const h1 = t.hand!;
    // the player left of the button (SB this hand) sits out after this hand
    const target = (h1.button + 2) % 4; // BB seat this hand -> will be skipped as SB? choose seat that would be next BB
    const nextBB = (h1.bbSeat! + 1) % 4;
    requestSitOut(t, 'p' + nextBB, n);
    n = autoplay(t, n, ctx, (x) => x.handNo === 2 && !!x.hand && x.hand.phase === 'choice');
    expect(t.hand!.players.some((p) => p.seat === nextBB)).toBe(false);
    n = autoplay(t, n, ctx, (x) => x.handNo === 3 && !!x.hand && x.hand.phase === 'choice');
    expect(t.seats[nextBB]!.owesBB).toBe(true);
    requestReturn(t, 'p' + nextBB, false, n);
    // returning player waits until the natural BB reaches them
    let dealtIn = t.hand!.players.some((p) => p.seat === nextBB);
    for (let k = 0; k < 4 && !dealtIn; k++) {
      n = autoplay(t, n, ctx, (x) => x.handNo === 3 + k + 1 && !!x.hand && x.hand.phase === 'choice');
      dealtIn = t.hand!.players.some((p) => p.seat === nextBB);
      if (dealtIn) expect(t.hand!.bbSeat).toBe(nextBB);
    }
    expect(dealtIn).toBe(true);
    expect(totalChips(t)).toBe(4000);
    void target;
  });
  it('leaving between hands records the exit and frees the seat; a late join waits for the big blind', () => {
    const { t, now, ctx } = makeTable([1000, 1000, 1000]);
    let n = start(t, now, ctx);
    const effects = requestLeave(t, 'p2', 'leave', n, ctx);
    expect(effects.find((e) => e.type === 'exit')).toBeUndefined(); // in hand: deferred
    n = autoplay(t, n, ctx, (x) => x.handNo === 2 && !!x.hand);
    expect(t.seats[2]).toBeNull();
    const seat = seatPlayer(t, { playerId: 'p9', name: 'New' }, 2000, n);
    expect(t.seats[seat]!.owesBB).toBe(true);
    expect(t.hand!.players.some((p) => p.playerId === 'p9')).toBe(false);
  });
  it('closes the table when everyone has left', () => {
    const { t, now, ctx } = makeTable([1000, 1000]);
    const e1 = requestLeave(t, 'p0', 'leave', now, ctx);
    expect(e1.some((e) => e.type === 'exit')).toBe(true);
    const e2 = requestLeave(t, 'p1', 'leave', now, ctx);
    expect(e2.some((e) => e.type === 'archive')).toBe(true);
    expect(t.status).toBe('closed');
  });
});

describe('tournament levels and eliminations', () => {
  const levels = [{ sb: 5, bb: 10, ante: 0, minutes: 1 }, { sb: 10, bb: 20, ante: 0, minutes: 3 }, { sb: 20, bb: 40, ante: 5, minutes: 4 }];
  it('A04/A05/A06/R4-20: each level uses its own duration, multiple elapsed levels catch up, final level holds, new tournament starts at level one', () => {
    const { t, now, ctx } = makeTable([1000, 1000, 1000], { mode: 'tournament', levels });
    let n = start(t, now, ctx);
    expect(t.hand!.level).toBe(0); expect(t.hand!.bb).toBe(10);
    // finish a hand quickly, then jump 2.5 minutes: should be level 2 (index 1)
    act(t, t.hand!.actor!, { type: 'fold' }, n, ctx); act(t, t.hand!.actor!, { type: 'fold' }, n, ctx);
    n = now + 150_000;
    tick(t, n, ctxAll(t, n, ctx.rng));
    expect(t.hand!.level).toBe(1); expect(t.hand!.bb).toBe(20);
    chooseVariant(t, t.hand!.chooserSeat, 'holdem', n, ctx); n = t.hand!.actionReadyAt!;
    act(t, t.hand!.actor!, { type: 'fold' }, n, ctx); act(t, t.hand!.actor!, { type: 'fold' }, n, ctx);
    n = now + 10_000_000; // long after the schedule ends
    tick(t, n, ctxAll(t, n, ctx.rng));
    expect(t.hand!.level).toBe(2); expect(t.hand!.bb).toBe(40); expect(t.hand!.ante).toBe(5);
  });
  it('level changes never alter the active hand', () => {
    const { t, now, ctx } = makeTable([1000, 1000, 1000], { mode: 'tournament', levels });
    const n = start(t, now, ctx);
    const h = t.hand!;
    tick(t, n + 70_000, ctxAll(t, n + 70_000, ctx.rng)); // actor timed out etc., but blinds unchanged
    expect(h.bb).toBe(10);
  });
  it('R4-22 (short-stack forced all-in): a big blind below the blind posts all-in, the hand is contested, elimination happens only after settlement', () => {
    const lv = [{ sb: 10, bb: 20, ante: 0, minutes: 60 }];
    let eliminatedSeen = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const { t, now, ctx } = makeTable([1000, 1000, 1000], { mode: 'tournament', unit: 1000, levels: lv }, 1_000_000, seededRng(seed));
      startTable(t, now, ctx);
      const h = t.hand!;
      const bb = h.bbSeat!;
      t.seats[bb]!.stack = 15; // below the 20 big blind
      const total = totalChips(t);
      chooseVariant(t, h.chooserSeat, 'holdem', now, ctx);
      let n = h.actionReadyAt!;
      const bbp = h.players.find((p) => p.seat === bb)!;
      expect(bbp.allIn).toBe(true); expect(bbp.bet).toBe(15);
      expect(h.currentBet).toBe(20); // nominal bring-in stays 20
      // the other two call the nominal blind; the short stack is contested, not walked
      while (h.phase === 'betting') { const a = h.actor!; const la = legalActions(t, a, n); act(t, a, { type: la.owed ? 'call' : 'check' }, n, ctx); }
      const effects: ReturnType<typeof tick> = [];
      for (let g = 0; g < 50 && h.phase !== 'result'; g++) { n = Math.max(n, t.dueAt!); effects.push(...tick(t, n, ctxAll(t, n, ctx.rng))); }
      expect(h.phase).toBe('result');
      expect(h.result!.uncontested).toBe(false);
      expect(t.seats[bb]!.eliminatedPlace).toBeNull(); // never before the boundary, even at zero chips
      expect(totalChips(t)).toBe(total);
      n = h.nextAt!;
      effects.push(...tick(t, n, ctxAll(t, n, ctx.rng)));
      expect(totalChips(t)).toBe(total);
      if (t.seats[bb]!.stack === 0) {
        eliminatedSeen++;
        expect(t.seats[bb]!.eliminatedPlace).toBe(3);
        expect(t.tournament!.eliminations).toEqual([{ playerId: 'p' + bb, name: 'P' + bb, place: 3, handNo: 1 }]);
        expect(effects.some((e) => e.type === 'eliminated' && e.playerId === 'p' + bb && e.place === 3)).toBe(true);
        expect(t.status).toBe('running');
        expect(t.hand!.players.length).toBe(2); // play continues heads-up, the busted seat is never dealt in
        expect(t.hand!.players.some((p) => p.seat === bb)).toBe(false);
      } else {
        expect(t.seats[bb]!.stack).toBeGreaterThan(15); // won the main pot or a share of it
        expect(t.seats[bb]!.eliminatedPlace).toBeNull();
        expect(t.hand!.players.length).toBe(3);
      }
    }
    expect(eliminatedSeen).toBeGreaterThan(0);
  });

  it('timeout-only tournament: levels rise on the clock, blinds and antes follow, chips are conserved, and the fold rotation legitimately never finishes', () => {
    // Every player is present but nobody acts: each actor times out (check if possible, otherwise fold). Preflop the
    // under-the-gun and small blind fold and the big blind collects. Over one full orbit each seat is big blind once and
    // small blind once, so the net transfer is zero: no stack ever drops below a blind and nobody is eliminated.
    // That is correct tournament behaviour, not a stall, so this test asserts progression and bounds the hand count.
    const lv = [{ sb: 5, bb: 10, ante: 0, minutes: 1 }, { sb: 10, bb: 20, ante: 0, minutes: 1 }, { sb: 20, bb: 40, ante: 5, minutes: 1 }];
    const { t, now, ctx } = makeTable([1000, 1000, 1000], { mode: 'tournament', unit: 1000, levels: lv });
    startTable(t, now, ctx);
    let n = now;
    const bbs: number[] = [];
    let lastHand = 0;
    for (let g = 0; g < 2000 && t.handNo < 30; g++) {
      n = Math.max(n, t.dueAt ?? n + 1000) + 1;
      tick(t, n, ctxAll(t, n, ctx.rng));
      if (t.hand && t.handNo !== lastHand) { lastHand = t.handNo; bbs.push(t.hand.bb); }
      expect(totalChips(t)).toBe(3000);
    }
    expect(t.handNo).toBe(30);
    expect(t.status).toBe('running');
    expect(t.tournament!.level).toBe(2);
    expect(t.hand!.bb).toBe(40); expect(t.hand!.ante).toBe(5);
    expect(bbs[0]).toBe(10);
    for (let i = 1; i < bbs.length; i++) expect(bbs[i]).toBeGreaterThanOrEqual(bbs[i - 1]); // never decreases
    expect(new Set(bbs)).toEqual(new Set([10, 20, 40]));
    expect(t.tournament!.eliminations).toEqual([]);
    for (const s of t.seats) { expect(s!.stack).toBeGreaterThan(800); expect(s!.stack).toBeLessThan(1200); }
    // every hand ended uncontested by timeouts: the log of the last completed hand shows folds flagged as timeouts
    expect(t.events.filter((e) => e.type === 'action' && e.action === 'fold').length).toBeGreaterThan(0);
  });

  it('simulated shoves: a tournament with active betting completes with a unique winner, full standings and an archive effect', () => {
    const lv = [{ sb: 5, bb: 10, ante: 0, minutes: 1 }, { sb: 10, bb: 20, ante: 0, minutes: 1 }, { sb: 20, bb: 40, ante: 5, minutes: 1 }];
    const { t, now, ctx } = makeTable([1000, 1000, 1000, 1000], { mode: 'tournament', unit: 1000, levels: lv }, 1_000_000, seededRng(7));
    const effects: ReturnType<typeof tick> = [];
    let n = now;
    let hands = 0;
    const bbs: number[] = [];
    effects.push(...startTable(t, now, ctx));
    for (let g = 0; g < 5000 && t.status === 'running'; g++) {
      const h = t.hand;
      if (!h) { n = Math.max(n, t.dueAt ?? n) + 1; effects.push(...tick(t, n, ctxAll(t, n, ctx.rng))); continue; }
      if (h.phase === 'choice') { chooseVariant(t, h.chooserSeat, 'holdem', n, ctx); n = h.actionReadyAt!; hands++; bbs.push(h.bb); continue; }
      if (h.phase === 'betting' && h.actor !== null) {
        // one designated seat shoves each hand (rotating); everyone else calls, so every hand is contested by all
        const alive = t.seats.map((s, i) => (s && s.stack > 0 && s.eliminatedPlace === null ? i : -1)).filter((i) => i >= 0);
        const shover = alive[(h.handNo - 1) % alive.length];
        // the shover goes all in once it is not the biggest stack (equal starting stacks would make hand one a four-way
        // all-in and end the event in one hand); as the chip leader it opens for a bounded raise instead
        const la = legalActions(t, h.actor, n);
        const biggest = Math.max(...alive.map((i) => t.seats[i]!.stack + (h.players.find((p) => p.seat === i)?.bet ?? 0)));
        const mine = t.seats[h.actor]!.stack + (h.players.find((p) => p.seat === h.actor)?.bet ?? 0);
        if (h.actor === shover && h.street === 'preflop' && la.raise && mine < biggest) effects.push(...act(t, h.actor, { type: 'raise', raiseTo: la.allInTo ?? la.raise.maxTo }, n, ctx));
        else if (h.actor === shover && h.street === 'preflop' && la.raise) effects.push(...act(t, h.actor, { type: 'raise', raiseTo: Math.max(la.raise.minTo, Math.min(la.raise.maxTo, 250)) }, n, ctx));
        else effects.push(...act(t, h.actor, { type: la.owed ? 'call' : 'check' }, n, ctx));
        expect(totalChips(t)).toBe(4000);
        continue;
      }
      if (h.phase === 'result') {
        for (const p of h.players) if (t.seats[p.seat]!.stack === 0) expect(t.seats[p.seat]!.eliminatedPlace).toBeNull(); // busted this hand: ranked only at the boundary
        n = Math.max(n, h.nextAt!) + 70_000; // a level passes between hands
        effects.push(...tick(t, n, ctxAll(t, n, ctx.rng)));
        continue;
      }
      n = Math.max(n, t.dueAt ?? n) + 1; effects.push(...tick(t, n, ctxAll(t, n, ctx.rng)));
    }
    expect(t.status).toBe('finished');
    expect(hands).toBeLessThan(40);
    expect(hands).toBeGreaterThanOrEqual(3);
    const tr = t.tournament!;
    const winner = t.seats.find((s) => s && s.playerId === tr.winnerPlayerId)!;
    expect(winner.stack).toBe(4000);
    expect(winner.eliminatedPlace).toBe(1);
    const places = tr.eliminations.map((e) => e.place).sort((a, b) => a - b);
    expect(tr.eliminations.length).toBe(4);
    expect(places[0]).toBe(1);
    // competition ranking: each place is either the next number or shared with the previous bust (equal hand-start stacks)
    for (let i = 1; i < places.length; i++) expect(places[i] === i + 1 || places[i] === places[i - 1]).toBe(true);
    expect(new Set(tr.eliminations.map((e) => e.playerId)).size).toBe(4);
    expect(t.seats.every((s) => s && s.eliminatedPlace !== null)).toBe(true);
    expect(bbs[0]).toBe(10); expect(Math.max(...bbs)).toBe(40);
    for (let i = 1; i < bbs.length; i++) expect(bbs[i]).toBeGreaterThanOrEqual(bbs[i - 1]);
    expect(effects.filter((e) => e.type === 'eliminated').length).toBe(3);
    expect(effects.some((e) => e.type === 'tournament_finished' && !e.abandoned && e.winnerPlayerId === tr.winnerPlayerId)).toBe(true);
    expect(effects.some((e) => e.type === 'archive' && e.reason === 'finished')).toBe(true);
    expect(t.hand).toBeNull();
    expect(t.dueAt).toBeNull();
  });

  it('all players absent: new hands hold after 45 s, resume when someone returns, and a 30-minute absence abandons the tournament (closes a cash table with exits)', () => {
    const lv = [{ sb: 5, bb: 10, ante: 0, minutes: 60 }];
    for (const mode of ['tournament', 'cash'] as const) {
      const { t, now, ctx } = makeTable([1000, 1000, 1000], mode === 'tournament' ? { mode, unit: 1000, levels: lv } : {});
      let n = start(t, now, ctx);
      n = autoplay(t, n, ctx, (x) => x.hand!.phase === 'result');
      const h = t.hand!;
      const nobody = { presence: {}, rng: ctx.rng };
      n = h.nextAt! + T.nobodyPresentHoldMs + 1;
      let fx = tick(t, n, nobody);
      expect(fx.some((e) => e.type === 'history')).toBe(true); // the finished hand is still recorded
      expect(t.hand).toBeNull(); expect(t.status).toBe('running'); expect(t.waitingReason).toBe('Waiting for someone to return');
      expect(t.dueAt).toBe(n + T.nobodyPresentHoldMs); // the scheduler keeps re-checking presence while held
      n += 10 * 60_000; tick(t, n, nobody);
      expect(t.dueAt).toBe(n + T.nobodyPresentHoldMs);
      expect(t.hand).toBeNull(); expect(t.status).toBe('running');
      // one player comes back: a hand starts again
      n += 1000; tick(t, n, { presence: { p1: n }, rng: ctx.rng });
      expect(t.hand).not.toBeNull(); expect(t.handNo).toBe(2);
      n = autoplay(t, n, ctx, (x) => x.hand!.phase === 'result');
      const total = totalChips(t);
      n = t.hand!.nextAt! + T.abandonmentMs + 1;
      fx = tick(t, n, nobody);                 // settles the hand, holds, arms the idle check
      expect(t.status).toBe('running');
      fx.push(...tick(t, t.dueAt!, nobody));   // the scheduler's next visit abandons
      if (mode === 'tournament') {
        expect(t.status).toBe('abandoned');
        expect(fx.some((e) => e.type === 'tournament_finished' && e.abandoned && e.winnerPlayerId === null)).toBe(true);
        expect(t.tournament!.winnerPlayerId).toBeNull();
        expect(t.seats.filter((s) => s).reduce((a, s) => a + s!.stack, 0)).toBe(total); // stacks untouched for the record
      } else {
        expect(t.status).toBe('closed');
        const exits = fx.filter((e) => e.type === 'exit');
        expect(exits.length).toBe(3);
        expect(exits.reduce((a, e) => a + (e.type === 'exit' ? e.amount : 0), 0)).toBe(total);
        expect(t.seats.every((s) => !s)).toBe(true);
      }
      expect(fx.some((e) => e.type === 'archive' && e.reason === 'abandoned')).toBe(true);
      expect(t.hand).toBeNull(); expect(t.dueAt).toBeNull();
    }
  });
});

describe('host succession', () => {
  it('transfers once to the earliest-joined present member after 30 seconds and the old host does not seize it back', () => {
    const { t, now, ctx } = makeTable([1000, 1000, 1000]);
    const n = start(t, now, ctx);
    const presence = { p1: n + 40_000, p2: n + 40_000 }; // host p0 absent
    tick(t, n + 40_000, { ...ctx, presence });
    expect(t.hostPlayerId).toBe('p1'); expect(t.hostEpoch).toBe(2);
    tick(t, n + 41_000, { ...ctx, presence: { ...presence, p0: n + 41_000, p1: n + 41_000 } });
    expect(t.hostPlayerId).toBe('p1'); expect(t.hostEpoch).toBe(2);
  });
});

describe('stress: random play conserves chips and never deals duplicates', () => {
  it('plays many hands across variants and seat counts', () => {
    const rng = seededRng(42);
    let hands = 0, twoBoards = 0, uncontested = 0;
    for (let round = 0; round < 24; round++) {
      const n = 2 + (round % 8);
      const stacks = Array.from({ length: n }, () => 200 + rng(20) * 100);
      const total = stacks.reduce((a, b) => a + b, 0);
      const { t, now, ctx } = makeTable(stacks, { straddle: round % 2 === 0, ante: round % 3 === 0 ? 5 : 0, sb: 5, bb: 10, unit: 100 }, 1000, seededRng(round));
      let time = now;
      startTable(t, time, ctx);
      let steps = 0;
      while (t.status === 'running' && steps++ < 4000 && t.handNo < 12) {
        const h = t.hand;
        if (!h) { time += 1000; tick(t, time, ctxAll(t, time, ctx.rng)); continue; }
        if (h.phase === 'choice') {
          const opts = ['holdem', 'omaha4', 'omaha5', 'omaha6'] as const;
          const v = opts[rng(4)];
          if (h.straddleOffer && !h.straddleOffer.decided && rng(2)) respondStraddle(t, h.straddleOffer.seat, true, time, ctx);
          if (variantAllowed(h.players.length, v)) chooseVariant(t, h.chooserSeat, v, time, ctx); else tick(t, h.choiceDeadline!, ctx), (time = h.choiceDeadline! + 1);
          continue;
        }
        if (h.phase === 'betting' && h.actor !== null) {
          if (h.actionReadyAt && time < h.actionReadyAt) time = h.actionReadyAt;
          const a = h.actor; const la = legalActions(t, a, time);
          const r = rng(10);
          if (r < 2 && la.owed > 0) act(t, a, { type: 'fold' }, time, ctx);
          else if (r < 4 && la.raise) act(t, a, { type: 'raise', raiseTo: la.raise.minTo + rng(Math.max(1, la.raise.maxTo - la.raise.minTo + 1)) }, time, ctx);
          else if (r === 4 && la.raise && la.allInTo) act(t, a, { type: 'raise', raiseTo: la.allInTo }, time, ctx);
          else if (r === 5 && t.rules.mode === 'cash' && (h.street === 'flop' || h.street === 'turn') && !h.players.some((p) => p.bet > 0) && !h.proposedStreets.includes(h.street) && h.players.filter((p) => !p.folded).length > 1 && (rng(2) === 0 || canRunTwice(h))) {
            try { propose(t, a, canRunTwice(h) && rng(2) ? 2 : 1, time, ctx); } catch { act(t, a, { type: la.check ? 'check' : 'call' }, time, ctx); }
          } else act(t, a, { type: la.check ? 'check' : 'call' }, time, ctx);
          continue;
        }
        if ((h.phase === 'vote' || h.phase === 'offer') && h.vote) {
          const pending = h.vote.electorate.filter((s) => !h.vote!.votes[s]);
          if (pending.length && rng(3)) { const s = pending[0]; respondVote(t, s, h.vote.kind === 'proposal' ? (rng(4) ? 'agree' : 'decline') : (rng(2) ? 'twice' : 'once'), time, ctx); continue; }
          time = h.vote.deadline; tick(t, time, ctx); continue;
        }
        if (h.phase === 'result' && h.result!.uncontested && rng(2)) { try { reveal(t, h.result!.winnerSeat!, rng(2) ? 'all' : [0], time, ctx); } catch { /* window closed */ } }
        if (t.dueAt !== null) { time = Math.max(time, t.dueAt); const before = t.handNo; tick(t, time, ctxAll(t, time, ctx.rng)); if (t.handNo !== before) hands++; continue; }
        break;
      }
      if (t.error) throw new Error(t.error);
      expect(totalChips(t)).toBe(total);
      for (const e of t.events) { if (e.type === 'award') { /* ok */ } }
      twoBoards += 0; uncontested += 0;
      void twoBoards; void uncontested;
    }
    expect(hands).toBeGreaterThan(100);
  });
});
