import { assertUniqueCards, type Card } from './cards.ts';
import type { VariantId } from './evaluator.ts';
import { awardPots, buildPots, uncalledExcess } from './pots.ts';
import { secureHex, secureInt, shuffledDeck, type Rng } from './random.ts';
import { RULES, VARIANT_IDS, variantAllowed } from './rules.ts';
import { isChipInt, MAX_CHIPS } from './amounts.ts';
import {
  EngineError, fail,
  type DistributiveOmit, type Effect, type HandPlayer, type HandState, type Level, type PublicEvent, type SeatState,
  type Street, type TableRules, type TableState, type Vote,
} from './types.ts';

export interface TickContext {
  presence: Record<string, number>;                 // playerId -> last server heartbeat (ms)
  credits?: { playerId: string; amount: number; id?: string }[]; // approved reloads to apply at the next boundary
  rng?: Rng;                                        // tests only
}

const T = RULES.timers;
const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river'];
const live = (p: HandPlayer) => !p.folded;
const active = (p: HandPlayer) => !p.folded && !p.allIn;

// ---------- helpers ----------
function nextSeat(t: TableState, from: number, pred: (s: SeatState, i: number) => boolean): number | null {
  const n = t.seats.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    const s = t.seats[i];
    if (s && pred(s, i)) return i;
  }
  return null;
}
function nextPlayer(t: TableState, h: HandState, from: number, pred: (p: HandPlayer) => boolean): number | null {
  const n = t.seats.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    const p = h.players.find((x) => x.seat === i);
    if (p && pred(p)) return i;
  }
  return null;
}
/** true when seat x lies strictly inside the clockwise open interval (a, b) */
function between(a: number, x: number, b: number, n: number): boolean {
  const dx = (x - a + n) % n, db = ((b - a + n) % n) || n;
  return dx > 0 && dx < db;
}
function hp(h: HandState, seat: number): HandPlayer {
  const p = h.players.find((x) => x.seat === seat);
  if (!p) fail('not_in_hand', 'Not in this hand');
  return p!;
}
function event(t: TableState, h: HandState | null, at: number, e: DistributiveOmit<PublicEvent, 'seq' | 'handId' | 'at'>): void {
  t.seq += 1;
  t.events.push({ seq: t.seq, handId: h ? h.id : null, at, ...(e as object) } as PublicEvent);
  if (t.events.length > 60) t.events.splice(0, t.events.length - 60);
  t.lastActivityAt = at;
}
function pay(h: HandState, p: HandPlayer, seat: SeatState, amount: number, asBet: boolean): number {
  const a = Math.min(amount, seat.stack);
  seat.stack -= a;
  p.paid += a;
  if (asBet) p.bet += a; else h.pot += a;
  if (seat.stack === 0) p.allIn = true;
  return a;
}
function totalChips(t: TableState): number {
  let sum = 0;
  for (const s of t.seats) if (s) sum += s.stack;
  if (t.hand) { sum += t.hand.pot; for (const p of t.hand.players) sum += p.bet; }
  return sum;
}
function currentLevel(t: TableState, now: number): number {
  const tr = t.tournament; if (!tr) return 0;
  const levels = t.rules.levels;
  const elapsed = Math.max(0, now - tr.startedAt);
  let acc = 0;
  for (let i = 0; i < levels.length; i++) {
    acc += levels[i].minutes * 60_000;
    if (elapsed < acc) return i;
  }
  return levels.length - 1;
}
function blindsFor(t: TableState, now: number): { sb: number; bb: number; ante: number; level: number | null } {
  if (t.rules.mode === 'tournament') {
    const li = currentLevel(t, now);
    const L: Level = t.rules.levels[li];
    return { sb: L.sb, bb: L.bb, ante: L.ante, level: li };
  }
  return { sb: t.rules.sb, bb: t.rules.bb, ante: t.rules.ante, level: null };
}
export function dealDurationMs(playerCount: number, holeCount: number): number {
  const total = playerCount * holeCount;
  const travel = 180;
  const gap = total > 1 ? Math.min(55, Math.floor((T.dealPresentationMaxMs - travel) / (total - 1))) : 0;
  return (total - 1) * gap + travel;
}

// ---------- validation ----------
export function validateRules(r: TableRules): TableRules {
  const bad = (m: string) => fail('invalid_rules', m);
  if (r.mode !== 'cash' && r.mode !== 'tournament') bad('Choose cash or tournament');
  const name = String(r.name ?? '').trim().slice(0, 40) || 'Friday table';
  if (!Number.isInteger(r.seats) || r.seats < RULES.seats.min || r.seats > RULES.seats.max) bad('Seats must be 2 to 9');
  if (!isChipInt(r.unit) || r.unit <= 0) bad('Buy-in must be a whole number of chips');
  let levels: Level[] = [];
  if (r.mode === 'cash') {
    if (!isChipInt(r.sb) || !isChipInt(r.bb) || r.sb <= 0 || r.bb <= r.sb) bad('Small blind must be below the big blind');
    if (!isChipInt(r.ante) || r.ante < 0) bad('Ante must be a whole number');
    if (r.unit < r.bb) bad('Buy-in must be at least one big blind');
  } else {
    if (!Array.isArray(r.levels) || r.levels.length < 1) bad('Add at least one blind level');
    let prevBB = 0;
    levels = r.levels.map((L, i) => {
      if (!isChipInt(L.sb) || !isChipInt(L.bb) || L.sb <= 0 || L.bb <= L.sb) bad(`Level ${i + 1}: small blind must be below the big blind`);
      if (!isChipInt(L.ante) || L.ante < 0) bad(`Level ${i + 1}: ante must be a whole number`);
      if (!Number.isInteger(L.minutes) || L.minutes <= 0 || L.minutes > 600) bad(`Level ${i + 1}: minutes must be 1 to 600`);
      if (L.bb < prevBB) bad(`Level ${i + 1}: blinds must not decrease`);
      prevBB = L.bb;
      return { sb: L.sb, bb: L.bb, ante: L.ante, minutes: L.minutes };
    });
    if (r.unit < levels[0].bb) bad('Starting stack must be at least one big blind');
  }
  return {
    mode: r.mode, name, seats: r.seats,
    sb: r.mode === 'cash' ? r.sb : levels[0].sb, bb: r.mode === 'cash' ? r.bb : levels[0].bb,
    ante: r.mode === 'cash' ? r.ante : 0, straddle: r.mode === 'cash' && !!r.straddle, unit: r.unit, levels,
  };
}

// ---------- table lifecycle ----------
export function createTable(id: string, rules: TableRules, hostPlayerId: string, now: number): TableState {
  const r = validateRules(rules);
  return {
    id, rules: r, status: 'waiting', version: 0, seq: 0,
    seats: Array(r.seats).fill(null), button: null, prevBB: null, prevSB: null, handNo: 0, hand: null,
    hostPlayerId, hostEpoch: 1, createdAt: now, startedAt: null, nextSeq: 0,
    tournament: null, waitingReason: 'Waiting for players', dueAt: null, events: [], error: null, lastActivityAt: now,
  };
}

export function seatOf(t: TableState, playerId: string): number {
  return t.seats.findIndex((s) => s && s.playerId === playerId);
}

export function seatPlayer(t: TableState, player: { playerId: string; name: string }, stack: number, now: number, preferred?: number | null): number {
  if (t.status !== 'waiting' && t.status !== 'running') fail('closed', 'This table has closed');
  if (t.rules.mode === 'tournament' && t.status !== 'waiting') fail('locked', 'Registration closed when the tournament started');
  if (seatOf(t, player.playerId) !== -1) fail('already_seated', 'Already seated here');
  if (!isChipInt(stack) || stack <= 0) fail('invalid_amount', 'Invalid buy-in');
  if (t.rules.mode === 'tournament' && stack !== t.rules.unit) fail('invalid_amount', 'Tournament stacks are fixed');
  if (t.rules.mode === 'cash' && stack % t.rules.unit !== 0) fail('invalid_amount', 'Buy-in must be a multiple of the table unit');
  if (totalChips(t) + stack > MAX_CHIPS) fail('invalid_amount', 'Table chip limit reached');
  let seat = -1;
  if (preferred != null && Number.isInteger(preferred) && preferred >= 0 && preferred < t.seats.length && !t.seats[preferred]) seat = preferred;
  else seat = t.seats.findIndex((s) => !s);
  if (seat === -1) fail('full', 'The table is full');
  const inProgress = t.status === 'running';
  t.seats[seat] = {
    playerId: player.playerId, name: player.name, stack, status: 'in',
    owesBB: inProgress && t.rules.mode === 'cash', owesSB: false, postToPlay: false,
    sitOutRequested: false, returnRequested: false, leaving: false, leaveReason: null, consecutiveTimeouts: 0,
    joinedAt: now, joinSeq: t.nextSeq++, straddlePref: false, handStartStack: null, eliminatedPlace: null,
  };
  event(t, null, now, { type: 'seat', seat, change: 'join' });
  return seat;
}

export function renamePlayer(t: TableState, playerId: string, name: string): void {
  const s = t.seats[seatOf(t, playerId)];
  if (s) s.name = name;
}

export function eligibleToStart(t: TableState): { ok: boolean; reason: string } {
  const funded = t.seats.filter((s) => s && s.stack > 0 && !s.leaving).length;
  if (funded < 2) return { ok: false, reason: 'Waiting for one more player' };
  return { ok: true, reason: '' };
}

export function startTable(t: TableState, now: number, ctx: TickContext): Effect[] {
  if (t.status !== 'waiting') fail('already_started', 'The game has already started');
  const e = eligibleToStart(t);
  if (!e.ok) fail('not_enough_players', e.reason);
  t.status = 'running';
  t.startedAt = now;
  if (t.rules.mode === 'tournament') {
    t.tournament = {
      startedAt: now, level: 0, eliminations: [], finishedAt: null, winnerPlayerId: null,
      entrants: t.seats.filter((s): s is SeatState => !!s).map((s) => ({ playerId: s.playerId, name: s.name })),
    };
  }
  event(t, null, now, { type: 'status', status: 'running' });
  const effects: Effect[] = [];
  startNextHand(t, now, ctx, effects);
  computeDue(t);
  return effects;
}

// ---------- boundary & new hand ----------
function tournamentEliminations(t: TableState, now: number, effects: Effect[]): void {
  const tr = t.tournament!;
  const alive = t.seats.filter((s): s is SeatState => !!s && s.eliminatedPlace === null);
  const busted = alive.filter((s) => s.stack === 0);
  if (busted.length === 0) return;
  const n = alive.length;
  const sorted = busted.slice().sort((a, b) => (b.handStartStack ?? 0) - (a.handStartStack ?? 0));
  // competition ranking: places n-k+1 .. n; larger hand-start stack places higher; equal stacks share a place
  let place = n - busted.length + 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && (sorted[i].handStartStack ?? 0) < (sorted[i - 1].handStartStack ?? 0)) place = n - busted.length + 1 + i;
    sorted[i].eliminatedPlace = place;
    tr.eliminations.push({ playerId: sorted[i].playerId, name: sorted[i].name, place, handNo: t.handNo });
    effects.push({ type: 'eliminated', playerId: sorted[i].playerId, place, handNo: t.handNo });
    event(t, null, now, { type: 'seat', seat: t.seats.indexOf(sorted[i]), change: 'eliminated' });
  }
  const remaining = alive.filter((s) => s.stack > 0);
  if (remaining.length === 1) {
    remaining[0].eliminatedPlace = 1;
    tr.eliminations.push({ playerId: remaining[0].playerId, name: remaining[0].name, place: 1, handNo: t.handNo });
    tr.finishedAt = now; tr.winnerPlayerId = remaining[0].playerId;
    t.status = 'finished'; t.hand = null; t.waitingReason = null;
    event(t, null, now, { type: 'status', status: 'finished' });
    effects.push({ type: 'tournament_finished', winnerPlayerId: remaining[0].playerId, abandoned: false });
    effects.push({ type: 'archive', reason: 'finished' });
  }
}

function applyBoundary(t: TableState, now: number, ctx: TickContext, effects: Effect[]): void {
  const cash = t.rules.mode === 'cash';
  // credits approved during the hand
  for (const c of ctx.credits ?? []) {
    const i = seatOf(t, c.playerId);
    if (i === -1 || !isChipInt(c.amount) || c.amount <= 0) continue;
    const s = t.seats[i]!;
    if (s.leaving) continue;
    s.stack += c.amount;
    effects.push({ type: 'credit_applied', playerId: c.playerId, amount: c.amount, handNo: t.handNo, id: c.id ?? null });
  }
  for (let i = 0; i < t.seats.length; i++) {
    const s = t.seats[i]; if (!s) continue;
    if (cash) {
      if (s.leaving) {
        effects.push({ type: 'exit', playerId: s.playerId, amount: s.stack, handNo: t.handNo, reason: s.leaveReason ?? 'leave' });
        t.seats[i] = null;
        event(t, null, now, { type: 'seat', seat: i, change: 'leave' });
        continue;
      }
      if (s.consecutiveTimeouts >= RULES.cash.consecutiveTimeoutsToSitOut && s.status === 'in') {
        s.status = 'sitout'; s.consecutiveTimeouts = 0; s.sitOutRequested = false;
        event(t, null, now, { type: 'seat', seat: i, change: 'sitout' });
      }
      if (s.sitOutRequested && s.status === 'in') { s.status = 'sitout'; s.sitOutRequested = false; event(t, null, now, { type: 'seat', seat: i, change: 'sitout' }); }
      if (s.returnRequested) { s.returnRequested = false; if (s.status === 'sitout') { s.status = 'in'; event(t, null, now, { type: 'seat', seat: i, change: 'return' }); } }
    }
  }
  if (!cash && t.tournament) {
    tournamentEliminations(t, now, effects);
    if (t.status === 'finished') return;
    const li = currentLevel(t, now);
    if (li !== t.tournament.level) { t.tournament.level = li; event(t, null, now, { type: 'level', level: li }); }
  }
  if (t.seats.every((s) => !s)) {
    t.status = 'closed'; t.hand = null;
    event(t, null, now, { type: 'status', status: 'closed' });
    effects.push({ type: 'archive', reason: 'all_left' });
  }
}

function anyonePresent(t: TableState, ctx: TickContext, now: number, withinMs: number): boolean {
  for (const s of t.seats) if (s && (ctx.presence[s.playerId] ?? 0) >= now - withinMs) return true;
  return false;
}

function startNextHand(t: TableState, now: number, ctx: TickContext, effects: Effect[]): void {
  if (t.status !== 'running') return;
  t.hand = null;
  const cash = t.rules.mode === 'cash';
  if (!anyonePresent(t, ctx, now, T.nobodyPresentHoldMs)) { t.waitingReason = 'Waiting for someone to return'; return; }
  const n = t.seats.length;
  const cand = (s: SeatState | null): s is SeatState => !!s && s.stack > 0 && !s.leaving && s.eliminatedPlace === null && s.status === 'in';
  const candidates = t.seats.map((s, i) => (cand(s) ? i : -1)).filter((i) => i >= 0);
  let base = cash ? candidates.filter((i) => !t.seats[i]!.owesBB) : candidates;
  if (cash && base.length < 2 && candidates.length >= 2) {
    // not enough players without obligations: everyone plays, obligations are forgiven to avoid a stall
    for (const i of candidates) { t.seats[i]!.owesBB = false; t.seats[i]!.owesSB = false; }
    base = candidates;
  }
  if (base.length < 2) { t.waitingReason = 'Waiting for players'; return; }
  const rng = ctx.rng ?? secureInt;

  let button: number, sbSeat: number | null, bbSeat: number | null;
  let dealt: number[];
  let sbPos: number | null = null;
  if (cash) {
    const inBase = (_: SeatState, i: number) => base.includes(i);
    if (t.button === null) button = base[rng(base.length)];
    else if (base.length === 2 && t.prevBB !== null && base.includes(t.prevBB)) button = t.prevBB;
    else button = nextSeat(t, t.button, inBase)!;
    const owing = candidates.filter((i) => !base.includes(i));
    if (base.length === 2 && owing.length === 0) { sbSeat = button; bbSeat = nextSeat(t, button, inBase)!; dealt = [button, bbSeat]; }
    else {
      sbSeat = nextSeat(t, button, inBase)!;
      bbSeat = nextSeat(t, sbSeat, (_, i) => candidates.includes(i))!;
      dealt = base.slice();
      if (!dealt.includes(bbSeat)) { dealt.push(bbSeat); t.seats[bbSeat]!.owesBB = false; t.seats[bbSeat]!.owesSB = false; }
      if (dealt.length === 2) { // base pair where the natural BB became the second player: heads-up positions
        sbSeat = button;
      }
      for (const i of owing) {
        const s = t.seats[i]!;
        if (dealt.includes(i)) continue;
        if (s.postToPlay && between(bbSeat, i, button, n)) dealt.push(i);
      }
    }
    // mark missed blinds for seated players skipped by the blinds this hand
    for (let i = 0; i < n; i++) {
      const s = t.seats[i]; if (!s || dealt.includes(i)) continue;
      if (t.button !== null && (between(t.button, i, bbSeat, n) || i === bbSeat)) {
        s.owesBB = true;
        if (sbSeat !== null && (between(t.button, i, sbSeat, n) || i === sbSeat)) s.owesSB = true;
      }
    }
  } else {
    const inCand = (_: SeatState, i: number) => candidates.includes(i);
    const len = candidates.length;
    if (t.prevBB === null) {
      button = candidates[rng(len)];
      if (len === 2) { sbSeat = button; bbSeat = nextSeat(t, button, inCand)!; }
      else { sbSeat = nextSeat(t, button, inCand)!; bbSeat = nextSeat(t, sbSeat, inCand)!; }
      sbPos = sbSeat;
    } else if (len === 2) {
      bbSeat = nextSeat(t, t.prevBB, inCand)!; button = nextSeat(t, bbSeat, inCand)!; sbSeat = button; sbPos = button;
    } else {
      // dead button: the big blind always advances; small blind and button take the previous positions even if empty
      bbSeat = nextSeat(t, t.prevBB, inCand)!;
      sbPos = t.prevBB;
      sbSeat = candidates.includes(sbPos) && sbPos !== bbSeat ? sbPos : null;
      button = t.prevSB ?? sbPos;
      if (button === bbSeat) button = sbPos;
    }
    dealt = candidates.slice();
  }
  dealt.sort((a, b) => a - b);

  const { sb, bb, ante, level } = blindsFor(t, now);
  const chooser = dealt.includes(button) ? button : nextSeat(t, button, (_, i) => dealt.includes(i))!;
  t.handNo += 1;
  const players: HandPlayer[] = dealt.map((seat) => ({
    seat, playerId: t.seats[seat]!.playerId, holeCount: 0, folded: false, allIn: false, left: false,
    bet: 0, paid: 0, acted: false, lastFaced: 0, stackStart: t.seats[seat]!.stack, revealed: [], shown: false,
  }));
  for (const s of t.seats) if (s) s.handStartStack = s.stack;
  const h: HandState = {
    id: `${t.handNo}-${secureHex(6)}`, handNo: t.handNo, variant: null, phase: 'choice', street: 'preflop',
    button, sbSeat, bbSeat, straddleSeat: null, chooserSeat: chooser, sb, bb, ante, level,
    players, pot: 0, board: [], boards: null, currentBet: 0, lastFullRaise: bb, actor: null, deadline: null, actionReadyAt: null,
    choiceDeadline: now + T.choiceMs, straddleOffer: null, vote: null, proposedStreets: [], bettingLocked: false, runs: 1,
    runoutQueue: [], result: null, revealDeadline: null, nextAt: null, startedAt: now, deck: [], cursor: 0, hole: {}, log: [],
  };
  if (cash && t.rules.straddle && dealt.length >= 3 && bbSeat !== null) {
    const utg = nextPlayer(t, h, bbSeat, () => true)!;
    const s = t.seats[utg]!;
    if (s.stack - Math.min(ante, s.stack) >= 2 * bb) h.straddleOffer = { seat: utg, decided: s.straddlePref, accepted: s.straddlePref };
  }
  t.button = button; t.prevBB = bbSeat; t.prevSB = sbSeat ?? sbPos ?? sbSeat; t.hand = h; t.waitingReason = null;
}

// ---------- dealer's choice & straddle ----------
export function choiceOptions(t: TableState): { variant: VariantId; allowed: boolean }[] {
  const n = t.hand ? t.hand.players.length : 0;
  return VARIANT_IDS.map((v) => ({ variant: v, allowed: variantAllowed(n, v) }));
}

export function chooseVariant(t: TableState, seat: number, variant: VariantId, now: number, ctx: TickContext): Effect[] {
  const effects = tick(t, now, ctx);
  const h = t.hand;
  if (!h || h.phase !== 'choice') fail('not_choice', 'The game has already been chosen');
  if (h.chooserSeat !== seat) fail('not_chooser', 'Not your deal');
  if (!VARIANT_IDS.includes(variant)) fail('bad_variant', 'Unknown game');
  if (!variantAllowed(h.players.length, variant)) fail('capacity', 'Not enough cards for that game with this many players');
  dealHand(t, h, variant, now, ctx, false);
  computeDue(t);
  return effects;
}

export function respondStraddle(t: TableState, seat: number, accept: boolean, now: number, ctx: TickContext): Effect[] {
  const effects = tick(t, now, ctx);
  const h = t.hand;
  if (!h || h.phase !== 'choice' || !h.straddleOffer || h.straddleOffer.seat !== seat) fail('no_offer', 'No straddle offer open');
  if (h.straddleOffer.decided) fail('decided', 'Already decided');
  h.straddleOffer.decided = true; h.straddleOffer.accepted = accept;
  computeDue(t);
  return effects;
}

function dealHand(t: TableState, h: HandState, variant: VariantId, now: number, ctx: TickContext, timeout: boolean): void {
  const n = h.players.length;
  const V = RULES.variants[variant];
  if (!variantAllowed(n, variant)) fail('capacity', 'Not enough cards');
  const deck = shuffledDeck(ctx.rng ?? secureInt);
  assertUniqueCards(deck);
  h.variant = variant; h.deck = deck; h.cursor = 0;
  const order: number[] = [];
  let s = h.button;
  for (let k = 0; k < n; k++) { s = nextPlayer(t, h, s, () => true)!; order.push(s); }
  for (const seat of order) h.hole[seat] = [];
  for (let r = 0; r < V.holeCards; r++) for (const seat of order) h.hole[seat].push(deck[h.cursor++]);
  for (const p of h.players) p.holeCount = V.holeCards;
  event(t, h, now, { type: 'choice', variant, seat: h.chooserSeat, timeout });
  // antes
  let nominal = 0, actual = 0;
  if (h.ante > 0) for (const p of h.players) { const a = pay(h, p, t.seats[p.seat]!, h.ante, false); h.log.push({ t: 'post', seat: p.seat, amount: a, kind: 'ante' }); }
  // dead posts for entering players who owed a small blind
  for (const p of h.players) {
    const st = t.seats[p.seat]!;
    if (st.owesBB && p.seat !== h.bbSeat) {
      // posting player: live BB + dead SB if owed
      if (st.owesSB) { const d = pay(h, p, st, h.sb, false); h.log.push({ t: 'post', seat: p.seat, amount: d, kind: 'dead' }); }
      const b = pay(h, p, st, h.bb, true); h.log.push({ t: 'post', seat: p.seat, amount: b, kind: 'bb' });
      st.owesBB = false; st.owesSB = false; st.postToPlay = false;
    }
  }
  if (h.sbSeat !== null && h.players.some((p) => p.seat === h.sbSeat)) {
    const p = hp(h, h.sbSeat); const a = pay(h, p, t.seats[p.seat]!, h.sb, true); nominal += h.sb; actual += a;
    h.log.push({ t: 'post', seat: p.seat, amount: a, kind: 'sb' });
  }
  if (h.bbSeat !== null) {
    const p = hp(h, h.bbSeat); const a = pay(h, p, t.seats[p.seat]!, h.bb, true); nominal += h.bb; actual += a;
    h.log.push({ t: 'post', seat: p.seat, amount: a, kind: 'bb' });
    t.seats[p.seat]!.owesBB = false; t.seats[p.seat]!.owesSB = false;
  }
  h.currentBet = h.bb; h.lastFullRaise = h.bb;
  let anchor = h.bbSeat ?? h.button;
  if (h.straddleOffer && h.straddleOffer.decided && h.straddleOffer.accepted) {
    const p = hp(h, h.straddleOffer.seat); const st = t.seats[p.seat]!;
    if (!p.allIn && st.stack >= 2 * h.bb && h.players.length >= 3) {
      const a = pay(h, p, st, 2 * h.bb, true); nominal += 2 * h.bb; actual += a;
      h.straddleSeat = p.seat; h.currentBet = 2 * h.bb; h.lastFullRaise = 2 * h.bb; anchor = p.seat;
      h.log.push({ t: 'post', seat: p.seat, amount: a, kind: 'straddle' });
    }
  }
  h.straddleOffer = null;
  (h as HandState & { shortfall: number }).shortfall = nominal - actual;
  const dur = dealDurationMs(n, V.holeCards);
  event(t, h, now, { type: 'deal', order, holeCount: V.holeCards, button: h.button, variant, durationMs: dur });
  h.phase = 'betting'; h.street = 'preflop'; h.choiceDeadline = null;
  h.actionReadyAt = now + dur;
  const first = nextPlayer(t, h, anchor, active);
  h.actor = first;
  h.deadline = first === null ? null : h.actionReadyAt + T.bettingMs;
  if (first === null || !bettingPossible(h)) { h.actor = null; h.deadline = null; closeStreet(t, h, now); }
}

function bettingPossible(h: HandState): boolean {
  const act = h.players.filter(active);
  if (act.length === 0) return false;
  if (act.length === 1) return act[0].bet < h.currentBet; // the lone active player still owes a call
  return true;
}

// ---------- betting ----------
export interface LegalActions {
  canAct: boolean;
  reason?: string;
  fold: boolean;
  check: boolean;
  call: number;        // additional chips actually payable
  owed: number;        // nominal amount owed
  raise: { minTo: number; maxTo: number; isBet: boolean } | null;
  raiseClosed: string | null;
  allInTo: number | null;
  stack: number;
  bet: number;
  pot: number;
  deadline: number | null;
  actionReadyAt: number | null;
}

export function potTotal(h: HandState): number {
  return h.pot + h.players.reduce((a, p) => a + p.bet, 0);
}

export function legalActions(t: TableState, seat: number, now: number): LegalActions {
  const none = (reason: string): LegalActions => ({ canAct: false, reason, fold: false, check: false, call: 0, owed: 0, raise: null, raiseClosed: null, allInTo: null, stack: 0, bet: 0, pot: 0, deadline: null, actionReadyAt: null });
  const h = t.hand;
  if (!h || h.phase !== 'betting') return none('Not a betting moment');
  if (h.actor !== seat) return none('Not your turn');
  const p = hp(h, seat); const st = t.seats[seat]!;
  if (!active(p)) return none('Not active');
  const owed = Math.max(0, h.currentBet - p.bet);
  const call = Math.min(owed, st.stack);
  const allIn = p.bet + st.stack;
  const rights = !p.acted || h.currentBet - p.lastFaced >= h.lastFullRaise;
  const opp = h.players.filter((q) => q.seat !== seat && active(q)).map((q) => q.bet + t.seats[q.seat]!.stack);
  const maxOpp = opp.length ? Math.max(...opp) : 0;
  let maxTo = Math.min(allIn, maxOpp);
  const V = RULES.variants[h.variant!];
  if (V.limit === 'PL') {
    const P = potTotal(h) + (h.street === 'preflop' ? ((h as HandState & { shortfall?: number }).shortfall ?? 0) : 0);
    const cap = p.bet + owed + P + owed; // S + 2C + P
    maxTo = Math.min(maxTo, cap);
  }
  let minTo = h.currentBet === 0 ? h.bb : h.currentBet + h.lastFullRaise;
  let raiseClosed: string | null = null;
  if (maxOpp <= h.currentBet) raiseClosed = 'Nobody can call more';
  else if (!rights) raiseClosed = 'Raising is closed for you';
  else if (maxTo <= h.currentBet) raiseClosed = 'Call only';
  const canRaise = raiseClosed === null;
  if (minTo > maxTo) minTo = maxTo;
  return {
    canAct: true, fold: true, check: owed === 0, call, owed,
    raise: canRaise ? { minTo, maxTo, isBet: h.currentBet === 0 } : null, raiseClosed,
    allInTo: canRaise && allIn <= maxTo ? allIn : null,
    stack: st.stack, bet: p.bet, pot: potTotal(h), deadline: h.deadline, actionReadyAt: h.actionReadyAt,
  };
}

export type Action = { type: 'fold' } | { type: 'check' } | { type: 'call' } | { type: 'raise'; raiseTo: number };

export function act(t: TableState, seat: number, action: Action, now: number, ctx: TickContext): Effect[] {
  const effects = tick(t, now, ctx);
  const h = t.hand;
  if (!h || h.phase !== 'betting') fail('not_betting', 'No action is open');
  if (h.actionReadyAt !== null && now < h.actionReadyAt) fail('not_ready', 'Cards are still being dealt');
  if (h.actor !== seat) fail('not_turn', 'Not your turn');
  if (h.deadline !== null && now > h.deadline) fail('expired', 'Your time ran out');
  applyAction(t, h, seat, action, now, false);
  computeDue(t);
  return effects;
}

function applyAction(t: TableState, h: HandState, seat: number, action: Action, now: number, timeout: boolean): void {
  const la = legalActions(t, seat, now);
  if (!la.canAct) fail('not_turn', la.reason ?? 'Not your turn');
  const p = hp(h, seat); const st = t.seats[seat]!;
  switch (action.type) {
    case 'fold':
      p.folded = true; h.log.push({ t: 'fold', seat, timeout }); event(t, h, now, { type: 'action', seat, action: 'fold', amount: 0, to: p.bet });
      break;
    case 'check':
      if (!la.check) fail('cannot_check', 'You must call or fold');
      h.log.push({ t: 'check', seat, timeout }); event(t, h, now, { type: 'action', seat, action: 'check', amount: 0, to: p.bet });
      break;
    case 'call': {
      if (la.owed <= 0) fail('nothing_to_call', 'Nothing to call');
      const a = pay(h, p, st, la.owed, true);
      h.log.push({ t: 'call', seat, to: p.bet, amount: a, allIn: p.allIn, timeout }); event(t, h, now, { type: 'action', seat, action: 'call', amount: a, to: p.bet });
      break;
    }
    case 'raise': {
      const to = action.raiseTo;
      if (!la.raise) fail('raise_closed', la.raiseClosed ?? 'Raising is closed');
      if (!isChipInt(to) || to < la.raise.minTo || to > la.raise.maxTo) fail('bad_raise', `Raise to between ${la.raise.minTo} and ${la.raise.maxTo}`);
      const increment = to - h.currentBet;
      const a = pay(h, p, st, to - p.bet, true);
      if (p.bet !== to) fail('invariant', 'Raise payment mismatch');
      if (increment >= h.lastFullRaise) h.lastFullRaise = increment;
      h.currentBet = to;
      h.log.push({ t: la.raise.isBet ? 'bet' : 'raise', seat, to, amount: a, allIn: p.allIn, timeout }); event(t, h, now, { type: 'action', seat, action: la.raise.isBet ? 'bet' : 'raise', amount: a, to });
      break;
    }
    default: fail('bad_action', 'Unknown action');
  }
  p.acted = true; p.lastFaced = h.currentBet;
  if (timeout) st.consecutiveTimeouts += 1; else st.consecutiveTimeouts = 0;
  advance(t, h, seat, now);
}

function advance(t: TableState, h: HandState, from: number, now: number): void {
  const lives = h.players.filter(live);
  if (lives.length === 1) { collectBets(h); return settle(t, h, now, true); }
  const nxt = nextPlayer(t, h, from, (p) => active(p) && (!p.acted || p.bet < h.currentBet));
  if (nxt !== null) { h.actor = nxt; h.deadline = now + T.bettingMs; return; }
  closeStreet(t, h, now);
}

function collectBets(h: HandState): void {
  for (const p of h.players) { h.pot += p.bet; p.bet = 0; p.acted = false; p.lastFaced = 0; }
  h.currentBet = 0; h.lastFullRaise = h.bb;
}

function closeStreet(t: TableState, h: HandState, now: number): void {
  collectBets(h);
  h.actor = null; h.deadline = null;
  const lives = h.players.filter(live);
  if (lives.length === 1) return settle(t, h, now, true);
  const act = h.players.filter(active);
  if (act.length <= 1 || h.bettingLocked) {
    // no further betting possible
    if (h.board.length === 5) return settle(t, h, now, false);
    return beginRunout(t, h, now);
  }
  if (h.street === 'river') return settle(t, h, now, false);
  const next = STREETS[STREETS.indexOf(h.street) + 1];
  const cards = h.deck.slice(h.cursor, h.cursor + (next === 'flop' ? 3 : 1)); h.cursor += cards.length;
  h.board.push(...cards); h.street = next;
  h.log.push({ t: 'street', street: next, cards, board: 0 });
  event(t, h, now, { type: 'board', board: 0, street: next, cards });
  const first = nextPlayer(t, h, h.button, active)!;
  h.actor = first; h.deadline = now + 400 + T.bettingMs;
}

// ---------- runouts ----------
function remainingDeck(h: HandState): number { return 52 - h.cursor; }
export function canRunTwice(h: HandState): boolean {
  return 2 * (5 - h.board.length) <= remainingDeck(h);
}

function queueStages(t: TableState, h: HandState, now: number, runs: 1 | 2): void {
  h.runs = runs;
  const prefix = h.board.slice();
  const need = 5 - prefix.length;
  if (runs === 2) {
    if (!canRunTwice(h)) fail('capacity', 'Not enough cards to run it twice');
    h.boards = [prefix.slice(), prefix.slice()];
  }
  let at = now;
  const stageFor = (board: 0 | 1, start: number) => {
    let len = start;
    while (len < 5) {
      const count = len === 0 ? 3 : 1;
      const cards = h.deck.slice(h.cursor, h.cursor + count); h.cursor += count;
      const street: Street = len + count === 3 ? 'flop' : len + count === 4 ? 'turn' : 'river';
      h.runoutQueue.push({ board, cards, street, at });
      at += T.boardStageMs; len += count;
    }
  };
  void need;
  stageFor(0, prefix.length);
  if (runs === 2) stageFor(1, prefix.length);
  h.phase = 'runout';
}

function beginRunout(t: TableState, h: HandState, now: number): void {
  const cash = t.rules.mode === 'cash';
  if (h.bettingLocked || !cash) { queueStages(t, h, now, h.bettingLocked ? h.runs : 1); return; }
  if (h.board.length < 3) {
    // shared flop first, then the tail offer
    const cards = h.deck.slice(h.cursor, h.cursor + 3); h.cursor += 3;
    h.runoutQueue.push({ board: 0, cards, street: 'flop', at: now });
    h.phase = 'runout';
    return;
  }
  openOffer(t, h, now);
}

function openOffer(t: TableState, h: HandState, now: number): void {
  const electorate = h.players.filter(live).map((p) => p.seat);
  if (!canRunTwice(h) || electorate.length < 2) { queueStages(t, h, now, 1); return; }
  h.vote = { kind: 'offer', runs: 2, proposer: null, electorate, votes: {}, deadline: now + T.forcedOfferMs, street: h.street, suspendedActor: null, remainingMs: 0 };
  h.phase = 'offer';
}

function applyStage(t: TableState, h: HandState, now: number): void {
  const st = h.runoutQueue.shift()!;
  if (h.boards) { h.boards[st.board].push(...st.cards); if (st.board === 0 && !h.boards[1].length) { /* noop */ } }
  else h.board.push(...st.cards);
  h.street = st.street;
  h.log.push({ t: 'street', street: st.street, cards: st.cards, board: st.board });
  event(t, h, now, { type: 'board', board: st.board, street: st.street, cards: st.cards });
  if (h.runoutQueue.length > 0) return;
  const boardLen = h.boards ? h.boards[0].length : h.board.length;
  if (boardLen < 5) {
    // shared flop dealt for a preflop all-in: offer the tail (cash) or continue once
    if (t.rules.mode === 'cash' && !h.bettingLocked) return openOffer(t, h, now);
    return queueStages(t, h, now, 1);
  }
  settle(t, h, now, false);
}

export function propose(t: TableState, seat: number, runs: 1 | 2, now: number, ctx: TickContext): Effect[] {
  const effects = tick(t, now, ctx);
  const h = t.hand;
  if (!h || h.phase !== 'betting') fail('not_now', 'You can only propose on your turn');
  if (t.rules.mode !== 'cash') fail('not_cash', 'Tournaments run once');
  if (h.actor !== seat) fail('not_turn', 'Wait for your turn');
  if (h.street !== 'flop' && h.street !== 'turn') fail('wrong_street', 'Proposals are open on the flop and turn');
  if (h.currentBet > 0 || h.players.some((p) => p.bet > 0)) fail('wager', 'Not after a wager on this street');
  if (h.proposedStreets.includes(h.street)) fail('already', 'One proposal per street');
  if (runs !== 1 && runs !== 2) fail('bad_runs', 'Once or twice');
  if (runs === 2 && !canRunTwice(h)) fail('capacity', 'Not enough cards to run it twice');
  const electorate = h.players.filter(live).map((p) => p.seat);
  if (electorate.length < 2) fail('nobody', 'Nobody to agree with');
  h.proposedStreets.push(h.street);
  h.vote = { kind: 'proposal', runs, proposer: seat, electorate, votes: { [seat]: 'agree' }, deadline: now + T.voluntaryVoteMs, street: h.street, suspendedActor: h.actor, remainingMs: Math.max(0, (h.deadline ?? now) - now) };
  h.phase = 'vote'; h.actor = null;
  computeDue(t);
  return effects;
}

export function respondVote(t: TableState, seat: number, choice: 'agree' | 'decline' | 'once' | 'twice', now: number, ctx: TickContext): Effect[] {
  const effects = tick(t, now, ctx);
  const h = t.hand; const v = h?.vote;
  if (!h || !v || (h.phase !== 'vote' && h.phase !== 'offer')) fail('no_vote', 'Nothing to vote on');
  if (!v.electorate.includes(seat)) fail('not_voter', 'Not part of this decision');
  if (v.votes[seat]) fail('voted', 'Already answered');
  if (v.kind === 'proposal') {
    if (choice !== 'agree' && choice !== 'decline') fail('bad_vote', 'Agree or keep playing');
    v.votes[seat] = choice;
    if (choice === 'decline') resolveProposal(t, h, now, 'declined');
    else if (v.electorate.every((s) => v.votes[s] === 'agree')) resolveProposal(t, h, now, 'agreed');
  } else {
    if (choice !== 'once' && choice !== 'twice') fail('bad_vote', 'Once or twice');
    v.votes[seat] = choice;
    if (choice === 'once') resolveOffer(t, h, now, 1);
    else if (v.electorate.every((s) => v.votes[s] === 'twice')) resolveOffer(t, h, now, 2);
  }
  computeDue(t);
  return effects;
}

function resolveProposal(t: TableState, h: HandState, now: number, outcome: 'agreed' | 'declined' | 'expired'): void {
  const v = h.vote!;
  h.log.push({ t: 'vote', kind: 'proposal', outcome, runs: v.runs });
  h.vote = null;
  if (outcome === 'agreed') {
    h.bettingLocked = true; h.runs = v.runs;
    collectBets(h); h.actor = null; h.deadline = null;
    queueStages(t, h, now, v.runs);
    return;
  }
  h.phase = 'betting'; h.actor = v.suspendedActor; h.deadline = now + v.remainingMs;
}

function resolveOffer(t: TableState, h: HandState, now: number, runs: 1 | 2): void {
  h.log.push({ t: 'vote', kind: 'offer', outcome: runs === 2 ? 'twice' : 'once', runs });
  h.vote = null;
  queueStages(t, h, now, runs);
}

// ---------- settlement ----------
function settle(t: TableState, h: HandState, now: number, uncontested: boolean): void {
  const before = totalChips(t);
  const contributors = h.players.map((p) => ({ seat: p.seat, paid: p.paid, folded: p.folded }));
  const refunds: { seat: number; amount: number }[] = [];
  const ex = uncalledExcess(contributors);
  if (ex) {
    const p = hp(h, ex.seat); p.paid -= ex.amount; t.seats[ex.seat]!.stack += ex.amount; h.pot -= ex.amount;
    if (p.allIn && t.seats[ex.seat]!.stack > 0) p.allIn = false;
    refunds.push(ex); h.log.push({ t: 'refund', seat: ex.seat, amount: ex.amount });
  }
  const pots = buildPots(h.players.map((p) => ({ seat: p.seat, paid: p.paid, folded: p.folded })));
  const boards = h.boards ?? [h.board];
  const potSum = pots.reduce((a, p) => a + p.amount, 0);
  if (potSum !== h.pot) return halt(t, `pot mismatch ${potSum} vs ${h.pot}`);
  const shows: Record<number, Card[]> = {};
  let awards, totals;
  if (uncontested) {
    const w = h.players.find(live)!;
    awards = pots.map((pot, i) => ({ potIndex: i, board: 0 as const, amount: pot.amount, eligible: pot.eligible, winners: [{ seat: w.seat, amount: pot.amount, name: '', cards: [] as Card[] }], hands: [] }));
    totals = { [w.seat]: h.pot };
  } else {
    for (const p of h.players) if (live(p)) { p.shown = true; shows[p.seat] = h.hole[p.seat]; }
    ({ awards, totals } = awardPots(pots, boards, h.hole, h.variant!, h.button, t.seats.length));
  }
  for (const [seat, amt] of Object.entries(totals)) t.seats[+seat]!.stack += amt;
  for (const a of awards) for (const w of a.winners) h.log.push({ t: 'award', seat: w.seat, amount: w.amount, board: a.board, potIndex: a.potIndex, name: w.name });
  h.pot = 0;
  h.result = { uncontested, winnerSeat: uncontested ? h.players.find(live)!.seat : null, refunds, pots, awards, totals, boards, shows };
  h.phase = 'result'; h.actor = null; h.deadline = null; h.vote = null;
  h.nextAt = now + T.awardToNextChoiceMs;
  h.revealDeadline = uncontested ? h.nextAt : null;
  if (!uncontested) event(t, h, now, { type: 'showdown' });
  event(t, h, now, { type: 'award', awards: Object.entries(totals).map(([s, a]) => ({ seat: +s, amount: a })) });
  const after = totalChips(t);
  if (after !== before) return halt(t, `chip conservation violated: ${before} -> ${after}`);
}

function halt(t: TableState, message: string): void {
  t.error = message;
  t.dueAt = null;
}

export function reveal(t: TableState, seat: number, what: number[] | 'all' | 'muck', now: number, ctx: TickContext): Effect[] {
  const effects = tick(t, now, ctx);
  const h = t.hand;
  if (!h || !h.result || !h.result.uncontested || h.result.winnerSeat !== seat) fail('no_reveal', 'Nothing to reveal');
  if (h.revealDeadline === null || now > h.revealDeadline) fail('expired', 'The reveal window has closed');
  const p = hp(h, seat);
  if (what === 'muck') { h.revealDeadline = now; computeDue(t); return effects; }
  const idx = what === 'all' ? p.revealed.length === p.holeCount ? [] : Array.from({ length: p.holeCount }, (_, i) => i) : what;
  const fresh = [...new Set(idx)].filter((i) => Number.isInteger(i) && i >= 0 && i < p.holeCount && !p.revealed.includes(i));
  if (fresh.length) {
    p.revealed.push(...fresh);
    const cards = fresh.map((i) => h.hole[seat][i]);
    h.log.push({ t: 'reveal', seat, indices: fresh, cards });
    event(t, h, now, { type: 'reveal', seat, indices: fresh, cards });
  }
  computeDue(t);
  return effects;
}

// ---------- seat commands ----------
export function requestSitOut(t: TableState, playerId: string, now: number): void {
  const i = seatOf(t, playerId); if (i === -1) fail('not_seated', 'Not seated');
  if (t.rules.mode !== 'cash') fail('not_cash', 'Tournament seats stay in play');
  const s = t.seats[i]!; s.sitOutRequested = true; s.returnRequested = false;
  if (!t.hand || !t.hand.players.some((p) => p.seat === i) || t.hand.phase === 'result') { s.status = 'sitout'; s.sitOutRequested = false; event(t, null, now, { type: 'seat', seat: i, change: 'sitout' }); }
}
export function requestReturn(t: TableState, playerId: string, postToPlay: boolean, now: number): void {
  const i = seatOf(t, playerId); if (i === -1) fail('not_seated', 'Not seated');
  const s = t.seats[i]!; s.returnRequested = true; s.sitOutRequested = false; s.postToPlay = postToPlay;
  if (s.status === 'sitout') { s.status = 'in'; s.returnRequested = false; event(t, null, now, { type: 'seat', seat: i, change: 'return' }); }
}
export function setPostToPlay(t: TableState, playerId: string, post: boolean): void {
  const i = seatOf(t, playerId); if (i === -1) fail('not_seated', 'Not seated');
  t.seats[i]!.postToPlay = post;
}
export function setStraddlePref(t: TableState, playerId: string, pref: boolean): void {
  const i = seatOf(t, playerId); if (i === -1) fail('not_seated', 'Not seated');
  t.seats[i]!.straddlePref = pref;
}

/** Leave (or host removal). Cash: queued to the next boundary; the player keeps any all-in claim. Tournament: no cash-out. */
export function requestLeave(t: TableState, playerId: string, reason: 'leave' | 'removed', now: number, ctx: TickContext): Effect[] {
  const effects = tick(t, now, ctx);
  const i = seatOf(t, playerId); if (i === -1) fail('not_seated', 'Not seated');
  const s = t.seats[i]!;
  if (t.rules.mode === 'tournament' && t.status === 'running') {
    if (reason === 'removed') { s.leaving = true; s.leaveReason = reason; }
    return effects; // stack stays in play
  }
  s.leaving = true; s.leaveReason = reason;
  const h = t.hand;
  const inHand = h && h.phase !== 'result' && h.players.some((p) => p.seat === i);
  if (!inHand) {
    if (t.status === 'waiting' || !h) {
      effects.push({ type: 'exit', playerId, amount: s.stack, handNo: t.handNo, reason });
      t.seats[i] = null;
      event(t, null, now, { type: 'seat', seat: i, change: 'leave' });
      if (t.seats.every((x) => !x)) { t.status = 'closed'; t.hand = null; event(t, null, now, { type: 'status', status: 'closed' }); effects.push({ type: 'archive', reason: 'all_left' }); }
    }
  } else {
    const p = hp(h!, i); p.left = true;
    // a leaving player who still has action folds when it is their turn; all-in claims stay live
    if (h!.phase === 'betting' && h!.actor === i && active(p)) applyAction(t, h!, i, { type: 'fold' }, now, true);
    else if (h!.phase === 'vote' && h!.vote && h!.vote.electorate.includes(i) && !h!.vote.votes[i] && h!.vote.kind === 'proposal') { h!.vote.votes[i] = 'decline'; resolveProposal(t, h!, now, 'declined'); }
  }
  computeDue(t);
  return effects;
}

export function cancelLeave(t: TableState, playerId: string): void {
  const i = seatOf(t, playerId); if (i === -1) return;
  const s = t.seats[i]!; if (s.leaveReason === 'leave') { s.leaving = false; s.leaveReason = null; }
}

export function transferHost(t: TableState, playerId: string, now: number): void {
  if (t.hostPlayerId === playerId) return;
  t.hostPlayerId = playerId; t.hostEpoch += 1;
  event(t, null, now, { type: 'host', playerId });
}

// ---------- timers ----------
export function computeDue(t: TableState): void {
  if (t.error || (t.status !== 'running' && t.status !== 'waiting')) { t.dueAt = null; return; }
  const h = t.hand;
  const c: number[] = [];
  if (h) {
    if (h.phase === 'choice' && h.choiceDeadline !== null) c.push(h.choiceDeadline);
    if (h.phase === 'betting' && h.deadline !== null) c.push(h.deadline);
    if ((h.phase === 'vote' || h.phase === 'offer') && h.vote) c.push(h.vote.deadline);
    if (h.phase === 'runout' && h.runoutQueue.length) c.push(h.runoutQueue[0].at);
    if (h.phase === 'result' && h.nextAt !== null) c.push(h.nextAt);
  }
  t.dueAt = c.length ? Math.min(...c) : null;
}

/** Resolve every due deadline at `now`. Safe to call at any time; idempotent for a given state/time. */
export function tick(t: TableState, now: number, ctx: TickContext): Effect[] {
  const effects: Effect[] = [];
  if (t.error) return effects;
  for (let guard = 0; guard < 200; guard++) {
    if (t.status !== 'running') break;
    hostSuccession(t, now, ctx);
    const h = t.hand;
    if (!h) {
      if (t.seats.every((s) => !s)) { t.status = 'closed'; event(t, null, now, { type: 'status', status: 'closed' }); effects.push({ type: 'archive', reason: 'all_left' }); break; }
      if (!anyonePresent(t, ctx, now, T.abandonmentMs) && t.lastActivityAt < now - T.abandonmentMs) { abandon(t, now, effects); break; }
      const before = t.handNo;
      startNextHand(t, now, ctx, effects);
      if (t.handNo === before) break;
      continue;
    }
    if (h.phase === 'choice' && h.choiceDeadline !== null && now >= h.choiceDeadline) {
      if (h.straddleOffer && !h.straddleOffer.decided) { h.straddleOffer.decided = true; h.straddleOffer.accepted = false; }
      dealHand(t, h, RULES.defaultVariant, h.choiceDeadline, ctx, true);
      continue;
    }
    if (h.phase === 'betting' && h.deadline !== null && now > h.deadline && h.actor !== null) {
      const la = legalActions(t, h.actor, now);
      applyAction(t, h, h.actor, { type: la.check ? 'check' : 'fold' }, h.deadline, true);
      continue;
    }
    if ((h.phase === 'vote' || h.phase === 'offer') && h.vote && now >= h.vote.deadline) {
      if (h.vote.kind === 'proposal') resolveProposal(t, h, h.vote.deadline, 'expired'); else resolveOffer(t, h, h.vote.deadline, 1);
      continue;
    }
    if (h.phase === 'runout' && h.runoutQueue.length && now >= h.runoutQueue[0].at) { applyStage(t, h, h.runoutQueue[0].at); continue; }
    if (h.phase === 'result' && h.nextAt !== null && now >= h.nextAt) {
      effects.push({ type: 'history', handNo: h.handNo, record: historyRecord(t, h) });
      event(t, h, h.nextAt, { type: 'hand_end' });
      applyBoundary(t, h.nextAt, ctx, effects);
      ctx = { ...ctx, credits: [] };
      if (t.status !== 'running') break;
      startNextHand(t, now, ctx, effects);
      if (!t.hand) break;
      continue;
    }
    break;
  }
  computeDue(t);
  return effects;
}

function abandon(t: TableState, now: number, effects: Effect[]): void {
  if (t.rules.mode === 'cash') {
    for (let i = 0; i < t.seats.length; i++) { const s = t.seats[i]; if (!s) continue; effects.push({ type: 'exit', playerId: s.playerId, amount: s.stack, handNo: t.handNo, reason: 'closed' }); t.seats[i] = null; }
    t.status = 'closed';
  } else {
    t.status = 'abandoned';
    effects.push({ type: 'tournament_finished', winnerPlayerId: null, abandoned: true });
  }
  t.hand = null;
  event(t, null, now, { type: 'status', status: t.status });
  effects.push({ type: 'archive', reason: 'abandoned' });
}

function hostSuccession(t: TableState, now: number, ctx: TickContext): void {
  const hostSeated = seatOf(t, t.hostPlayerId) !== -1;
  const hostSeen = ctx.presence[t.hostPlayerId] ?? 0;
  if (hostSeated && hostSeen >= now - T.hostGraceMs) return;
  const candidates = t.seats
    .map((s, i) => ({ s, i }))
    .filter((x): x is { s: SeatState; i: number } => !!x.s && x.s.playerId !== t.hostPlayerId && (ctx.presence[x.s.playerId] ?? 0) >= now - T.hostGraceMs)
    .sort((a, b) => a.s.joinSeq - b.s.joinSeq || a.i - b.i || a.s.playerId.localeCompare(b.s.playerId));
  if (candidates.length) transferHost(t, candidates[0].s.playerId, now);
}

// ---------- projections ----------
function historyRecord(t: TableState, h: HandState): unknown {
  return {
    handId: h.id, handNo: h.handNo, variant: h.variant, sb: h.sb, bb: h.bb, ante: h.ante, level: h.level, button: h.button,
    players: h.players.map((p) => ({ seat: p.seat, playerId: p.playerId, name: t.seats[p.seat]?.name ?? '', stackStart: p.stackStart, paid: p.paid, folded: p.folded, won: h.result?.totals[p.seat] ?? 0, shown: p.shown ? h.hole[p.seat] : null, revealed: p.revealed.map((i) => h.hole[p.seat][i]) })),
    board: h.board, boards: h.boards, log: h.log, result: h.result && { uncontested: h.result.uncontested, refunds: h.result.refunds, pots: h.result.pots, awards: h.result.awards, totals: h.result.totals },
    startedAt: h.startedAt,
  };
}

export interface PublicHand extends Omit<HandState, 'deck' | 'cursor' | 'hole' | 'vote' | 'runoutQueue'> {
  actorLegal: LegalActions | null;
  canRunTwice: boolean;
  vote: null | { kind: Vote['kind']; runs: 1 | 2; proposer: number | null; electorate: number[]; answered: number[]; deadline: number; remainingMs: number };
  revealedCards: Record<number, { index: number; card: Card }[]>;
  stagesPending: number;
}
export interface PublicTable extends Omit<TableState, 'hand'> { hand: PublicHand | null }

export function publicView(t: TableState): PublicTable {
  const h = t.hand;
  const ph: PublicHand | null = h && {
    ...(() => { const { deck, cursor, hole, vote, runoutQueue, ...rest } = h; void deck; void cursor; void hole; void vote; void runoutQueue; return rest; })(),
    vote: h.vote ? { kind: h.vote.kind, runs: h.vote.runs, proposer: h.vote.proposer, electorate: h.vote.electorate, answered: Object.keys(h.vote.votes).map(Number), deadline: h.vote.deadline, remainingMs: h.vote.remainingMs } : null,
    revealedCards: Object.fromEntries(h.players.filter((p) => p.revealed.length).map((p) => [p.seat, p.revealed.map((i) => ({ index: i, card: h.hole[p.seat][i] }))])),
    stagesPending: h.runoutQueue.length,
    actorLegal: h.phase === 'betting' && h.actor !== null ? legalActions(t, h.actor, h.actionReadyAt ?? 0) : null,
    canRunTwice: canRunTwice(h),
  };
  if (ph) ph.result = ph.result && { ...ph.result, shows: h!.result!.shows };
  return { ...t, hand: ph };
}

export function privateCards(t: TableState, playerId: string): { handId: string; cards: Card[] } | null {
  const h = t.hand; if (!h || !h.variant) return null;
  const i = seatOf(t, playerId); if (i === -1) return null;
  const cards = h.hole[i]; if (!cards) return null;
  return { handId: h.id, cards };
}

export { EngineError };
