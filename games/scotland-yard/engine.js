/**
 * Scotland Yard · القاهرة — pure rules engine (no DOM / network).
 * ES module. Host-authoritative; project via projectPublicState for viewers.
 */

export const TICKETS = Object.freeze({
  taxi: 'taxi',
  bus: 'bus',
  metro: 'metro',
  black: 'black',
});

export const DETECTIVE_COLORS = Object.freeze(['blue', 'red', 'green', 'purple']);

export const REVEAL_ROUNDS = Object.freeze([3, 8, 13]);
export const MAX_ROUND = 14;

export const TRANSPORT_MODES = Object.freeze(['taxi', 'bus', 'metro', 'river']);
export const DETECTIVE_TICKETS = Object.freeze(['taxi', 'bus', 'metro']);

const DETECTIVE_START_TICKETS = Object.freeze({ taxi: 10, bus: 6, metro: 3 });
const MRX_START_SPECIAL = Object.freeze({ black: 5, double: 2 });

/** @returns {boolean} */
export function isRevealRound(round, revealRounds = REVEAL_ROUNDS) {
  return revealRounds.includes(round);
}

/** Deep-ish clone of game state (plain data). */
export function cloneState(state) {
  return {
    phase: state.phase,
    round: state.round,
    turn: state.turn,
    revealRounds: state.revealRounds ? [...state.revealRounds] : [...REVEAL_ROUNDS],
    mrX: {
      pos: state.mrX.pos,
      tickets: { ...state.mrX.tickets },
      log: state.mrX.log.map((e) => ({ ...e })),
      lastKnownPos: state.mrX.lastKnownPos,
    },
    detectives: Object.fromEntries(
      DETECTIVE_COLORS.map((c) => {
        const d = state.detectives[c];
        return [
          c,
          {
            pos: d.pos,
            tickets: { ...d.tickets },
            controller: d.controller,
            ...(d.playerId != null ? { playerId: d.playerId } : {}),
          },
        ];
      }),
    ),
    winner: state.winner,
    mapId: state.mapId,
  };
}

/**
 * Build adjacency: adj[id][mode] = sorted unique neighbor ids.
 * @param {{ edges: Array<{a:number,b:number,mode:string}> }} map
 */
export function buildAdjacency(map) {
  const adj = Object.create(null);
  const ensure = (id) => {
    if (!adj[id]) {
      adj[id] = Object.create(null);
      for (const m of TRANSPORT_MODES) adj[id][m] = [];
    }
    return adj[id];
  };

  for (const e of map.edges || []) {
    const { a, b, mode } = e;
    if (a == null || b == null || !mode) continue;
    const na = ensure(a);
    const nb = ensure(b);
    if (!na[mode]) na[mode] = [];
    if (!nb[mode]) nb[mode] = [];
    if (!na[mode].includes(b)) na[mode].push(b);
    if (!nb[mode].includes(a)) nb[mode].push(a);
  }

  for (const id of Object.keys(adj)) {
    for (const mode of Object.keys(adj[id])) {
      adj[id][mode].sort((x, y) => x - y);
    }
  }
  return adj;
}

/** Memo-friendly: prefer map._adj if present, else build. */
export function getAdjacency(map) {
  if (map && map._adj) return map._adj;
  return buildAdjacency(map);
}

function stationIds(map) {
  if (map.stations && map.stations.length) {
    return map.stations.map((s) => s.id);
  }
  const ids = new Set();
  for (const e of map.edges || []) {
    ids.add(e.a);
    ids.add(e.b);
  }
  return [...ids].sort((a, b) => a - b);
}

function pickRandom(arr, rng) {
  if (!arr.length) throw new Error('pickRandom: empty array');
  const i = Math.floor(rng() * arr.length);
  return arr[Math.min(i, arr.length - 1)];
}

/** Simple BFS hop distance (any transport mode, undirected). */
export function graphDistance(map, from, to) {
  if (from === to) return 0;
  const adj = getAdjacency(map);
  const q = [from];
  const dist = Object.create(null);
  dist[from] = 0;
  while (q.length) {
    const cur = q.shift();
    const node = adj[cur];
    if (!node) continue;
    for (const mode of TRANSPORT_MODES) {
      for (const n of node[mode] || []) {
        if (dist[n] != null) continue;
        dist[n] = dist[cur] + 1;
        if (n === to) return dist[n];
        q.push(n);
      }
    }
  }
  return Infinity;
}

function detectivePositions(state, exceptColor = null) {
  const set = new Set();
  for (const c of DETECTIVE_COLORS) {
    if (exceptColor && c === exceptColor) continue;
    const d = state.detectives[c];
    if (d) set.add(d.pos);
  }
  return set;
}

/**
 * Neighbors reachable from `from` with a given ticket type.
 * black → any mode including river; taxi/bus/metro → that mode only.
 */
export function neighborsForTicket(map, from, ticket) {
  const adj = getAdjacency(map);
  const node = adj[from];
  if (!node) return [];
  const out = new Set();
  if (ticket === TICKETS.black) {
    for (const mode of TRANSPORT_MODES) {
      for (const n of node[mode] || []) out.add(n);
    }
  } else if (ticket === TICKETS.taxi || ticket === TICKETS.bus || ticket === TICKETS.metro) {
    for (const n of node[ticket] || []) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Legal destination ids for actor with a specific ticket.
 * actor: 'x' | detective color
 * @returns {number[]}
 */
export function legalMoves(state, map, actor, ticket) {
  if (state.phase !== 'playing') return [];
  if (actor === 'x') {
    if (ticket === TICKETS.black && (state.mrX.tickets.black || 0) <= 0) return [];
    if (
      ticket !== TICKETS.black &&
      ticket !== TICKETS.taxi &&
      ticket !== TICKETS.bus &&
      ticket !== TICKETS.metro
    ) {
      return [];
    }
    const blocked = detectivePositions(state);
    return neighborsForTicket(map, state.mrX.pos, ticket).filter((n) => !blocked.has(n));
  }

  if (!DETECTIVE_COLORS.includes(actor)) return [];
  const det = state.detectives[actor];
  if (!det) return [];
  if (!DETECTIVE_TICKETS.includes(ticket)) return [];
  if ((det.tickets[ticket] || 0) <= 0) return [];
  const blocked = detectivePositions(state, actor);
  return neighborsForTicket(map, det.pos, ticket).filter((n) => !blocked.has(n));
}

/** Any legal destination for actor across tickets they can use. */
export function hasAnyLegalMove(state, map, actor) {
  if (actor === 'x') {
    for (const t of [TICKETS.taxi, TICKETS.bus, TICKETS.metro, TICKETS.black]) {
      if (legalMoves(state, map, 'x', t).length) return true;
    }
    return false;
  }
  const det = state.detectives[actor];
  if (!det) return false;
  for (const t of DETECTIVE_TICKETS) {
    if (legalMoves(state, map, actor, t).length) return true;
  }
  return false;
}

/**
 * Can Mr X perform a double move this turn (tokens + not round 14)?
 * Does not fully validate two legs.
 */
export function canDouble(state) {
  return (
    state.phase === 'playing' &&
    state.turn === 'x' &&
    state.round < MAX_ROUND &&
    (state.mrX.tickets.double || 0) > 0
  );
}

function assertPlayingMrX(state) {
  if (state.phase !== 'playing') throw new Error('game not playing');
  if (state.turn !== 'x') throw new Error("not Mr X's turn");
}

function assertPlayingDetective(state, color) {
  if (state.phase !== 'playing') throw new Error('game not playing');
  if (state.turn !== color) throw new Error(`not ${color}'s turn (turn=${state.turn})`);
  if (!DETECTIVE_COLORS.includes(color)) throw new Error(`invalid detective ${color}`);
}

function spendMrXTicket(tickets, ticket) {
  const next = { ...tickets };
  if (ticket === TICKETS.black) {
    if ((next.black || 0) <= 0) throw new Error('no black tickets');
    next.black -= 1;
  }
  // taxi/bus/metro unlimited for Mr X
  return next;
}

function appendMrXLog(log, round, ticket, posOrNull) {
  const entry = { round, ticket };
  if (posOrNull != null) entry.pos = posOrNull;
  return [...log, entry];
}

/**
 * Apply a single Mr X move (one leg / full single-move action).
 * @returns {object} new state
 */
export function applyMrXMove(state, map, { ticket, to }) {
  assertPlayingMrX(state);
  if (to == null) throw new Error('missing destination');
  const legal = legalMoves(state, map, 'x', ticket);
  if (!legal.includes(to)) throw new Error(`illegal Mr X move: ${ticket} → ${to}`);

  const next = cloneState(state);
  next.mrX.tickets = spendMrXTicket(next.mrX.tickets, ticket);
  next.mrX.pos = to;

  const reveal = isRevealRound(next.round, next.revealRounds);
  next.mrX.log = appendMrXLog(next.mrX.log, next.round, ticket, reveal ? to : null);
  if (reveal) next.mrX.lastKnownPos = to;

  // Detectives act next (skip stranded)
  next.turn = 'blue';
  return advancePastStrandedDetectives(next, map);
}

/**
 * Apply Mr X double move: two legs, same round, consumes 1 double + tickets per leg.
 * Reveal (if any) only after second leg (final station).
 * Illegal on round 14.
 */
export function applyMrXDouble(state, map, { legs }) {
  assertPlayingMrX(state);
  if (state.round >= MAX_ROUND) throw new Error('double illegal on final round');
  if ((state.mrX.tickets.double || 0) <= 0) throw new Error('no double tokens');
  if (!Array.isArray(legs) || legs.length !== 2) throw new Error('double requires exactly 2 legs');

  const [leg1, leg2] = legs;
  if (!leg1 || !leg2) throw new Error('invalid legs');

  // Validate leg 1 from current pos
  const legal1 = legalMoves(state, map, 'x', leg1.ticket);
  if (!legal1.includes(leg1.to)) throw new Error(`illegal double leg1: ${leg1.ticket} → ${leg1.to}`);

  // Temporary state after leg 1 for leg 2 validation (detectives still block)
  const mid = cloneState(state);
  mid.mrX.tickets = spendMrXTicket(mid.mrX.tickets, leg1.ticket);
  mid.mrX.pos = leg1.to;

  const legal2 = legalMoves(mid, map, 'x', leg2.ticket);
  if (!legal2.includes(leg2.to)) throw new Error(`illegal double leg2: ${leg2.ticket} → ${leg2.to}`);

  const next = cloneState(state);
  next.mrX.tickets = spendMrXTicket(next.mrX.tickets, leg1.ticket);
  next.mrX.tickets = spendMrXTicket(next.mrX.tickets, leg2.ticket);
  next.mrX.tickets.double = (next.mrX.tickets.double || 0) - 1;
  next.mrX.pos = leg2.to;

  const reveal = isRevealRound(next.round, next.revealRounds);
  // Intermediate leg never includes pos; final leg gets pos only on reveal rounds
  next.mrX.log = appendMrXLog(next.mrX.log, next.round, leg1.ticket, null);
  next.mrX.log = appendMrXLog(next.mrX.log, next.round, leg2.ticket, reveal ? leg2.to : null);
  if (reveal) next.mrX.lastKnownPos = leg2.to;

  next.turn = 'blue';
  return advancePastStrandedDetectives(next, map);
}

/**
 * Apply detective move. Capture if landing on mrX.pos.
 * After purple (and any skips): end game on round 14 or increment round → Mr X.
 */
export function applyDetectiveMove(state, map, color, { ticket, to }) {
  assertPlayingDetective(state, color);
  if (to == null) throw new Error('missing destination');
  const legal = legalMoves(state, map, color, ticket);
  if (!legal.includes(to)) throw new Error(`illegal ${color} move: ${ticket} → ${to}`);

  const next = cloneState(state);
  const det = next.detectives[color];
  if ((det.tickets[ticket] || 0) <= 0) throw new Error(`no ${ticket} tickets for ${color}`);
  det.tickets[ticket] -= 1;
  det.pos = to;

  // Capture
  if (to === next.mrX.pos) {
    next.phase = 'ended';
    next.winner = 'detectives';
    next.turn = color;
    return next;
  }

  return advanceAfterDetectiveMove(next, map, color);
}

/** Skip a stranded detective (no legal moves). Call when it is their turn. */
export function skipDetective(state, map, color) {
  assertPlayingDetective(state, color);
  if (hasAnyLegalMove(state, map, color)) {
    throw new Error(`${color} has legal moves; cannot skip`);
  }
  const next = cloneState(state);
  return advanceAfterDetectiveMove(next, map, color);
}

function nextDetectiveColor(color) {
  const i = DETECTIVE_COLORS.indexOf(color);
  if (i < 0 || i >= DETECTIVE_COLORS.length - 1) return null;
  return DETECTIVE_COLORS[i + 1];
}

/**
 * After a detective has acted (or skipped), advance turn / round / win.
 */
function advanceAfterDetectiveMove(state, map, colorJustMoved) {
  const nextColor = nextDetectiveColor(colorJustMoved);
  if (nextColor) {
    state.turn = nextColor;
    return advancePastStrandedDetectives(state, map);
  }
  // All detectives done for this round
  return finishDetectiveSequence(state, map);
}

/** Skip detectives from current turn while they have no legal moves. */
function advancePastStrandedDetectives(state, map) {
  if (state.phase !== 'playing') return state;
  let guard = 0;
  while (DETECTIVE_COLORS.includes(state.turn) && guard++ < 8) {
    if (hasAnyLegalMove(state, map, state.turn)) return state;
    const cur = state.turn;
    const nxt = nextDetectiveColor(cur);
    if (nxt) {
      state.turn = nxt;
      continue;
    }
    return finishDetectiveSequence(state, map);
  }
  return state;
}

function finishDetectiveSequence(state, map) {
  if (state.phase !== 'playing') return state;
  if (state.round >= MAX_ROUND) {
    state.phase = 'ended';
    state.winner = 'x';
    state.turn = 'x';
    return state;
  }
  state.round += 1;
  state.turn = 'x';
  // Trapped Mr X at start of his turn
  if (!hasAnyLegalMove(state, map, 'x')) {
    state.phase = 'ended';
    state.winner = 'detectives';
  }
  return state;
}

/**
 * If it is Mr X's turn and he is trapped, end with detectives win.
 * Safe no-op otherwise. Useful for host before soliciting a move.
 */
export function resolveIfMrXTrapped(state, map) {
  if (state.phase !== 'playing' || state.turn !== 'x') return state;
  if (hasAnyLegalMove(state, map, 'x')) return state;
  const next = cloneState(state);
  next.phase = 'ended';
  next.winner = 'detectives';
  return next;
}

/**
 * Deal starts from map pools (disjoint). Optional min graph distance resampling.
 */
export function createInitialState(map, rng = Math.random, opts = {}) {
  const minDist = opts.minStartDistance ?? 2;
  const maxAttempts = opts.maxDealAttempts ?? 80;
  const startsX = [...(map.startsMrX || [])];
  const startsD = [...(map.startsDetectives || [])];
  if (startsX.length < 1) throw new Error('map.startsMrX empty');
  if (startsD.length < DETECTIVE_COLORS.length) {
    throw new Error('map.startsDetectives needs at least 4 positions');
  }

  let xPos;
  let dPositions;
  let ok = false;

  // Prebuild adj for distance / legal-move checks during deal
  if (map && !map._adj) {
    map._adj = buildAdjacency(map);
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Draw Mr X
    xPos = pickRandom(startsX, rng);
    // Draw 4 distinct detective starts ≠ xPos
    const available = [...new Set(startsD)].filter((id) => id !== xPos);
    if (available.length < 4) throw new Error('not enough detective starts disjoint from Mr X');
    dPositions = shufflePick(available, 4, rng);

    // Soft distance constraints
    let good = true;
    for (const dp of dPositions) {
      if (graphDistance(map, xPos, dp) < minDist) {
        good = false;
        break;
      }
    }
    if (good && opts.minDetectiveDistance) {
      for (let i = 0; i < dPositions.length; i++) {
        for (let j = i + 1; j < dPositions.length; j++) {
          if (graphDistance(map, dPositions[i], dPositions[j]) < opts.minDetectiveDistance) {
            good = false;
            break;
          }
        }
        if (!good) break;
      }
    }

    // Mr X must have at least one legal escape at deal time
    if (good) {
      const trial = bareState(map, xPos, dPositions, opts);
      if (!hasAnyLegalMove(trial, map, 'x')) good = false;
    }

    if (good) {
      ok = true;
      break;
    }
  }

  if (!ok) {
    // Fallback: any disjoint deal where Mr X is not trapped (ignore minDist)
    ok = false;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      xPos = pickRandom(startsX, rng);
      const pool = [...new Set(startsD)].filter((id) => id !== xPos);
      if (pool.length < 4) throw new Error('cannot deal starts');
      dPositions = shufflePick(pool, 4, rng);
      const trial = bareState(map, xPos, dPositions, opts);
      if (hasAnyLegalMove(trial, map, 'x')) {
        ok = true;
        break;
      }
    }
    if (!ok) throw new Error('could not deal starts with a legal Mr X move');
  }

  return bareState(map, xPos, dPositions, opts);
}

function bareState(map, xPos, dPositions, opts = {}) {
  const detectives = {};
  DETECTIVE_COLORS.forEach((color, i) => {
    detectives[color] = {
      pos: dPositions[i],
      tickets: { ...DETECTIVE_START_TICKETS },
      controller: opts.controllers?.[color] || 'ai',
    };
  });
  return {
    phase: 'playing',
    round: 1,
    turn: 'x',
    revealRounds: [...REVEAL_ROUNDS],
    mrX: {
      pos: xPos,
      tickets: { ...MRX_START_SPECIAL },
      log: [],
      lastKnownPos: null,
    },
    detectives,
    winner: null,
    mapId: map.id || 'unknown',
  };
}

function shufflePick(arr, n, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

/**
 * Role-filtered view for UI / network.
 * viewer: 'x' | detective color | 'spectator'
 */
export function projectPublicState(state, viewer) {
  const isMrX = viewer === 'x';
  const base = {
    phase: state.phase,
    round: state.round,
    turn: state.turn,
    revealRounds: [...(state.revealRounds || REVEAL_ROUNDS)],
    winner: state.winner,
    mapId: state.mapId,
    detectives: Object.fromEntries(
      DETECTIVE_COLORS.map((c) => {
        const d = state.detectives[c];
        return [
          c,
          {
            pos: d.pos,
            tickets: { ...d.tickets },
            controller: d.controller,
            ...(d.playerId != null ? { playerId: d.playerId } : {}),
          },
        ];
      }),
    ),
    mrX: {
      // Black/double counts are private to Mr X (infer doubles from paired log entries).
      tickets: isMrX
        ? { black: state.mrX.tickets.black, double: state.mrX.tickets.double }
        : {},
      log: state.mrX.log.map((e) => {
        if (isMrX) return { ...e };
        // Only include pos when that move was a reveal (entry has pos)
        const out = { round: e.round, ticket: e.ticket };
        if (e.pos != null) out.pos = e.pos;
        return out;
      }),
      lastKnownPos: state.mrX.lastKnownPos,
    },
  };

  if (isMrX) {
    base.mrX.pos = state.mrX.pos;
  } else {
    // Never expose live pos to detectives/spectators (ghost via lastKnownPos / log).
    // UI can use winner + detective pos for capture animation.
    base.mrX.pos = undefined;
  }

  return base;
}

/**
 * Constraint-propagated set of stations Mr X could occupy from public log + map.
 * Used by detective AI / hints.
 * @returns {number[]} sorted unique ids
 */
export function possibleMrXPositions(state, map) {
  const starts = map.startsMrX && map.startsMrX.length ? [...map.startsMrX] : stationIds(map);
  let possible = new Set(starts);

  // If we have a lastKnownPos and log has a reveal entry with that pos, we can
  // restart the set at each reveal for accuracy.
  for (const entry of state.mrX.log) {
    const next = new Set();
    for (const p of possible) {
      for (const n of neighborsForTicket(map, p, entry.ticket)) {
        next.add(n);
      }
    }
    if (entry.pos != null) {
      // Reveal anchors the set
      possible = new Set([entry.pos]);
    } else {
      possible = next;
    }
  }

  // Mr X cannot sit on detective stations
  const blocked = detectivePositions(state);
  for (const b of blocked) possible.delete(b);

  return [...possible].sort((a, b) => a - b);
}


// ---------------------------------------------------------------------------
// Self-tests (embedded compact fixture map)
// ---------------------------------------------------------------------------

/**
 * Compact undirected test map (~8 nodes) so 4 detectives leave Mr X an escape.
 *
 *   1 --taxi-- 2 --bus-- 3 --metro-- 7
 *   |          |         |
 *  taxi       taxi      bus
 *   |          |         |
 *   4 --taxi-- 5 --river-- 6
 *              |
 *             taxi
 *              |
 *              8
 */
export function makeTestMap() {
  return {
    id: 'test-8',
    stations: [1, 2, 3, 4, 5, 6, 7, 8].map((id) => ({
      id,
      nameAr: String(id),
      x: id * 10,
      y: 10,
      modes: ['taxi', 'bus', 'metro'],
    })),
    edges: [
      { a: 1, b: 2, mode: 'taxi' },
      { a: 2, b: 3, mode: 'bus' },
      { a: 1, b: 4, mode: 'taxi' },
      { a: 2, b: 5, mode: 'taxi' },
      { a: 3, b: 6, mode: 'metro' },
      { a: 3, b: 7, mode: 'metro' },
      { a: 4, b: 5, mode: 'taxi' },
      { a: 5, b: 6, mode: 'river' },
      { a: 5, b: 3, mode: 'bus' },
      { a: 4, b: 2, mode: 'bus' },
      { a: 5, b: 8, mode: 'taxi' },
      { a: 6, b: 8, mode: 'taxi' },
    ],
    startsMrX: [1, 6],
    // 5 candidates → deal leaves one free so Mr X keeps an escape
    startsDetectives: [2, 3, 4, 7, 8],
  };
}

/** Fixed layout helper for unit tests (does not validate deal distance). */
export function makeFixtureState(map, { x, detectives, round = 1, turn = 'x' } = {}) {
  const dpos = detectives || { blue: 2, red: 3, green: 4, purple: 8 };
  const s = bareState(
    map,
    x ?? 1,
    DETECTIVE_COLORS.map((c) => dpos[c]),
    {},
  );
  s.round = round;
  s.turn = turn;
  return s;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

/**
 * Run embedded self-tests. Returns { ok, results: [{name, pass, error?}] }.
 */
export function runEngineSelfTests() {
  const results = [];
  const test = (name, fn) => {
    try {
      fn();
      results.push({ name, pass: true });
    } catch (e) {
      results.push({ name, pass: false, error: e && e.message ? e.message : String(e) });
    }
  };

  const map = makeTestMap();
  let n = 0;
  const rng = () => {
    n += 1;
    return (n * 0.17) % 1;
  };

  test('buildAdjacency undirected + modes', () => {
    const adj = buildAdjacency(map);
    assert(adj[1].taxi.includes(2), '1-2 taxi');
    assert(adj[2].taxi.includes(1), '2-1 taxi');
    assert(adj[5].river.includes(6), '5-6 river');
    assert(adj[6].metro.includes(3), '6-3 metro');
    assert(adj[3].metro.includes(7), '3-7 metro');
  });

  test('createInitialState deals disjoint starts', () => {
    const s = createInitialState(map, rng, { minStartDistance: 1 });
    assert(s.phase === 'playing', 'playing');
    assert(s.round === 1 && s.turn === 'x', 'round/turn');
    assert(s.mrX.tickets.black === 5 && s.mrX.tickets.double === 2, 'mrx tickets');
    const positions = DETECTIVE_COLORS.map((c) => s.detectives[c].pos);
    assert(new Set(positions).size === 4, 'unique detective starts');
    assert(!positions.includes(s.mrX.pos), 'mrx not on detective');
    assert(hasAnyLegalMove(s, map, 'x'), 'mrx not trapped at deal');
    for (const c of DETECTIVE_COLORS) {
      const t = s.detectives[c].tickets;
      assert(t.taxi === 10 && t.bus === 6 && t.metro === 3, 'detective ticket counts');
    }
  });

  test('legalMoves: detective cannot share station', () => {
    const s = makeFixtureState(map, {
      x: 1,
      detectives: { blue: 2, red: 3, green: 4, purple: 5 },
      turn: 'blue',
    });
    const taxiMoves = legalMoves(s, map, 'blue', 'taxi');
    assert(taxiMoves.includes(1), 'blue can taxi to 1 (empty / mrx ok)');
    assert(!taxiMoves.includes(5), 'blue cannot taxi onto purple@5');
  });

  test('legalMoves: Mr X cannot enter detective station; black uses river', () => {
    const s = makeFixtureState(map, {
      x: 5,
      detectives: { blue: 2, red: 3, green: 4, purple: 1 },
      turn: 'x',
    });
    const taxi = legalMoves(s, map, 'x', 'taxi');
    assert(!taxi.includes(2) && !taxi.includes(4), 'blocked detectives');
    const black = legalMoves(s, map, 'x', 'black');
    assert(black.includes(6), 'black can use river to 6');
    assert(black.includes(8), 'black can taxi-mode to 8');
    assert(!legalMoves(s, map, 'x', 'taxi').includes(6), 'taxi cannot use river');
  });

  test('applyMrXMove spends black and advances to blue', () => {
    const s = makeFixtureState(map, {
      x: 5,
      detectives: { blue: 2, red: 3, green: 1, purple: 4 },
      turn: 'x',
      round: 1,
    });
    const s2 = applyMrXMove(s, map, { ticket: 'black', to: 6 });
    assert(s2.mrX.pos === 6, 'pos 6');
    assert(s2.mrX.tickets.black === 4, 'black spent');
    assert(s2.turn === 'blue', 'turn blue');
    assert(s2.mrX.log.length === 1 && s2.mrX.log[0].ticket === 'black', 'log');
    assert(s2.mrX.log[0].pos == null, 'no reveal on round 1');
    assert(s2.mrX.lastKnownPos == null, 'no last known yet');
  });

  test('reveal projection hides live pos; lastKnownPos after reveal', () => {
    const s = makeFixtureState(map, {
      x: 1,
      detectives: { blue: 3, red: 4, green: 5, purple: 6 },
      turn: 'x',
      round: 3,
    });
    const s2 = applyMrXMove(s, map, { ticket: 'taxi', to: 2 });
    assert(s2.mrX.pos === 2, 'live pos 2');
    assert(s2.mrX.lastKnownPos === 2, 'lastKnown set');
    assert(s2.mrX.log[0].pos === 2, 'log has pos on reveal');

    const detView = projectPublicState(s2, 'blue');
    assert(detView.mrX.pos === undefined, 'detective cannot see live pos');
    assert(detView.mrX.lastKnownPos === 2, 'ghost lastKnown');
    assert(detView.mrX.log[0].pos === 2, 'log reveal pos visible');
    assert(detView.mrX.tickets.black === undefined, 'black count hidden');

    const xView = projectPublicState(s2, 'x');
    assert(xView.mrX.pos === 2, 'x sees pos');
    assert(xView.mrX.tickets.black === 5, 'x sees black');
  });

  test('double on last round rejected', () => {
    const s = makeFixtureState(map, {
      x: 1,
      detectives: { blue: 3, red: 4, green: 5, purple: 6 },
      turn: 'x',
      round: 14,
    });
    s.mrX.tickets.double = 2;
    let threw = false;
    try {
      applyMrXDouble(s, map, {
        legs: [
          { ticket: 'taxi', to: 2 },
          { ticket: 'taxi', to: 5 },
        ],
      });
    } catch {
      threw = true;
    }
    assert(threw, 'double on 14 throws');
    assert(!canDouble(s), 'canDouble false on 14');
  });

  test('double move two legs same round; reveal only final', () => {
    const s = makeFixtureState(map, {
      x: 1,
      detectives: { blue: 3, red: 4, green: 6, purple: 7 },
      turn: 'x',
      round: 3,
    });
    s.mrX.tickets.double = 2;

    const s2 = applyMrXDouble(s, map, {
      legs: [
        { ticket: 'taxi', to: 2 },
        { ticket: 'taxi', to: 5 },
      ],
    });
    assert(s2.mrX.pos === 5, 'final pos 5');
    assert(s2.mrX.tickets.double === 1, 'double spent');
    assert(s2.mrX.log.length === 2, 'two log entries');
    assert(s2.mrX.log[0].round === 3 && s2.mrX.log[1].round === 3, 'same round');
    assert(s2.mrX.log[0].pos == null, 'intermediate hidden');
    assert(s2.mrX.log[1].pos === 5, 'final revealed');
    assert(s2.mrX.lastKnownPos === 5, 'lastKnown final');
    assert(s2.turn === 'blue', 'detectives next');
  });

  test('capture when detective lands on mrX', () => {
    const s = makeFixtureState(map, {
      x: 1,
      detectives: { blue: 2, red: 3, green: 5, purple: 6 },
      turn: 'blue',
      round: 5,
    });
    const s2 = applyDetectiveMove(s, map, 'blue', { ticket: 'taxi', to: 1 });
    assert(s2.phase === 'ended', 'ended');
    assert(s2.winner === 'detectives', 'detectives win');
    assert(s2.detectives.blue.tickets.taxi === 9, 'ticket spent');
  });

  test('round 14 complete without capture Mr X wins', () => {
    let st = makeFixtureState(map, {
      x: 7,
      detectives: { blue: 1, red: 5, green: 4, purple: 6 },
      turn: 'x',
      round: 14,
    });
    st = applyMrXMove(st, map, { ticket: 'metro', to: 3 });
    st = applyDetectiveMove(st, map, 'blue', { ticket: 'taxi', to: 2 });
    st = applyDetectiveMove(st, map, 'red', { ticket: 'taxi', to: 8 });
    st = applyDetectiveMove(st, map, 'green', { ticket: 'taxi', to: 1 });
    // purple stranded without capture
    st.detectives.purple.tickets = { taxi: 0, bus: 0, metro: 0 };
    assert(!hasAnyLegalMove(st, map, 'purple'), 'purple stranded');
    st = skipDetective(st, map, 'purple');
    assert(st.phase === 'ended', 'ended');
    assert(st.winner === 'x', 'Mr X wins round 14');
  });

  test('stranded detectives auto-skip after Mr X move', () => {
    let st = makeFixtureState(map, {
      x: 1,
      detectives: { blue: 3, red: 4, green: 6, purple: 7 },
      turn: 'x',
      round: 2,
    });
    for (const c of DETECTIVE_COLORS) {
      st.detectives[c].tickets = { taxi: 0, bus: 0, metro: 0 };
    }
    st = applyMrXMove(st, map, { ticket: 'taxi', to: 2 });
    assert(st.round === 3, 'round advanced');
    assert(st.turn === 'x', 'back to x');
    assert(st.phase === 'playing', 'still playing');
  });

  test('Mr X trapped → detectives win', () => {
    const s = makeFixtureState(map, {
      x: 6,
      detectives: { blue: 3, red: 5, green: 8, purple: 1 },
      turn: 'x',
      round: 2,
    });
    assert(!hasAnyLegalMove(s, map, 'x'), 'no moves');
    const s2 = resolveIfMrXTrapped(s, map);
    assert(s2.winner === 'detectives' && s2.phase === 'ended', 'trapped');
  });

  test('possibleMrXPositions respects log + reveal', () => {
    const s = makeFixtureState(map, {
      x: 1,
      detectives: { blue: 3, red: 4, green: 5, purple: 6 },
    });
    s.mrX.log = [];
    s.mrX.lastKnownPos = null;
    let poss = possibleMrXPositions(s, map);
    assert(poss.includes(1), 'start 1 possible');
    s.mrX.log = [{ round: 3, ticket: 'taxi', pos: 2 }];
    s.mrX.lastKnownPos = 2;
    poss = possibleMrXPositions(s, map);
    assert(poss.length === 1 && poss[0] === 2, 'anchored at reveal');
    s.mrX.log.push({ round: 4, ticket: 'taxi' });
    poss = possibleMrXPositions(s, map);
    assert(poss.includes(1), 'expanded to 1');
    assert(!poss.includes(5), '5 occupied removed');
  });

  test('isRevealRound helpers', () => {
    assert(isRevealRound(3) && isRevealRound(8) && isRevealRound(13), 'reveals');
    assert(!isRevealRound(1) && !isRevealRound(14), 'non-reveals');
  });

  test('cloneState isolation', () => {
    const s = makeFixtureState(map, { x: 1 });
    const c = cloneState(s);
    c.mrX.pos = 999;
    c.detectives.blue.tickets.taxi = 0;
    assert(s.mrX.pos !== 999, 'pos isolated');
    assert(s.detectives.blue.tickets.taxi === 10, 'tickets isolated');
  });

  const ok = results.every((r) => r.pass);
  return { ok, results };
}

// Node CLI: `node games/scotland-yard/engine.js`
const isMain =
  typeof process !== 'undefined' &&
  process.argv &&
  process.argv[1] &&
  (process.argv[1].endsWith('engine.js') || process.argv[1].includes('scotland-yard/engine'));

if (isMain) {
  const { ok, results } = runEngineSelfTests();
  for (const r of results) {
    const mark = r.pass ? 'PASS' : 'FAIL';
    console.log(`${mark}  ${r.name}${r.error ? ' — ' + r.error : ''}`);
  }
  console.log(ok ? `\nAll ${results.length} tests passed.` : `\nSome tests failed.`);
  process.exit(ok ? 0 : 1);
}
