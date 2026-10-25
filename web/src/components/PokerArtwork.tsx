/** Lightweight vector artwork: no image request or animation on the home screen. */
export function PokerArtwork() {
  return <svg className="home-art" viewBox="0 0 420 190" aria-hidden="true" focusable="false">
    <defs><radialGradient id="home-felt"><stop stopColor="#315b9e"/><stop offset="1" stopColor="#102443"/></radialGradient></defs>
    <rect width="420" height="190" rx="24" fill="#0a1324"/>
    <ellipse cx="210" cy="172" rx="183" ry="125" fill="url(#home-felt)" stroke="#b99246" strokeWidth="2"/>
    <ellipse cx="210" cy="172" rx="174" ry="117" fill="none" stroke="#6686b4" strokeOpacity=".35"/>
    <g transform="translate(153 24) rotate(-14 40 66)"><rect width="80" height="116" rx="7" fill="#fffaf0"/><text x="10" y="29" fontSize="25" fontFamily="Georgia" fill="#17203a">A</text><text x="10" y="51" fontSize="23" fill="#17203a">♠</text><text x="23" y="94" fontSize="51" fill="#17203a">♠</text></g>
    <g transform="translate(213 28) rotate(12 40 66)"><rect width="80" height="116" rx="7" fill="#fffaf0"/><text x="10" y="29" fontSize="25" fontFamily="Georgia" fill="#a4263d">K</text><text x="10" y="51" fontSize="23" fill="#a4263d">♥</text><text x="22" y="94" fontSize="50" fill="#a4263d">♥</text></g>
    {[0,1,2].map(i=><g key={i} transform={`translate(${94+i*7} ${143-i*8})`}><ellipse rx="29" ry="12" fill="#d1a84e" stroke="#f6df9c" strokeWidth="2"/><ellipse rx="20" ry="7" fill="none" stroke="#6a4e1e" strokeWidth="2" strokeDasharray="6 4"/></g>)}
    <circle cx="316" cy="145" r="19" fill="#fffaf0" stroke="#b99246" strokeWidth="3"/><text x="316" y="152" textAnchor="middle" fontFamily="Georgia" fontSize="21" fill="#17203a">D</text>
  </svg>;
}
