import { cardLabel, rankOf, suitOf, RANKS, SUIT_SYMBOL, SUITS, type Card } from '@allin/engine/public';

export function PlayingCard({ card, size, win, dim, flip, hi, delayMs, as = 'span', onClick, label, tag, ariaPressed }: { card: Card | null; size?: 'sm' | 'lg'; win?: boolean; dim?: boolean; flip?: boolean; hi?: boolean; delayMs?: number; as?: 'span' | 'button'; onClick?: () => void; label?: string; tag?: string; ariaPressed?: boolean }) {
  if (card === null) {
    const C = as;
    return <C className={`pc back ${size ?? ''}`} aria-label={label ?? 'Face-down card'} role={as === 'span' ? 'img' : undefined} onClick={onClick} aria-pressed={ariaPressed}>{tag && <span className="tag">{tag}</span>}</C>;
  }
  const r = RANKS[rankOf(card)], su = SUITS[suitOf(card)];
  const red = su === 'h' || su === 'd';
  const cls = `pc ${red ? 'red' : ''} ${size ?? ''} ${win ? 'win' : ''} ${dim ? 'dim' : ''} ${hi ? 'contrib' : ''} ${flip ? 'flip motion' : ''}`;
  const style = flip && delayMs ? { animationDelay: delayMs + 'ms' } : undefined;
  const inner = <><span className="r">{r === 'T' ? '10' : r}</span><span className="s" aria-hidden="true">{SUIT_SYMBOL[su]}</span>{tag && <span className="tag">{tag}</span>}</>;
  if (as === 'button') return <button type="button" className={cls} style={style} aria-label={label ?? cardLabel(card)} onClick={onClick} aria-pressed={ariaPressed}>{inner}</button>;
  return <span className={cls} style={style} role="img" aria-label={label ?? cardLabel(card)}>{inner}</span>;
}
export function SlotCard() { return <span className="pc slot" aria-hidden="true" />; }
