import { BURN_MS, planDeal, type Card, type PublicEvent } from '@allin/engine/public';

/** DOM-level deal animation driven by a planner; card backs fly from the deck anchor to seat slots. */
export function runDealAnimation(root: HTMLElement, ev: Extract<PublicEvent, { type: 'deal' }>, handId: string, reducedMotion: boolean, onDone: () => void): () => void {
  const deck = root.querySelector<HTMLElement>('[data-deck]');
  if (!deck) { onDone(); return () => undefined; }
  let plan;
  try { plan = planDeal({ eventId: String(ev.seq), handId, seatIds: ev.order, buttonSeatId: ev.button, holeCount: ev.holeCount, reducedMotion }); }
  catch { onDone(); return () => undefined; }
  const from = deck.getBoundingClientRect();
  const flyers: HTMLElement[] = [];
  const slots: HTMLElement[] = [];
  const anims: Animation[] = [];
  let cancelled = false;
  // Measure all destinations before hiding slots or inserting animated cards.
  // Interleaving these operations forced repeated layout at crowded tables.
  const destinations = plan.steps.flatMap(step => {
    const slot = root.querySelector<HTMLElement>(`[data-seat="${step.to}"] [data-slot="${step.slot}"]`) ?? root.querySelector<HTMLElement>(`[data-seat="${step.to}"]`);
    return slot ? [{ step, slot, to: slot.getBoundingClientRect() }] : [];
  });
  for (const { step, slot, to } of destinations) {
    slots.push(slot);
    slot.style.visibility = reducedMotion ? '' : 'hidden';
    if (reducedMotion) { slot.style.visibility = ''; continue; }
    const el = document.createElement('span');
    el.className = 'pc back fly';
    el.setAttribute('aria-hidden', 'true');
    el.style.left = from.left + 'px'; el.style.top = from.top + 'px'; el.style.width = to.width + 'px'; el.style.height = to.height + 'px'; el.style.opacity = '0';
    document.body.appendChild(el);
    flyers.push(el);
    const a = el.animate([
      { transform: 'translate(0,0) rotate(-6deg)', opacity: 0 },
      { opacity: 1, offset: 0.1 },
      { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) rotate(0deg)`, opacity: 1 },
    ], { duration: step.durationMs, delay: step.delayMs, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'forwards' });
    a.onfinish = () => { if (cancelled) return; slot.style.visibility = ''; el.remove(); };
    anims.push(a);
  }
  const total = reducedMotion ? 0 : plan.durationMs + 20;
  const t = setTimeout(() => { if (!cancelled) finish(); }, total);
  function finish() { for (const slot of slots) slot.style.visibility = ''; for (const el of flyers) el.remove(); onDone(); }
  return () => { for (const slot of slots) slot.style.visibility = ''; cancelled = true; clearTimeout(t); for (const a of anims) a.cancel(); for (const el of flyers) el.remove(); };
}

/** A discreet burn: one card back slides a short way off the deck and fades, face-down throughout. The burned card is
 *  never in the event, so there is nothing that could be exposed. Returns the lead time (ms) a following board reveal
 *  should wait so the burn visibly happens first; 0 under reduced motion. */
export function runBurnAnimation(root: HTMLElement, reducedMotion: boolean): number {
  const deck = root.querySelector<HTMLElement>('[data-deck]');
  if (!deck || reducedMotion) return 0;
  const from = deck.getBoundingClientRect();
  const pile = root.querySelector<HTMLElement>('[data-burn-pile]')?.getBoundingClientRect();
  const dx = pile ? pile.left - from.left : -48;
  const dy = pile ? pile.top - from.top : 12;
  const el = document.createElement('span');
  el.className = 'pc back fly';
  el.setAttribute('aria-hidden', 'true');
  el.style.left = from.left + 'px'; el.style.top = from.top + 'px'; el.style.width = from.width + 'px'; el.style.height = from.height + 'px';
  document.body.appendChild(el);
  const a = el.animate([
    { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
    { transform: `translate(${dx}px, ${dy}px) rotate(-14deg)`, opacity: 0.9, offset: 0.7 },
    { transform: `translate(${dx}px, ${dy}px) rotate(-18deg)`, opacity: 0 },
  ], { duration: BURN_MS, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'forwards' });
  a.onfinish = () => el.remove();
  return BURN_MS;
}

export function reducedMotionPreferred(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches || localStorage.getItem('allin.reducedMotion') === '1'; } catch { return false; }
}
export type { Card };
