import { useEffect, useRef, type ReactNode } from 'react';
import { formatChips } from '@allin/engine/public';

export const fmt = (n: number | null | undefined): string => (n == null ? '—' : formatChips(n));

export function Page({ children, back, onBack, wide }: { children: ReactNode; back?: string; onBack?: () => void; wide?: boolean }) {
  return (
    <div className="page">
      <div className="page-inner" style={wide ? { maxWidth: 720 } : undefined}>
        <div className="topbar">
          <div className="wordmark">All In<b> ·</b></div>
          {back && <button className="btn btn-quiet" type="button" onClick={onBack}>{back}</button>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function Sheet({ title, onClose, children, turnCue, onReturn }: { title: string; onClose: () => void; children: ReactNode; turnCue?: string | null; onReturn?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('button, input, textarea, [tabindex]');
    first?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === 'Tab' && ref.current) {
        const f = Array.from(ref.current.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, [tabindex]:not([tabindex="-1"])'));
        if (!f.length) return;
        const a = f[0], b = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); }
        else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); prev?.focus?.(); };
  }, [onClose]);
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="sheet-head"><h2>{title}</h2><button type="button" className="sheet-close" aria-label="Close" onClick={onClose}>×</button></div>
        {turnCue && <div className="turn-cue"><span style={{ flex: 1 }}>{turnCue}</span>{onReturn && <button type="button" onClick={onReturn}>Back to the table</button>}</div>}
        <div className="sheet-body">{children}</div>
      </div>
    </>
  );
}

export function Field({ label, value, onChange, hint, error, inputMode = 'text', type = 'text', placeholder, autoComplete, maxLength, name }: { label: string; value: string; onChange: (v: string) => void; hint?: string; error?: string | null; inputMode?: 'text' | 'numeric'; type?: string; placeholder?: string; autoComplete?: string; maxLength?: number; name?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input className="input" name={name} type={type} inputMode={inputMode} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete={autoComplete} maxLength={maxLength} aria-invalid={error ? 'true' : undefined} />
      {error ? <span className="error" role="alert">{error}</span> : hint ? <span className="fine" style={{ fontWeight: 400 }}>{hint}</span> : null}
    </label>
  );
}

export function KV({ rows }: { rows: [string, ReactNode][] }) {
  return <div>{rows.map(([k, v]) => <div className="kv" key={k}><span>{k}</span><span>{v}</span></div>)}</div>;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <p className="lead" role="status">{label}…</p>;
}
