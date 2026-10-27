export interface Position { left: number; top: number }

/** Clockwise physical order, rotated to put the viewer at six o'clock.
 * The top arc has two seats at full capacity; side seats stay outside the board. */
export function seatPositions(seatCount: number, mySeat: number, landscape: boolean): Position[] {
  const rail: Position[] = [{ left: 50, top: 94 }];
  if (landscape) {
    const leftCount = Math.ceil((seatCount - 1) / 2);
    const rightCount = Math.floor((seatCount - 1) / 2);
    const rows = (n:number) => Array.from({length:n},(_,i)=>n===1?35:12+i*76/(n-1));
    for (const top of rows(leftCount).reverse()) rail.push({left:11,top});
    for (const top of rows(rightCount)) rail.push({left:89,top});
    return Array.from({length:seatCount},(_,i)=>rail[(i-mySeat+seatCount)%seatCount]);
  }
  const others = seatCount - 1;
  const topCount = others >= 6 ? 2 : 1;
  const leftCount = Math.ceil((others - topCount) / 2);
  const rightCount = others - topCount - leftCount;
  const rows = (n: number) => Array.from({length:n}, (_, i) => n === 1 ? 48 : 30 + i * 38 / (n - 1));
  for (const top of rows(leftCount).reverse()) rail.push({left:11,top});
  for (let i=0;i<topCount;i++) rail.push({left:topCount===1?50:34+i*32,top:10});
  for (const top of rows(rightCount)) rail.push({left:89,top});
  return Array.from({length:seatCount},(_,i)=>rail[(i-mySeat+seatCount)%seatCount]);
}

/** Bets stay with their player on the rail, never in the board's reserved rectangle. */
export function betPosition(p: Position, _landscape: boolean): Position {
  return { left: p.left, top: p.top > 90 ? 88 : p.top + 10 };
}
