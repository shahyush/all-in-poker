export interface Position { left: number; top: number }

/** Stable physical seats, clockwise from the viewer. Side rails reserve the whole centre for the board.
 * Unlike an ellipse, these positions never pull a middle seat inward over the community cards.
 * Empty seats retain their positions; joining/leaving cannot shuffle players around the screen.
 */
export function seatPositions(seatCount: number, mySeat: number, landscape: boolean): Position[] {
  const rail: Position[] = [{ left: 50, top: 96 }];
  if (seatCount === 2) rail.push({ left: landscape ? 11 : 50, top: landscape ? 12 : 8 });
  else {
    const leftCount = Math.ceil((seatCount - 1) / 2);
    const rightCount = Math.floor((seatCount - 1) / 2);
    const row = (n: number) => Array.from({ length: n }, (_, i) => n === 1 ? 32 : 12 + i * 78 / (n - 1));
    for (const top of row(leftCount).reverse()) rail.push({ left: 11, top });
    for (const top of row(rightCount)) rail.push({ left: 89, top });
  }
  return Array.from({ length: seatCount }, (_, i) => rail[(i - mySeat + seatCount) % seatCount]);
}

/** Bets stay with their player on the rail, never in the board's reserved rectangle. */
export function betPosition(p: Position, _landscape: boolean): Position {
  return { left: p.left, top: p.top > 90 ? 88 : p.top + 10 };
}
