import { RULES, formatChips, type TableRules, type VariantId } from '@allin/engine/public';

export function variantLabel(v: VariantId | null): string { return v ? RULES.variants[v].label : "Dealer's choice"; }
export function variantShort(v: VariantId | null): string { return v ? `${RULES.variants[v].short}` : '—'; }
export function limitLabel(v: VariantId | null): string { return v ? (RULES.variants[v].limit === 'NL' ? 'No limit' : 'Pot limit') : ''; }
export function rulesSummary(r: TableRules): string[] {
  const out: string[] = [];
  if (r.mode === 'cash') {
    out.push(`Blinds ${r.sb} / ${r.bb}`);
    out.push(`Buy-in unit ${r.unit}`);
    if (r.ante) out.push(`Ante ${r.ante} per player`);
    if (r.straddle) out.push('UTG straddle allowed');
  } else {
    out.push(`Starting bank ${r.unit}`);
    out.push(r.orbitBlindStep === 5 ? `Blinds ${r.sb}/${r.bb} · +5 each orbit` : r.levels.length === 1 ? `Fixed blinds ${r.levels[0].sb} / ${r.levels[0].bb}` : `${r.levels.length} blind levels`);
    out.push('One entry · no rebuys');
  }
  out.push(`${r.seats} seats`);
  return out;
}
export function timeLeft(deadline: number | null | undefined, now: number): number { return deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0; }

export function rulesRows(r: TableRules): [string, string][] {
  if (r.mode === 'cash') {
    const rows: [string, string][] = [['Blinds', `${r.sb} / ${r.bb}`], ['Buy-in unit', formatChips(r.unit)], ['Seats', String(r.seats)]];
    if (r.ante) rows.push(['Ante', `${r.ante} per player`]);
    rows.push(['UTG straddle', r.straddle ? 'Optional, 2 × big blind' : 'Off']);
    rows.push(['Games', "Dealer's Choice · NL Hold'em, PL Omaha 4/5/6"]);
    return rows;
  }
  return [['Starting bank', formatChips(r.unit)], ['Seats', String(r.seats)], [r.orbitBlindStep === 5 ? 'Blinds · +5 each orbit' : r.levels.length === 1 ? 'Fixed blinds' : 'Levels', r.orbitBlindStep === 5 ? `${r.sb} / ${r.bb}` : r.levels.length === 1 ? `${r.levels[0].sb} / ${r.levels[0].bb}` : r.levels.map((L, i) => `${i + 1}: ${L.sb}/${L.bb}${L.ante ? ` a${L.ante}` : ''} · ${L.minutes} min`).join('\n')], ['Rebuys', 'Off'], ['Winner', 'Last player with chips'], ['Games', "Dealer's Choice · NL Hold'em, PL Omaha 4/5/6"]];
}
