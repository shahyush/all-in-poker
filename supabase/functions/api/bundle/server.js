// server/src/errors.ts
var ApiError = class extends Error {
  constructor(status, code, message, detail) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.name = "ApiError";
  }
  status;
  code;
  detail;
};
var bad = (status, code, message, detail) => {
  throw new ApiError(status, code, message, detail);
};

// server/src/crypto.ts
var enc = new TextEncoder();
function toHex(b) {
  return Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
}
function fromHex(h) {
  return new Uint8Array((h.match(/.{2}/g) ?? []).map((x) => parseInt(x, 16)));
}
async function sha256Hex(s) {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}
function canonicalJson(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  const o = v;
  return "{" + Object.keys(o).filter((k) => o[k] !== void 0).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(o[k])).join(",") + "}";
}
var PBKDF2_ITERATIONS = 21e4;
async function pbkdf2(password, salt, iterations = PBKDF2_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}
function randomBytes(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}
var byteaHex = (b) => "\\x" + toHex(b);
var parseBytea = (s) => typeof s === "string" ? fromHex(s.startsWith("\\x") ? s.slice(2) : s) : new Uint8Array(s);
var B32 = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
function newRecoveryCode() {
  const b = randomBytes(26);
  let s = "";
  for (let i = 0; i < 26; i++) {
    let x = b[i];
    while (x >= 240) {
      x = randomBytes(1)[0];
    }
    s += B32[x % 30];
  }
  return s.match(/.{1,4}/g).join("-");
}
function normalizeCode(s) {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

// engine/src/cards.ts
var RANK_NAME = ["Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Jack", "Queen", "King", "Ace"];
var rankOf = (c) => c % 13;
var suitOf = (c) => Math.floor(c / 13);
var isCard = (c) => Number.isInteger(c) && c >= 0 && c <= 51;
function assertUniqueCards(cards) {
  const seen = /* @__PURE__ */ new Set();
  for (const c of cards) {
    if (!isCard(c)) throw new Error("Invalid card id");
    if (seen.has(c)) throw new Error("Duplicate card");
    seen.add(c);
  }
}
function freshDeck() {
  return Array.from({ length: 52 }, (_, i) => i);
}

// engine/src/random.ts
function secureInt(n) {
  if (!Number.isInteger(n) || n <= 0 || n > 4294967296) throw new Error("secureInt range");
  const g = globalThis.crypto;
  if (!g || typeof g.getRandomValues !== "function") throw new Error("Secure randomness unavailable");
  const limit = Math.floor(4294967296 / n) * n;
  const buf = new Uint32Array(1);
  let x;
  do {
    g.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % n;
}
function shuffledDeck(rng = secureInt) {
  const d = freshDeck();
  for (let i = d.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) throw new Error("rng out of range");
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}
function secureHex(bytes) {
  const g = globalThis.crypto;
  if (!g || typeof g.getRandomValues !== "function") throw new Error("Secure randomness unavailable");
  const b = new Uint8Array(bytes);
  g.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
var CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function secureCode(length) {
  let s = "";
  for (let i = 0; i < length; i++) s += CODE_ALPHABET[secureInt(CODE_ALPHABET.length)];
  return s;
}

// engine/src/evaluator.ts
function eval5(c) {
  if (c.length !== 5) throw new Error("eval5 needs five cards");
  const ranks = c.map(rankOf).sort((a, b) => b - a);
  const s0 = suitOf(c[0]);
  const flush = c.every((x) => suitOf(x) === s0);
  const counts = /* @__PURE__ */ new Map();
  for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  let straightHigh = -1;
  if (groups.length === 5) {
    if (ranks[0] - ranks[4] === 4) straightHigh = ranks[0];
    else if (ranks[0] === 12 && ranks[1] === 3 && ranks[4] === 0) straightHigh = 3;
  }
  let cat, tb;
  if (straightHigh >= 0 && flush) {
    cat = 8;
    tb = [straightHigh];
  } else if (groups[0][1] === 4) {
    cat = 7;
    tb = [groups[0][0], groups[1][0]];
  } else if (groups[0][1] === 3 && groups[1][1] === 2) {
    cat = 6;
    tb = [groups[0][0], groups[1][0]];
  } else if (flush) {
    cat = 5;
    tb = ranks;
  } else if (straightHigh >= 0) {
    cat = 4;
    tb = [straightHigh];
  } else if (groups[0][1] === 3) {
    cat = 3;
    tb = groups.map((g) => g[0]);
  } else if (groups[0][1] === 2 && groups[1][1] === 2) {
    cat = 2;
    tb = groups.map((g) => g[0]);
  } else if (groups[0][1] === 2) {
    cat = 1;
    tb = groups.map((g) => g[0]);
  } else {
    cat = 0;
    tb = ranks;
  }
  let s = cat;
  for (let i = 0; i < 5; i++) s = s * 16 + (tb[i] ?? 0);
  return s;
}
function categoryOf(score) {
  return Math.floor(score / 16 ** 5);
}
function describeScore(score) {
  const cat = categoryOf(score);
  const tb = [];
  let s = score % 16 ** 5;
  for (let i = 4; i >= 0; i--) {
    tb[i] = s % 16;
    s = Math.floor(s / 16);
  }
  const R = (r) => RANK_NAME[r];
  const Rs = (r) => R(r) + (r === 4 ? "es" : "s");
  switch (cat) {
    case 8:
      return tb[0] === 12 ? "Royal flush" : `Straight flush, ${R(tb[0])} high`;
    case 7:
      return `Four of a kind, ${Rs(tb[0])}`;
    case 6:
      return `Full house, ${Rs(tb[0])} over ${Rs(tb[1])}`;
    case 5:
      return `Flush, ${R(tb[0])} high`;
    case 4:
      return `Straight, ${R(tb[0])} high`;
    case 3:
      return `Three of a kind, ${Rs(tb[0])}`;
    case 2:
      return `Two pair, ${Rs(tb[0])} and ${Rs(tb[1])}`;
    case 1:
      return `Pair of ${Rs(tb[0])}`;
    default:
      return `${R(tb[0])} high`;
  }
}
function* combos(arr, k, start = 0, acc = []) {
  if (acc.length === k) {
    yield acc.slice();
    return;
  }
  for (let i = start; i <= arr.length - (k - acc.length); i++) {
    acc.push(arr[i]);
    yield* combos(arr, k, i + 1, acc);
    acc.pop();
  }
}
function bestHand(hole, board, variant) {
  assertUniqueCards([...hole, ...board]);
  if (board.length !== 5) throw new Error("Complete board required");
  let best = { score: -1, cards: [], name: "" };
  if (variant === "holdem") {
    if (hole.length !== 2) throw new Error("Hold'em needs two hole cards");
    for (const five of combos([...hole, ...board], 5)) {
      const s = eval5(five);
      if (s > best.score) best = { score: s, cards: five, name: "" };
    }
  } else {
    const need = { omaha4: 4, omaha5: 5, omaha6: 6 }[variant];
    if (hole.length !== need) throw new Error("Omaha hole count mismatch");
    for (const h2 of combos(hole, 2)) for (const b3 of combos(board, 3)) {
      const five = [...h2, ...b3];
      const s = eval5(five);
      if (s > best.score) best = { score: s, cards: five, name: "" };
    }
  }
  best.name = describeScore(best.score);
  return best;
}

// engine/src/amounts.ts
var MAX_CHIPS = 1e12;
function parseChipAmount(input) {
  if (typeof input === "number") {
    if (!Number.isInteger(input) || input < 0 || input > MAX_CHIPS) return null;
    return input;
  }
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!/^(0|[1-9][0-9]*)$/.test(s)) return null;
  if (s.length > 13) return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n > MAX_CHIPS) return null;
  return n;
}
function isChipInt(n) {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= MAX_CHIPS;
}

// engine/src/rules.ts
var RULES = {
  burnCards: false,
  variants: {
    holdem: { id: "holdem", label: "Hold'em", short: "NLH", holeCards: 2, limit: "NL", maxDealt: 9 },
    omaha4: { id: "omaha4", label: "Omaha 4", short: "PLO4", holeCards: 4, limit: "PL", maxDealt: 9 },
    omaha5: { id: "omaha5", label: "Omaha 5", short: "PLO5", holeCards: 5, limit: "PL", maxDealt: 9 },
    omaha6: { id: "omaha6", label: "Omaha 6", short: "PLO6", holeCards: 6, limit: "PL", maxDealt: 7 }
  },
  defaultVariant: "holdem",
  timers: {
    choiceMs: 4e3,
    bettingMs: 3e4,
    voluntaryVoteMs: 8e3,
    forcedOfferMs: 5e3,
    revealMs: 3e3,
    awardToNextChoiceMs: 3e3,
    dealPresentationMaxMs: 1500,
    boardStageMs: 1100,
    hostGraceMs: 3e4,
    abandonmentMs: 30 * 60 * 1e3,
    nobodyPresentHoldMs: 45e3
  },
  cash: { consecutiveTimeoutsToSitOut: 2 },
  tournament: { rebuys: false },
  seats: { min: 2, max: 9 },
  nicknameMax: 24,
  chatMax: 500
};
var VARIANT_IDS = ["holdem", "omaha4", "omaha5", "omaha6"];
function cardsForOneBoard(n, variant) {
  return n * RULES.variants[variant].holeCards + 5;
}
function variantAllowed(n, variant) {
  return n >= 2 && n <= RULES.variants[variant].maxDealt && cardsForOneBoard(n, variant) <= 52;
}

// engine/src/pots.ts
function uncalledExcess(players) {
  const sorted = players.filter((p) => p.paid > 0).sort((a, b) => b.paid - a.paid);
  if (sorted.length === 0) return null;
  const top = sorted[0];
  const second = sorted[1]?.paid ?? 0;
  if (top.paid > second) return { seat: top.seat, amount: top.paid - second };
  return null;
}
function buildPots(players) {
  const levels = [...new Set(players.filter((p) => p.paid > 0).map((p) => p.paid))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  for (const L of levels) {
    let amount = 0;
    for (const p of players) amount += Math.max(0, Math.min(p.paid, L) - prev);
    const eligible = players.filter((p) => !p.folded && p.paid >= L).map((p) => p.seat).sort((a, b) => a - b);
    if (amount > 0) {
      const last = pots[pots.length - 1];
      if (last && last.eligible.join() === eligible.join()) last.amount += amount;
      else pots.push({ amount, eligible });
    }
    prev = L;
  }
  return pots;
}
function clockwiseFrom(button, seatCount, seats) {
  const out = [];
  for (let i = 1; i <= seatCount && out.length < seats.length; i++) {
    const s = (button + i) % seatCount;
    if (seats.includes(s)) out.push(s);
  }
  return out;
}
function splitAmong(winners, amount, button, seatCount) {
  const ordered = clockwiseFrom(button, seatCount, winners);
  const share = Math.floor(amount / ordered.length);
  let rem = amount - share * ordered.length;
  return ordered.map((seat) => ({ seat, amount: share + (rem-- > 0 ? 1 : 0) }));
}
function awardPots(pots, boards, hole, variant, button, seatCount) {
  const awards = [];
  const totals = {};
  pots.forEach((pot, potIndex) => {
    const runs = boards.length;
    const base = Math.floor(pot.amount / runs);
    let rem = pot.amount - base * runs;
    for (let r = 0; r < runs; r++) {
      const amt = base + (rem-- > 0 ? 1 : 0);
      if (amt === 0) continue;
      let winners;
      let hands = [];
      if (pot.eligible.length === 1) {
        winners = pot.eligible.slice();
      } else {
        hands = pot.eligible.map((seat) => {
          const b = bestHand(hole[seat], boards[r], variant);
          return { seat, name: b.name, score: b.score, cards: b.cards };
        });
        const top = Math.max(...hands.map((h) => h.score));
        winners = hands.filter((h) => h.score === top).map((h) => h.seat);
      }
      const split = splitAmong(winners, amt, button, seatCount);
      const payout = split.map((w) => {
        const h = hands.find((x) => x.seat === w.seat);
        return { seat: w.seat, amount: w.amount, name: h?.name ?? "", cards: h?.cards ?? [] };
      });
      for (const w of payout) totals[w.seat] = (totals[w.seat] || 0) + w.amount;
      awards.push({ potIndex, board: r, amount: amt, eligible: pot.eligible.slice(), winners: payout, hands });
    }
  });
  return { awards, totals };
}

// engine/src/types.ts
var EngineError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "EngineError";
  }
};
var fail = (code, message) => {
  throw new EngineError(code, message);
};

// engine/src/table.ts
var T = RULES.timers;
var STREETS = ["preflop", "flop", "turn", "river"];
var live = (p) => !p.folded;
var active = (p) => !p.folded && !p.allIn;
function nextSeat(t, from, pred) {
  const n = t.seats.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    const s = t.seats[i];
    if (s && pred(s, i)) return i;
  }
  return null;
}
function nextPlayer(t, h, from, pred) {
  const n = t.seats.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    const p = h.players.find((x) => x.seat === i);
    if (p && pred(p)) return i;
  }
  return null;
}
function between(a, x, b, n) {
  const dx = (x - a + n) % n, db = (b - a + n) % n || n;
  return dx > 0 && dx < db;
}
function hp(h, seat) {
  const p = h.players.find((x) => x.seat === seat);
  if (!p) fail("not_in_hand", "Not in this hand");
  return p;
}
function event(t, h, at, e) {
  t.seq += 1;
  t.events.push({ seq: t.seq, handId: h ? h.id : null, at, ...e });
  if (t.events.length > 60) t.events.splice(0, t.events.length - 60);
  t.lastActivityAt = at;
}
function pay(h, p, seat, amount, asBet) {
  const a = Math.min(amount, seat.stack);
  seat.stack -= a;
  p.paid += a;
  if (asBet) p.bet += a;
  else h.pot += a;
  if (seat.stack === 0) p.allIn = true;
  return a;
}
function totalChips(t) {
  let sum = 0;
  for (const s of t.seats) if (s) sum += s.stack;
  if (t.hand) {
    sum += t.hand.pot;
    for (const p of t.hand.players) sum += p.bet;
  }
  return sum;
}
function currentLevel(t, now) {
  const tr = t.tournament;
  if (!tr) return 0;
  const levels = t.rules.levels;
  const elapsed = Math.max(0, now - tr.startedAt);
  let acc = 0;
  for (let i = 0; i < levels.length; i++) {
    acc += levels[i].minutes * 6e4;
    if (elapsed < acc) return i;
  }
  return levels.length - 1;
}
function blindsFor(t, now) {
  if (t.rules.mode === "tournament") {
    const li = currentLevel(t, now);
    const L = t.rules.levels[li];
    return { sb: L.sb, bb: L.bb, ante: L.ante, level: li };
  }
  return { sb: t.rules.sb, bb: t.rules.bb, ante: t.rules.ante, level: null };
}
function dealDurationMs(playerCount, holeCount) {
  const total = playerCount * holeCount;
  const travel = 180;
  const gap = total > 1 ? Math.min(55, Math.floor((T.dealPresentationMaxMs - travel) / (total - 1))) : 0;
  return (total - 1) * gap + travel;
}
function validateRules(r) {
  const bad2 = (m) => fail("invalid_rules", m);
  if (r.mode !== "cash" && r.mode !== "tournament") bad2("Choose cash or tournament");
  const name = String(r.name ?? "").trim().slice(0, 40) || "Friday table";
  if (!Number.isInteger(r.seats) || r.seats < RULES.seats.min || r.seats > RULES.seats.max) bad2("Seats must be 2 to 9");
  if (!isChipInt(r.unit) || r.unit <= 0) bad2("Buy-in must be a whole number of chips");
  let levels = [];
  if (r.mode === "cash") {
    if (!isChipInt(r.sb) || !isChipInt(r.bb) || r.sb <= 0 || r.bb <= r.sb) bad2("Small blind must be below the big blind");
    if (!isChipInt(r.ante) || r.ante < 0) bad2("Ante must be a whole number");
    if (r.unit < r.bb) bad2("Buy-in must be at least one big blind");
  } else {
    if (!Array.isArray(r.levels) || r.levels.length < 1) bad2("Add at least one blind level");
    let prevBB = 0;
    levels = r.levels.map((L, i) => {
      if (!isChipInt(L.sb) || !isChipInt(L.bb) || L.sb <= 0 || L.bb <= L.sb) bad2(`Level ${i + 1}: small blind must be below the big blind`);
      if (!isChipInt(L.ante) || L.ante < 0) bad2(`Level ${i + 1}: ante must be a whole number`);
      if (!Number.isInteger(L.minutes) || L.minutes <= 0 || L.minutes > 600) bad2(`Level ${i + 1}: minutes must be 1 to 600`);
      if (L.bb < prevBB) bad2(`Level ${i + 1}: blinds must not decrease`);
      prevBB = L.bb;
      return { sb: L.sb, bb: L.bb, ante: L.ante, minutes: L.minutes };
    });
    if (r.unit < levels[0].bb) bad2("Starting stack must be at least one big blind");
  }
  return {
    mode: r.mode,
    name,
    seats: r.seats,
    sb: r.mode === "cash" ? r.sb : levels[0].sb,
    bb: r.mode === "cash" ? r.bb : levels[0].bb,
    ante: r.mode === "cash" ? r.ante : 0,
    straddle: r.mode === "cash" && !!r.straddle,
    unit: r.unit,
    levels
  };
}
function createTable(id, rules, hostPlayerId, now) {
  const r = validateRules(rules);
  return {
    id,
    rules: r,
    status: "waiting",
    version: 0,
    seq: 0,
    seats: Array(r.seats).fill(null),
    button: null,
    prevBB: null,
    prevSB: null,
    handNo: 0,
    hand: null,
    hostPlayerId,
    hostEpoch: 1,
    createdAt: now,
    startedAt: null,
    nextSeq: 0,
    tournament: null,
    waitingReason: "Waiting for players",
    dueAt: null,
    events: [],
    error: null,
    lastActivityAt: now
  };
}
function seatOf(t, playerId) {
  return t.seats.findIndex((s) => s && s.playerId === playerId);
}
function seatPlayer(t, player, stack, now, preferred) {
  if (t.status !== "waiting" && t.status !== "running") fail("closed", "This table has closed");
  if (t.rules.mode === "tournament" && t.status !== "waiting") fail("locked", "Registration closed when the tournament started");
  if (seatOf(t, player.playerId) !== -1) fail("already_seated", "Already seated here");
  if (!isChipInt(stack) || stack <= 0) fail("invalid_amount", "Invalid buy-in");
  if (t.rules.mode === "tournament" && stack !== t.rules.unit) fail("invalid_amount", "Tournament stacks are fixed");
  if (t.rules.mode === "cash" && stack % t.rules.unit !== 0) fail("invalid_amount", "Buy-in must be a multiple of the table unit");
  if (totalChips(t) + stack > MAX_CHIPS) fail("invalid_amount", "Table chip limit reached");
  let seat = -1;
  if (preferred != null && Number.isInteger(preferred) && preferred >= 0 && preferred < t.seats.length && !t.seats[preferred]) seat = preferred;
  else seat = t.seats.findIndex((s) => !s);
  if (seat === -1) fail("full", "The table is full");
  const inProgress = t.status === "running";
  t.seats[seat] = {
    playerId: player.playerId,
    name: player.name,
    stack,
    status: "in",
    owesBB: inProgress && t.rules.mode === "cash",
    owesSB: false,
    postToPlay: false,
    sitOutRequested: false,
    returnRequested: false,
    leaving: false,
    leaveReason: null,
    consecutiveTimeouts: 0,
    joinedAt: now,
    joinSeq: t.nextSeq++,
    straddlePref: false,
    handStartStack: null,
    eliminatedPlace: null
  };
  event(t, null, now, { type: "seat", seat, change: "join" });
  return seat;
}
function renamePlayer(t, playerId, name) {
  const s = t.seats[seatOf(t, playerId)];
  if (s) s.name = name;
}
function eligibleToStart(t) {
  const funded = t.seats.filter((s) => s && s.stack > 0 && !s.leaving).length;
  if (funded < 2) return { ok: false, reason: "Waiting for one more player" };
  return { ok: true, reason: "" };
}
function startTable(t, now, ctx) {
  if (t.status !== "waiting") fail("already_started", "The game has already started");
  const e = eligibleToStart(t);
  if (!e.ok) fail("not_enough_players", e.reason);
  t.status = "running";
  t.startedAt = now;
  if (t.rules.mode === "tournament") {
    t.tournament = {
      startedAt: now,
      level: 0,
      eliminations: [],
      finishedAt: null,
      winnerPlayerId: null,
      entrants: t.seats.filter((s) => !!s).map((s) => ({ playerId: s.playerId, name: s.name }))
    };
  }
  event(t, null, now, { type: "status", status: "running" });
  const effects = [];
  startNextHand(t, now, ctx, effects);
  computeDue(t);
  return effects;
}
function tournamentEliminations(t, now, effects) {
  const tr = t.tournament;
  const alive = t.seats.filter((s) => !!s && s.eliminatedPlace === null);
  const busted = alive.filter((s) => s.stack === 0);
  if (busted.length === 0) return;
  const n = alive.length;
  const sorted = busted.slice().sort((a, b) => (b.handStartStack ?? 0) - (a.handStartStack ?? 0));
  let place = n - busted.length + 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && (sorted[i].handStartStack ?? 0) < (sorted[i - 1].handStartStack ?? 0)) place = n - busted.length + 1 + i;
    sorted[i].eliminatedPlace = place;
    tr.eliminations.push({ playerId: sorted[i].playerId, name: sorted[i].name, place, handNo: t.handNo });
    effects.push({ type: "eliminated", playerId: sorted[i].playerId, place, handNo: t.handNo });
    event(t, null, now, { type: "seat", seat: t.seats.indexOf(sorted[i]), change: "eliminated" });
  }
  const remaining = alive.filter((s) => s.stack > 0);
  if (remaining.length === 1) {
    remaining[0].eliminatedPlace = 1;
    tr.eliminations.push({ playerId: remaining[0].playerId, name: remaining[0].name, place: 1, handNo: t.handNo });
    tr.finishedAt = now;
    tr.winnerPlayerId = remaining[0].playerId;
    t.status = "finished";
    t.hand = null;
    t.waitingReason = null;
    event(t, null, now, { type: "status", status: "finished" });
    effects.push({ type: "tournament_finished", winnerPlayerId: remaining[0].playerId, abandoned: false });
    effects.push({ type: "archive", reason: "finished" });
  }
}
function applyBoundary(t, now, ctx, effects) {
  const cash = t.rules.mode === "cash";
  for (const c of ctx.credits ?? []) {
    const i = seatOf(t, c.playerId);
    if (i === -1 || !isChipInt(c.amount) || c.amount <= 0) continue;
    const s = t.seats[i];
    if (s.leaving) continue;
    s.stack += c.amount;
    effects.push({ type: "credit_applied", playerId: c.playerId, amount: c.amount, handNo: t.handNo, id: c.id ?? null });
  }
  for (let i = 0; i < t.seats.length; i++) {
    const s = t.seats[i];
    if (!s) continue;
    if (cash) {
      if (s.leaving) {
        effects.push({ type: "exit", playerId: s.playerId, amount: s.stack, handNo: t.handNo, reason: s.leaveReason ?? "leave" });
        t.seats[i] = null;
        event(t, null, now, { type: "seat", seat: i, change: "leave" });
        continue;
      }
      if (s.consecutiveTimeouts >= RULES.cash.consecutiveTimeoutsToSitOut && s.status === "in") {
        s.status = "sitout";
        s.consecutiveTimeouts = 0;
        s.sitOutRequested = false;
        event(t, null, now, { type: "seat", seat: i, change: "sitout" });
      }
      if (s.sitOutRequested && s.status === "in") {
        s.status = "sitout";
        s.sitOutRequested = false;
        event(t, null, now, { type: "seat", seat: i, change: "sitout" });
      }
      if (s.returnRequested) {
        s.returnRequested = false;
        if (s.status === "sitout") {
          s.status = "in";
          event(t, null, now, { type: "seat", seat: i, change: "return" });
        }
      }
    }
  }
  if (!cash && t.tournament) {
    tournamentEliminations(t, now, effects);
    if (t.status === "finished") return;
    const li = currentLevel(t, now);
    if (li !== t.tournament.level) {
      t.tournament.level = li;
      event(t, null, now, { type: "level", level: li });
    }
  }
  if (t.seats.every((s) => !s)) {
    t.status = "closed";
    t.hand = null;
    event(t, null, now, { type: "status", status: "closed" });
    effects.push({ type: "archive", reason: "all_left" });
  }
}
function anyonePresent(t, ctx, now, withinMs) {
  for (const s of t.seats) if (s && (ctx.presence[s.playerId] ?? 0) >= now - withinMs) return true;
  return false;
}
function startNextHand(t, now, ctx, effects) {
  if (t.status !== "running") return;
  t.hand = null;
  const cash = t.rules.mode === "cash";
  if (!anyonePresent(t, ctx, now, T.nobodyPresentHoldMs)) {
    t.waitingReason = "Waiting for someone to return";
    return;
  }
  const n = t.seats.length;
  const cand = (s) => !!s && s.stack > 0 && !s.leaving && s.eliminatedPlace === null && s.status === "in";
  const candidates = t.seats.map((s, i) => cand(s) ? i : -1).filter((i) => i >= 0);
  let base = cash ? candidates.filter((i) => !t.seats[i].owesBB) : candidates;
  if (cash && base.length < 2 && candidates.length >= 2) {
    for (const i of candidates) {
      t.seats[i].owesBB = false;
      t.seats[i].owesSB = false;
    }
    base = candidates;
  }
  if (base.length < 2) {
    t.waitingReason = "Waiting for players";
    return;
  }
  const rng = ctx.rng ?? secureInt;
  let button, sbSeat, bbSeat;
  let dealt;
  let sbPos = null;
  if (cash) {
    const inBase = (_, i) => base.includes(i);
    if (t.button === null) button = base[rng(base.length)];
    else if (base.length === 2 && t.prevBB !== null && base.includes(t.prevBB)) button = t.prevBB;
    else button = nextSeat(t, t.button, inBase);
    const owing = candidates.filter((i) => !base.includes(i));
    if (base.length === 2 && owing.length === 0) {
      sbSeat = button;
      bbSeat = nextSeat(t, button, inBase);
      dealt = [button, bbSeat];
    } else {
      sbSeat = nextSeat(t, button, inBase);
      bbSeat = nextSeat(t, sbSeat, (_, i) => candidates.includes(i));
      dealt = base.slice();
      if (!dealt.includes(bbSeat)) {
        dealt.push(bbSeat);
        t.seats[bbSeat].owesBB = false;
        t.seats[bbSeat].owesSB = false;
      }
      if (dealt.length === 2) {
        sbSeat = button;
      }
      for (const i of owing) {
        const s = t.seats[i];
        if (dealt.includes(i)) continue;
        if (s.postToPlay && between(bbSeat, i, button, n)) dealt.push(i);
      }
    }
    for (let i = 0; i < n; i++) {
      const s = t.seats[i];
      if (!s || dealt.includes(i)) continue;
      if (t.button !== null && (between(t.button, i, bbSeat, n) || i === bbSeat)) {
        s.owesBB = true;
        if (sbSeat !== null && (between(t.button, i, sbSeat, n) || i === sbSeat)) s.owesSB = true;
      }
    }
  } else {
    const inCand = (_, i) => candidates.includes(i);
    const len = candidates.length;
    if (t.prevBB === null) {
      button = candidates[rng(len)];
      if (len === 2) {
        sbSeat = button;
        bbSeat = nextSeat(t, button, inCand);
      } else {
        sbSeat = nextSeat(t, button, inCand);
        bbSeat = nextSeat(t, sbSeat, inCand);
      }
      sbPos = sbSeat;
    } else if (len === 2) {
      bbSeat = nextSeat(t, t.prevBB, inCand);
      button = nextSeat(t, bbSeat, inCand);
      sbSeat = button;
      sbPos = button;
    } else {
      bbSeat = nextSeat(t, t.prevBB, inCand);
      sbPos = t.prevBB;
      sbSeat = candidates.includes(sbPos) && sbPos !== bbSeat ? sbPos : null;
      button = t.prevSB ?? sbPos;
      if (button === bbSeat) button = sbPos;
    }
    dealt = candidates.slice();
  }
  dealt.sort((a, b) => a - b);
  const { sb, bb, ante, level } = blindsFor(t, now);
  const chooser = dealt.includes(button) ? button : nextSeat(t, button, (_, i) => dealt.includes(i));
  t.handNo += 1;
  const players = dealt.map((seat) => ({
    seat,
    playerId: t.seats[seat].playerId,
    holeCount: 0,
    folded: false,
    allIn: false,
    left: false,
    bet: 0,
    paid: 0,
    acted: false,
    lastFaced: 0,
    stackStart: t.seats[seat].stack,
    revealed: [],
    shown: false
  }));
  for (const s of t.seats) if (s) s.handStartStack = s.stack;
  const h = {
    id: `${t.handNo}-${secureHex(6)}`,
    handNo: t.handNo,
    variant: null,
    phase: "choice",
    street: "preflop",
    button,
    sbSeat,
    bbSeat,
    straddleSeat: null,
    chooserSeat: chooser,
    sb,
    bb,
    ante,
    level,
    players,
    pot: 0,
    board: [],
    boards: null,
    currentBet: 0,
    lastFullRaise: bb,
    actor: null,
    deadline: null,
    actionReadyAt: null,
    choiceDeadline: now + T.choiceMs,
    straddleOffer: null,
    vote: null,
    proposedStreets: [],
    bettingLocked: false,
    runs: 1,
    runoutQueue: [],
    result: null,
    revealDeadline: null,
    nextAt: null,
    startedAt: now,
    deck: [],
    cursor: 0,
    hole: {},
    log: []
  };
  if (cash && t.rules.straddle && dealt.length >= 3 && bbSeat !== null) {
    const utg = nextPlayer(t, h, bbSeat, () => true);
    const s = t.seats[utg];
    if (s.stack - Math.min(ante, s.stack) >= 2 * bb) h.straddleOffer = { seat: utg, decided: s.straddlePref, accepted: s.straddlePref };
  }
  t.button = button;
  t.prevBB = bbSeat;
  t.prevSB = sbSeat ?? sbPos ?? sbSeat;
  t.hand = h;
  t.waitingReason = null;
}
function chooseVariant(t, seat, variant, now, ctx) {
  const effects = tick(t, now, ctx);
  const h = t.hand;
  if (!h || h.phase !== "choice") fail("not_choice", "The game has already been chosen");
  if (h.chooserSeat !== seat) fail("not_chooser", "Not your deal");
  if (!VARIANT_IDS.includes(variant)) fail("bad_variant", "Unknown game");
  if (!variantAllowed(h.players.length, variant)) fail("capacity", "Not enough cards for that game with this many players");
  dealHand(t, h, variant, now, ctx, false);
  computeDue(t);
  return effects;
}
function respondStraddle(t, seat, accept, now, ctx) {
  const effects = tick(t, now, ctx);
  const h = t.hand;
  if (!h || h.phase !== "choice" || !h.straddleOffer || h.straddleOffer.seat !== seat) fail("no_offer", "No straddle offer open");
  if (h.straddleOffer.decided) fail("decided", "Already decided");
  h.straddleOffer.decided = true;
  h.straddleOffer.accepted = accept;
  computeDue(t);
  return effects;
}
function dealHand(t, h, variant, now, ctx, timeout) {
  const n = h.players.length;
  const V = RULES.variants[variant];
  if (!variantAllowed(n, variant)) fail("capacity", "Not enough cards");
  const deck = shuffledDeck(ctx.rng ?? secureInt);
  assertUniqueCards(deck);
  h.variant = variant;
  h.deck = deck;
  h.cursor = 0;
  const order = [];
  let s = h.button;
  for (let k = 0; k < n; k++) {
    s = nextPlayer(t, h, s, () => true);
    order.push(s);
  }
  for (const seat of order) h.hole[seat] = [];
  for (let r = 0; r < V.holeCards; r++) for (const seat of order) h.hole[seat].push(deck[h.cursor++]);
  for (const p of h.players) p.holeCount = V.holeCards;
  event(t, h, now, { type: "choice", variant, seat: h.chooserSeat, timeout });
  let nominal = 0, actual = 0;
  if (h.ante > 0) for (const p of h.players) {
    const a = pay(h, p, t.seats[p.seat], h.ante, false);
    h.log.push({ t: "post", seat: p.seat, amount: a, kind: "ante" });
  }
  for (const p of h.players) {
    const st = t.seats[p.seat];
    if (st.owesBB && p.seat !== h.bbSeat) {
      if (st.owesSB) {
        const d = pay(h, p, st, h.sb, false);
        h.log.push({ t: "post", seat: p.seat, amount: d, kind: "dead" });
      }
      const b = pay(h, p, st, h.bb, true);
      h.log.push({ t: "post", seat: p.seat, amount: b, kind: "bb" });
      st.owesBB = false;
      st.owesSB = false;
      st.postToPlay = false;
    }
  }
  if (h.sbSeat !== null && h.players.some((p) => p.seat === h.sbSeat)) {
    const p = hp(h, h.sbSeat);
    const a = pay(h, p, t.seats[p.seat], h.sb, true);
    nominal += h.sb;
    actual += a;
    h.log.push({ t: "post", seat: p.seat, amount: a, kind: "sb" });
  }
  if (h.bbSeat !== null) {
    const p = hp(h, h.bbSeat);
    const a = pay(h, p, t.seats[p.seat], h.bb, true);
    nominal += h.bb;
    actual += a;
    h.log.push({ t: "post", seat: p.seat, amount: a, kind: "bb" });
    t.seats[p.seat].owesBB = false;
    t.seats[p.seat].owesSB = false;
  }
  h.currentBet = h.bb;
  h.lastFullRaise = h.bb;
  let anchor = h.bbSeat ?? h.button;
  if (h.straddleOffer && h.straddleOffer.decided && h.straddleOffer.accepted) {
    const p = hp(h, h.straddleOffer.seat);
    const st = t.seats[p.seat];
    if (!p.allIn && st.stack >= 2 * h.bb && h.players.length >= 3) {
      const a = pay(h, p, st, 2 * h.bb, true);
      nominal += 2 * h.bb;
      actual += a;
      h.straddleSeat = p.seat;
      h.currentBet = 2 * h.bb;
      h.lastFullRaise = 2 * h.bb;
      anchor = p.seat;
      h.log.push({ t: "post", seat: p.seat, amount: a, kind: "straddle" });
    }
  }
  h.straddleOffer = null;
  h.shortfall = nominal - actual;
  const dur = dealDurationMs(n, V.holeCards);
  event(t, h, now, { type: "deal", order, holeCount: V.holeCards, button: h.button, variant, durationMs: dur });
  h.phase = "betting";
  h.street = "preflop";
  h.choiceDeadline = null;
  h.actionReadyAt = now + dur;
  const first = nextPlayer(t, h, anchor, active);
  h.actor = first;
  h.deadline = first === null ? null : h.actionReadyAt + T.bettingMs;
  if (first === null || !bettingPossible(h)) {
    h.actor = null;
    h.deadline = null;
    closeStreet(t, h, now);
  }
}
function bettingPossible(h) {
  const act2 = h.players.filter(active);
  if (act2.length === 0) return false;
  if (act2.length === 1) return act2[0].bet < h.currentBet;
  return true;
}
function potTotal(h) {
  return h.pot + h.players.reduce((a, p) => a + p.bet, 0);
}
function legalActions(t, seat, now) {
  const none = (reason) => ({ canAct: false, reason, fold: false, check: false, call: 0, owed: 0, raise: null, raiseClosed: null, allInTo: null, stack: 0, bet: 0, pot: 0, deadline: null, actionReadyAt: null });
  const h = t.hand;
  if (!h || h.phase !== "betting") return none("Not a betting moment");
  if (h.actor !== seat) return none("Not your turn");
  const p = hp(h, seat);
  const st = t.seats[seat];
  if (!active(p)) return none("Not active");
  const owed = Math.max(0, h.currentBet - p.bet);
  const call = Math.min(owed, st.stack);
  const allIn = p.bet + st.stack;
  const rights = !p.acted || h.currentBet - p.lastFaced >= h.lastFullRaise;
  const opp = h.players.filter((q) => q.seat !== seat && active(q)).map((q) => q.bet + t.seats[q.seat].stack);
  const maxOpp = opp.length ? Math.max(...opp) : 0;
  let maxTo = Math.min(allIn, maxOpp);
  const V = RULES.variants[h.variant];
  if (V.limit === "PL") {
    const P = potTotal(h) + (h.street === "preflop" ? h.shortfall ?? 0 : 0);
    const cap = p.bet + owed + P + owed;
    maxTo = Math.min(maxTo, cap);
  }
  let minTo = h.currentBet === 0 ? h.bb : h.currentBet + h.lastFullRaise;
  let raiseClosed = null;
  if (maxOpp <= h.currentBet) raiseClosed = "Nobody can call more";
  else if (!rights) raiseClosed = "Raising is closed for you";
  else if (maxTo <= h.currentBet) raiseClosed = "Call only";
  const canRaise = raiseClosed === null;
  if (minTo > maxTo) minTo = maxTo;
  return {
    canAct: true,
    fold: true,
    check: owed === 0,
    call,
    owed,
    raise: canRaise ? { minTo, maxTo, isBet: h.currentBet === 0 } : null,
    raiseClosed,
    allInTo: canRaise && allIn <= maxTo ? allIn : null,
    stack: st.stack,
    bet: p.bet,
    pot: potTotal(h),
    deadline: h.deadline,
    actionReadyAt: h.actionReadyAt
  };
}
function act(t, seat, action, now, ctx) {
  const effects = tick(t, now, ctx);
  const h = t.hand;
  if (!h || h.phase !== "betting") fail("not_betting", "No action is open");
  if (h.actionReadyAt !== null && now < h.actionReadyAt) fail("not_ready", "Cards are still being dealt");
  if (h.actor !== seat) fail("not_turn", "Not your turn");
  if (h.deadline !== null && now > h.deadline) fail("expired", "Your time ran out");
  applyAction(t, h, seat, action, now, false);
  computeDue(t);
  return effects;
}
function applyAction(t, h, seat, action, now, timeout) {
  const la = legalActions(t, seat, now);
  if (!la.canAct) fail("not_turn", la.reason ?? "Not your turn");
  const p = hp(h, seat);
  const st = t.seats[seat];
  switch (action.type) {
    case "fold":
      p.folded = true;
      h.log.push({ t: "fold", seat, timeout });
      event(t, h, now, { type: "action", seat, action: "fold", amount: 0, to: p.bet });
      break;
    case "check":
      if (!la.check) fail("cannot_check", "You must call or fold");
      h.log.push({ t: "check", seat, timeout });
      event(t, h, now, { type: "action", seat, action: "check", amount: 0, to: p.bet });
      break;
    case "call": {
      if (la.owed <= 0) fail("nothing_to_call", "Nothing to call");
      const a = pay(h, p, st, la.owed, true);
      h.log.push({ t: "call", seat, to: p.bet, amount: a, allIn: p.allIn, timeout });
      event(t, h, now, { type: "action", seat, action: "call", amount: a, to: p.bet });
      break;
    }
    case "raise": {
      const to = action.raiseTo;
      if (!la.raise) fail("raise_closed", la.raiseClosed ?? "Raising is closed");
      if (!isChipInt(to) || to < la.raise.minTo || to > la.raise.maxTo) fail("bad_raise", `Raise to between ${la.raise.minTo} and ${la.raise.maxTo}`);
      const increment = to - h.currentBet;
      const a = pay(h, p, st, to - p.bet, true);
      if (p.bet !== to) fail("invariant", "Raise payment mismatch");
      if (increment >= h.lastFullRaise) h.lastFullRaise = increment;
      h.currentBet = to;
      h.log.push({ t: la.raise.isBet ? "bet" : "raise", seat, to, amount: a, allIn: p.allIn, timeout });
      event(t, h, now, { type: "action", seat, action: la.raise.isBet ? "bet" : "raise", amount: a, to });
      break;
    }
    default:
      fail("bad_action", "Unknown action");
  }
  p.acted = true;
  p.lastFaced = h.currentBet;
  if (timeout) st.consecutiveTimeouts += 1;
  else st.consecutiveTimeouts = 0;
  advance(t, h, seat, now);
}
function advance(t, h, from, now) {
  const lives = h.players.filter(live);
  if (lives.length === 1) {
    collectBets(h);
    return settle(t, h, now, true);
  }
  const nxt = nextPlayer(t, h, from, (p) => active(p) && (!p.acted || p.bet < h.currentBet));
  if (nxt !== null) {
    h.actor = nxt;
    h.deadline = now + T.bettingMs;
    return;
  }
  closeStreet(t, h, now);
}
function collectBets(h) {
  for (const p of h.players) {
    h.pot += p.bet;
    p.bet = 0;
    p.acted = false;
    p.lastFaced = 0;
  }
  h.currentBet = 0;
  h.lastFullRaise = h.bb;
}
function closeStreet(t, h, now) {
  collectBets(h);
  h.actor = null;
  h.deadline = null;
  const lives = h.players.filter(live);
  if (lives.length === 1) return settle(t, h, now, true);
  const act2 = h.players.filter(active);
  if (act2.length <= 1 || h.bettingLocked) {
    if (h.board.length === 5) return settle(t, h, now, false);
    return beginRunout(t, h, now);
  }
  if (h.street === "river") return settle(t, h, now, false);
  const next = STREETS[STREETS.indexOf(h.street) + 1];
  const cards = h.deck.slice(h.cursor, h.cursor + (next === "flop" ? 3 : 1));
  h.cursor += cards.length;
  h.board.push(...cards);
  h.street = next;
  h.log.push({ t: "street", street: next, cards, board: 0 });
  event(t, h, now, { type: "board", board: 0, street: next, cards });
  const first = nextPlayer(t, h, h.button, active);
  h.actor = first;
  h.deadline = now + 400 + T.bettingMs;
}
function remainingDeck(h) {
  return 52 - h.cursor;
}
function canRunTwice(h) {
  return 2 * (5 - h.board.length) <= remainingDeck(h);
}
function queueStages(t, h, now, runs) {
  h.runs = runs;
  const prefix = h.board.slice();
  const need = 5 - prefix.length;
  if (runs === 2) {
    if (!canRunTwice(h)) fail("capacity", "Not enough cards to run it twice");
    h.boards = [prefix.slice(), prefix.slice()];
  }
  let at = now;
  const stageFor = (board, start) => {
    let len = start;
    while (len < 5) {
      const count = len === 0 ? 3 : 1;
      const cards = h.deck.slice(h.cursor, h.cursor + count);
      h.cursor += count;
      const street = len + count === 3 ? "flop" : len + count === 4 ? "turn" : "river";
      h.runoutQueue.push({ board, cards, street, at });
      at += T.boardStageMs;
      len += count;
    }
  };
  void need;
  stageFor(0, prefix.length);
  if (runs === 2) stageFor(1, prefix.length);
  h.phase = "runout";
}
function beginRunout(t, h, now) {
  const cash = t.rules.mode === "cash";
  if (h.bettingLocked || !cash) {
    queueStages(t, h, now, h.bettingLocked ? h.runs : 1);
    return;
  }
  if (h.board.length < 3) {
    const cards = h.deck.slice(h.cursor, h.cursor + 3);
    h.cursor += 3;
    h.runoutQueue.push({ board: 0, cards, street: "flop", at: now });
    h.phase = "runout";
    return;
  }
  openOffer(t, h, now);
}
function openOffer(t, h, now) {
  const electorate = h.players.filter(live).map((p) => p.seat);
  if (!canRunTwice(h) || electorate.length < 2) {
    queueStages(t, h, now, 1);
    return;
  }
  h.vote = { kind: "offer", runs: 2, proposer: null, electorate, votes: {}, deadline: now + T.forcedOfferMs, street: h.street, suspendedActor: null, remainingMs: 0 };
  h.phase = "offer";
}
function applyStage(t, h, now) {
  const st = h.runoutQueue.shift();
  if (h.boards) {
    h.boards[st.board].push(...st.cards);
    if (st.board === 0 && !h.boards[1].length) {
    }
  } else h.board.push(...st.cards);
  h.street = st.street;
  h.log.push({ t: "street", street: st.street, cards: st.cards, board: st.board });
  event(t, h, now, { type: "board", board: st.board, street: st.street, cards: st.cards });
  if (h.runoutQueue.length > 0) return;
  const boardLen = h.boards ? h.boards[0].length : h.board.length;
  if (boardLen < 5) {
    if (t.rules.mode === "cash" && !h.bettingLocked) return openOffer(t, h, now);
    return queueStages(t, h, now, 1);
  }
  settle(t, h, now, false);
}
function propose(t, seat, runs, now, ctx) {
  const effects = tick(t, now, ctx);
  const h = t.hand;
  if (!h || h.phase !== "betting") fail("not_now", "You can only propose on your turn");
  if (t.rules.mode !== "cash") fail("not_cash", "Tournaments run once");
  if (h.actor !== seat) fail("not_turn", "Wait for your turn");
  if (h.street !== "flop" && h.street !== "turn") fail("wrong_street", "Proposals are open on the flop and turn");
  if (h.currentBet > 0 || h.players.some((p) => p.bet > 0)) fail("wager", "Not after a wager on this street");
  if (h.proposedStreets.includes(h.street)) fail("already", "One proposal per street");
  if (runs !== 1 && runs !== 2) fail("bad_runs", "Once or twice");
  if (runs === 2 && !canRunTwice(h)) fail("capacity", "Not enough cards to run it twice");
  const electorate = h.players.filter(live).map((p) => p.seat);
  if (electorate.length < 2) fail("nobody", "Nobody to agree with");
  h.proposedStreets.push(h.street);
  h.vote = { kind: "proposal", runs, proposer: seat, electorate, votes: { [seat]: "agree" }, deadline: now + T.voluntaryVoteMs, street: h.street, suspendedActor: h.actor, remainingMs: Math.max(0, (h.deadline ?? now) - now) };
  h.phase = "vote";
  h.actor = null;
  computeDue(t);
  return effects;
}
function respondVote(t, seat, choice, now, ctx) {
  const effects = tick(t, now, ctx);
  const h = t.hand;
  const v = h?.vote;
  if (!h || !v || h.phase !== "vote" && h.phase !== "offer") fail("no_vote", "Nothing to vote on");
  if (!v.electorate.includes(seat)) fail("not_voter", "Not part of this decision");
  if (v.votes[seat]) fail("voted", "Already answered");
  if (v.kind === "proposal") {
    if (choice !== "agree" && choice !== "decline") fail("bad_vote", "Agree or keep playing");
    v.votes[seat] = choice;
    if (choice === "decline") resolveProposal(t, h, now, "declined");
    else if (v.electorate.every((s) => v.votes[s] === "agree")) resolveProposal(t, h, now, "agreed");
  } else {
    if (choice !== "once" && choice !== "twice") fail("bad_vote", "Once or twice");
    v.votes[seat] = choice;
    if (choice === "once") resolveOffer(t, h, now, 1);
    else if (v.electorate.every((s) => v.votes[s] === "twice")) resolveOffer(t, h, now, 2);
  }
  computeDue(t);
  return effects;
}
function resolveProposal(t, h, now, outcome) {
  const v = h.vote;
  h.log.push({ t: "vote", kind: "proposal", outcome, runs: v.runs });
  h.vote = null;
  if (outcome === "agreed") {
    h.bettingLocked = true;
    h.runs = v.runs;
    collectBets(h);
    h.actor = null;
    h.deadline = null;
    queueStages(t, h, now, v.runs);
    return;
  }
  h.phase = "betting";
  h.actor = v.suspendedActor;
  h.deadline = now + v.remainingMs;
}
function resolveOffer(t, h, now, runs) {
  h.log.push({ t: "vote", kind: "offer", outcome: runs === 2 ? "twice" : "once", runs });
  h.vote = null;
  queueStages(t, h, now, runs);
}
function settle(t, h, now, uncontested) {
  const before = totalChips(t);
  const contributors = h.players.map((p) => ({ seat: p.seat, paid: p.paid, folded: p.folded }));
  const refunds = [];
  const ex = uncalledExcess(contributors);
  if (ex) {
    const p = hp(h, ex.seat);
    p.paid -= ex.amount;
    t.seats[ex.seat].stack += ex.amount;
    h.pot -= ex.amount;
    if (p.allIn && t.seats[ex.seat].stack > 0) p.allIn = false;
    refunds.push(ex);
    h.log.push({ t: "refund", seat: ex.seat, amount: ex.amount });
  }
  const pots = buildPots(h.players.map((p) => ({ seat: p.seat, paid: p.paid, folded: p.folded })));
  const boards = h.boards ?? [h.board];
  const potSum = pots.reduce((a, p) => a + p.amount, 0);
  if (potSum !== h.pot) return halt(t, `pot mismatch ${potSum} vs ${h.pot}`);
  const shows = {};
  let awards, totals;
  if (uncontested) {
    const w = h.players.find(live);
    awards = pots.map((pot, i) => ({ potIndex: i, board: 0, amount: pot.amount, eligible: pot.eligible, winners: [{ seat: w.seat, amount: pot.amount, name: "", cards: [] }], hands: [] }));
    totals = { [w.seat]: h.pot };
  } else {
    for (const p of h.players) if (live(p)) {
      p.shown = true;
      shows[p.seat] = h.hole[p.seat];
    }
    ({ awards, totals } = awardPots(pots, boards, h.hole, h.variant, h.button, t.seats.length));
  }
  for (const [seat, amt] of Object.entries(totals)) t.seats[+seat].stack += amt;
  for (const a of awards) for (const w of a.winners) h.log.push({ t: "award", seat: w.seat, amount: w.amount, board: a.board, potIndex: a.potIndex, name: w.name });
  h.pot = 0;
  h.result = { uncontested, winnerSeat: uncontested ? h.players.find(live).seat : null, refunds, pots, awards, totals, boards, shows };
  h.phase = "result";
  h.actor = null;
  h.deadline = null;
  h.vote = null;
  h.nextAt = now + T.awardToNextChoiceMs;
  h.revealDeadline = uncontested ? h.nextAt : null;
  if (!uncontested) event(t, h, now, { type: "showdown" });
  event(t, h, now, { type: "award", awards: Object.entries(totals).map(([s, a]) => ({ seat: +s, amount: a })) });
  const after = totalChips(t);
  if (after !== before) return halt(t, `chip conservation violated: ${before} -> ${after}`);
}
function halt(t, message) {
  t.error = message;
  t.dueAt = null;
}
function reveal(t, seat, what, now, ctx) {
  const effects = tick(t, now, ctx);
  const h = t.hand;
  if (!h || !h.result || !h.result.uncontested || h.result.winnerSeat !== seat) fail("no_reveal", "Nothing to reveal");
  if (h.revealDeadline === null || now > h.revealDeadline) fail("expired", "The reveal window has closed");
  const p = hp(h, seat);
  if (what === "muck") {
    h.revealDeadline = now;
    computeDue(t);
    return effects;
  }
  const idx = what === "all" ? p.revealed.length === p.holeCount ? [] : Array.from({ length: p.holeCount }, (_, i) => i) : what;
  const fresh = [...new Set(idx)].filter((i) => Number.isInteger(i) && i >= 0 && i < p.holeCount && !p.revealed.includes(i));
  if (fresh.length) {
    p.revealed.push(...fresh);
    const cards = fresh.map((i) => h.hole[seat][i]);
    h.log.push({ t: "reveal", seat, indices: fresh, cards });
    event(t, h, now, { type: "reveal", seat, indices: fresh, cards });
  }
  computeDue(t);
  return effects;
}
function requestSitOut(t, playerId, now) {
  const i = seatOf(t, playerId);
  if (i === -1) fail("not_seated", "Not seated");
  if (t.rules.mode !== "cash") fail("not_cash", "Tournament seats stay in play");
  const s = t.seats[i];
  s.sitOutRequested = true;
  s.returnRequested = false;
  if (!t.hand || !t.hand.players.some((p) => p.seat === i) || t.hand.phase === "result") {
    s.status = "sitout";
    s.sitOutRequested = false;
    event(t, null, now, { type: "seat", seat: i, change: "sitout" });
  }
}
function requestReturn(t, playerId, postToPlay, now) {
  const i = seatOf(t, playerId);
  if (i === -1) fail("not_seated", "Not seated");
  const s = t.seats[i];
  s.returnRequested = true;
  s.sitOutRequested = false;
  s.postToPlay = postToPlay;
  if (s.status === "sitout") {
    s.status = "in";
    s.returnRequested = false;
    event(t, null, now, { type: "seat", seat: i, change: "return" });
  }
}
function setPostToPlay(t, playerId, post) {
  const i = seatOf(t, playerId);
  if (i === -1) fail("not_seated", "Not seated");
  t.seats[i].postToPlay = post;
}
function setStraddlePref(t, playerId, pref) {
  const i = seatOf(t, playerId);
  if (i === -1) fail("not_seated", "Not seated");
  t.seats[i].straddlePref = pref;
}
function requestLeave(t, playerId, reason, now, ctx) {
  const effects = tick(t, now, ctx);
  const i = seatOf(t, playerId);
  if (i === -1) fail("not_seated", "Not seated");
  const s = t.seats[i];
  if (t.rules.mode === "tournament" && t.status === "running") {
    if (reason === "removed") {
      s.leaving = true;
      s.leaveReason = reason;
    }
    return effects;
  }
  s.leaving = true;
  s.leaveReason = reason;
  const h = t.hand;
  const inHand = h && h.phase !== "result" && h.players.some((p) => p.seat === i);
  if (!inHand) {
    if (t.status === "waiting" || !h) {
      effects.push({ type: "exit", playerId, amount: s.stack, handNo: t.handNo, reason });
      t.seats[i] = null;
      event(t, null, now, { type: "seat", seat: i, change: "leave" });
      if (t.seats.every((x) => !x)) {
        t.status = "closed";
        t.hand = null;
        event(t, null, now, { type: "status", status: "closed" });
        effects.push({ type: "archive", reason: "all_left" });
      }
    }
  } else {
    const p = hp(h, i);
    p.left = true;
    if (h.phase === "betting" && h.actor === i && active(p)) applyAction(t, h, i, { type: "fold" }, now, true);
    else if (h.phase === "vote" && h.vote && h.vote.electorate.includes(i) && !h.vote.votes[i] && h.vote.kind === "proposal") {
      h.vote.votes[i] = "decline";
      resolveProposal(t, h, now, "declined");
    }
  }
  computeDue(t);
  return effects;
}
function cancelLeave(t, playerId) {
  const i = seatOf(t, playerId);
  if (i === -1) return;
  const s = t.seats[i];
  if (s.leaveReason === "leave") {
    s.leaving = false;
    s.leaveReason = null;
  }
}
function transferHost(t, playerId, now) {
  if (t.hostPlayerId === playerId) return;
  t.hostPlayerId = playerId;
  t.hostEpoch += 1;
  event(t, null, now, { type: "host", playerId });
}
function computeDue(t) {
  if (t.error || t.status !== "running" && t.status !== "waiting") {
    t.dueAt = null;
    return;
  }
  const h = t.hand;
  const c = [];
  if (h) {
    if (h.phase === "choice" && h.choiceDeadline !== null) c.push(h.choiceDeadline);
    if (h.phase === "betting" && h.deadline !== null) c.push(h.deadline);
    if ((h.phase === "vote" || h.phase === "offer") && h.vote) c.push(h.vote.deadline);
    if (h.phase === "runout" && h.runoutQueue.length) c.push(h.runoutQueue[0].at);
    if (h.phase === "result" && h.nextAt !== null) c.push(h.nextAt);
  }
  t.dueAt = c.length ? Math.min(...c) : null;
}
function tick(t, now, ctx) {
  const effects = [];
  if (t.error) return effects;
  for (let guard = 0; guard < 200; guard++) {
    if (t.status !== "running") break;
    hostSuccession(t, now, ctx);
    const h = t.hand;
    if (!h) {
      if (t.seats.every((s) => !s)) {
        t.status = "closed";
        event(t, null, now, { type: "status", status: "closed" });
        effects.push({ type: "archive", reason: "all_left" });
        break;
      }
      if (!anyonePresent(t, ctx, now, T.abandonmentMs) && t.lastActivityAt < now - T.abandonmentMs) {
        abandon(t, now, effects);
        break;
      }
      const before = t.handNo;
      startNextHand(t, now, ctx, effects);
      if (t.handNo === before) break;
      continue;
    }
    if (h.phase === "choice" && h.choiceDeadline !== null && now >= h.choiceDeadline) {
      if (h.straddleOffer && !h.straddleOffer.decided) {
        h.straddleOffer.decided = true;
        h.straddleOffer.accepted = false;
      }
      dealHand(t, h, RULES.defaultVariant, h.choiceDeadline, ctx, true);
      continue;
    }
    if (h.phase === "betting" && h.deadline !== null && now > h.deadline && h.actor !== null) {
      const la = legalActions(t, h.actor, now);
      applyAction(t, h, h.actor, { type: la.check ? "check" : "fold" }, h.deadline, true);
      continue;
    }
    if ((h.phase === "vote" || h.phase === "offer") && h.vote && now >= h.vote.deadline) {
      if (h.vote.kind === "proposal") resolveProposal(t, h, h.vote.deadline, "expired");
      else resolveOffer(t, h, h.vote.deadline, 1);
      continue;
    }
    if (h.phase === "runout" && h.runoutQueue.length && now >= h.runoutQueue[0].at) {
      applyStage(t, h, h.runoutQueue[0].at);
      continue;
    }
    if (h.phase === "result" && h.nextAt !== null && now >= h.nextAt) {
      effects.push({ type: "history", handNo: h.handNo, record: historyRecord(t, h) });
      event(t, h, h.nextAt, { type: "hand_end" });
      applyBoundary(t, h.nextAt, ctx, effects);
      ctx = { ...ctx, credits: [] };
      if (t.status !== "running") break;
      startNextHand(t, now, ctx, effects);
      if (!t.hand) break;
      continue;
    }
    break;
  }
  computeDue(t);
  return effects;
}
function abandon(t, now, effects) {
  if (t.rules.mode === "cash") {
    for (let i = 0; i < t.seats.length; i++) {
      const s = t.seats[i];
      if (!s) continue;
      effects.push({ type: "exit", playerId: s.playerId, amount: s.stack, handNo: t.handNo, reason: "closed" });
      t.seats[i] = null;
    }
    t.status = "closed";
  } else {
    t.status = "abandoned";
    effects.push({ type: "tournament_finished", winnerPlayerId: null, abandoned: true });
  }
  t.hand = null;
  event(t, null, now, { type: "status", status: t.status });
  effects.push({ type: "archive", reason: "abandoned" });
}
function hostSuccession(t, now, ctx) {
  const hostSeated = seatOf(t, t.hostPlayerId) !== -1;
  const hostSeen = ctx.presence[t.hostPlayerId] ?? 0;
  if (hostSeated && hostSeen >= now - T.hostGraceMs) return;
  const candidates = t.seats.map((s, i) => ({ s, i })).filter((x) => !!x.s && x.s.playerId !== t.hostPlayerId && (ctx.presence[x.s.playerId] ?? 0) >= now - T.hostGraceMs).sort((a, b) => a.s.joinSeq - b.s.joinSeq || a.i - b.i || a.s.playerId.localeCompare(b.s.playerId));
  if (candidates.length) transferHost(t, candidates[0].s.playerId, now);
}
function historyRecord(t, h) {
  return {
    handId: h.id,
    handNo: h.handNo,
    variant: h.variant,
    sb: h.sb,
    bb: h.bb,
    ante: h.ante,
    level: h.level,
    button: h.button,
    players: h.players.map((p) => ({ seat: p.seat, playerId: p.playerId, name: t.seats[p.seat]?.name ?? "", stackStart: p.stackStart, paid: p.paid, folded: p.folded, won: h.result?.totals[p.seat] ?? 0, shown: p.shown ? h.hole[p.seat] : null, revealed: p.revealed.map((i) => h.hole[p.seat][i]) })),
    board: h.board,
    boards: h.boards,
    log: h.log,
    result: h.result && { uncontested: h.result.uncontested, refunds: h.result.refunds, pots: h.result.pots, awards: h.result.awards, totals: h.result.totals },
    startedAt: h.startedAt
  };
}
function publicView(t) {
  const h = t.hand;
  const ph = h && {
    ...(() => {
      const { deck, cursor, hole, vote, runoutQueue, ...rest } = h;
      void deck;
      void cursor;
      void hole;
      void vote;
      void runoutQueue;
      return rest;
    })(),
    vote: h.vote ? { kind: h.vote.kind, runs: h.vote.runs, proposer: h.vote.proposer, electorate: h.vote.electorate, answered: Object.keys(h.vote.votes).map(Number), deadline: h.vote.deadline, remainingMs: h.vote.remainingMs } : null,
    revealedCards: Object.fromEntries(h.players.filter((p) => p.revealed.length).map((p) => [p.seat, p.revealed.map((i) => ({ index: i, card: h.hole[p.seat][i] }))])),
    stagesPending: h.runoutQueue.length,
    actorLegal: h.phase === "betting" && h.actor !== null ? legalActions(t, h.actor, h.actionReadyAt ?? 0) : null,
    canRunTwice: canRunTwice(h)
  };
  if (ph) ph.result = ph.result && { ...ph.result, shows: h.result.shows };
  return { ...t, hand: ph };
}
function privateCards(t, playerId) {
  const h = t.hand;
  if (!h || !h.variant) return null;
  const i = seatOf(t, playerId);
  if (i === -1) return null;
  const cards = h.hole[i];
  if (!cards) return null;
  return { handId: h.id, cards };
}

// server/src/tables.ts
async function loadTable(db, tableId) {
  const r = await db.rpc("allin_load", { table_id: tableId });
  if (!r.found) throw new ApiError(404, "not_found", "That table no longer exists");
  if (!r.secret) throw new ApiError(410, "archived", "This table has ended");
  return { row: r.table, t: r.secret, members: r.members, now: Number(r.now) };
}
function presenceOf(members) {
  const p = {};
  for (const m of members) if (m.status === "active" && m.last_seen) p[m.user_id] = Number(m.last_seen);
  return p;
}
function effectsToPayload(t, effects, memberNames, approved) {
  const out = { members: [], ledger: [], participants: [], reloads: [], history: [] };
  const used = /* @__PURE__ */ new Set();
  for (const e of effects) {
    switch (e.type) {
      case "exit":
        out.ledger.push({ user_id: e.playerId, kind: "exit", amount: e.amount, source_id: `${t.id}:exit:${e.playerId}:${e.handNo}:${t.version}`, hand_no: e.handNo });
        out.participants.push({ user_id: e.playerId, left_at: true, taken_off_delta: e.amount, final_stack: 0 });
        out.members.push({ user_id: e.playerId, status: e.reason === "removed" ? "removed" : "left", seat: null });
        break;
      case "credit_applied": {
        const req = e.id ? approved.find((r) => r.id === e.id) : approved.find((r) => r.user_id === e.playerId && r.amount === e.amount && !used.has(r.id));
        if (req) {
          used.add(req.id);
          out.ledger.push({ user_id: e.playerId, kind: "reload", amount: e.amount, source_id: `reload:${req.id}`, hand_no: e.handNo });
          out.reloads.push({ id: req.id, status: "credited", from_status: "approved", credited_hand_no: e.handNo });
          out.participants.push({ user_id: e.playerId, added_delta: e.amount });
        }
        break;
      }
      case "history":
        out.history.push({ hand_no: e.handNo, hand_id: e.record.handId ?? null, record: e.record });
        break;
      case "eliminated":
        out.participants.push({ user_id: e.playerId, place: e.place, final_stack: 0 });
        break;
      case "tournament_finished":
        if (e.winnerPlayerId) {
          const i = seatOf(t, e.winnerPlayerId);
          out.participants.push({ user_id: e.winnerPlayerId, place: 1, final_stack: i >= 0 ? t.seats[i].stack : null });
        }
        break;
      case "archive": {
        for (const s of t.seats) if (s) out.participants.push({ user_id: s.playerId, final_stack: s.stack, left_at: true });
        out.archive = { reason: e.reason, summary: { reason: e.reason, mode: t.rules.mode, hands: t.handNo, status: t.status, tournament: t.tournament ? { eliminations: t.tournament.eliminations, winnerPlayerId: t.tournament.winnerPlayerId, entrants: t.tournament.entrants } : null, endedAt: t.lastActivityAt } };
        break;
      }
      case "invariant_failure":
        out.diagnostic = { kind: "invariant", message: e.message };
        break;
    }
  }
  void memberNames;
  return out;
}
async function commitTable(db, loaded, after, effects, extras, approved = []) {
  computeDue(after);
  const names = /* @__PURE__ */ new Map();
  for (const s of after.seats) if (s) names.set(s.playerId, s.name);
  const fx = effectsToPayload(after, effects, names, approved);
  const before = loaded?.t ?? null;
  const dealtNow = !!after.hand && !!after.hand.variant;
  const newDeal = dealtNow && (!before || !before.hand || before.hand.id !== after.hand.id || !before.hand.variant);
  const holeCards = newDeal ? after.hand.players.map((p) => {
    const pc = privateCards(after, p.playerId);
    return { user_id: p.playerId, hand_no: after.hand.handNo, hand_id: pc.handId, cards: pc.cards };
  }) : void 0;
  if (after.error) fx.diagnostic = { kind: "invariant", message: after.error, state: after };
  const payload = {
    table_id: after.id,
    expected_version: loaded ? loaded.row.version : -1,
    create: !loaded,
    ...extras.create ?? {},
    status: after.status,
    host_id: after.hostPlayerId,
    host_epoch: after.hostEpoch,
    due_at: after.dueAt,
    started_at: after.startedAt,
    seq: after.seq,
    public_state: publicView(after),
    private_state: after,
    hole_cards: holeCards,
    history: fx.history,
    ledger: [...fx.ledger ?? [], ...extras.ledger ?? []],
    members: [...fx.members ?? [], ...extras.members ?? []],
    participants: [...fx.participants ?? [], ...extras.participants ?? []],
    reloads: [...fx.reloads ?? [], ...extras.reloads ?? []],
    chat: extras.chat ?? [],
    receipt: extras.receipt ?? null,
    touch: extras.touch ?? null,
    archive: fx.archive ?? null,
    diagnostic: fx.diagnostic ?? null
  };
  const r = await db.rpc("allin_commit", payload);
  if (r.ok) after.version = r.version;
  return r;
}

// server/src/handlers.ts
var NAME_RE = /^[\p{L}\p{N}\p{P}\p{S}\p{Zs}\p{M}\p{Emoji}]{1,24}$/u;
function cleanName(raw) {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!s || [...s].length > RULES.nicknameMax || !NAME_RE.test(s)) bad(400, "bad_name", "Pick a nickname of 1 to 24 characters");
  return s;
}
var uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var isUuid = (s) => typeof s === "string" && uuidRe.test(s);
var Handlers = class {
  constructor(db, env) {
    this.db = db;
    this.env = env;
  }
  db;
  env;
  // ---------- identity ----------
  async playerFor(authUid) {
    const rows = await this.db.select("profiles", { auth_user_id: authUid, status: "active" }, { limit: 1 });
    if (!rows.length) return null;
    const r = rows[0];
    return { id: r.id, name: r.display_name, avatar: r.avatar, isOwner: r.is_owner };
  }
  async rateLimit(key, kind, limit, windowS, message) {
    const c = await this.db.rpc("allin_attempt", { key, kind, limit, window_s: windowS });
    if (c >= limit) bad(429, "rate_limited", message);
  }
  async verifyGroupPassword(password, authUid) {
    const rows = await this.db.select("group_settings", { id: 1 });
    if (!rows.length) {
      const boot = this.env.groupPassword;
      if (!boot) bad(503, "not_configured", "The group password has not been set up yet");
      const a = new TextEncoder().encode(password.normalize("NFKC")), b = new TextEncoder().encode(boot.normalize("NFKC"));
      if (!constantTimeEqual(a, b)) bad(403, "wrong_password", "That group password is not right");
      void authUid;
      return { bootstrap: true };
    }
    const r = rows[0];
    const derived = await pbkdf2(password, parseBytea(r.password_salt), r.iterations);
    if (!constantTimeEqual(derived, parseBytea(r.password_hash))) bad(403, "wrong_password", "That group password is not right");
    return { bootstrap: false };
  }
  async admit(authUid, p) {
    const existing = await this.playerFor(authUid);
    if (existing) return { result: { player: existing, already: true } };
    const name = cleanName(p.nickname);
    const password = String(p.password ?? "");
    if (!password || password.length > 200) bad(400, "bad_password", "Enter the group password");
    await this.rateLimit(authUid, "admit", 10, 600, "Too many tries. Wait a few minutes and try again.");
    const { bootstrap } = await this.verifyGroupPassword(password, authUid);
    const r = await this.db.rpc("allin_admit", {
      auth_user_id: authUid,
      display_name: name,
      bootstrap,
      ...bootstrap ? await this.hashPassword(password) : {}
    });
    if (!r.ok) bad(409, r.reason ?? "admit_failed", "Could not admit you, please try again");
    return { result: { player: { id: r.player.id, name: r.player.display_name, avatar: r.player.avatar, isOwner: r.player.is_owner } } };
  }
  async hashPassword(password) {
    const salt = randomBytes(16);
    const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
    return { password_hash: byteaHex(hash), password_salt: byteaHex(salt), iterations: PBKDF2_ITERATIONS };
  }
  async rotateGroupPassword(player, authUid, p) {
    if (!player.isOwner) bad(403, "owner_only", "Only the group owner can change the password");
    const next = String(p.next ?? "");
    if (next.length < 6 || next.length > 200) bad(400, "bad_password", "Use at least 6 characters");
    await this.rateLimit(authUid, "rotate", 5, 600, "Too many tries");
    await this.verifyGroupPassword(String(p.current ?? ""), authUid);
    await this.db.rpc("allin_set_group_password", { ...await this.hashPassword(next), rotated_by: player.id });
    return { result: { ok: true } };
  }
  async updateProfile(player, p) {
    const name = p.name !== void 0 ? cleanName(p.name) : void 0;
    let avatar;
    if (p.avatar !== void 0) {
      avatar = p.avatar === null ? null : String(p.avatar);
      if (avatar && [...avatar].length > 2) bad(400, "bad_avatar", "Avatar is one or two characters");
    }
    await this.db.rpc("allin_update_profile", { player_id: player.id, display_name: name ?? null, avatar: avatar === void 0 ? "__keep__" : avatar });
    if (name) {
      const seats = await this.db.select("table_members", { user_id: player.id, status: "active" });
      for (const s of seats) {
        try {
          await this.withTable(s.table_id, null, (L) => {
            renamePlayer(L.t, player.id, name);
            return { effects: [], result: null };
          });
        } catch {
        }
      }
    }
    return { result: { player: { ...player, name: name ?? player.name, avatar: avatar === void 0 ? player.avatar : avatar } } };
  }
  async createRecoveryCode(player) {
    const code = newRecoveryCode();
    const verifier = await sha256Hex(normalizeCode(code));
    await this.db.rpc("allin_recovery_create", { player_id: player.id, verifier: byteaHex(new Uint8Array(verifier.match(/.{2}/g).map((x) => parseInt(x, 16)))) });
    return { result: { code } };
  }
  async recover(authUid, p) {
    const existing = await this.playerFor(authUid);
    if (existing) bad(409, "already_player", "This device already has a player. Forget it first if you want to restore a different one.");
    const code = normalizeCode(String(p.code ?? ""));
    if (code.length < 20) bad(400, "bad_code", "That does not look like a player code");
    await this.rateLimit(authUid, "recover", 5, 900, "Too many tries. Wait 15 minutes and try again.");
    const verifier = await sha256Hex(code);
    const r = await this.db.rpc("allin_recover", { auth_user_id: authUid, verifier: byteaHex(new Uint8Array(verifier.match(/.{2}/g).map((x) => parseInt(x, 16)))) });
    if (!r.ok) bad(403, "bad_code", "That player code is not valid any more");
    const pr = r.player;
    return { result: { player: { id: pr.id, name: pr.display_name, avatar: pr.avatar, isOwner: pr.is_owner }, codeRotated: true } };
  }
  async forget(player) {
    const seats = await this.db.select("table_members", { user_id: player.id, status: "active" });
    if (seats.length) bad(409, "seated", "Leave your table before forgetting this player on this device");
    await this.db.rpc("allin_unbind", { player_id: player.id });
    return { result: { ok: true } };
  }
  // ---------- tables ----------
  async withTable(tableId, receipt, fn) {
    if (!isUuid(tableId)) bad(400, "bad_table", "Unknown table");
    for (let attempt = 0; attempt < 4; attempt++) {
      const L = await loadTable(this.db, tableId);
      const approved = await this.db.select("reload_requests", { table_id: tableId, status: "approved" }, { order: "requested_at" });
      const ctx = { presence: presenceOf(L.members), credits: approved.map((r2) => ({ playerId: r2.user_id, amount: Number(r2.amount), id: r2.id })) };
      const before = structuredClone(L.t);
      const pre = tick(L.t, L.now, ctx);
      const out = fn(L, ctx);
      const effects = [...pre, ...out.effects];
      const r = await commitTable(this.db, { ...L, t: before }, L.t, effects, { ...out.extras ?? {}, receipt: receipt ?? void 0 }, approved);
      if (r.ok) return { result: out.result };
      if (r.duplicate && r.receipt) return { result: r.receipt.result, duplicate: { ...receipt, status: r.receipt.status, result: r.receipt.result } };
      if (!r.conflict) bad(500, "commit_failed", "Could not save that, please try again");
    }
    return bad(409, "busy", "The table changed, please try again");
  }
  seatFor(L, player) {
    const i = seatOf(L.t, player.id);
    if (i === -1) bad(403, "not_seated", "You are not seated at this table");
    return i;
  }
  requireHost(L, player) {
    if (L.t.hostPlayerId !== player.id) bad(403, "host_only", "Only the host can do that");
  }
  async createTable(player, receipt, p) {
    const raw = p.rules ?? {};
    const int = (v) => parseChipAmount(v) ?? NaN;
    const rules = validateRules({
      mode: raw.mode === "tournament" ? "tournament" : "cash",
      name: String(raw.name ?? ""),
      seats: int(raw.seats),
      sb: int(raw.sb),
      bb: int(raw.bb),
      ante: raw.ante === void 0 || raw.ante === "" ? 0 : int(raw.ante),
      straddle: !!raw.straddle,
      unit: int(raw.unit),
      levels: Array.isArray(raw.levels) ? raw.levels.map((L) => ({ sb: int(L.sb), bb: int(L.bb), ante: L.ante === void 0 || L.ante === "" ? 0 : int(L.ante), minutes: int(L.minutes) })) : []
    });
    const active2 = await this.db.select("table_members", { user_id: player.id, status: "active" });
    if (active2.length) bad(409, "already_seated", "You are already at a table. Leave it before hosting another.");
    const buyIn = rules.mode === "tournament" ? rules.unit : parseChipAmount(p.buyIn);
    if (buyIn === null || buyIn <= 0 || buyIn % rules.unit !== 0) bad(400, "bad_buyin", `Buy-in must be a positive multiple of ${rules.unit}`);
    const now = Number(await this.db.rpc("allin_now", {}));
    const id = crypto.randomUUID();
    const t = createTable(id, rules, player.id, now);
    const seat = seatPlayer(t, { playerId: player.id, name: player.name }, buyIn, now, null);
    for (let attempt = 0; attempt < 3; attempt++) {
      const invite = secureCode(8);
      const r = await commitTable(this.db, null, t, [], {
        receipt,
        create: { name: rules.name, host_id: player.id, invite_code: invite, config: rules, mode: rules.mode, seats: rules.seats },
        members: [{ user_id: player.id, role: "host", seat, status: "active" }],
        ledger: [{ user_id: player.id, kind: "buyin", amount: buyIn, source_id: `${id}:buyin:${player.id}:0`, hand_no: 0 }],
        participants: [{ user_id: player.id, name: player.name, added_delta: buyIn }]
      }).catch((e) => /duplicate key value.*invite_code/.test(e.message) ? null : Promise.reject(e));
      if (r === null) continue;
      if (r.duplicate) return { result: r.receipt.result };
      return { result: { tableId: id, inviteCode: invite } };
    }
    return bad(500, "create_failed", "Could not create the table");
  }
  async preview(player, authUid, p) {
    const code = String(p.code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 8) bad(400, "bad_code", "Enter the 8-character invite code");
    await this.rateLimit(authUid, "invite", 30, 600, "Too many invite attempts, wait a few minutes");
    const rows = await this.db.select("tables", { invite_code: code }, { limit: 1 });
    if (!rows.length) bad(404, "no_table", "No table with that code");
    const r = rows[0];
    const host = await this.db.select("profiles", { id: r.state?.hostPlayerId ?? r.host_id }, { limit: 1 });
    const occupied = (r.state?.seats ?? []).filter(Boolean).length;
    const member = await this.db.select("table_members", { table_id: r.id, user_id: player.id, status: "active" });
    return { result: { tableId: r.id, name: r.name, host: host[0]?.display_name ?? "Host", status: r.archived_at ? "closed" : r.status, mode: r.mode, rules: r.config, seats: r.seats, occupied, open: r.seats - occupied, isMember: member.length > 0 } };
  }
  async join(player, receipt, p) {
    const code = String(p.code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const rows = await this.db.select("tables", { invite_code: code }, { limit: 1 });
    if (!rows.length || rows[0].archived_at) bad(404, "no_table", "That invite is no longer open");
    const tableId = rows[0].id;
    const active2 = await this.db.select("table_members", { user_id: player.id, status: "active" });
    if (active2.some((a) => a.table_id === tableId)) return { result: { tableId, already: true } };
    if (active2.length) bad(409, "already_seated", "You are seated at another table. Leave it first.");
    const amount = parseChipAmount(p.amount);
    const r = await this.withTable(tableId, receipt, (L) => {
      const unit = L.t.rules.unit;
      const buyIn = L.t.rules.mode === "tournament" ? unit : amount;
      if (buyIn === null || buyIn <= 0 || buyIn % unit !== 0) bad(400, "bad_buyin", `Buy-in must be a positive multiple of ${unit}`);
      const seat = seatPlayer(L.t, { playerId: player.id, name: player.name }, buyIn, L.now, typeof p.seat === "number" ? p.seat : null);
      const episode = L.members.filter((m) => m.user_id === player.id).length;
      return {
        effects: [],
        result: { tableId, seat },
        extras: {
          members: [{ user_id: player.id, role: "player", seat, status: "active" }],
          ledger: [{ user_id: player.id, kind: "buyin", amount: buyIn, source_id: `${tableId}:buyin:${player.id}:${L.t.handNo}:${L.row.version}:${episode}`, hand_no: L.t.handNo }],
          participants: [{ user_id: player.id, name: player.name, added_delta: buyIn, rejoined: true }],
          touch: player.id
        }
      };
    });
    return { result: r.result };
  }
  async start(player, receipt, tableId) {
    const r = await this.withTable(tableId, receipt, (L, ctx) => {
      this.requireHost(L, player);
      if (L.t.status === "running") return { effects: [], result: { already: true } };
      const e = eligibleToStart(L.t);
      if (!e.ok) bad(409, "not_enough_players", e.reason);
      const effects = startTable(L.t, L.now, ctx);
      return { effects, result: { ok: true }, extras: { touch: player.id } };
    });
    return { result: r.result };
  }
  async game(player, receipt, tableId, type, p) {
    const r = await this.withTable(tableId, receipt, (L, ctx) => {
      const t = L.t;
      const now = L.now;
      if (t.error) bad(409, "table_error", "This table stopped after a problem. Please tell the host.");
      const seat = this.seatFor(L, player);
      let effects = [];
      switch (type) {
        case "choose":
          effects = chooseVariant(t, seat, String(p.variant), now, ctx);
          break;
        case "straddle":
          effects = respondStraddle(t, seat, !!p.accept, now, ctx);
          break;
        case "act": {
          const a = String(p.action);
          if (a === "raise") {
            const to = parseChipAmount(p.raiseTo);
            if (to === null) bad(400, "bad_amount", "Enter a whole number of chips");
            effects = act(t, seat, { type: "raise", raiseTo: to }, now, ctx);
          } else if (a === "fold" || a === "check" || a === "call") effects = act(t, seat, { type: a }, now, ctx);
          else bad(400, "bad_action", "Unknown action");
          break;
        }
        case "propose":
          effects = propose(t, seat, p.runs === 2 ? 2 : 1, now, ctx);
          break;
        case "vote":
          effects = respondVote(t, seat, String(p.choice), now, ctx);
          break;
        case "reveal": {
          const what = p.what === "all" || p.what === "muck" ? p.what : Array.isArray(p.indices) ? p.indices.map((x) => Number(x)) : bad(400, "bad_reveal", "Nothing to reveal");
          effects = reveal(t, seat, what, now, ctx);
          break;
        }
        case "sitout":
          effects = tick(t, now, ctx);
          requestSitOut(t, player.id, now);
          break;
        case "return":
          effects = tick(t, now, ctx);
          requestReturn(t, player.id, !!p.post, now);
          effects.push(...tick(t, now, ctx));
          break;
        case "post_pref":
          setPostToPlay(t, player.id, !!p.post);
          break;
        case "straddle_pref":
          setStraddlePref(t, player.id, !!p.pref);
          break;
        case "leave":
          effects = requestLeave(t, player.id, "leave", now, ctx);
          break;
        case "cancel_leave":
          cancelLeave(t, player.id);
          break;
        case "remove": {
          this.requireHost(L, player);
          const target = String(p.playerId);
          if (target === player.id) bad(400, "self", "Use Leave to leave your own table");
          if (seatOf(t, target) === -1) bad(404, "not_seated", "That player is not here");
          effects = requestLeave(t, target, "removed", now, ctx);
          const extras = { touch: player.id };
          if (t.rules.mode === "tournament") extras.members = [{ user_id: target, status: "removed", seat: null }];
          return { effects, result: { ok: true }, extras };
        }
        default:
          bad(400, "bad_type", "Unknown command");
      }
      return { effects, result: { ok: true, version: t.version + 1 }, extras: { touch: player.id } };
    });
    return { result: r.result };
  }
  async reload(player, receipt, tableId, type, p) {
    const r = await this.withTable(tableId, receipt, (L) => {
      const t = L.t;
      if (t.rules.mode !== "cash") bad(400, "not_cash", "Tournament stacks cannot be reloaded");
      const seat = this.seatFor(L, player);
      if (type === "reload_request") {
        const amount = parseChipAmount(p.amount);
        if (amount === null || amount <= 0 || amount % t.rules.unit !== 0) bad(400, "bad_amount", `Reload must be a positive multiple of ${t.rules.unit}`);
        if (t.seats[seat].leaving) bad(409, "leaving", "You are leaving this table");
        const id2 = isUuid(p.requestId) ? p.requestId : crypto.randomUUID();
        const extras = { touch: player.id };
        if (t.hostPlayerId === player.id) {
          extras.reloads = [{ id: id2, user_id: player.id, amount, insert: true }, { id: id2, status: "approved", from_status: "requested", decided_by: player.id, host_epoch: t.hostEpoch }];
        } else extras.reloads = [{ id: id2, user_id: player.id, amount, insert: true }];
        return { effects: [], result: { requestId: id2, status: t.hostPlayerId === player.id ? "approved" : "requested" }, extras };
      }
      if (type === "reload_cancel") {
        const id2 = String(p.requestId);
        return { effects: [], result: { ok: true }, extras: { reloads: [{ id: id2, status: "cancelled", from_status: "requested" }], touch: player.id } };
      }
      this.requireHost(L, player);
      const id = String(p.requestId);
      return { effects: [], result: { ok: true }, extras: { reloads: [{ id, status: p.approve ? "approved" : "rejected", from_status: "requested", decided_by: player.id, host_epoch: t.hostEpoch }], touch: player.id } };
    });
    return { result: r.result };
  }
  async chat(player, receipt, tableId, p, authUid) {
    const body = String(p.body ?? "").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim();
    if (!body) bad(400, "empty", "Write something first");
    if ([...body].length > RULES.chatMax) bad(400, "too_long", "Keep it under 500 characters");
    await this.rateLimit(authUid, "chat", 20, 30, "Slow down a little");
    const r = await this.withTable(tableId, receipt, (L) => {
      this.seatFor(L, player);
      return { effects: [], result: { ok: true }, extras: { chat: [{ user_id: player.id, body }], touch: player.id } };
    });
    return { result: r.result };
  }
  async transferHost(player, receipt, tableId, p) {
    const r = await this.withTable(tableId, receipt, (L) => {
      this.requireHost(L, player);
      const target = String(p.playerId);
      if (seatOf(L.t, target) === -1) bad(404, "not_seated", "That player is not here");
      transferHost(L.t, target, L.now);
      return { effects: [], result: { ok: true }, extras: { touch: player.id, members: [{ user_id: target, role: "host" }, { user_id: player.id, role: "player" }] } };
    });
    return { result: r.result };
  }
  /** Timer job: resolve due deadlines for one table. Idempotent. */
  async runTable(tableId) {
    try {
      const r = await this.withTable(tableId, null, () => ({ effects: [], result: null }));
      void r;
      return { ok: true };
    } catch (e) {
      if (e instanceof ApiError && (e.code === "archived" || e.code === "not_found")) return { ok: true };
      throw e;
    }
  }
  // unused import guard
  static _types() {
    return [isChipInt, null];
  }
};

// server/src/app.ts
var TABLE_CMDS = /* @__PURE__ */ new Set(["start", "choose", "straddle", "act", "propose", "vote", "reveal", "sitout", "return", "post_pref", "straddle_pref", "leave", "cancel_leave", "remove", "reload_request", "reload_cancel", "reload_decide", "chat", "transfer_host"]);
var App = class {
  constructor(db, auth, env) {
    this.db = db;
    this.auth = auth;
    this.env = env;
    this.handlers = new Handlers(db, env);
  }
  db;
  auth;
  env;
  handlers;
  cors() {
    return {
      "Access-Control-Allow-Origin": this.env.corsOrigin ?? "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-allin-job",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin"
    };
  }
  async handle(req) {
    const h = this.cors();
    if (req.method === "OPTIONS") return { status: 204, body: null, headers: h };
    if (req.method !== "POST") return { status: 405, body: { ok: false, error: { code: "method", message: "POST only" } }, headers: h };
    const path = req.path.replace(/\/+$/, "");
    const correlationId = crypto.randomUUID().slice(0, 8);
    try {
      if (path.endsWith("/jobs")) return { status: 200, body: await this.jobs(req), headers: h };
      if (path.endsWith("/cmd")) return { status: 200, body: await this.cmd(req), headers: h };
      return { status: 404, body: { ok: false, error: { code: "not_found", message: "Unknown endpoint" } }, headers: h };
    } catch (e) {
      if (e instanceof ApiError) return { status: e.status, body: { ok: false, error: { code: e.code, message: e.message, detail: e.detail ?? null }, correlationId }, headers: h };
      if (e instanceof EngineError) return { status: 409, body: { ok: false, error: { code: e.code, message: e.message, detail: null }, correlationId }, headers: h };
      console.error("[allin]", correlationId, e.name, e.message);
      return { status: 500, body: { ok: false, error: { code: "server_error", message: "Something went wrong on our side. Please try again." }, correlationId }, headers: h };
    }
  }
  jobKeyCache = null;
  async jobKey() {
    if (this.env.jobKey) return this.env.jobKey;
    if (this.jobKeyCache && Date.now() - this.jobKeyCache.at < 6e4) return this.jobKeyCache.value;
    const rows = await this.db.select("app_settings", { key: "job_key" }, { limit: 1 });
    const value = rows[0]?.value ?? "";
    this.jobKeyCache = { value, at: Date.now() };
    return value;
  }
  async jobs(req) {
    const key = req.headers["x-allin-job"] ?? "";
    const expected = await this.jobKey();
    if (!expected || !constantTimeEqual(new TextEncoder().encode(key), new TextEncoder().encode(expected))) throw new ApiError(403, "forbidden", "Not allowed");
    const body = req.body ?? {};
    const ids = Array.isArray(body.tableIds) && body.tableIds.every(isUuid) ? body.tableIds : await this.db.rpc("allin_claim_due", { limit: body.limit ?? 10 });
    const results = {};
    for (const id of ids) {
      try {
        await this.handlers.runTable(id);
        results[id] = "ok";
      } catch (e) {
        results[id] = e.message;
        console.error("[allin job]", id, e.message);
      }
    }
    return { ok: true, ran: ids.length, results };
  }
  async cmd(req) {
    const { authUid } = await this.auth.verify(req.headers["authorization"] ?? null);
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const type = String(body.type ?? "");
    const actionId = body.actionId;
    const tableId = body.tableId;
    const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
    if (!isUuid(actionId)) throw new ApiError(400, "bad_action_id", "actionId must be a UUID");
    const requestHash = await sha256Hex(canonicalJson({ type, tableId: tableId ?? null, payload }));
    const H = this.handlers;
    if (type === "me") {
      const player2 = await H.playerFor(authUid);
      return { ok: true, result: { player: player2, authUid } };
    }
    if (type === "admit") return this.finish(await H.admit(authUid, payload));
    if (type === "recover") return this.finish(await H.recover(authUid, payload));
    const player = await H.playerFor(authUid);
    if (!player) throw new ApiError(403, "not_admitted", "Enter your nickname and the group password first");
    const receipt = { user_id: player.id, action_id: actionId, request_hash: requestHash, status: 200, result: null };
    const prior = await this.db.select("command_receipts", { user_id: player.id, action_id: actionId }, { limit: 1 });
    if (prior.length) {
      if (prior[0].request_hash !== requestHash) throw new ApiError(409, "action_conflict", "That action id was already used for a different command");
      return { ok: true, result: prior[0].result, replayed: true };
    }
    let out = null;
    if (TABLE_CMDS.has(type)) {
      if (!isUuid(tableId)) throw new ApiError(400, "bad_table", "tableId required");
      if (type === "start") out = await H.start(player, receipt, tableId);
      else if (type === "reload_request" || type === "reload_cancel" || type === "reload_decide") out = await H.reload(player, receipt, tableId, type, payload);
      else if (type === "chat") out = await H.chat(player, receipt, tableId, payload, authUid);
      else if (type === "transfer_host") out = await H.transferHost(player, receipt, tableId, payload);
      else out = await H.game(player, receipt, tableId, type, payload);
      return { ok: true, result: out.result };
    }
    switch (type) {
      case "create_table":
        out = await H.createTable(player, receipt, payload);
        break;
      case "join":
        out = await H.join(player, receipt, payload);
        break;
      case "preview":
        out = await H.preview(player, authUid, payload);
        break;
      case "profile":
        out = await H.updateProfile(player, payload);
        break;
      case "recovery_create":
        out = await H.createRecoveryCode(player);
        break;
      case "rotate_password":
        out = await H.rotateGroupPassword(player, authUid, payload);
        break;
      case "forget":
        out = await H.forget(player);
        break;
      default:
        throw new ApiError(400, "bad_type", "Unknown command");
    }
    if (!["preview"].includes(type)) await this.db.rpc("allin_receipt", { ...receipt, result: out.result });
    return { ok: true, result: out.result };
  }
  finish(r) {
    return { ok: true, result: r.result };
  }
};

// server/src/db-rest.ts
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

// server/src/db.ts
var DbError = class extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = "DbError";
  }
  code;
};

// server/src/db-rest.ts
var RestDb = class {
  client;
  constructor(url, serviceKey) {
    this.client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  async rpc(name, payload) {
    const { data, error } = await this.client.rpc(name, { p: payload });
    if (error) throw new DbError(error.message, error.code);
    return data;
  }
  async select(table, where, opts = {}) {
    let q = this.client.from(table).select("*");
    for (const [k, v] of Object.entries(where)) q = Array.isArray(v) ? q.in(k, v) : v === null ? q.is(k, null) : q.eq(k, v);
    if (opts.order) q = q.order(opts.order, { ascending: opts.asc !== false });
    if (opts.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) throw new DbError(error.message, error.code);
    return data ?? [];
  }
};

// server/src/auth.ts
import { createClient as createClient2 } from "npm:@supabase/supabase-js@2.118.0";
var SupabaseAuthenticator = class {
  client;
  constructor(url, serviceKey) {
    this.client = createClient2(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  async verify(authorization) {
    const token = (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token) throw new ApiError(401, "unauthenticated", "Sign-in required");
    const { data, error } = await this.client.auth.getUser(token);
    if (error || !data.user) throw new ApiError(401, "unauthenticated", "Session expired, please reopen the app");
    return { authUid: data.user.id };
  }
};
var DevAuthenticator = class {
  async verify(authorization) {
    const token = (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!/^dev:[0-9a-f-]{36}$/.test(token)) throw new ApiError(401, "unauthenticated", "Sign-in required");
    return { authUid: token.slice(4) };
  }
};
export {
  App,
  DevAuthenticator,
  RestDb,
  SupabaseAuthenticator
};
