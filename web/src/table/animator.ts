import { planDeal, type Card, type PublicEvent } from '@allin/engine/public';

/** DOM-level deal animation driven by a planner; card backs fly from the deck anchor to seat slots. */
export function runDealAnimation(root: HTMLElement, ev: Extract<PublicEvent, { type: 'deal' }>, handId: string, reducedMotion: boolean, onDone: () => void): () => void {
  const deck = root.querySelector<HTMLElement>('[data-deck]');
  if (!deck) { onDone(); return () => undefined; }
  let plan;
  try { plan = planDeal({ eventId: String(ev.seq), handId, seatIds: ev.order, buttonSeatId: ev.button, holeCount: ev.holeCount, reducedMotion }); }
  catch { onDone(); return () => undefined; }
  const from = deck.getBoundingClientRect();
  const flyers: HTMLElement[] = [];
  const anims: Animation[] = [];
  let cancelled = false;
  for (const step of plan.steps) {
    const slot = root.querySelector<HTMLElement>(`[data-seat="${step.to}"] [data-slot="${step.slot}"]`) ?? root.querySelector<HTMLElement>(`[data-seat="${step.to}"]`);
    if (!slot) continue;
    const to = slot.getBoundingClientRect();
    if (reducedMotion) { slot.classList.add('dealt'); continue; }
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
    a.onfinish = () => { if (cancelled) return; slot.classList.add('dealt'); el.remove(); };
    anims.push(a);
  }
  const total = reducedMotion ? 0 : plan.durationMs + 20;
  const t = setTimeout(() => { if (!cancelled) finish(); }, total);
  function finish() { for (const el of flyers) el.remove(); onDone(); }
  return () => { cancelled = true; clearTimeout(t); for (const a of anims) a.cancel(); for (const el of flyers) el.remove(); };
}

export function reducedMotionPreferred(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches || localStorage.getItem('allin.reducedMotion') === '1'; } catch { return false; }
}
export type { Card };
