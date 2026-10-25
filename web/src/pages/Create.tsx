import { useMemo, useState } from 'react';
import { Field, Page, KV, fmt } from '../components/ui.tsx';
import { useSession } from '../state/session.tsx';
import { parseChipAmount, variantAllowed } from '@allin/engine/public';
import { TransportError } from '../transport/index.ts';

type Level = { sb: string; bb: string; ante: string; minutes: string };
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
  const [levels, setLevels] = useState<Level[]>([{ sb: '5', bb: '10', ante: '', minutes: '15' }, { sb: '10', bb: '20', ante: '', minutes: '15' }, { sb: '20', bb: '40', ante: '', minutes: '15' }, { sb: '50', bb: '100', ante: '', minutes: '15' }]);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    const u = int(unit); if (u === null || u <= 0) e.unit = 'Whole number of chips';
    if (mode === 'cash') {
      const a = int(sb), b = int(bb);
      if (a === null || a <= 0) e.sb = 'Whole number'; if (b === null || b <= 0) e.bb = 'Whole number';
      if (a !== null && b !== null && a >= b) e.sb = 'Small blind must be below the big blind';
      if (u !== null && b !== null && u < b) e.unit = 'At least one big blind';
      const amount = int(buyAmount);
      if (amount === null || amount <= 0) e.buyAmount = 'Enter a whole number of chips';
      else if (u && amount % u !== 0) e.buyAmount = `Use a multiple of ${fmt(u)} chips`;
      if (ante !== '' && (int(ante) === null)) e.ante = 'Whole number or blank';
    } else {
      levels.forEach((L, i) => {
        const a = int(L.sb), b = int(L.bb), m = int(L.minutes);
        if (a === null || b === null || a <= 0 || a >= b) e['L' + i] = 'Small blind must be below the big blind';
        if (m === null || m <= 0) e['L' + i] = 'Minutes must be a whole number';
        if (L.ante !== '' && int(L.ante) === null) e['L' + i] = 'Ante must be a whole number or blank';
        if (i > 0 && b !== null && int(levels[i - 1].bb) !== null && b < int(levels[i - 1].bb)!) e['L' + i] = 'Blinds must not decrease';
      });
      if (!levels.length) e.levels = 'Add at least one level';
    }
    return e;
  }, [mode, sb, bb, unit, buyAmount, ante, levels]);

  const rules = { mode, name, seats: String(seats), sb, bb, ante, straddle, unit, levels };
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
    : [['Format', 'Tournament · freezeout'], ['Starting stack', unit], ['Seats', String(seats)], ['Levels', levels.map((L, i) => `${i + 1}: ${L.sb}/${L.bb}${L.ante && int(L.ante) ? ` a${L.ante}` : ''} · ${L.minutes} min`).join(' · ')], ['After the last level', 'Blinds hold'], ['Rebuys', 'Off']];

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
            <button type="button" aria-pressed={mode === 'tournament'} onClick={() => setMode('tournament')}>Tournament</button>
          </div>
          <Field label="Table name" value={name} onChange={setName} placeholder="Friday at ours" maxLength={40} />
          {mode === 'cash' ? (
            <>
              <div className="grid2">
                <Field label="Small blind" inputMode="numeric" value={sb} onChange={setSb} error={errors.sb} />
                <Field label="Big blind" inputMode="numeric" value={bb} onChange={setBb} error={errors.bb} />
              </div>
              <section className="buyin-section" aria-label="Your starting chips">
                <Field label="Your buy-in" inputMode="numeric" value={buyAmount} onChange={setBuyAmount} error={errors.buyAmount ?? errors.unit} hint="Chips you bring to this table." />
                <div className="buyin-options" role="group" aria-label="Quick buy-in">
                  {[1,2,3,5].map(n => <button key={n} type="button" className="chip" aria-pressed={buyIn === n * (int(unit) ?? 0)} onClick={() => setBuyAmount(String(n * (int(unit) ?? 1000)))}>{fmt(n * (int(unit) ?? 1000))}</button>)}
                </div>
              </section>
            </>
          ) : (
            <Field label="Starting stack" inputMode="numeric" value={unit} onChange={setUnit} error={errors.unit} hint="Everyone starts equal. No rebuys." />
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
          {mode === 'tournament' && (
            <div className="stack" style={{ gap: 8 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}><span style={{ fontSize: 14, fontWeight: 600 }}>Blind schedule</span><span className="fine">Editable</span></div>
              {levels.map((L, i) => (
                <div key={i} className="level-card stack" style={{ gap: 8 }}>
                  <div className="level-fields">
                    <span className="level-number">Level {i + 1}</span>
                    <label className="field"><span>Small blind</span><input className="input" inputMode="numeric" aria-label={`Level ${i + 1} small blind`} value={L.sb} onChange={(e) => setLevels(levels.map((x, j) => (j === i ? { ...x, sb: e.target.value } : x)))} style={{ height: 44, padding: '0 8px' }} /></label>
                    <label className="field"><span>Big blind</span><input className="input" inputMode="numeric" aria-label={`Level ${i + 1} big blind`} value={L.bb} onChange={(e) => setLevels(levels.map((x, j) => (j === i ? { ...x, bb: e.target.value } : x)))} style={{ height: 44, padding: '0 8px' }} /></label>
                    <label className="field"><span>Ante</span><input className="input" inputMode="numeric" aria-label={`Level ${i + 1} ante`} placeholder="ante" value={L.ante} onChange={(e) => setLevels(levels.map((x, j) => (j === i ? { ...x, ante: e.target.value } : x)))} style={{ height: 44, padding: '0 8px' }} /></label>
                    <label className="field"><span>Minutes</span><input className="input" inputMode="numeric" aria-label={`Level ${i + 1} minutes`} value={L.minutes} onChange={(e) => setLevels(levels.map((x, j) => (j === i ? { ...x, minutes: e.target.value } : x)))} style={{ height: 44, padding: '0 8px' }} /></label>
                    <button type="button" aria-label={`Remove level ${i + 1}`} className="chip" style={{ width: 44, padding: 0 }} onClick={() => setLevels(levels.filter((_, j) => j !== i))}>×</button>
                  </div>
                  {errors['L' + i] && <span className="error">{errors['L' + i]}</span>}
                </div>
              ))}

              <button type="button" className="btn btn-secondary" style={{ borderStyle: 'dashed' }} onClick={() => { const last = levels[levels.length - 1]; setLevels([...levels, last ? { sb: String((int(last.sb) ?? 5) * 2), bb: String((int(last.bb) ?? 10) * 2), ante: last.ante, minutes: last.minutes } : { sb: '5', bb: '10', ante: '', minutes: '15' }]); }}>Add a level</button>
              <p className="fine">After the last level the blinds hold. Rebuys are off. Hands run once.</p>
            </div>
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
