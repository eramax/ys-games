/**
 * Scotland Yard · القاهرة — SVG board map: pan/zoom, clear stations, reliable taps.
 */

const MODE_STROKE = Object.freeze({
  taxi: { stroke: '#c9a227', width: 2.6, dash: null, opacity: 0.55 },
  bus: { stroke: '#1f9d66', width: 3.4, dash: null, opacity: 0.88 },
  metro: { stroke: '#e03d3d', width: 4.2, dash: null, opacity: 0.95 },
  river: { stroke: '#3d7ea6', width: 3.2, dash: '7 5', opacity: 0.85 },
});

const DET_FILL = Object.freeze({
  blue: '#3b82f6',
  red: '#ef4444',
  green: '#22c55e',
  purple: '#a855f7',
});

const STATION_R = 14;
const TOKEN_R = 15;
const DRAG_THRESHOLD_PX = 14;

/**
 * @param {HTMLElement} host - dedicated canvas element (not shared with badges)
 * @param {object} map
 */
export function createMapView(host, map) {
  if (!host) throw new Error('createMapView: host required');
  if (!map?.stations?.length) throw new Error('createMapView: map.stations required');

  const stationsById = new Map(map.stations.map((s) => [s.id, s]));

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
  const pad = 56;
  const vbX = minX - pad;
  const vbY = minY - pad;
  const vbW = maxX - minX + pad * 2;
  const vbH = maxY - minY + pad * 2;

  // Clear only this canvas host
  while (host.firstChild) host.removeChild(host.firstChild);
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
  svg.style.userSelect = 'none';

  const defs = el('defs');
  defs.innerHTML = `
    <linearGradient id="sy-board-bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1a2740"/>
      <stop offset="45%" stop-color="#121c30"/>
      <stop offset="100%" stop-color="#0b1220"/>
    </linearGradient>
    <linearGradient id="sy-nile-fill" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#1a4a66" stop-opacity="0.15"/>
      <stop offset="50%" stop-color="#2d7aad" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#1a4a66" stop-opacity="0.15"/>
    </linearGradient>
    <filter id="sy-token-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="1.5" stdDeviation="1.8" flood-color="#000" flood-opacity="0.55"/>
    </filter>
    <filter id="sy-hl-glow" x="-80%" y="-80%" width="260%" height="260%">
      <feDropShadow dx="0" dy="0" stdDeviation="3.5" flood-color="#f0d56a" flood-opacity="0.95"/>
    </filter>
  `;
  svg.appendChild(defs);

  svg.appendChild(
    el('rect', {
      x: vbX,
      y: vbY,
      width: vbW,
      height: vbH,
      fill: 'url(#sy-board-bg)',
    }),
  );

  // Nile band through map center-ish
  const nileX = minX + (maxX - minX) * 0.42;
  svg.appendChild(
    el('rect', {
      x: nileX - 38,
      y: vbY,
      width: 76,
      height: vbH,
      fill: 'url(#sy-nile-fill)',
      rx: 40,
    }),
  );

  // Soft district labels
  const labels = [
    { t: 'الجيزة', x: minX + 40, y: minY + 80 },
    { t: 'وسط البلد', x: nileX + 90, y: minY + (maxY - minY) * 0.42 },
    { t: 'مدينة نصر', x: maxX - 40, y: minY + (maxY - minY) * 0.35 },
    { t: 'المعادي', x: nileX + 70, y: maxY - 40 },
  ];
  for (const L of labels) {
    const text = el('text', {
      x: L.x,
      y: L.y,
      fill: 'rgba(212,175,55,0.14)',
      'font-size': '28',
      'font-weight': '900',
      'font-family': 'Cairo, sans-serif',
      'text-anchor': 'middle',
      'pointer-events': 'none',
    });
    text.textContent = L.t;
    svg.appendChild(text);
  }

  const world = el('g', { class: 'sy-world' });
  const gEdges = el('g', { class: 'sy-edges' });
  const gHighlights = el('g', { class: 'sy-highlights' });
  const gStations = el('g', { class: 'sy-stations' });
  const gTokens = el('g', { class: 'sy-tokens' });
  world.append(gEdges, gHighlights, gStations, gTokens);
  svg.appendChild(world);
  host.appendChild(svg);

  // Edges
  const modeOrder = ['taxi', 'bus', 'metro', 'river'];
  const edgesByMode = { taxi: [], bus: [], metro: [], river: [] };
  for (const e of map.edges || []) {
    if (edgesByMode[e.mode]) edgesByMode[e.mode].push(e);
  }
  for (const mode of modeOrder) {
    const style = MODE_STROKE[mode];
    if (!style) continue;
    const g = el('g', { class: `sy-edges-${mode}` });
    for (const edge of edgesByMode[mode]) {
      const a = stationsById.get(edge.a);
      const b = stationsById.get(edge.b);
      if (!a || !b) continue;
      // Slight curve offset for stacked modes
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ox = (-dy / len) * (mode === 'bus' ? 3 : mode === 'metro' ? -3 : 0);
      const oy = (dx / len) * (mode === 'bus' ? 3 : mode === 'metro' ? -3 : 0);
      const path = el('path', {
        d: `M ${a.x} ${a.y} Q ${midX + ox} ${midY + oy} ${b.x} ${b.y}`,
        stroke: style.stroke,
        'stroke-width': style.width,
        'stroke-opacity': style.opacity,
        'stroke-linecap': 'round',
        fill: 'none',
        'pointer-events': 'none',
      });
      if (style.dash) path.setAttribute('stroke-dasharray', style.dash);
      g.appendChild(path);
    }
    gEdges.appendChild(g);
  }

  /** @type {Map<number, SVGGElement>} */
  const stationNodes = new Map();
  let onStationClick = null;
  let scale = 1;
  let tx = 0;
  let ty = 0;

  // Pointer state
  /** @type {Map<number, {x:number,y:number}>} */
  const pointers = new Map();
  let panLast = null;
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  let dragMoved = false;
  let dragStart = null;
  let pressStationId = null;

  function fireStation(id) {
    if (typeof onStationClick === 'function') onStationClick(id);
  }

  for (const s of map.stations) {
    const g = el('g', {
      class: 'sy-station',
      'data-id': String(s.id),
      transform: `translate(${s.x},${s.y})`,
    });
    g.style.cursor = 'pointer';

    // Large invisible hit target for fat fingers
    const hit = el('circle', {
      r: STATION_R + 16,
      fill: 'rgba(0,0,0,0.001)',
      class: 'sy-station-hit',
    });
    const ring = el('circle', {
      r: STATION_R,
      class: 'sy-station-ring',
      fill: '#1a2438',
      stroke: '#d4af37',
      'stroke-width': 2,
    });

    // Mode color dots under ring
    const modes = s.modes || [];
    const modeColors = { taxi: '#e6c84a', bus: '#2fa86a', metro: '#d64545' };
    let mi = 0;
    for (const m of ['taxi', 'bus', 'metro']) {
      if (!modes.includes(m)) continue;
      const ang = (-60 + mi * 50) * (Math.PI / 180);
      const px = Math.cos(ang) * (STATION_R + 5);
      const py = Math.sin(ang) * (STATION_R + 5);
      g.appendChild(
        el('circle', {
          cx: px,
          cy: py,
          r: 2.6,
          fill: modeColors[m],
          'pointer-events': 'none',
        }),
      );
      mi++;
    }

    const num = el('text', {
      class: 'sy-station-num',
      y: 4.2,
      'text-anchor': 'middle',
      fill: '#f5e6b0',
      'font-size': '11',
      'font-weight': '800',
      'font-family': 'Cairo, sans-serif',
      'pointer-events': 'none',
    });
    num.textContent = String(s.id);

    const name = el('text', {
      class: 'sy-station-name',
      y: STATION_R + 14,
      'text-anchor': 'middle',
      fill: 'rgba(232,212,139,0.9)',
      'font-size': '9.5',
      'font-weight': '700',
      'font-family': 'Cairo, sans-serif',
      'pointer-events': 'none',
    });
    name.textContent = s.nameAr || '';

    g.append(hit, ring, num, name);
    gStations.appendChild(g);
    stationNodes.set(s.id, g);

    // Prefer pointerup over click so pan threshold works on mobile
    g.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      pressStationId = s.id;
      dragMoved = false;
      dragStart = { x: ev.clientX, y: ev.clientY };
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      try {
        g.setPointerCapture(ev.pointerId);
      } catch (_) {
        /* ignore */
      }
    });
    g.addEventListener('pointermove', (ev) => {
      if (pressStationId !== s.id) return;
      if (dragStart) {
        const dx = ev.clientX - dragStart.x;
        const dy = ev.clientY - dragStart.y;
        if (dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
          dragMoved = true;
          // hand off to map pan
          if (!pointers.has(ev.pointerId)) {
            pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
          }
          panLast = { x: ev.clientX, y: ev.clientY };
        }
      }
    });
    g.addEventListener('pointerup', (ev) => {
      if (pressStationId === s.id && !dragMoved) {
        ev.stopPropagation();
        fireStation(s.id);
      }
      pressStationId = null;
      pointers.delete(ev.pointerId);
      dragStart = null;
    });
    g.addEventListener('pointercancel', () => {
      pressStationId = null;
      dragStart = null;
    });
  }

  function applyTransform() {
    world.setAttribute('transform', `translate(${tx},${ty}) scale(${scale})`);
    const showNames = scale >= 0.95;
    gStations.querySelectorAll('.sy-station-name').forEach((n) => {
      n.setAttribute('opacity', showNames ? '1' : '0');
    });
  }

  function fitToHost() {
    scale = 1;
    tx = 0;
    ty = 0;
    applyTransform();
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
    const newScale = clamp(scale * factor, 0.5, 4.5);
    const k = newScale / scale;
    tx = before.x - k * (before.x - tx);
    ty = before.y - k * (before.y - ty);
    scale = newScale;
    applyTransform();
  }

  // Background pan (not on stations — stations stopPropagation on down)
  svg.addEventListener('pointerdown', (e) => {
    if (e.target.closest?.('.sy-station')) return;
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragMoved = false;
    dragStart = { x: e.clientX, y: e.clientY };
    pressStationId = null;
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
    if (!pointers.has(e.pointerId) && pressStationId == null) return;
    if (pointers.has(e.pointerId)) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (dragStart) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      if (dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) dragMoved = true;
    }

    // If station press turned into drag, pan map
    if (pressStationId != null && dragMoved) {
      if (!panLast) panLast = { x: e.clientX, y: e.clientY };
      const rect = svg.getBoundingClientRect();
      const sx = vbW / Math.max(1, rect.width);
      const sy = vbH / Math.max(1, rect.height);
      tx += (e.clientX - panLast.x) * sx;
      ty += (e.clientY - panLast.y) * sy;
      panLast = { x: e.clientX, y: e.clientY };
      applyTransform();
      return;
    }

    if (pointers.size === 1 && panLast && pressStationId == null) {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const rect = svg.getBoundingClientRect();
      const sx = vbW / Math.max(1, rect.width);
      const sy = vbH / Math.max(1, rect.height);
      tx += (p.x - panLast.x) * sx;
      ty += (p.y - panLast.y) * sy;
      panLast = { x: p.x, y: p.y };
      applyTransform();
    } else if (pointers.size === 2) {
      const pts = [...pointers.values()];
      const d = dist(pts[0], pts[1]);
      if (pinchStartDist > 0) {
        const factor = d / pinchStartDist;
        const target = clamp(pinchStartScale * factor, 0.5, 4.5);
        const m = mid(pts[0], pts[1]);
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
      panLast = mid(pts[0], pts[1]);
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      panLast = null;
      pinchStartDist = 0;
      svg.style.cursor = 'grab';
      dragStart = null;
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
      zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 0.9 : 1.1);
    },
    { passive: false },
  );

  function render(opts = {}) {
    const view = opts.view || {};
    const highlights = new Set(opts.highlights || []);
    const selected = opts.selectedStation ?? null;

    gHighlights.innerHTML = '';
    for (const id of highlights) {
      const s = stationsById.get(id);
      if (!s) continue;
      gHighlights.appendChild(
        el('circle', {
          cx: s.x,
          cy: s.y,
          r: STATION_R + 10,
          fill: 'rgba(240,213,106,0.22)',
          stroke: '#f0d56a',
          'stroke-width': 3,
          filter: 'url(#sy-hl-glow)',
          class: 'sy-hl',
          'pointer-events': 'none',
        }),
      );
      // Pulse ring
      gHighlights.appendChild(
        el('circle', {
          cx: s.x,
          cy: s.y,
          r: STATION_R + 16,
          fill: 'none',
          stroke: 'rgba(240,213,106,0.45)',
          'stroke-width': 2,
          'pointer-events': 'none',
          class: 'sy-hl-pulse',
        }),
      );
    }

    for (const [id, g] of stationNodes) {
      const ring = g.querySelector('.sy-station-ring');
      if (!ring) continue;
      if (selected === id) {
        ring.setAttribute('stroke', '#fff8d6');
        ring.setAttribute('stroke-width', '3');
        ring.setAttribute('fill', '#2a3858');
      } else if (highlights.has(id)) {
        ring.setAttribute('stroke', '#f0d56a');
        ring.setAttribute('stroke-width', '2.8');
        ring.setAttribute('fill', '#243450');
      } else {
        ring.setAttribute('stroke', '#d4af37');
        ring.setAttribute('stroke-width', '2');
        ring.setAttribute('fill', '#1a2438');
      }
    }

    gTokens.innerHTML = '';
    const lastKnown = view.mrX?.lastKnownPos;
    const livePos = view.mrX?.pos;
    const showLive = opts.showMrXLive !== undefined ? opts.showMrXLive : livePos != null;

    if (lastKnown != null && (!showLive || lastKnown !== livePos)) {
      const s = stationsById.get(lastKnown);
      if (s) {
        const g = el('g', {
          class: 'sy-token sy-token-ghost',
          transform: `translate(${s.x},${s.y})`,
          'pointer-events': 'none',
        });
        g.appendChild(
          el('circle', {
            r: TOKEN_R,
            fill: 'rgba(20,20,28,0.35)',
            stroke: 'rgba(212,175,55,0.55)',
            'stroke-width': 2,
            'stroke-dasharray': '4 3',
          }),
        );
        const t = el('text', {
          y: 5,
          'text-anchor': 'middle',
          fill: 'rgba(212,175,55,0.75)',
          'font-size': '11',
          'font-weight': '900',
          'font-family': 'Cairo, sans-serif',
        });
        t.textContent = '؟';
        g.appendChild(t);
        gTokens.appendChild(g);
      }
    }

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
          stroke: 'rgba(255,255,255,0.65)',
          'stroke-width': 2,
        }),
      );
      const letter = { blue: 'أ', red: 'ح', green: 'خ', purple: 'ب' }[color] || '';
      const t = el('text', {
        y: 4.5,
        'text-anchor': 'middle',
        fill: '#fff',
        'font-size': '11',
        'font-weight': '800',
        'font-family': 'Cairo, sans-serif',
      });
      t.textContent = letter;
      g.appendChild(t);
      gTokens.appendChild(g);
    }

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
            r: TOKEN_R + 2,
            fill: '#0a0a0f',
            stroke: '#f0d56a',
            'stroke-width': 2.6,
          }),
        );
        const t = el('text', {
          y: 5,
          'text-anchor': 'middle',
          fill: '#f0d56a',
          'font-size': '12',
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
    const targetScale = clamp(Math.max(scale, 1.15), 1.15, 2.4);
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
    while (host.firstChild) host.removeChild(host.firstChild);
    pointers.clear();
    onStationClick = null;
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
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
