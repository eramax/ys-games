/**
 * Scotland Yard · القاهرة — SVG map pan/zoom, edges, stations, tokens, highlights.
 * Pure view: render from projected public state + local UI selection.
 */

const MODE_STROKE = Object.freeze({
  taxi: { stroke: '#e6c84a', width: 2.2, dash: null, opacity: 0.85 },
  bus: { stroke: '#2fa86a', width: 2.8, dash: null, opacity: 0.9 },
  metro: { stroke: '#d64545', width: 3.4, dash: null, opacity: 0.92 },
  river: { stroke: '#4a6a8a', width: 2.4, dash: '6 4', opacity: 0.75 },
});

const DET_FILL = Object.freeze({
  blue: '#3b82f6',
  red: '#ef4444',
  green: '#22c55e',
  purple: '#a855f7',
});

const NAME_ZOOM_THRESHOLD = 1.35;
const STATION_R = 11;
const TOKEN_R = 13;

/**
 * @param {HTMLElement} host
 * @param {object} map - cairo-map.json
 */
export function createMapView(host, map) {
  if (!host) throw new Error('createMapView: host required');
  if (!map?.stations?.length) throw new Error('createMapView: map.stations required');

  const stationsById = new Map(map.stations.map((s) => [s.id, s]));

  // Bounds with padding
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of map.stations) {
    if (s.x < minX) minX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.x > maxX) maxX = s.x;
    if (s.y > maxY) maxY = s.y;
  }
  const pad = 40;
  const vbX = minX - pad;
  const vbY = minY - pad;
  const vbW = maxX - minX + pad * 2;
  const vbH = maxY - minY + pad * 2;

  host.innerHTML = '';
  host.classList.add('sy-map-host');

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'sy-map-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'خريطة القاهرة');
  svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
  svg.style.touchAction = 'none';
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.display = 'block';
  svg.style.cursor = 'grab';

  // Background layers
  const defs = el('defs');
  defs.innerHTML = `
    <radialGradient id="sy-bg-glow" cx="50%" cy="40%" r="65%">
      <stop offset="0%" stop-color="#1a2744" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#0b1220" stop-opacity="1"/>
    </radialGradient>
    <filter id="sy-token-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#000" flood-opacity="0.55"/>
    </filter>
    <filter id="sy-hl-glow" x="-80%" y="-80%" width="260%" height="260%">
      <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#d4af37" flood-opacity="0.85"/>
    </filter>
  `;
  svg.appendChild(defs);

  const bg = el('rect', {
    x: vbX,
    y: vbY,
    width: vbW,
    height: vbH,
    fill: 'url(#sy-bg-glow)',
  });
  svg.appendChild(bg);

  // Soft Nile band (decorative)
  const nile = el('path', {
    d: `M ${minX + vbW * 0.32} ${minY - 20}
        C ${minX + vbW * 0.38} ${minY + vbH * 0.25},
          ${minX + vbW * 0.28} ${minY + vbH * 0.55},
          ${minX + vbW * 0.34} ${minY + vbH + 20}`,
    fill: 'none',
    stroke: 'rgba(60,100,140,0.22)',
    'stroke-width': 48,
    'stroke-linecap': 'round',
  });
  svg.appendChild(nile);

  const world = el('g', { class: 'sy-world' });
  const gEdges = el('g', { class: 'sy-edges' });
  const gHighlights = el('g', { class: 'sy-highlights' });
  const gStations = el('g', { class: 'sy-stations' });
  const gTokens = el('g', { class: 'sy-tokens' });
  world.append(gEdges, gHighlights, gStations, gTokens);
  svg.appendChild(world);
  host.appendChild(svg);

  // Draw edges (taxi under, metro on top-ish)
  const modeOrder = ['taxi', 'bus', 'metro', 'river'];
  const edgesByMode = { taxi: [], bus: [], metro: [], river: [] };
  for (const e of map.edges || []) {
    if (edgesByMode[e.mode]) edgesByMode[e.mode].push(e);
  }
  for (const mode of modeOrder) {
    const style = MODE_STROKE[mode];
    if (!style) continue;
    const g = el('g', { class: `sy-edges-${mode}`, 'data-mode': mode });
    for (const edge of edgesByMode[mode]) {
      const a = stationsById.get(edge.a);
      const b = stationsById.get(edge.b);
      if (!a || !b) continue;
      const line = el('line', {
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        stroke: style.stroke,
        'stroke-width': style.width,
        'stroke-opacity': style.opacity,
        'stroke-linecap': 'round',
        fill: 'none',
      });
      if (style.dash) line.setAttribute('stroke-dasharray', style.dash);
      g.appendChild(line);
    }
    gEdges.appendChild(g);
  }

  // Stations
  /** @type {Map<number, SVGGElement>} */
  const stationNodes = new Map();
  for (const s of map.stations) {
    const g = el('g', {
      class: 'sy-station',
      'data-id': String(s.id),
      transform: `translate(${s.x},${s.y})`,
    });
    g.style.cursor = 'pointer';

    const hit = el('circle', {
      r: STATION_R + 8,
      fill: 'transparent',
      class: 'sy-station-hit',
    });
    const ring = el('circle', {
      r: STATION_R,
      class: 'sy-station-ring',
      fill: '#121a2b',
      stroke: '#d4af37',
      'stroke-width': 1.6,
    });
    // Mode pips (tiny arcs/dots)
    const modes = s.modes || [];
    if (modes.includes('metro')) {
      ring.setAttribute('stroke-width', '2.2');
    }
    const num = el('text', {
      class: 'sy-station-num',
      y: 3.5,
      'text-anchor': 'middle',
      fill: '#e8d9a0',
      'font-size': '9',
      'font-weight': '700',
      'font-family': 'Cairo, sans-serif',
      'pointer-events': 'none',
    });
    num.textContent = String(s.id);

    const name = el('text', {
      class: 'sy-station-name',
      y: STATION_R + 12,
      'text-anchor': 'middle',
      fill: 'rgba(212,175,55,0.75)',
      'font-size': '8',
      'font-weight': '600',
      'font-family': 'Cairo, sans-serif',
      'pointer-events': 'none',
      opacity: '0',
    });
    name.textContent = s.nameAr || '';

    g.append(hit, ring, num, name);
    gStations.appendChild(g);
    stationNodes.set(s.id, g);

    g.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (dragMoved) return;
      if (typeof onStationClick === 'function') onStationClick(s.id);
    });
  }

  // --- Camera (pan / zoom) ---
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let onStationClick = null;
  let dragMoved = false;

  function applyTransform() {
    world.setAttribute('transform', `translate(${tx},${ty}) scale(${scale})`);
    // Show names at higher zoom
    const showNames = scale >= NAME_ZOOM_THRESHOLD;
    gStations.querySelectorAll('.sy-station-name').forEach((n) => {
      n.setAttribute('opacity', showNames ? '1' : '0');
    });
  }

  function fitToHost() {
    // Start slightly zoomed to fill host; center content
    const rect = host.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) {
      scale = 1;
      tx = 0;
      ty = 0;
      applyTransform();
      return;
    }
    // viewBox already fits content; leave identity and slight inset via CSS
    scale = 1;
    tx = 0;
    ty = 0;
    applyTransform();
  }

  function clientToSvg(clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = pt.matrixTransform(ctm.inverse());
    // Convert through world inverse
    return {
      x: (p.x - tx) / scale,
      y: (p.y - ty) / scale,
    };
  }

  function zoomAt(clientX, clientY, factor) {
    const before = (() => {
      const pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return { x: 0, y: 0 };
      return pt.matrixTransform(ctm.inverse());
    })();
    const newScale = clamp(scale * factor, 0.55, 4.5);
    const k = newScale / scale;
    tx = before.x - k * (before.x - tx);
    ty = before.y - k * (before.y - ty);
    scale = newScale;
    applyTransform();
  }

  // Pointer pan + pinch
  /** @type {Map<number, {x:number,y:number}>} */
  const pointers = new Map();
  let panLast = null;
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  let dragStart = null;

  svg.addEventListener('pointerdown', (e) => {
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragMoved = false;
    dragStart = { x: e.clientX, y: e.clientY };
    if (pointers.size === 1) {
      panLast = { x: e.clientX, y: e.clientY };
      svg.style.cursor = 'grabbing';
    } else if (pointers.size === 2) {
      const pts = [...pointers.values()];
      pinchStartDist = dist(pts[0], pts[1]);
      pinchStartScale = scale;
      panLast = mid(pts[0], pts[1]);
    }
  });

  svg.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (dragStart) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      if (dx * dx + dy * dy > 16) dragMoved = true;
    }
    if (pointers.size === 1 && panLast) {
      const p = pointers.get(e.pointerId);
      const dx = p.x - panLast.x;
      const dy = p.y - panLast.y;
      // Convert screen delta to viewBox units
      const rect = svg.getBoundingClientRect();
      const sx = vbW / rect.width;
      const sy = vbH / rect.height;
      tx += dx * sx;
      ty += dy * sy;
      panLast = { x: p.x, y: p.y };
      applyTransform();
    } else if (pointers.size === 2) {
      const pts = [...pointers.values()];
      const d = dist(pts[0], pts[1]);
      if (pinchStartDist > 0) {
        const factor = d / pinchStartDist;
        const target = clamp(pinchStartScale * factor, 0.55, 4.5);
        const m = mid(pts[0], pts[1]);
        // Zoom toward pinch midpoint
        const before = (() => {
          const pt = svg.createSVGPoint();
          pt.x = m.x;
          pt.y = m.y;
          const ctm = svg.getScreenCTM();
          if (!ctm) return { x: 0, y: 0 };
          return pt.matrixTransform(ctm.inverse());
        })();
        const k = target / scale;
        tx = before.x - k * (before.x - tx);
        ty = before.y - k * (before.y - ty);
        scale = target;
        applyTransform();
      }
      // Pan with midpoint
      const m2 = mid(pts[0], pts[1]);
      if (panLast) {
        const rect = svg.getBoundingClientRect();
        const sx = vbW / rect.width;
        const sy = vbH / rect.height;
        tx += (m2.x - panLast.x) * sx;
        ty += (m2.y - panLast.y) * sy;
        applyTransform();
      }
      panLast = m2;
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      panLast = null;
      pinchStartDist = 0;
      svg.style.cursor = 'grab';
    } else if (pointers.size === 1) {
      const only = [...pointers.values()][0];
      panLast = { x: only.x, y: only.y };
      pinchStartDist = 0;
    }
  }
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);

  svg.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      zoomAt(e.clientX, e.clientY, factor);
    },
    { passive: false },
  );

  /**
   * Render tokens + highlights from projected view + UI selection.
   * @param {object} opts
   * @param {object} opts.view - projectPublicState result
   * @param {number[]} [opts.highlights] - legal destination station ids
   * @param {number|null} [opts.selectedStation]
   * @param {boolean} [opts.showMrXLive] - override (usually derived from view.mrX.pos)
   */
  function render(opts = {}) {
    const view = opts.view || {};
    const highlights = new Set(opts.highlights || []);
    const selected = opts.selectedStation ?? null;

    // Highlights
    gHighlights.innerHTML = '';
    for (const id of highlights) {
      const s = stationsById.get(id);
      if (!s) continue;
      const c = el('circle', {
        cx: s.x,
        cy: s.y,
        r: STATION_R + 6,
        fill: 'rgba(212,175,55,0.18)',
        stroke: '#d4af37',
        'stroke-width': 2.2,
        filter: 'url(#sy-hl-glow)',
        class: 'sy-hl',
        'pointer-events': 'none',
      });
      gHighlights.appendChild(c);
    }

    // Station ring states
    for (const [id, g] of stationNodes) {
      const ring = g.querySelector('.sy-station-ring');
      if (!ring) continue;
      if (selected === id) {
        ring.setAttribute('stroke', '#fff3c4');
        ring.setAttribute('stroke-width', '2.6');
        ring.setAttribute('fill', '#1c2740');
      } else if (highlights.has(id)) {
        ring.setAttribute('stroke', '#f0d56a');
        ring.setAttribute('stroke-width', '2.2');
        ring.setAttribute('fill', '#1a2438');
      } else {
        ring.setAttribute('stroke', '#d4af37');
        ring.setAttribute('stroke-width', '1.6');
        ring.setAttribute('fill', '#121a2b');
      }
    }

    // Tokens
    gTokens.innerHTML = '';

    // Ghost last-known Mr X
    const lastKnown = view.mrX?.lastKnownPos;
    const livePos = view.mrX?.pos;
    const showLive =
      opts.showMrXLive !== undefined ? opts.showMrXLive : livePos != null;

    if (lastKnown != null && (!showLive || lastKnown !== livePos)) {
      const s = stationsById.get(lastKnown);
      if (s) {
        const g = el('g', {
          class: 'sy-token sy-token-ghost',
          transform: `translate(${s.x},${s.y})`,
          filter: 'url(#sy-token-glow)',
          'pointer-events': 'none',
        });
        g.appendChild(
          el('circle', {
            r: TOKEN_R,
            fill: 'rgba(20,20,28,0.35)',
            stroke: 'rgba(212,175,55,0.55)',
            'stroke-width': 1.8,
            'stroke-dasharray': '3 2',
          }),
        );
        const t = el('text', {
          y: 3.5,
          'text-anchor': 'middle',
          fill: 'rgba(212,175,55,0.7)',
          'font-size': '9',
          'font-weight': '800',
          'font-family': 'Cairo, sans-serif',
        });
        t.textContent = 'X';
        g.appendChild(t);
        gTokens.appendChild(g);
      }
    }

    // Detectives
    const dets = view.detectives || {};
    for (const color of ['blue', 'red', 'green', 'purple']) {
      const d = dets[color];
      if (!d || d.pos == null) continue;
      const s = stationsById.get(d.pos);
      if (!s) continue;
      const fill = DET_FILL[color] || '#888';
      const g = el('g', {
        class: `sy-token sy-token-${color}`,
        transform: `translate(${s.x},${s.y})`,
        filter: 'url(#sy-token-glow)',
        'pointer-events': 'none',
      });
      g.appendChild(
        el('circle', {
          r: TOKEN_R,
          fill,
          stroke: 'rgba(255,255,255,0.55)',
          'stroke-width': 1.6,
        }),
      );
      // Small badge letter
      const letter = { blue: 'أ', red: 'ح', green: 'خ', purple: 'ب' }[color] || '';
      const t = el('text', {
        y: 3.8,
        'text-anchor': 'middle',
        fill: '#fff',
        'font-size': '10',
        'font-weight': '800',
        'font-family': 'Cairo, sans-serif',
      });
      t.textContent = letter;
      g.appendChild(t);
      gTokens.appendChild(g);
    }

    // Live Mr X
    if (showLive && livePos != null) {
      const s = stationsById.get(livePos);
      if (s) {
        const g = el('g', {
          class: 'sy-token sy-token-x',
          transform: `translate(${s.x},${s.y})`,
          filter: 'url(#sy-token-glow)',
          'pointer-events': 'none',
        });
        g.appendChild(
          el('circle', {
            r: TOKEN_R + 1,
            fill: '#0a0a0f',
            stroke: '#d4af37',
            'stroke-width': 2.2,
          }),
        );
        // Fedora-ish mark
        g.appendChild(
          el('ellipse', {
            cx: 0,
            cy: -2,
            rx: 7,
            ry: 3.2,
            fill: '#1a1a22',
            stroke: '#d4af37',
            'stroke-width': 0.8,
          }),
        );
        const t = el('text', {
          y: 6,
          'text-anchor': 'middle',
          fill: '#d4af37',
          'font-size': '9',
          'font-weight': '900',
          'font-family': 'Cairo, sans-serif',
        });
        t.textContent = 'X';
        g.appendChild(t);
        gTokens.appendChild(g);
      }
    }
  }

  function focusStation(id, animate = true) {
    const s = stationsById.get(id);
    if (!s) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width < 10) return;
    const targetScale = clamp(scale, 1.2, 2.2);
    // Center station in viewBox space
    const cx = vbX + vbW / 2;
    const cy = vbY + vbH / 2;
    const nextTx = cx - s.x * targetScale;
    const nextTy = cy - s.y * targetScale;
    if (!animate) {
      scale = targetScale;
      tx = nextTx;
      ty = nextTy;
      applyTransform();
      return;
    }
    const from = { scale, tx, ty };
    const t0 = performance.now();
    const dur = 280;
    function step(now) {
      const u = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - u, 3);
      scale = from.scale + (targetScale - from.scale) * e;
      tx = from.tx + (nextTx - from.tx) * e;
      ty = from.ty + (nextTy - from.ty) * e;
      applyTransform();
      if (u < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function destroy() {
    host.innerHTML = '';
    pointers.clear();
  }

  fitToHost();

  return {
    svg,
    render,
    fitToHost,
    focusStation,
    destroy,
    setOnStationClick(fn) {
      onStationClick = fn;
    },
    getScale: () => scale,
    stationsById,
  };
}

function el(tag, attrs = {}) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    n.setAttribute(k, String(v));
  }
  return n;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
