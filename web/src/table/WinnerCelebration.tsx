/** Mounted once when an award becomes visible, including a delayed first delivery. */
export function WinnerCelebration() {
  return <span className="winner-sparks" aria-hidden="true">{Array.from({length: 18}, (_, i) =>
    <i key={i} style={{transform: `rotate(${i * 20}deg)`}}><span style={{animationDelay: `${(i % 3) * 100}ms`}} /></i>
  )}</span>;
}
