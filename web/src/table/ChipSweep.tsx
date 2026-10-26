import { useLayoutEffect, useRef } from 'react';
import { reducedMotionPreferred } from './animator';

/** Decorative collection, aimed at the displayed pot rather than the table centre. */
export function ChipSweep({ from }: { from: { left: number; top: number } }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const chip = ref.current;
    const surface = chip?.parentElement;
    if (!chip || !surface) return;
    if (reducedMotionPreferred()) { chip.style.display = 'none'; return; }
    const area = surface.getBoundingClientRect();
    const pot = surface.querySelector('.pot')?.getBoundingClientRect();
    const dx = (pot ? pot.left + pot.width / 2 - area.left : area.width / 2) - area.width * from.left / 100;
    const dy = (pot ? pot.top + pot.height / 2 - area.top : area.height / 2) - area.height * from.top / 100;
    const animation = chip.animate([
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.75)`, opacity: 0 },
    ], { duration: 520, easing: 'cubic-bezier(.4,.08,.2,1)', fill: 'forwards' });
    return () => animation.cancel();
  }, [from.left, from.top]);
  return <span ref={ref} className="chip-sweep" aria-hidden="true" style={{ left: from.left + '%', top: from.top + '%' }} />;
}
