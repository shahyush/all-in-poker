import { useLayoutEffect, useRef, useState } from 'react';

/** One moving token, anchored to space reserved in the dealer's name row. */
export function DealerButton({ seat }: { seat: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [point, setPoint] = useState<{left: number; top: number} | null>(null);
  useLayoutEffect(() => {
    const surface = ref.current?.parentElement;
    if (!surface) return;
    const row = surface.querySelector(`[data-seat="${seat}"] .seat-name`);
    const place = () => {
      const bounds = surface.getBoundingClientRect();
      const r = row?.getBoundingClientRect();
      const next = r ? {left: r.left - bounds.left + 9, top: r.top - bounds.top + r.height / 2}
        : {left: bounds.width / 2, top: bounds.height * .94};
      setPoint(old => old?.left === next.left && old.top === next.top ? old : next);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(surface);
    if (row) observer.observe(row.parentElement!);
    return () => observer.disconnect();
  }, [seat]);
  return <span ref={ref} className="dealer-token motion" aria-label="Dealer button" style={{...point, visibility: point ? 'visible' : 'hidden'}}>D</span>;
}
