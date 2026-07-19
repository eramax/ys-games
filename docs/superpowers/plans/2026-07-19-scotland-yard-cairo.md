# Scotland Yard · القاهرة Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a polished Arabic, noir-gold, streamlined Scotland Yard game on a Cairo map with solo AI practice and cross-device WebRTC multiplayer (share link), integrated into YS Games portal + APK assets.

**Architecture:** Host-authoritative pure JS rules engine + AI on the host device; PeerJS WebRTC for guest sync; SVG map UI with role-filtered views; entry HTML shell registered in `games.json` / `version.json`.

**Tech Stack:** Vanilla JS (ES modules or IIFE consistent with repo), SVG/CSS, PeerJS (vendored), Cairo font, static JSON map. No build step required (match existing games).

**Spec:** `docs/superpowers/specs/2026-07-19-scotland-yard-cairo-design.md`

---

## File map

| Path | Role |
|------|------|
| `games/scotland-yard.html` | Entry: screens, CSS noir-gold RTL, boot |
| `games/scotland-yard/cairo-map.json` | Stations, edges, start pools |
| `games/scotland-yard/engine.js` | Pure rules (no DOM) |
| `games/scotland-yard/ai.js` | Mr X + detective AI |
| `games/scotland-yard/net.js` | PeerJS host/guest protocol |
| `games/scotland-yard/ui-map.js` | Map pan/zoom, tokens, highlights |
| `games/vendor/peerjs.min.js` | Vendored PeerJS |
| `games/images/scotland-yard.webp` | Portal thumbnail |
| `games.json` | Catalog entry |
| `version.json` | Version bump + file list |
| `docs/superpowers/specs/2026-07-19-scotland-yard-cairo-design.md` | Spec (done) |

**Vertical slices:** engine → map data → solo UI → AI → multiplayer → portal polish.

---

### Task 1: Pure rules engine

**Files:**
- Create: `games/scotland-yard/engine.js`
- Create: `games/scotland-yard/engine-selftest.html` (optional tiny harness) OR inline self-test callable from console

- [ ] **Step 1: Implement map graph helpers + ticket constants**

```js
// engine.js — core API sketch
export const TICKETS = { taxi: 'taxi', bus: 'bus', metro: 'metro', black: 'black' };
export const DETECTIVE_COLORS = ['blue', 'red', 'green', 'purple'];
export const REVEAL_ROUNDS = [3, 8, 13];
export const MAX_ROUND = 14;

export function buildAdjacency(map) {
  // map.edges -> adj[id][mode] = [neighborIds]
}

export function createInitialState(map, rng = Math.random) {
  // deal starts from startsMrX / startsDetectives, disjoint
  // detectives: 10 taxi, 6 bus, 3 metro each
  // mrX: black:5, double:2, unlimited normal
  // phase: 'playing', round:1, turn:'x'
}
```

- [ ] **Step 2: Implement legal moves & apply move**

Rules from spec:
- Detectives cannot share stations
- Mr X cannot enter detective stations
- Black ticket: any mode including river
- Double: one action two legs same round; illegal on round 14
- Used detective tickets logged (type only), not transferred
- Capture when detective lands on mrX.pos
- After all detectives act on round 14 without capture → winner `x`
- Round increments after full detective sequence

```js
export function legalMoves(state, map, actor /* 'x' | color */, ticket) { /* [...] */ }
export function applyMrXMove(state, map, { ticket, to, double }) { /* immutable or clone */ }
export function applyDetectiveMove(state, map, color, { ticket, to }) {}
export function projectPublicState(state, viewer /* 'x' | color | 'spectator' */) {}
export function possibleMrXPositions(state, map) { /* constraint set for AI/UI optional */ }
```

- [ ] **Step 3: Self-test in Node or browser**

Run (if node available):

```bash
cd /mnt/mydata/projects2/ys-games && node --input-type=module -e "
import { createInitialState, legalMoves, applyMrXMove, applyDetectiveMove, MAX_ROUND } from './games/scotland-yard/engine.js';
import map from './games/scotland-yard/cairo-map.json' assert { type: 'json' };
// After map exists — or use minimal fixture map in engine test
console.log('engine import ok');
"
```

Until map exists, embed a **minimal 6-node fixture** inside engine self-test function `runEngineSelfTests()` and call it from HTML later.

Expected: self-tests pass for move legality, capture, double on last round rejected, reveal projection hides pos.

- [ ] **Step 4: Commit**

```bash
git add games/scotland-yard/engine.js
git commit -m "feat(scotland-yard): pure rules engine"
```

---

### Task 2: Cairo map JSON (~70 stations)

**Files:**
- Create: `games/scotland-yard/cairo-map.json`

- [ ] **Step 1: Author map structure**

```json
{
  "id": "cairo-v1",
  "stations": [
    { "id": 1, "nameAr": "التحرير", "x": 480, "y": 420, "modes": ["taxi", "bus", "metro"] }
  ],
  "edges": [
    { "a": 1, "b": 2, "mode": "taxi" },
    { "a": 10, "b": 11, "mode": "river" }
  ],
  "startsMrX": [5, 12, 20, 28, 35, 42, 50, 61],
  "startsDetectives": [1, 3, 8, 15, 22, 30, 38, 45, 52, 58, 64, 70]
}
```

Invariants from spec: connected without river; taxi covers ≥90%; river ≥4 stations; start pools disjoint.

- [ ] **Step 2: Validate with a small script**

```bash
node --input-type=module <<'EOF'
import fs from 'fs';
const map = JSON.parse(fs.readFileSync('games/scotland-yard/cairo-map.json','utf8'));
// check counts, disjoint starts, connectivity via BFS on taxi|bus|metro
console.log('stations', map.stations.length);
EOF
```

Expected: 60–80 stations, no validation errors.

- [ ] **Step 3: Commit**

```bash
git add games/scotland-yard/cairo-map.json
git commit -m "feat(scotland-yard): Cairo schematic map data"
```

---

### Task 3: AI players

**Files:**
- Create: `games/scotland-yard/ai.js`
- Modify: `games/scotland-yard/engine.js` (export helpers if needed)

- [ ] **Step 1: Detective AI using possible-position set**

```js
export function chooseDetectiveMove(state, map, color, rng) {
  // possible set from ticket log + last reveal
  // pick ticket+to minimizing sum of graph distances to possible nodes
}
export function chooseMrXMove(state, map, rng) {
  // maximize min distance to detectives; save black/double when threatened
}
```

- [ ] **Step 2: Simulate full AI-vs-AI game**

```js
export function simulateGame(map, rng) { /* until ended; return winner */ }
```

Run 20 sims; expected: no throws; both winners occur sometimes.

- [ ] **Step 3: Commit**

```bash
git add games/scotland-yard/ai.js games/scotland-yard/engine.js
git commit -m "feat(scotland-yard): Mr X and detective AI"
```

---

### Task 4: Map UI + noir shell (solo playable)

**Files:**
- Create: `games/scotland-yard.html`
- Create: `games/scotland-yard/ui-map.js`

- [ ] **Step 1: HTML shell**

RTL Arabic menu:
- العنوان: اسكتلاند يارد · القاهرة
- أزرار: لعب جماعي · تدريب سيد X · تدريب محقق · كيف تلعب · رجوع للمنصة (`../index.html`)

CSS variables: `--bg:#0b1220`, `--gold:#d4af37`, panels, ticket colors.

- [ ] **Step 2: SVG map renderer**

`ui-map.js`:
- Draw edges by mode color (yellow/green/red/black dashed river)
- Stations as circles + numbers + optional name on zoom
- Pan/zoom (pointer events + wheel)
- Tokens for detectives; Mr X only if viewer is X or `state.mrX.revealedThisRound`
- Highlight legal destinations

- [ ] **Step 3: Wire solo practice**

- Train as X: human moves on X turn; AI for 4 detectives
- Train as detective: human picks 1 color (or all human-controlled seats); AI for X + other seats
- Ticket bar, travel log, round indicator, end overlay

- [ ] **Step 4: Manual test**

Open `games/scotland-yard.html` in browser; complete one short practice game as X.

Expected: moves apply, AI detectives move, capture/win messages Arabic.

- [ ] **Step 5: Commit**

```bash
git add games/scotland-yard.html games/scotland-yard/ui-map.js
git commit -m "feat(scotland-yard): solo UI and Cairo map renderer"
```

---

### Task 5: Multiplayer WebRTC

**Files:**
- Create: `games/scotland-yard/net.js`
- Add: `games/vendor/peerjs.min.js` (download official min build)
- Modify: `games/scotland-yard.html` (lobby + host/guest)

- [ ] **Step 1: Vendor PeerJS**

```bash
# download peerjs min to games/vendor/peerjs.min.js
curl -L -o games/vendor/peerjs.min.js "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js"
```

- [ ] **Step 2: Implement net.js**

```js
// HostPeer: create room, broadcast state, handle join/move
// GuestPeer: connect via URL params host peer id, send join/move
// Messages: join | lobby | state | move | event | host_left
```

- [ ] **Step 3: Lobby UI**

- Create room → show shareable URL (`location.href` with `?host=<id>&room=<code>`)
- Copy link button
- Seats 1 X + 4 detectives with names / AI badge
- Start button (host only)

- [ ] **Step 4: Sync game**

Host runs engine+AI; after each action `broadcast(project per peer)`.  
Guests render and send move intents only on their turn/seat.

- [ ] **Step 5: Two-browser test**

Host + guest same machine different profiles/ports or file vs server.

Expected: join, start, moves sync, reveal shows pos on both, host close → guest message.

- [ ] **Step 6: Commit**

```bash
git add games/vendor/peerjs.min.js games/scotland-yard/net.js games/scotland-yard.html
git commit -m "feat(scotland-yard): WebRTC multiplayer lobby and sync"
```

---

### Task 6: Polish, help, portal integration

**Files:**
- Modify: `games/scotland-yard.html` (help overlay, toasts, empty states)
- Create: `games/images/scotland-yard.webp` (or `.png`/`.svg` if easier — prefer webp/svg)
- Modify: `games.json`
- Modify: `version.json`

- [ ] **Step 1: In-game help**

Arabic short rules: goal, tickets, reveal rounds, black/double, how to share link.

- [ ] **Step 2: Thumbnail**

Generate or design simple noir gold card art (silhouette + Cairo night). Save under `games/images/scotland-yard.webp`.

- [ ] **Step 3: Register game**

`games.json` entry:

```json
{
  "id": "scotland-yard",
  "title": "اسكتلاند يارد · القاهرة",
  "description": "طارد السيد X في شوارع القاهرة! لعب جماعي عبر الأجهزة (رابط مشاركة) أو تدريب منفرد. ٤ محققين، تذاكر تاكسي وأتوبيس ومترو، وجو بوليسي ذهبي.",
  "url": "games/scotland-yard.html",
  "image": "games/images/scotland-yard.webp"
}
```

- [ ] **Step 4: version.json**

Bump `"version": 4` (or current+1) and add all new files to `files` array:
- `games/scotland-yard.html`
- `games/scotland-yard/cairo-map.json`
- `games/scotland-yard/engine.js`
- `games/scotland-yard/ai.js`
- `games/scotland-yard/net.js`
- `games/scotland-yard/ui-map.js`
- `games/vendor/peerjs.min.js`
- `games/images/scotland-yard.webp`

- [ ] **Step 5: Sync APK assets if script exists**

```bash
bash scripts/sync-apk-assets.sh
```

Expected: files under `ys-games-apk/app/src/main/assets/www/...`

- [ ] **Step 6: Final smoke**

- Portal loads card
- Solo X / solo detective
- Multiplayer link join
- Mobile viewport (~390px) usable

- [ ] **Step 7: Commit**

```bash
git add games.json version.json games/images/scotland-yard.webp games/scotland-yard.html ys-games-apk/app/src/main/assets/www 2>/dev/null
git commit -m "feat(scotland-yard): portal registration and polish"
```

---

## Testing checklist (release)

- [ ] Engine self-tests pass
- [ ] Map validation passes
- [ ] AI-vs-AI completes without throw
- [ ] Solo X can win and lose
- [ ] Solo detective capture works
- [ ] Guest never sees Mr X pos off-reveal (inspect state payload)
- [ ] Host disconnect message
- [ ] Arabic RTL no clipped tickets on phone
- [ ] `version.json` lists every asset

---

## Notes for implementers

- Prefer immutable state updates (`structuredClone` / spread) for easier net broadcast.
- Do not load PeerJS in pure solo path until multiplayer chosen (faster offline).
- Avoid English UI strings.
- Do not copy Ravensburger box art; original silhouette + Cairo night is fine.
- If PeerJS public broker is flaky, keep API seam to swap broker host later.
