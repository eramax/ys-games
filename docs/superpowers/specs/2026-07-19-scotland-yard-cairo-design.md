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
| River / black | Black | Mr X only | Nile edges; needs black ticket |

### Tickets (starting)
**Each detective:** 10 taxi, 6 bus, 3 metro. Tickets are **not** shared between detectives. Used tickets go to Mr X’s pool (visible log for detectives is type-only; destination secret).

**Mr X:** starts with a large pool of taxi/bus/metro (or unlimited normal tickets for streamlining — **decision: unlimited yellow/green/red for Mr X**, finite **5 black** + **2 double-move**). Detectives still have finite tickets; stranded detective skips moves.

Rationale: reduces bookkeeping for mobile; detectives’ scarcity drives pressure; black/double remain the skill toys.

### Reveal rounds
Mr X’s **position** is shown to all after moves on rounds **3, 8, 13**. Round **14** is final (no need for extra reveal if already caught or win by survival). Between reveals, detectives see only **ticket type** in the travel log.

### Double move
Consumes one double-move token + one transport ticket per half-move. Both legs logged. If first leg is a reveal round, position shows briefly then hides for second leg (classic behavior).

### Turn order
1. Mr X moves (and logs ticket; reveal if applicable).  
2. Detectives move in fixed color order: blue → red → green → purple.  
3. AI detectives move automatically on host with short delay for UX.  
4. Capture check after each detective move.

### Setup
- Draw start positions from two pools: Mr X starts, detectives starts (predefined lists on map data, mutually well-spaced).
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

### UX
- Pinch-zoom + pan; tap station to select when legal.
- Legal destinations highlighted by selected ticket type.
- Nile band as background art; stations as numbered gold-rimmed discs at night.

Map data file: `games/scotland-yard/cairo-map.json` (or embedded in HTML if prefer single-file — **prefer separate JSON** for maintainability, listed in `version.json`).

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
| Host | Rules engine, AI, RNG starts, broadcast public state, receive move intents, validate |
| Guest | Render role-filtered view, send `{type:'move', ...}` intents, receive state snapshots |

### Protocol (minimal)
```
host → all: { type: 'state', version, publicState, privateFor?: { playerId, payload } }
guest → host: { type: 'join', name, preferredRole }
host → all: { type: 'lobby', players, seats }
guest → host: { type: 'move', detectiveId?| 'x', ticket, to, doubleSecond? }
host → all: { type: 'event', kind: 'reveal'|'capture'|'win'|... }
```

Private payload for Mr X includes true position and remaining black/double. Detectives never receive true position except on reveal flags in public state.

### Lobby
- Host creates room, picks preferred role (X or detective seat).
- Up to 5 humans (1 X + 4 detectives). Start allowed when host presses start.
- Unfilled detective seats → AI on start.
- Mr X seat: if empty at start → only valid in **practice** flows, not public multiplayer (multiplayer requires human X **or** explicitly “train as detectives vs AI X” from solo menu).

**Multiplayer start rules:**
- At least 2 human connections **or** 1 human + any AI fill is OK if host chose “play with friends” and X is human.
- Simpler rule: **Host may start anytime.** Empty seats AI. If no human X, AI is Mr X (useful when host is a detective and friends join as detectives only).

### Disconnect
- Guest disconnect: seat becomes AI mid-game (host continues); rejoin by same link may reclaim seat if peer id/name matches (best-effort).
- Host disconnect: game ends for all with Arabic message «انقطع المضيف».

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
4. **End** — win banner + rematch / menu.

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
| Rounds | 14; reveals 3, 8, 13 |

---

## 15. Success criteria

- Two real devices can open a shared link and complete a game.
- Mr X position never leaks to detective UI except on reveal/capture.
- Solo practice playable offline.
- UI fully Arabic, noir-gold, usable one-handed on phone.
- Registered on portal and APK asset list.
