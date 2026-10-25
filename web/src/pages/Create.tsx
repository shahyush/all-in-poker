import { useMemo, useState } from 'react';
import { Field, Page, KV, fmt } from '../components/ui.tsx';
import { useSession } from '../state/session.tsx';
import { parseChipAmount, variantAllowed } from '@allin/engine/public';
import { TransportError } from '../transport/index.ts';

const int = (v: string) => parseChipAmount(v);

export function CreatePage({ go }: { go: (to: string) => void }) {
  const s = useSession();
  const [mode, setMode] = useState<'cash' | 'tournament'>('cash');
  const [name, setName] = useState('');
  const [sb, setSb] = useState('5'); const [bb, setBb] = useState('10');
  const [unit, setUnit] = useState('1000');
  const [buyAmount, setBuyAmount] = useState('3000');
  const [seats, setSeats] = useState(6);
  const [ante, setAnte] = useState(''); const [straddle, setStraddle] = useState(false);
  const [more, setMore] = useState(false);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    const u = int(unit); if (u === null || u <= 0) e.unit = 'Whole number of chips';
    const a = int(sb), b = int(bb);
    if (a === null || a <= 0) e.sb = 'Whole number';
    if (b === null || b <= 0) e.bb = 'Whole number';
    if (a !== null && b !== null && a >= b) e.sb = 'Small blind must be below the big blind';
    if (u !== null && b !== null && u < b) e.unit = 'At least one big blind';
    if (mode === 'cash') {
      const amount = int(buyAmount);
      if (amount === null || amount <= 0) e.buyAmount = 'Enter a whole number of chips';
      else if (u && amount % u !== 0) e.buyAmount = `Use a multiple of ${fmt(u)} chips`;
      if (ante !== '' && int(ante) === null) e.ante = 'Whole number or blank';
    }
    return e;
  }, [mode, sb, bb, unit, buyAmount, ante]);

  // Reuse the proven elimination engine. One level holds these blinds for the entire game.
  const levels = [{ sb, bb, ante: '', minutes: '15' }];
  const rules = { mode, name, seats: String(seats), sb, bb, ante: mode === 'cash' ? ante : '', straddle: mode === 'cash' && straddle, unit, levels };
  const buyIn = mode === 'cash' ? (int(buyAmount) ?? 0) : int(unit) ?? 0;

  async function create() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const r = await s.transport.cmd<{ tableId: string }>('create_table', { rules, buyIn: String(buyIn) });
      go('/table/' + r.tableId);
    } catch (err) { setError(err instanceof TransportError ? err.message : 'Could not create the table'); setBusy(false); }
  }
  const o6Note = !variantAllowed(seats, 'omaha6') ? (seats === 9 ? 'At nine players: Hold’em or Omaha 4.' : 'At eight players: Hold’em, Omaha 4 or Omaha 5.') : null;
  const summary: [string, string][] = mode === 'cash'
    ? [['Format', 'Cash · play chips'], ['Blinds', `${sb} / ${bb}`], ['Buy-in unit', unit], ['Your buy-in', `${fmt(buyIn)} chips`], ['Seats', String(seats)], ['Ante', ante && int(ante) ? `${ante} per player` : 'Off'], ['UTG straddle', straddle ? '2 × big blind, optional' : 'Off']]
    : [['Format', 'Last player standing'], ['Starting bank', `${fmt(buyIn)} chips each`], ['Blinds', `${sb} / ${bb} · fixed`], ['Seats', String(seats)], ['Rebuys', 'Off'], ['Winner', 'Last player with chips']];

  return (
    <Page back="Back" onBack={() => (review ? setReview(false) : go('/'))}>
      <div className="stack" style={{ gap: 8 }}>
        <div className="eyebrow">{review ? 'Ready to invite your friends' : 'Your game, your table'}</div>
        <h1>{review ? 'Looks right?' : 'Host a table'}</h1>
      </div>
      {!review ? (
        <div className="stack host-form">
          <div className="seg" role="group" aria-label="Format">
            <button type="button" aria-pressed={mode === 'cash'} onClick={() => setMode('cash')}>Cash · play chips</button>
            <button type="button" aria-pressed={mode === 'tournament'} onClick={() => setMode('tournament')}>Last player standing</button>
          </div>
          <Field label="Table name" value={name} onChange={setName} placeholder="Friday at ours" maxLength={40} />
              <div className="grid2">
                <Field label="Small blind" inputMode="numeric" value={sb} onChange={setSb} error={errors.sb} />
                <Field label="Big blind" inputMode="numeric" value={bb} onChange={setBb} error={errors.bb} />
              </div>
          {mode === 'cash' ? (
            <>
              <section className="buyin-section" aria-label="Your starting chips">
                <Field label="Your buy-in" inputMode="numeric" value={buyAmount} onChange={setBuyAmount} error={errors.buyAmount ?? errors.unit} hint="Chips you bring to this table." />
                <div className="buyin-options" role="group" aria-label="Quick buy-in">
                  {[1,2,3,5].map(n => <button key={n} type="button" className="chip" aria-pressed={buyIn === n * (int(unit) ?? 0)} onClick={() => setBuyAmount(String(n * (int(unit) ?? 1000)))}>{fmt(n * (int(unit) ?? 1000))}</button>)}
                </div>
              </section>
            </>
          ) : (
            <Field label="Starting bank" inputMode="numeric" value={unit} onChange={setUnit} error={errors.unit} hint="Same chips for everyone. One entry, no rebuys. Last player with chips wins." />
          )}
          <div className="stack" style={{ gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Seats</div>
            <div className="seat-options" role="group" aria-label="Number of seats">{[2, 3, 4, 5, 6, 7, 8, 9].map((n) => <button key={n} type="button" className="chip" aria-pressed={seats === n} onClick={() => setSeats(n)}>{n}</button>)}</div>
            {o6Note && <p className="fine">{o6Note}</p>}
          </div>
          {mode === 'cash' && (
            <>
              <button type="button" className="btn btn-quiet" aria-expanded={more} onClick={() => setMore(!more)} style={{ justifyContent: 'space-between', textDecoration: 'none', borderTop: '1px solid var(--line)', paddingTop: 8 }}><span>More table rules</span><span style={{ color: 'var(--muted)' }}>{more ? '−' : '+'}</span></button>
              {more && (
                <div className="stack rules-panel">
                  <Field label="Buy-in unit" inputMode="numeric" value={unit} onChange={setUnit} error={errors.unit} hint="Buy-ins and rebuys use multiples of this amount." />
                  <Field label="Ante per player (optional)" inputMode="numeric" value={ante} onChange={setAnte} error={errors.ante} hint="Paid by every dealt player before the blinds." />
                  <label className="toggle"><span>Allow a UTG straddle<br /><span className="fine" style={{ fontWeight: 400 }}>The seat after the big blind may post 2 × big blind before the deal.</span></span><input type="checkbox" checked={straddle} onChange={(e) => setStraddle(e.target.checked)} /></label>
                </div>
              )}
            </>
          )}
          <button type="button" className="btn btn-primary" disabled={Object.keys(errors).length > 0} onClick={() => { setReview(true); window.scrollTo({top:0,behavior:'instant'}); }}>Review the table</button>
        </div>
      ) : (
        <div className="stack">
          <KV rows={summary} />
          <p className="fine">One game for a full orbit. The next chooser picks when the round completes. Hold’em is the default; Omaha availability depends on the number of players.</p>
          {error && <div className="error" role="alert">{error}</div>}
          <div className="grid2" style={{ gridTemplateColumns: '1fr 2fr' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setReview(false)}>Edit</button>
            <button type="button" className="btn btn-primary" disabled={busy} aria-busy={busy} onClick={create}>{busy ? 'Creating your table…' : 'Create and open the room'}</button>
          </div>
        </div>
      )}
    </Page>
  );
}
