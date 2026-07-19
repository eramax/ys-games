# Scotland Yard · القاهرة — Design Spec

**Date:** 2026-07-19  
**Status:** Approved for planning (user: no further design gates)  
**Game id:** `scotland-yard`  
**Title (AR):** اسكتلاند يارد · القاهرة  

---

## 1. Summary

Digital adaptation of Ravensburger’s *Scotland Yard* for the YS Games portal: streamlined rules, **Cairo** graph map, **full Arabic RTL UI**, dark **noir + gold** visual language. One **Mister X** vs **exactly 4 detectives**. Cross-device multiplayer via **WebRTC + shareable link** (host-authoritative). Empty detective seats filled by **AI**. Solo practice as Mr X or detectives vs AI.

Fits existing YS Games pattern: self-contained web game, listed in `games.json`, packaged into Android APK assets, static deploy on Vercel.

---

## 2. Goals & Non-Goals

### Goals
- Easy to learn on phone/tablet; professional noir look.
- True multiplayer across devices (tablet + phone) via one share link.
- Mr X secrecy: hidden position on detective devices except reveal rounds.
- Arabic-only product UI (labels, buttons, help, roles).
- Solo practice without network.
- Always 4 detectives on the board (humans + AI).

### Non-Goals
- Full 199-station London board or strict official ticket counts.
- Cloud-authoritative server / accounts / leaderboards.
- Voice chat, spectator mode, ranked matchmaking.
- GPS-accurate Cairo cartography (schematic graph only).
- Same-device hot-seat multiplayer as primary mode (optional later; not required).

---

## 3. Rules (Streamlined)

### Win conditions
- **Detectives win** if any detective ends on the same station as Mr X after a move resolution, or Mr X has no legal move.
- **Mr X wins** by surviving through **round 14** without capture.

### Roles
- 1 × Mister X (human or AI in practice).
- 4 × Detectives (colors: blue, red, green, purple). Each seat is human or AI.

### Transport
| Mode | Color | Who | Notes |
|------|--------|-----|--------|
| Taxi | Yellow | All | Short hops; most common edges |
| Bus | Green | All | Medium hops |
| Metro | Red | All | Long hops between hubs |
| River / black | Black | Mr X only | **Universal disguise + river:** black ticket may be used as taxi, bus, metro, **or** river at the current station (same as classic black ticket). River edges require black. |

### Tickets (starting)
**Each detective:** 10 taxi, 6 bus, 3 metro. Tickets are **not** shared between detectives.

**Mr X:** **unlimited** taxi/bus/metro for streamlining; finite **5 black** + **2 double-move**. Detectives still have finite tickets; stranded detective skips moves.

Rationale: reduces bookkeeping for mobile; detectives’ scarcity drives pressure; black/double remain the skill toys.

**Ticket log (no pool transfer):** When a detective spends a ticket, only the **type** is appended to Mr X’s public travel log for that detective’s move is **not** needed for X log — only **Mr X’s** moves appear on the travel log (type always; position only when revealed). Detective spends reduce their own counters only. Nothing is transferred into a Mr X ticket inventory.

### Reveal rounds & last-known position
Mr X’s **position** is shown to all after his move on rounds **3, 8, 13**. Round **14** is final. Between reveals, detectives see only **ticket type** in the travel log.

**Last-known (classic UX):** After a reveal, detectives keep a **ghost token** on that station as “آخر ظهور” until the next reveal updates it (or capture). The ghost is **not** Mr X’s live position. Only the Mr X player (and host process internals) sees the true live token every turn.

### Round counter & double move
- One **round** = one full Mr X action (which may be a single move **or** a double move of two legs) + all four detectives’ moves.
- A **double move** consumes **1 double token** + **one transport ticket per leg**. Both legs are separate log entries with the **same** `round` number.
- Reveal applies to the **round number**, not the leg: if `round ∈ {3,8,13}`, Mr X’s position after the **entire** double action (final station of the second leg) is revealed. Intermediate leg position is not shown to detectives.
- Double move is **illegal** on round 14 (only a single move allowed on the last round). On rounds 1–13, double is allowed if tokens remain.
- After Mr X finishes (single or double), `round` does not increment until all detectives have acted; then `round += 1`. Mr X wins when detectives finish acting on round 14 without capture.

### Occupancy & capture
- **Detectives may not occupy the same station** as each other. A detective cannot move onto a station occupied by another detective.
- **Mr X may not move onto a station occupied by a detective** — such destinations are illegal. If Mr X has zero legal destinations, detectives win immediately (trapped).
- **Capture:** after a detective completes a move onto Mr X’s **current** station, detectives win. (Mr X is never “on” a detective because that move is illegal for him.)
- Bypassing: bus/metro edges go station-to-station; there is no intermediate “pass through” occupancy on this streamlined graph (only endpoints matter).

### Turn order
1. Mr X moves (single or double; logs ticket(s); reveal if applicable).  
2. Detectives move in fixed color order: blue → red → green → purple.  
3. AI detectives move automatically on host with short delay for UX.  
4. Capture check after each detective move.  
5. If round was 14 and no capture → Mr X wins; else round += 1 and return to step 1.

### Setup
- Draw start positions from two pools: Mr X starts, detectives starts (predefined lists on map data, mutually well-spaced, **disjoint**).
- Mr X start hidden; detectives place tokens visibly.

---

## 4. Cairo Map

### Representation
- Undirected multigraph of **~70 stations** (ids `1…N`).
- Each station: `{ id, nameAr, x, y, modes: ['taxi'|'bus'|'metro'] }`.
- Edges: `{ a, b, mode }` including `river` for Mr X black routes.
- Layout coordinates in normalized 0–1000 space for SVG/canvas.

### Districts (names in Arabic on board)
وسط البلد، الزمالك، المهندسين، الدقي، مدينة نصر، مصر الجديدة، العباسية، المعادي، الجيزة، الأهرام، شبرا، روض الفرج، الخليفة، مصر القديمة، المقطم، بولاق، جاردن سيتي، كورنيش النيل (محاور).

### Graph invariants (map authoring)
- Station count target: 60–80 (ship ~70).
- Graph is **connected** via taxi∪bus∪metro (ignoring river).
- **Taxi** edges cover most stations (degree ≥ 1 taxi for ≥ 90% of nodes).
- **Bus** and **metro** form sparser overlays on hubs.
- **River** edges form a linear/path-like Nile band (Mr X only); ≥ 4 river stations.
- Start pools: `startsMrX` (≥ 8 ids), `startsDetectives` (≥ 12 ids), **disjoint** sets, pairwise graph distance preferably ≥ 3 between any detective start and Mr X start for drawn combinations (enforced at deal time by resampling).

### UX
- Pinch-zoom + pan; tap station to select when legal.
- Legal destinations highlighted by selected ticket type.
- Nile band as background art; stations as numbered gold-rimmed discs at night.

Map data file: `games/scotland-yard/cairo-map.json` (separate JSON for maintainability, listed in `version.json`).

---

## 5. Multiplayer Architecture

### Approach
**Host-authoritative WebRTC** with shareable link. Guests are thin clients.

### Stack
- **PeerJS** (or equivalent free peer broker) for WebRTC data channels + signaling.
- Room identity: random short code; host peer id encoded in URL  
  `games/scotland-yard.html?room=<code>&host=<peerId>`  
  Also show copyable full URL and optional room code display.
- No YS backend. Solo works fully offline (no PeerJS needed).

### Roles in session
| Device | Responsibility |
|--------|----------------|
| Host | Rules engine, AI, RNG starts, broadcast **role-projected** state, receive move intents, validate |
| Guest | Render received projection, send `{type:'move', ...}` intents |

**Fog of war on host UI:** Even though the host process stores full engine state, the **renderer always uses `projectPublicState(state, localViewerRole)`**. If the host player is a detective, their screen must **not** show live Mr X position (only last-known ghost + ticket log). Full state is never painted for the wrong role.

### Protocol (minimal)
```
host → peer: { type: 'state', version, view }   // view already projected for that peer’s role
guest → host: { type: 'join', name, preferredRole: 'x'|'blue'|'red'|'green'|'purple'|null }
host → all: { type: 'lobby', players, seats }
guest → host: { type: 'move', actor: 'x'|color, ticket, to }
              | { type: 'double', legs: [{ ticket, to }, { ticket, to }] }
host → all: { type: 'event', kind: 'reveal'|'capture'|'win'|... }
```

**Double move on wire:** single message `{ type:'double', legs:[leg1, leg2] }` — host validates both legs before applying. Not two separate turn messages.

**Seat claims:** First player to claim a free seat gets it (host included). Conflict → host rejects with seat taken; client must pick another. Host may force-assign empty seats before start. `preferredRole: null` = any free detective seat.

Private projection for Mr X viewer includes true position and black/double counts. Detective projections include `lastKnownPos` (or null before first reveal), never live `mrX.pos` off-reveal.

### Lobby
- Host creates room, picks preferred role (X or a detective seat).
- Up to 5 humans (1 X + 4 detectives).

**Multiplayer start rules (authoritative):**
- **Host may press «ابدأ» anytime** while in lobby.
- Empty seats (including Mr X) → filled by **AI** on start.
- Valid sessions include: all-human, mixed, or host alone with full AI (same as practice but via multiplayer entry).

### Disconnect
- Guest disconnect: seat becomes AI mid-game (host continues); rejoin by same link may reclaim seat if peer id/name matches (best-effort).
- Host disconnect: game ends for all with Arabic message «انقطع المضيف».

### PeerJS packaging
- Vendor **peerjs** min bundle under `games/vendor/peerjs.min.js` (same pattern as `three.min.js`) so APK/offline static hosting does not depend on a live npm CDN.
- Default cloud broker: PeerJS public server (`0.peerjs.com`) unless overridden later; document that multiplayer needs internet for signaling even though game state is P2P.

---

## 6. Solo / Practice

From main menu:
1. **تدريب: أنا السيد X** — 4 AI detectives, full fog rules.
2. **تدريب: أنا محقق** — player controls 1–4 detectives (picker), AI Mr X + remaining AI detectives.

No network. Same rules engine.

---

## 7. UI / UX

### Visual language (Noir gold)
- Background: deep navy/black `#0b1220`, gold accents `#d4af37`, muted steel panels.
- Typography: Cairo / Tajawal (match platform), RTL.
- Ticket chips: yellow / green / red / black with Arabic labels (تاكسي، أتوبيس، مترو، أسود).
- Mr X silhouette / fedora motif (original-inspired, not Ravensburger asset copy).

### Screens
1. **Menu** — title, multiplayer, practice, rules help, back to portal.
2. **Lobby** — seats, names, AI badges, share link, start.
3. **Game** — map (main), bottom sheet: tickets + turn status + travel log; detective tokens on map; Mr X token only when revealed or for X player.
4. **End** — win banner + **القائمة** (return to game menu). **No rematch-same-room in v1** (players create a new room or re-enter practice).

### Device layout
- Mobile: map full area, collapsible log, large ticket buttons.
- Tablet: map + side panel for log and tickets.
- Touch targets ≥ 44px.

### Accessibility / clarity
- Always show: round `الجولة n / 14`, whose turn, reveal countdown (“يظهر بعد جولتين”).
- Illegal moves disabled with short toast.

### Language
- All UI Arabic. No English chrome except optional Latin room codes if needed for URL safety (prefer digits + Arabic-friendly codes like `ق-3841` or pure `SY-AB12`).

---

## 8. AI (Host-side)

### Mr X AI
- Score moves by: distance from nearest detectives (graph distance), preserve black/double for pressure, prefer non-reveal exposure, bias toward river escapes when surrounded.

### Detective AI
- After last known position / ticket history, maintain **possible-position set** (constraint propagation on graph).
- Move to reduce max distance to possible set / cut key edges; prefer cheaper tickets when equivalent.

Keep AI deterministic-enough with seeded RNG on host for reproducibility in a session. Strength: “good casual”, not tournament.

---

## 9. Module Structure (files)

Prefer maintainable split under `games/scotland-yard/` while portal can open one HTML entry:

| Path | Responsibility |
|------|----------------|
| `games/scotland-yard.html` | Shell, screens, styles, boot |
| `games/scotland-yard/cairo-map.json` | Stations, edges, start pools |
| `games/scotland-yard/engine.js` | Pure rules: moves, tickets, win, possible-sets |
| `games/scotland-yard/ai.js` | Mr X + detective AI |
| `games/scotland-yard/net.js` | PeerJS host/guest, protocol |
| `games/scotland-yard/ui.js` | Map render, panels, lobby (or keep in HTML if size OK) |
| `games/images/scotland-yard.webp` | Portal card thumbnail |
| `games.json` | Register game |
| `version.json` | Bump version + list new files |
| APK assets | Via existing sync/build scripts |

**Engine purity:** `engine.js` has no DOM/network — unit-testable in browser console or tiny node tests if available.

### Integration
- Portal card Arabic description emphasizing multiplayer + Cairo.
- `YSSave` optional for “last practice settings” only; multiplayer state is live-only.

---

## 10. Game State Model (host)

```js
{
  phase: 'lobby' | 'playing' | 'ended',
  round: 1..14,
  turn: 'x' | 'blue' | 'red' | 'green' | 'purple',
  revealRounds: [3, 8, 13],
  mrX: { pos, tickets: {black, double}, log: [{round, ticket, pos?}] },
  detectives: {
    blue: { pos, tickets: {taxi, bus, metro}, controller: 'human'|'ai', playerId? },
    ...
  },
  winner: null | 'x' | 'detectives',
  mapId: 'cairo-v1'
}
```

Public projection strips `mrX.pos` and log `pos` fields unless revealed or viewer is Mr X.

---

## 11. Error Handling

- Invalid move → reject + toast; no state change.
- PeerJS fail → Arabic error «تعذّر الاتصال، تحقق من الإنترنت» + retry.
- Stale state version → full resync snapshot from host.
- Double-submit move → ignore if not your turn.

---

## 12. Testing Plan

1. **Engine unit checks** (manual or small script): legal moves, capture, reveal filtering, ticket spend, double move, stranded detective.
2. **AI smoke:** game completes 14 rounds without throw.
3. **UI:** solo X and solo detective on phone viewport.
4. **Net:** two browsers — host + guest join, move, reveal sync, host leave message.
5. **Portal:** card opens game; version.json includes assets.

---

## 13. Out of scope polish (later)
- Rematch same room, custom avatars, sound design pack, landscape-only lock, official Ravensburger licensing art.

---

## 14. Decisions log

| Decision | Choice |
|----------|--------|
| Rules depth | Streamlined B |
| Map | Cairo schematic ~70 nodes |
| Language | Arabic RTL |
| Detectives | Always 4 + AI fill |
| Multiplayer | WebRTC (PeerJS) + share link, host auth |
| Solo | Both roles vs AI |
| Visual | Noir gold |
| Architecture | Approach 1 single game + host engine |
| Mr X normal tickets | Unlimited taxi/bus/metro; finite black/double |
| Ticket transfer | Log type only; no pool transfer to Mr X |
| Rounds | 14; reveals 3, 8, 13 |
| Double move | One action / one round; two legs; reveal final pos if round is reveal; illegal on round 14 |
| Occupancy | Detectives unique stations; Mr X cannot enter detective station; capture = detective lands on X |
| Lobby start | Host anytime; empty seats AI (including AI Mr X) |
| Rematch | Out of v1; end screen → menu only |
| PeerJS | Vendored `games/vendor/peerjs.min.js` + public broker |
| Black ticket | Any transport including river (classic disguise) |
| Last-known | Ghost token stays until next reveal |
| Host fog | Host UI uses same projection as guests for local role |
| Double wire | One `double` message with two legs |
| Seat claim | First-claim wins; host can assign |

---

## 15. Success criteria

- Two real devices can open a shared link and complete a game.
- Mr X position never leaks to detective UI except on reveal/capture.
- Solo practice playable offline.
- UI fully Arabic, noir-gold, usable one-handed on phone.
- Registered on portal and APK asset list.
