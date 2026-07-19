/**
 * Scotland Yard · القاهرة — host-side casual AI (Mr X + detectives).
 * Pure functions over engine state; optional rng for tie-breaks.
 */

import {
  TICKETS,
  DETECTIVE_COLORS,
  DETECTIVE_TICKETS,
  legalMoves,
  applyMrXMove,
  applyMrXDouble,
  applyDetectiveMove,
  skipDetective,
  possibleMrXPositions,
  graphDistance,
  createInitialState,
  hasAnyLegalMove,
  canDouble,
  resolveIfMrXTrapped,
  buildAdjacency,
} from './engine.js';

/** Cheaper first: taxi < bus < metro < black */
const TICKET_COST = Object.freeze({
  [TICKETS.taxi]: 0,
  [TICKETS.bus]: 1,
  [TICKETS.metro]: 2,
  [TICKETS.black]: 3,
});

const THREAT_DIST = 2;
const MAX_SIM_STEPS = 256;

function ensureAdj(map) {
  if (map && !map._adj) map._adj = buildAdjacency(map);
  return map;
}

function pickRandom(arr, rng) {
  if (!arr.length) return null;
  const i = Math.floor(rng() * arr.length);
  return arr[Math.min(i, arr.length - 1)];
}

/** Minimum hop distance from `pos` to any detective. */
function minDistToDetectives(map, pos, state) {
  let min = Infinity;
  for (const c of DETECTIVE_COLORS) {
    const d = state.detectives[c];
    if (!d) continue;
    const dist = graphDistance(map, pos, d.pos);
    if (dist < min) min = dist;
  }
  return min;
}

/** All legal (ticket, to) pairs for a detective. */
function detectiveCandidates(state, map, color) {
  const out = [];
  for (const ticket of DETECTIVE_TICKETS) {
    for (const to of legalMoves(state, map, color, ticket)) {
      out.push({ ticket, to });
    }
  }
  return out;
}

/** All legal (ticket, to) pairs for Mr X. */
function mrXSingleCandidates(state, map) {
  const out = [];
  for (const ticket of [TICKETS.taxi, TICKETS.bus, TICKETS.metro, TICKETS.black]) {
    for (const to of legalMoves(state, map, 'x', ticket)) {
      out.push({ ticket, to });
    }
  }
  return out;
}

/**
 * Detective AI: minimize sum of graph distances to possible Mr X nodes;
 * prefer cheaper tickets when scores are similar.
 * @returns {{ ticket: string, to: number } | null}
 */
export function chooseDetectiveMove(state, map, color, rng = Math.random) {
  ensureAdj(map);
  if (state.phase !== 'playing') return null;
  if (!DETECTIVE_COLORS.includes(color)) return null;

  const candidates = detectiveCandidates(state, map, color);
  if (!candidates.length) return null;

  const possibles = possibleMrXPositions(state, map);
  const n = possibles.length || 1;

  let best = [];
  let bestKey = null;

  for (const move of candidates) {
    let distSum = 0;
    let onPossible = 0;
    if (possibles.length) {
      for (const p of possibles) {
        const d = graphDistance(map, move.to, p);
        distSum += Number.isFinite(d) ? d : 999;
        if (move.to === p) onPossible += 1;
      }
    } else {
      // No constraint set — treat all destinations equally on distance
      distSum = 0;
    }
    const avg = distSum / n;
    // Lexicographic key (lower is better):
    // 1) land on a possible node (capture chance) — count negated
    // 2) average distance to possibles
    // 3) ticket cost
    // 4) station id for stable fallback
    const key = [-onPossible, avg, TICKET_COST[move.ticket] ?? 9, move.to];
    if (bestKey === null || cmpKey(key, bestKey) < 0) {
      bestKey = key;
      best = [move];
    } else if (cmpKey(key, bestKey) === 0) {
      best.push(move);
    }
  }

  return pickRandom(best, rng);
}

function cmpKey(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}

/**
 * Mr X AI: maximize min distance to detectives.
 * Save black/double when not threatened; spend when minDist is small.
 * @returns {{ type:'single', ticket, to } | { type:'double', legs:[{ticket,to},{ticket,to}] } | null}
 */
export function chooseMrXMove(state, map, rng = Math.random) {
  ensureAdj(map);
  if (state.phase !== 'playing' || state.turn !== 'x') return null;

  const singles = mrXSingleCandidates(state, map);
  if (!singles.length) return null;

  const currentThreat = minDistToDetectives(map, state.mrX.pos, state);
  const threatened = currentThreat <= THREAT_DIST;

  /** @type {Array<{ action: object, key: number[] }>} */
  const scored = [];

  for (const move of singles) {
    const minD = minDistToDetectives(map, move.to, state);
    const blackPenalty =
      move.ticket === TICKETS.black ? (threatened ? 0.25 : 3) : 0;
    // Higher minD better → negate for min-key compare
    // Prefer non-black when safe; prefer cheaper tickets slightly
    const key = [
      -minD,
      blackPenalty,
      TICKET_COST[move.ticket] ?? 9,
      move.to,
    ];
    scored.push({
      action: { type: 'single', ticket: move.ticket, to: move.to },
      key,
    });
  }

  // Double when allowed and under pressure (or single escape still tight)
  const bestSingleMin = Math.max(
    ...singles.map((m) => minDistToDetectives(map, m.to, state)),
  );
  const considerDouble =
    canDouble(state) && (threatened || bestSingleMin <= THREAT_DIST);

  if (considerDouble) {
    // Mid-state clone fields we need for leg-2 legality
    for (const leg1 of singles) {
      // Prefer non-black first leg when possible — still enumerate all
      const mid = {
        ...state,
        mrX: {
          ...state.mrX,
          pos: leg1.to,
          tickets: { ...state.mrX.tickets },
        },
      };
      if (leg1.ticket === TICKETS.black) {
        mid.mrX.tickets.black = (mid.mrX.tickets.black || 0) - 1;
      }
      // legalMoves uses detective positions from state — same for mid
      for (const ticket2 of [TICKETS.taxi, TICKETS.bus, TICKETS.metro, TICKETS.black]) {
        if (ticket2 === TICKETS.black && (mid.mrX.tickets.black || 0) <= 0) continue;
        for (const to2 of legalMoves(mid, map, 'x', ticket2)) {
          const minD = minDistToDetectives(map, to2, state);
          const blacks =
            (leg1.ticket === TICKETS.black ? 1 : 0) + (ticket2 === TICKETS.black ? 1 : 0);
          // Double costs a token — slight penalty unless it clearly helps
          const doublePenalty = minD > bestSingleMin + 0.5 ? 0 : 0.5;
          const blackPenalty = threatened ? blacks * 0.15 : blacks * 2;
          const key = [
            -minD,
            doublePenalty + blackPenalty,
            (TICKET_COST[leg1.ticket] ?? 9) + (TICKET_COST[ticket2] ?? 9),
            to2,
          ];
          scored.push({
            action: {
              type: 'double',
              legs: [
                { ticket: leg1.ticket, to: leg1.to },
                { ticket: ticket2, to: to2 },
              ],
            },
            key,
          });
        }
      }
    }
  }

  let best = [];
  let bestKey = null;
  for (const s of scored) {
    if (bestKey === null || cmpKey(s.key, bestKey) < 0) {
      bestKey = s.key;
      best = [s.action];
    } else if (cmpKey(s.key, bestKey) === 0) {
      best.push(s.action);
    }
  }

  return pickRandom(best, rng);
}

/**
 * Play a full AI-vs-AI game until ended.
 * @returns {{ winner: 'x'|'detectives'|null, rounds: number }}
 */
export function simulateGame(map, rng = Math.random) {
  ensureAdj(map);
  let state = createInitialState(map, rng);
  let steps = 0;

  while (state.phase === 'playing' && steps++ < MAX_SIM_STEPS) {
    if (state.turn === 'x') {
      state = resolveIfMrXTrapped(state, map);
      if (state.phase !== 'playing') break;

      const move = chooseMrXMove(state, map, rng);
      if (!move) {
        state = resolveIfMrXTrapped(state, map);
        break;
      }
      if (move.type === 'double') {
        state = applyMrXDouble(state, map, { legs: move.legs });
      } else {
        state = applyMrXMove(state, map, { ticket: move.ticket, to: move.to });
      }
      continue;
    }

    // Detective turn (engine may have already skipped stranded seats)
    const color = state.turn;
    if (!DETECTIVE_COLORS.includes(color)) break;

    if (!hasAnyLegalMove(state, map, color)) {
      state = skipDetective(state, map, color);
      continue;
    }

    const move = chooseDetectiveMove(state, map, color, rng);
    if (!move) {
      state = skipDetective(state, map, color);
      continue;
    }
    state = applyDetectiveMove(state, map, color, move);
  }

  return {
    winner: state.winner,
    rounds: state.round,
  };
}
