import { describe, it, expect } from 'vitest';
import { eval5, bestHand, currentBest, categoryOf, combos, describeScore } from '../src/evaluator.ts';
import { parseCard } from '../src/cards.ts';
import { parseChipAmount } from '../src/amounts.ts';

const C = (s: string) => s.split(' ').map(parseCard);

describe('evaluator', () => {
  it('counts all 2,598,960 five-card combinations by category', () => {
    const counts = Array(9).fill(0);
    const all = Array.from({ length: 52 }, (_, i) => i);
    for (const five of combos(all, 5)) counts[categoryOf(eval5(five))]++;
    expect(counts).toEqual([1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40]);
  }, 60000);
  it('ranks the wheel as five-high and never wraps', () => {
    expect(categoryOf(eval5(C('As 2d 3c 4h 5s')))).toBe(4);
    expect(eval5(C('As 2d 3c 4h 5s'))).toBeLessThan(eval5(C('2s 3d 4c 5h 6s')));
    expect(categoryOf(eval5(C('Qs Kd Ac 2h 3s')))).toBe(0);
  });
  it('orders kickers and full houses, ignores suits', () => {
    expect(eval5(C('As Ad Kc Kh 2s'))).toBeGreaterThan(eval5(C('Ac Ah Qc Qh Ks')));
    expect(eval5(C('3s 3d 3c Kh Ks'))).toBeGreaterThan(eval5(C('2s 2d 2c Ah As')));
    expect(eval5(C('As Ks Qs Js 9s'))).toBe(eval5(C('Ah Kh Qh Jh 9h')));
    expect(describeScore(eval5(C('As Ad Kc Kh 2s')))).toBe('Two pair, Aces and Kings');
  });
  it("hold'em may play the board", () => {
    const b = bestHand(C('2c 3d'), C('As Ks Qs Js Ts'), 'holdem');
    expect(describeScore(b.score)).toBe('Royal flush');
  });
  it('omaha uses exactly two hole cards: a board flush with one hole spade is not a flush', () => {
    const b = bestHand(C('As 2d 3c 4h'), C('Ks Qs Js 9s 7d'), 'omaha4');
    expect(categoryOf(b.score)).not.toBe(5);
    const b2 = bestHand(C('As 2s 3c 4h'), C('Ks Qs Js 9s 7d'), 'omaha4');
    expect(categoryOf(b2.score)).toBe(5);
    expect(() => bestHand(C('As 2s 3c'), C('Ks Qs Js 9s 7d'), 'omaha4')).toThrow();
    const b6 = bestHand(C('As 2s 3c 4h 5d 6d'), C('Ks Qs Js 9s 7d'), 'omaha6');
    expect(b6.cards.length).toBe(5);
  });
  it('rejects duplicate cards', () => {
    expect(() => bestHand(C('As As'), C('Ks Qs Js 9s 7d'), 'holdem')).toThrow();
  });
  it('currentBest: live label on a partial board, Omaha exactly-two rule, null before the flop', () => {
    expect(currentBest(C('Qs Qd'), C('Qh 7c 2d'), 'holdem')!.name).toBe('Three of a kind, Queens');
    // hold'em flush on the flop: two hole spades plus three board spades
    expect(categoryOf(currentBest(C('7s 8s'), C('As Ks Qs'), 'holdem')!.score)).toBe(5);
    // Omaha on the flop: one hole spade cannot make the board-spade flush, but two can
    expect(categoryOf(currentBest(C('As 2d 3c 4h'), C('Ks Qs Js'), 'omaha4')!.score)).not.toBe(5);
    expect(categoryOf(currentBest(C('As 2s 3c 4h'), C('Ks Qs Js'), 'omaha4')!.score)).toBe(5);
    const m = currentBest(C('Ah Ad Kc 7s'), C('As Kd 2h'), 'omaha4')!;
    expect(m.cards.length).toBe(5);
    expect(currentBest(C('Ah Kd'), C('Qs Jc'), 'holdem')).toBeNull(); // only two board cards: too early
  });
});

describe('amounts', () => {
  it('accepts canonical positive integers only', () => {
    expect(parseChipAmount('3000')).toBe(3000);
    expect(parseChipAmount(' 21 ')).toBe(21);
    for (const bad of ['1.5', '-2', '1e2', 'Infinity', '15abc', '1,000', '', '01', '1000000000001', 'NaN', '+5']) expect(parseChipAmount(bad)).toBeNull();
    expect(parseChipAmount(1.5)).toBeNull();
    expect(parseChipAmount(-2)).toBeNull();
    expect(parseChipAmount(Infinity)).toBeNull();
  });
});
