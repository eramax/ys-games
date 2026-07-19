/**
 * Scotland Yard · القاهرة — WebRTC multiplayer (PeerJS, host-authoritative).
 *
 * Host: engine + AI + lobby seats; broadcasts role-projected state.
 * Guest: thin client — renders projected view, sends move/double intents.
 */

import {
  DETECTIVE_COLORS,
  createInitialState,
  applyMrXMove,
  applyMrXDouble,
  applyDetectiveMove,
  skipDetective,
  projectPublicState,
  hasAnyLegalMove,
  resolveIfMrXTrapped,
  cloneState,
} from './engine.js';
import { chooseDetectiveMove, chooseMrXMove } from './ai.js';

export const SEAT_ROLES = Object.freeze(['x', 'blue', 'red', 'green', 'purple']);

const AI_STEP_MS = 420;
const PEERJS_SRC = './vendor/peerjs.min.js';
const DEFAULT_NAME = 'لاعب';

/** @type {Promise<typeof import('peerjs').default>|null} */
let peerJsLoad = null;

/**
 * Dynamically load vendored PeerJS only on multiplayer path.
 * @returns {Promise<typeof window.Peer>}
 */
export function loadPeerJS() {
  if (typeof window !== 'undefined' && window.Peer) {
    return Promise.resolve(window.Peer);
  }
  if (peerJsLoad) return peerJsLoad;
  peerJsLoad = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-sy-peerjs]`);
    if (existing) {
      existing.addEventListener('load', () => {
        if (window.Peer) resolve(window.Peer);
        else reject(new Error('PeerJS missing after load'));
      });
      existing.addEventListener('error', () => reject(new Error('PeerJS load failed')));
      return;
    }
    const s = document.createElement('script');
    s.src = PEERJS_SRC;
    s.async = true;
    s.dataset.syPeerjs = '1';
    s.onload = () => {
      if (window.Peer) resolve(window.Peer);
      else reject(new Error('PeerJS global missing'));
    };
    s.onerror = () => {
      peerJsLoad = null;
      reject(new Error('تعذّر تحميل PeerJS'));
    };
    document.head.appendChild(s);
  });
  return peerJsLoad;
}

function roomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `SY-${out}`;
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function send(conn, msg) {
  if (!conn || !conn.open) return false;
  try {
    conn.send(msg);
    return true;
  } catch {
    return false;
  }
}

function emptySeats() {
  /** @type {Record<string, { role: string, name: string|null, peerId: string|null, claimed: boolean }>} */
  const seats = {};
  for (const role of SEAT_ROLES) {
    seats[role] = { role, name: null, peerId: null, claimed: false };
  }
  return seats;
}

function lobbyPayload(seats, hostPeerId, code, phase = 'lobby') {
  const players = SEAT_ROLES.filter((r) => seats[r].claimed).map((r) => ({
    role: r,
    name: seats[r].name,
    peerId: seats[r].peerId,
  }));
  return {
    type: 'lobby',
    seats: Object.fromEntries(
      SEAT_ROLES.map((r) => [
        r,
        {
          role: r,
          name: seats[r].name,
          peerId: seats[r].peerId,
          claimed: seats[r].claimed,
          // empty → AI at start
          controller: seats[r].claimed ? 'human' : 'ai',
        },
      ]),
    ),
    players,
    hostPeerId,
    roomCode: code,
    phase,
  };
}

/**
 * Create host session.
 * @param {{
 *   onLobby?: (lobby: object) => void,
 *   onState?: (payload: { version: number, view: object, localRole: string|null }) => void,
 *   onEvent?: (ev: { kind: string, [k: string]: any }) => void,
 *   onError?: (err: Error|string) => void,
 *   name?: string,
 * }} opts
 */
export async function createHost(opts = {}) {
  const {
    onLobby = () => {},
    onState = () => {},
    onEvent = () => {},
    onError = () => {},
    name: initialName = DEFAULT_NAME,
  } = opts;

  let Peer;
  try {
    Peer = await loadPeerJS();
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
    throw err;
  }

  const code = roomCode();
  const seats = emptySeats();
  /** @type {Map<string, import('peerjs').DataConnection>} */
  const conns = new Map();
  /** peerId → display name */
  const names = new Map();
  /** LOCAL host pseudo-id until Peer opens */
  let hostPeerId = null;
  let localName = (initialName || DEFAULT_NAME).trim() || DEFAULT_NAME;
  /** @type {string|null} host's claimed seat */
  let localRole = null;
  /** @type {object|null} full authoritative engine state */
  let gameState = null;
  /** @type {object|null} map reference for AI / validation */
  let gameMap = null;
  let version = 0;
  let destroyed = false;
  let aiTimer = 0;
  let phase = 'lobby'; // lobby | playing | ended

  const peer = new Peer({ debug: 0 });

  function emitLobby() {
    const payload = lobbyPayload(seats, hostPeerId, code, phase);
    onLobby(payload);
    for (const conn of conns.values()) {
      send(conn, payload);
    }
  }

  function roleForPeer(peerId) {
    if (peerId === hostPeerId || peerId === '__host__') return localRole;
    for (const r of SEAT_ROLES) {
      if (seats[r].peerId === peerId) return r;
    }
    return null;
  }

  function projectFor(role) {
    if (!gameState) return null;
    const viewer = role || 'spectator';
    return projectPublicState(gameState, viewer);
  }

  function pushState() {
    if (!gameState) return;
    version += 1;
    // Host UI (always project for localRole fog-of-war)
    onState({
      version,
      view: projectFor(localRole),
      localRole,
      fullState: gameState, // host only — guests never get this channel
    });

    for (const [pid, conn] of conns) {
      const role = roleForPeer(pid);
      send(conn, {
        type: 'state',
        version,
        view: projectFor(role),
        localRole: role,
      });
    }

    // Events for captures / win / reveal
    if (gameState.phase === 'ended') {
      broadcastEvent({
        kind: 'win',
        winner: gameState.winner,
      });
    }
  }

  function broadcastEvent(ev) {
    const msg = { type: 'event', ...ev };
    onEvent(msg);
    for (const conn of conns.values()) send(conn, msg);
  }

  function claimSeatFor(peerId, role, playerName) {
    if (!SEAT_ROLES.includes(role)) return { ok: false, reason: 'bad_role' };
    if (phase !== 'lobby') return { ok: false, reason: 'started' };
    const seat = seats[role];
    // Already own this seat
    if (seat.claimed && seat.peerId === peerId) {
      seat.name = playerName || seat.name;
      return { ok: true };
    }
    if (seat.claimed && seat.peerId !== peerId) {
      return { ok: false, reason: 'taken' };
    }
    // Release previous seat of this peer
    for (const r of SEAT_ROLES) {
      if (seats[r].peerId === peerId) {
        seats[r].claimed = false;
        seats[r].peerId = null;
        seats[r].name = null;
      }
    }
    seat.claimed = true;
    seat.peerId = peerId;
    seat.name = playerName || names.get(peerId) || DEFAULT_NAME;
    return { ok: true };
  }

  function releasePeer(peerId) {
    for (const r of SEAT_ROLES) {
      if (seats[r].peerId === peerId) {
        if (phase === 'lobby') {
          seats[r].claimed = false;
          seats[r].peerId = null;
          seats[r].name = null;
        } else if (gameState) {
          // Mid-game: seat becomes AI
          seats[r].claimed = false;
          seats[r].peerId = null;
          if (r === 'x') {
            // Mr X controller flag lives in session, not engine — handled via seats
          } else if (gameState.detectives[r]) {
            gameState = cloneState(gameState);
            gameState.detectives[r].controller = 'ai';
          }
        }
      }
    }
    names.delete(peerId);
    conns.delete(peerId);
    emitLobby();
    if (phase === 'playing' && gameState) {
      pushState();
      scheduleAi();
    }
  }

  function isHumanSeat(role) {
    if (!role) return false;
    return seats[role]?.claimed === true;
  }

  function controllerOfTurn() {
    if (!gameState || gameState.phase !== 'playing') return null;
    const t = gameState.turn;
    if (t === 'x') return isHumanSeat('x') ? 'human' : 'ai';
    if (DETECTIVE_COLORS.includes(t)) {
      return gameState.detectives[t]?.controller === 'human' ? 'human' : 'ai';
    }
    return null;
  }

  function applyMoveFrom(peerId, msg) {
    if (!gameState || gameState.phase !== 'playing' || !gameMap) {
      return { ok: false, reason: 'not_playing' };
    }
    const role = roleForPeer(peerId);
    if (!role) return { ok: false, reason: 'no_seat' };

    try {
      if (msg.type === 'double') {
        if (role !== 'x' || gameState.turn !== 'x') {
          return { ok: false, reason: 'not_your_turn' };
        }
        if (!isHumanSeat('x')) return { ok: false, reason: 'ai_seat' };
        gameState = applyMrXDouble(gameState, gameMap, { legs: msg.legs });
        if (
          gameState.mrX?.log?.length &&
          gameState.mrX.log[gameState.mrX.log.length - 1]?.pos != null
        ) {
          broadcastEvent({ kind: 'reveal', pos: gameState.mrX.lastKnownPos });
        }
      } else if (msg.type === 'move') {
        const actor = msg.actor;
        if (actor !== role) return { ok: false, reason: 'wrong_actor' };
        if (gameState.turn !== actor) return { ok: false, reason: 'not_your_turn' };
        if (!isHumanSeat(role)) return { ok: false, reason: 'ai_seat' };

        if (actor === 'x') {
          gameState = applyMrXMove(gameState, gameMap, {
            ticket: msg.ticket,
            to: msg.to,
          });
          if (
            gameState.mrX?.log?.length &&
            gameState.mrX.log[gameState.mrX.log.length - 1]?.pos != null
          ) {
            broadcastEvent({ kind: 'reveal', pos: gameState.mrX.lastKnownPos });
          }
        } else {
          gameState = applyDetectiveMove(gameState, gameMap, actor, {
            ticket: msg.ticket,
            to: msg.to,
          });
          if (gameState.phase === 'ended' && gameState.winner === 'detectives') {
            broadcastEvent({ kind: 'capture', by: actor });
          }
        }
      } else {
        return { ok: false, reason: 'bad_type' };
      }
    } catch (err) {
      return { ok: false, reason: 'illegal', error: String(err?.message || err) };
    }

    if (gameState.phase === 'ended') phase = 'ended';
    pushState();
    scheduleAi();
    return { ok: true };
  }

  function runAiStep() {
    if (!gameState || !gameMap || gameState.phase !== 'playing') return;
    if (controllerOfTurn() !== 'ai') return;

    if (gameState.turn === 'x') {
      gameState = resolveIfMrXTrapped(gameState, gameMap);
      if (gameState.phase !== 'playing') {
        phase = 'ended';
        pushState();
        return;
      }
      const move = chooseMrXMove(gameState, gameMap, Math.random);
      if (!move) {
        gameState = resolveIfMrXTrapped(gameState, gameMap);
        if (gameState.phase === 'ended') phase = 'ended';
        pushState();
        return;
      }
      if (move.type === 'double') {
        gameState = applyMrXDouble(gameState, gameMap, { legs: move.legs });
      } else {
        gameState = applyMrXMove(gameState, gameMap, {
          ticket: move.ticket,
          to: move.to,
        });
      }
      if (
        gameState.mrX?.log?.length &&
        gameState.mrX.log[gameState.mrX.log.length - 1]?.pos != null
      ) {
        broadcastEvent({ kind: 'reveal', pos: gameState.mrX.lastKnownPos });
      }
    } else if (DETECTIVE_COLORS.includes(gameState.turn)) {
      const color = gameState.turn;
      if (!hasAnyLegalMove(gameState, gameMap, color)) {
        gameState = skipDetective(gameState, gameMap, color);
      } else {
        const move = chooseDetectiveMove(gameState, gameMap, color, Math.random);
        if (!move) {
          gameState = skipDetective(gameState, gameMap, color);
        } else {
          gameState = applyDetectiveMove(gameState, gameMap, color, move);
          if (gameState.phase === 'ended' && gameState.winner === 'detectives') {
            broadcastEvent({ kind: 'capture', by: color });
          }
        }
      }
    }

    if (gameState.phase === 'ended') phase = 'ended';
    pushState();
  }

  function scheduleAi() {
    clearTimeout(aiTimer);
    if (destroyed || !gameState || gameState.phase !== 'playing') return;
    if (controllerOfTurn() !== 'ai') return;
    aiTimer = setTimeout(() => {
      try {
        runAiStep();
      } catch (err) {
        console.error(err);
        onError(err instanceof Error ? err : new Error(String(err)));
      }
      if (!destroyed && gameState?.phase === 'playing' && controllerOfTurn() === 'ai') {
        scheduleAi();
      }
    }, AI_STEP_MS);
  }

  function handleGuestMessage(peerId, msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'join': {
        const n = (msg.name || DEFAULT_NAME).toString().trim().slice(0, 24) || DEFAULT_NAME;
        names.set(peerId, n);
        if (msg.preferredRole && SEAT_ROLES.includes(msg.preferredRole)) {
          const res = claimSeatFor(peerId, msg.preferredRole, n);
          if (!res.ok && msg.preferredRole) {
            // try any free detective
            for (const r of DETECTIVE_COLORS) {
              if (!seats[r].claimed) {
                claimSeatFor(peerId, r, n);
                break;
              }
            }
          }
        }
        emitLobby();
        // If already playing, send current projected state
        if (gameState) {
          const role = roleForPeer(peerId);
          const conn = conns.get(peerId);
          if (conn) {
            send(conn, {
              type: 'state',
              version,
              view: projectFor(role),
              localRole: role,
            });
          }
        }
        break;
      }
      case 'setName': {
        const n = (msg.name || DEFAULT_NAME).toString().trim().slice(0, 24) || DEFAULT_NAME;
        names.set(peerId, n);
        for (const r of SEAT_ROLES) {
          if (seats[r].peerId === peerId) seats[r].name = n;
        }
        emitLobby();
        break;
      }
      case 'claim': {
        const n = names.get(peerId) || DEFAULT_NAME;
        const res = claimSeatFor(peerId, msg.role, n);
        if (!res.ok) {
          const conn = conns.get(peerId);
          send(conn, { type: 'event', kind: 'seat_taken', role: msg.role, reason: res.reason });
        }
        emitLobby();
        break;
      }
      case 'move':
      case 'double': {
        const res = applyMoveFrom(peerId, msg);
        if (!res.ok) {
          const conn = conns.get(peerId);
          send(conn, { type: 'event', kind: 'move_rejected', reason: res.reason });
        }
        break;
      }
      default:
        break;
    }
  }

  function wireConn(conn) {
    const peerId = conn.peer;
    conns.set(peerId, conn);
    conn.on('data', (raw) => {
      const msg = typeof raw === 'string' ? safeJsonParse(raw) : raw;
      handleGuestMessage(peerId, msg);
    });
    conn.on('close', () => {
      releasePeer(peerId);
    });
    conn.on('error', () => {
      releasePeer(peerId);
    });
    // Wait for join; still send lobby snapshot
    send(conn, lobbyPayload(seats, hostPeerId, code, phase));
  }

  const ready = new Promise((resolve, reject) => {
    peer.on('open', (id) => {
      hostPeerId = id;
      names.set(id, localName);
      emitLobby();
      resolve(api);
    });
    peer.on('connection', (conn) => {
      conn.on('open', () => wireConn(conn));
    });
    peer.on('error', (err) => {
      const e = err instanceof Error ? err : new Error(String(err?.type || err));
      onError(e);
      // Only reject if not yet open
      if (!hostPeerId) reject(e);
    });
    peer.on('disconnected', () => {
      if (!destroyed) {
        try {
          peer.reconnect();
        } catch (_) {
          /* ignore */
        }
      }
    });
  });

  const api = {
    isHost: true,
    getPeerId: () => hostPeerId,
    getRoomCode: () => code,
    getLocalRole: () => localRole,
    getPhase: () => phase,
    getFullState: () => (gameState ? cloneState(gameState) : null),
    getShareUrl() {
      const url = new URL(location.href);
      url.searchParams.set('host', hostPeerId || '');
      url.searchParams.set('room', code);
      // Drop hash noise
      url.hash = '';
      return url.toString();
    },
    setName(name) {
      localName = (name || DEFAULT_NAME).toString().trim().slice(0, 24) || DEFAULT_NAME;
      if (hostPeerId) names.set(hostPeerId, localName);
      if (localRole && seats[localRole]) seats[localRole].name = localName;
      emitLobby();
    },
    claimSeat(role) {
      if (!hostPeerId) return { ok: false, reason: 'not_ready' };
      const res = claimSeatFor(hostPeerId, role, localName);
      if (res.ok) localRole = role;
      emitLobby();
      return res;
    },
    /**
     * Host starts the match. Empty seats → AI.
     * @param {object} map
     */
    startGame(map) {
      if (phase !== 'lobby') return { ok: false, reason: 'already' };
      if (!map) return { ok: false, reason: 'no_map' };
      if (!localRole) {
        // Host must claim a seat; default blue if none
        const free = SEAT_ROLES.find((r) => !seats[r].claimed) || 'blue';
        claimSeatFor(hostPeerId, free, localName);
        localRole = free;
      }

      const controllers = {};
      for (const c of DETECTIVE_COLORS) {
        controllers[c] = seats[c].claimed ? 'human' : 'ai';
      }
      // Mr X human/ai tracked via seats (engine doesn't store X controller)

      gameMap = map;
      gameState = createInitialState(map, Math.random, { controllers });
      // Ensure controllers stick
      for (const c of DETECTIVE_COLORS) {
        gameState.detectives[c].controller = controllers[c];
      }
      phase = 'playing';
      emitLobby();
      pushState();
      scheduleAi();
      onEvent({ type: 'event', kind: 'started' });
      for (const conn of conns.values()) {
        send(conn, { type: 'event', kind: 'started' });
      }
      return { ok: true, localRole };
    },
    /**
     * Host local move (same validation path as guests).
     * @param {{ type?: 'move'|'double', actor?: string, ticket?: string, to?: number, legs?: Array<{ticket:string,to:number}> }} intent
     */
    sendMove(intent) {
      if (!hostPeerId) return { ok: false, reason: 'not_ready' };
      const msg =
        intent?.type === 'double' || intent?.legs
          ? { type: 'double', legs: intent.legs }
          : { type: 'move', actor: intent.actor, ticket: intent.ticket, to: intent.to };
      return applyMoveFrom(hostPeerId, msg);
    },
    destroy() {
      destroyed = true;
      clearTimeout(aiTimer);
      broadcastEvent({ kind: 'host_left' });
      for (const conn of conns.values()) {
        try {
          conn.close();
        } catch (_) {
          /* ignore */
        }
      }
      conns.clear();
      try {
        peer.destroy();
      } catch (_) {
        /* ignore */
      }
      gameState = null;
      gameMap = null;
      phase = 'lobby';
    },
  };

  return ready;
}

/**
 * Create guest session connecting to host peer id.
 * @param {{
 *   hostPeerId: string,
 *   onLobby?: (lobby: object) => void,
 *   onState?: (payload: { version: number, view: object, localRole: string|null }) => void,
 *   onEvent?: (ev: object) => void,
 *   onError?: (err: Error|string) => void,
 *   name?: string,
 *   preferredRole?: string|null,
 * }} opts
 */
export async function createGuest(opts = {}) {
  const {
    hostPeerId,
    onLobby = () => {},
    onState = () => {},
    onEvent = () => {},
    onError = () => {},
    name: initialName = DEFAULT_NAME,
    preferredRole = null,
  } = opts;

  if (!hostPeerId) {
    const err = new Error('معرّف المضيف مفقود');
    onError(err);
    throw err;
  }

  let Peer;
  try {
    Peer = await loadPeerJS();
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
    throw err;
  }

  let localName = (initialName || DEFAULT_NAME).trim() || DEFAULT_NAME;
  /** @type {string|null} */
  let localRole = null;
  let destroyed = false;
  /** @type {import('peerjs').DataConnection|null} */
  let conn = null;
  let lastLobby = null;
  let lastView = null;
  let version = 0;

  const peer = new Peer({ debug: 0 });

  function emitJoin() {
    if (!conn || !conn.open) return;
    send(conn, {
      type: 'join',
      name: localName,
      preferredRole: preferredRole && SEAT_ROLES.includes(preferredRole) ? preferredRole : null,
    });
  }

  function handleMsg(raw) {
    const msg = typeof raw === 'string' ? safeJsonParse(raw) : raw;
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'lobby':
        lastLobby = msg;
        // Infer local role from seats matching our connection peer id
        if (conn) {
          const myId = peer.id;
          for (const r of SEAT_ROLES) {
            if (msg.seats?.[r]?.peerId === myId) {
              localRole = r;
              break;
            }
          }
        }
        onLobby(msg);
        break;
      case 'state':
        version = msg.version ?? version + 1;
        lastView = msg.view;
        if (msg.localRole != null) localRole = msg.localRole;
        onState({
          version,
          view: msg.view,
          localRole,
        });
        break;
      case 'event':
        if (msg.kind === 'host_left') {
          onEvent(msg);
        } else {
          onEvent(msg);
        }
        break;
      default:
        break;
    }
  }

  const ready = new Promise((resolve, reject) => {
    const failTimer = setTimeout(() => {
      if (!conn || !conn.open) {
        const e = new Error('تعذّر الاتصال، تحقق من الإنترنت');
        onError(e);
        reject(e);
      }
    }, 20000);

    peer.on('open', () => {
      try {
        conn = peer.connect(hostPeerId, { reliable: true });
      } catch (err) {
        clearTimeout(failTimer);
        const e = err instanceof Error ? err : new Error(String(err));
        onError(e);
        reject(e);
        return;
      }
      conn.on('open', () => {
        clearTimeout(failTimer);
        emitJoin();
        resolve(api);
      });
      conn.on('data', handleMsg);
      conn.on('close', () => {
        if (!destroyed) {
          onEvent({ type: 'event', kind: 'host_left' });
        }
      });
      conn.on('error', (err) => {
        onError(err instanceof Error ? err : new Error(String(err)));
      });
    });

    peer.on('error', (err) => {
      clearTimeout(failTimer);
      const e =
        err instanceof Error
          ? err
          : new Error(
              err?.type === 'peer-unavailable'
                ? 'المضيف غير متاح'
                : 'تعذّر الاتصال، تحقق من الإنترنت',
            );
      onError(e);
      reject(e);
    });
  });

  const api = {
    isHost: false,
    getPeerId: () => peer.id,
    getRoomCode: () => lastLobby?.roomCode || null,
    getLocalRole: () => localRole,
    getPhase: () => lastLobby?.phase || (lastView ? 'playing' : 'lobby'),
    getLastView: () => lastView,
    getShareUrl() {
      const url = new URL(location.href);
      url.searchParams.set('host', hostPeerId);
      if (lastLobby?.roomCode) url.searchParams.set('room', lastLobby.roomCode);
      url.hash = '';
      return url.toString();
    },
    setName(name) {
      localName = (name || DEFAULT_NAME).toString().trim().slice(0, 24) || DEFAULT_NAME;
      if (conn?.open) send(conn, { type: 'setName', name: localName });
    },
    claimSeat(role) {
      if (!conn?.open) return { ok: false, reason: 'not_connected' };
      send(conn, { type: 'claim', role });
      return { ok: true };
    },
    startGame() {
      return { ok: false, reason: 'guest_cannot_start' };
    },
    sendMove(intent) {
      if (!conn?.open) return { ok: false, reason: 'not_connected' };
      if (intent?.type === 'double' || intent?.legs) {
        send(conn, { type: 'double', legs: intent.legs });
      } else {
        send(conn, {
          type: 'move',
          actor: intent.actor,
          ticket: intent.ticket,
          to: intent.to,
        });
      }
      return { ok: true };
    },
    destroy() {
      destroyed = true;
      try {
        conn?.close();
      } catch (_) {
        /* ignore */
      }
      try {
        peer.destroy();
      } catch (_) {
        /* ignore */
      }
      conn = null;
    },
  };

  return ready;
}

/**
 * Parse multiplayer URL params from location.search.
 * @returns {{ host: string|null, room: string|null }}
 */
export function parseMultiplayerParams(search = location.search) {
  const q = new URLSearchParams(search);
  return {
    host: q.get('host') || null,
    room: q.get('room') || null,
  };
}
