/** Seat positions around the felt as percentages. The viewer's seat anchors at the bottom; clockwise order is preserved. */
export function seatPositions(seatCount: number, mySeat: number, landscape: boolean): { left: number; top: number }[] {
  const out: { left: number; top: number }[] = [];
  // Portrait is a tall oval: seat pods sit on the rail (not floating in the felt), the viewer anchors at the bottom where
  // the felt meets their own cards and controls. Landscape stays a wide oval beside the control column.
  const rx = landscape ? 42 : 43, ry = landscape ? 36 : 43, cx = 50, cy = landscape ? 50 : 50;
  for (let k = 0; k < seatCount; k++) {
    const angle = (Math.PI / 2) + ((k - mySeat + seatCount) % seatCount) * (2 * Math.PI / seatCount);
    out.push({ left: cx + rx * Math.cos(angle), top: cy + ry * Math.sin(angle) });
  }
  return out;
}
/** Position for a bet marker: a point between the seat and the centre. */
export function betPosition(p: { left: number; top: number }, landscape: boolean): { left: number; top: number } {
  const cx = 50, cy = 50;
  return { left: p.left + (cx - p.left) * 0.42, top: p.top + (cy - p.top) * 0.42 };
}
