// SVG scene renderer. Patches only what changed so large diagrams stay responsive.
import { sv, setAttrs, wrapText, fontString, clamp } from './util.js';
import { shapePath, shapeDecor, textBox, PORTS, portLocal, SHAPES } from './shapes.js';
import { routeEdge, THEMES, DASHES } from './model.js';

const HANDLES = [
  ['nw', 0, 0], ['n', .5, 0], ['ne', 1, 0], ['e', 1, .5],
  ['se', 1, 1], ['s', .5, 1], ['sw', 0, 1], ['w', 0, .5],
];

export class Renderer {
  constructor(svg, store) {
    this.svg = svg; this.store = store;
    this.nodeEls = new Map(); this.edgeEls = new Map();
    this.nodeSig = new Map(); this.edgeSig = new Map();
    this.issues = new Map();     // nodeId|edgeId -> 'error'|'warning'
    this.findIds = new Set(); this.findCurrent = null;
    this.hoverNode = null;
    this._markers = new Set();
    this.build();
  }

  build() {
    const svg = this.svg;
    svg.textContent = '';
    this.defs = sv('defs'); svg.append(this.defs);

    // grid lives in screen space; the pattern transform follows the viewport
    this.gridPattern = sv('pattern', { id: 'ffGrid', patternUnits: 'userSpaceOnUse', width: 20, height: 20 });
    this.gridMinor = sv('path', { d: 'M20,0H0V20', fill: 'none', 'stroke-width': 1 });
    this.gridPattern.append(this.gridMinor);
    this.defs.append(this.gridPattern);
    this.gridRect = sv('rect', { x: 0, y: 0, width: '100%', height: '100%', fill: 'url(#ffGrid)', 'pointer-events': 'none' });
    svg.append(this.gridRect);

    this.root = sv('g', { id: 'ffRoot' });
    this.edgeLayer = sv('g', { class: 'edges' });
    this.nodeLayer = sv('g', { class: 'nodes' });
    this.overlay = sv('g', { class: 'overlay', 'pointer-events': 'none' });
    this.root.append(this.edgeLayer, this.nodeLayer, this.overlay);
    svg.append(this.root);

    this.selLayer = sv('g'); this.portLayer = sv('g', { 'pointer-events': 'all' });
    this.guideLayer = sv('g'); this.gizmoLayer = sv('g'); this.findLayer = sv('g');
    this.overlay.append(this.findLayer, this.selLayer, this.guideLayer, this.gizmoLayer, this.portLayer);
    this.overlay.setAttribute('pointer-events', 'none');
    this.portLayer.setAttribute('pointer-events', 'all');
  }

  /* ---------- viewport ---------- */
  applyViewport() {
    const { x, y, k } = this.store.viewport;
    this.root.setAttribute('transform', `translate(${x},${y}) scale(${k})`);
    const s = this.gridStep * k;
    setAttrs(this.gridPattern, { width: s, height: s, patternTransform: `translate(${x % s},${y % s})` });
    this.gridMinor.setAttribute('d', `M${s},0H0V${s}`);
    this.gridRect.style.display = this.store.doc.settings.grid && s >= 7 ? '' : 'none';
    this.scaleGizmos();
  }
  get gridStep() { return (this.store.doc.settings.gridSize || 10) * 2; }
  screenToWorld(px, py) {
    const r = this.svg.getBoundingClientRect();
    const { x, y, k } = this.store.viewport;
    return { x: (px - r.left - x) / k, y: (py - r.top - y) / k };
  }
  worldToScreen(wx, wy) {
    const r = this.svg.getBoundingClientRect();
    const { x, y, k } = this.store.viewport;
    return { x: wx * k + x + r.left, y: wy * k + y + r.top };
  }
  size() { const r = this.svg.getBoundingClientRect(); return { w: r.width, h: r.height }; }

  /* ---------- theme / grid ---------- */
  applyTheme() {
    const t = THEMES[this.store.doc.settings.theme] || THEMES.midnight;
    this.svg.style.setProperty('--canvas-bg', t.bg);
    this.gridMinor.setAttribute('stroke', t.grid);
    this.themeBg = t.bg;
    this.applyViewport();
  }

  /* ---------- full sync ---------- */
  render() {
    const doc = this.store.doc;
    this.applyTheme();
    const liveNodes = new Set(doc.nodes.map((n) => n.id));
    const liveEdges = new Set(doc.edges.map((e) => e.id));
    for (const [id, el] of this.nodeEls) if (!liveNodes.has(id)) { el.remove(); this.nodeEls.delete(id); this.nodeSig.delete(id); }
    for (const [id, el] of this.edgeEls) if (!liveEdges.has(id)) { el.remove(); this.edgeEls.delete(id); this.edgeSig.delete(id); }
    for (const n of doc.nodes) this.syncNode(n);
    for (const e of doc.edges) this.syncEdge(e);
    // keep DOM order matching document order (cheap: only when counts differ)
    this.decorate();
  }

  /* ---------- nodes ---------- */
  syncNode(n) {
    let g = this.nodeEls.get(n.id);
    if (!g) {
      g = sv('g', { class: 'node' + (n.type === 'lane' ? ' lane' : ''), 'data-id': n.id, tabindex: -1, role: 'group' });
      g.append(sv('path', { class: 'shape' }), sv('g', { class: 'decor' }), sv('text', { class: 'label' }), sv('g', { class: 'badges' }));
      if (n.type === 'lane') this.nodeLayer.prepend(g); else this.nodeLayer.append(g);   // lanes sit behind everything
      this.nodeEls.set(n.id, g);
    }
    const sig = JSON.stringify([n.type, n.w, n.h, n.text, n.style, n.code?.source ? 1 : 0, this.issues.get(n.id) || 0]);
    g.setAttribute('transform', `translate(${n.x},${n.y})`);
    g.classList.toggle('lane', n.type === 'lane');
    if (this.nodeSig.get(n.id) === sig) return g;
    this.nodeSig.set(n.id, sig);

    const st = n.style || {};
    const shape = g.children[0];
    setAttrs(shape, {
      d: shapePath(n.type, n.w, n.h, st.radius ?? 10),
      fill: n.type === 'note' ? 'none' : (st.fill || '#fff'),
      stroke: st.stroke || '#888',
      'stroke-width': st.strokeWidth ?? 2,
      'stroke-dasharray': DASHES[st.dash] || null,
    });
    const decor = g.children[1];
    const paths = shapeDecor(n.type, n.w, n.h);
    while (decor.childElementCount > paths.length) decor.lastChild.remove();
    while (decor.childElementCount < paths.length) decor.append(sv('path', { fill: 'none' }));
    paths.forEach((d, i) => setAttrs(decor.children[i], { d, stroke: st.stroke || '#888', 'stroke-width': st.strokeWidth ?? 2 }));

    // label
    const text = g.children[2];
    const box = textBox(n.type, n.w, n.h);
    const font = fontString(st);
    const lines = wrapText(n.text, Math.max(box.w, 16), font);
    const lh = (st.fontSize || 14) * 1.3;
    const anchor = st.align === 'left' ? 'start' : st.align === 'right' ? 'end' : 'middle';
    const tx = st.align === 'left' ? box.x : st.align === 'right' ? box.x + box.w : box.x + box.w / 2;
    setAttrs(text, {
      'font-family': st.fontFamily, 'font-size': st.fontSize, 'font-weight': st.fontWeight,
      'font-style': st.fontStyle === 'italic' ? 'italic' : null,
      fill: st.textColor || '#111', 'text-anchor': anchor,
    });
    text.textContent = '';
    const y0 = box.y + box.h / 2 - ((lines.length - 1) * lh) / 2 + (st.fontSize || 14) * .34;
    lines.forEach((ln, i) => {
      const ts = sv('tspan', { x: tx, y: y0 + i * lh });
      ts.textContent = ln || ' ';
      text.append(ts);
    });

    // badges
    const badges = g.children[3];
    badges.textContent = '';
    const sev = this.issues.get(n.id);
    let bx = n.w - 6;
    if (sev) {
      badges.append(this.badge(bx, 6, sev === 'error' ? 'badge-err' : 'badge-warn', sev === 'error' ? '!' : '?'));
      bx -= 19;
    }
    if (n.code?.source && this.store.doc.settings.showCodeBadges) {
      badges.append(this.badge(bx, 6, 'badge-code', '{ }'));
    }
    g.setAttribute('aria-label', `${(SHAPES[n.type] || {}).label || n.type}: ${n.text || 'untitled'}`);
    return g;
  }
  badge(x, y, cls, glyph) {
    const g = sv('g', { transform: `translate(${x - 8},${y})` });
    g.append(sv('circle', { class: cls, cx: 0, cy: 0, r: 8 }));
    const t = sv('text', { x: 0, y: 3.2, 'text-anchor': 'middle', 'font-size': glyph.length > 1 ? 8 : 11, 'font-weight': 700, fill: '#0c1016', 'font-family': 'Inter, sans-serif' });
    t.textContent = glyph;
    g.append(t);
    return g;
  }

  /* ---------- edges ---------- */
  syncEdge(e) {
    const doc = this.store.doc;
    const r = routeEdge(doc, e);
    let g = this.edgeEls.get(e.id);
    if (!r) { if (g) { g.remove(); this.edgeEls.delete(e.id); } return; }
    if (!g) {
      g = sv('g', { class: 'edge', 'data-id': e.id });
      g.append(sv('path', { class: 'edge-hit' }), sv('path', { class: 'wire' }), sv('text', { class: 'elabel' }));
      this.edgeLayer.append(g);
      this.edgeEls.set(e.id, g);
    }
    const st = e.style || {};
    const ms = this.marker(st.arrowStart, st.stroke), me = this.marker(st.arrowEnd, st.stroke);
    g.children[0].setAttribute('d', r.d);
    setAttrs(g.children[1], {
      d: r.d, stroke: st.stroke || '#888', 'stroke-width': st.strokeWidth ?? 2,
      'stroke-dasharray': DASHES[st.dash] || null,
      'marker-start': ms ? `url(#${ms})` : null,
      'marker-end': me ? `url(#${me})` : null,
    });
    const lab = g.children[2];
    if (e.label) {
      setAttrs(lab, {
        x: r.label.x, y: r.label.y + 4, 'text-anchor': 'middle',
        'font-size': st.fontSize || 12, fill: st.labelColor || st.stroke,
        'font-family': 'Inter, sans-serif', stroke: this.themeBg, 'stroke-width': 4, 'paint-order': 'stroke',
      });
      lab.textContent = e.label;
      lab.style.display = '';
    } else { lab.style.display = 'none'; lab.textContent = ''; }
    const sev = this.issues.get(e.id);
    g.classList.toggle('issue', !!sev);
    return g;
  }

  marker(kind, color) {
    if (!kind || kind === 'none') return null;
    const id = 'ar-' + kind + '-' + String(color || '#000').replace(/[^a-z0-9]/gi, '');
    if (this._markers.has(id)) return id;
    const m = sv('marker', {
      id, viewBox: '0 0 10 10', refX: kind === 'circle' ? 5 : kind === 'bar' ? 5 : 9, refY: 5,
      markerWidth: 5, markerHeight: 5, markerUnits: 'strokeWidth', orient: 'auto-start-reverse',
    });
    let shape;
    if (kind === 'arrow') shape = sv('path', { d: 'M0.5,0.5L9.5,5L0.5,9.5Z', fill: color });
    else if (kind === 'open') shape = sv('path', { d: 'M1,1L9,5L1,9', fill: 'none', stroke: color, 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    else if (kind === 'circle') shape = sv('circle', { cx: 5, cy: 5, r: 3.6, fill: color });
    else if (kind === 'diamond') shape = sv('path', { d: 'M0.5,5L5,0.8L9.5,5L5,9.2Z', fill: color });
    else shape = sv('path', { d: 'M5,0.5V9.5', stroke: color, 'stroke-width': 2 });
    m.append(shape);
    this.defs.append(m);
    this._markers.add(id);
    return id;
  }

  /* ---------- fast paths ---------- */
  /** Move/resize without rebuilding labels when geometry only changed. */
  patchNodes(ids) {
    const doc = this.store.doc;
    const touched = new Set();
    for (const id of ids) {
      const n = doc.nodes.find((x) => x.id === id);
      if (!n) continue;
      this.syncNode(n);
      touched.add(id);
    }
    for (const e of doc.edges) if (touched.has(e.from) || touched.has(e.to)) this.syncEdge(e);
    this.decorate();
  }
  patchEdges(ids) {
    const doc = this.store.doc;
    for (const id of ids) {
      const e = doc.edges.find((x) => x.id === id);
      if (e) { this.edgeSig.delete(id); this.syncEdge(e); }
    }
  }

  /* ---------- selection, handles, ports ---------- */
  decorate() {
    const { selNodes, selEdges } = this.store;
    for (const [id, el] of this.edgeEls) el.classList.toggle('sel', selEdges.has(id));
    this.selLayer.textContent = '';
    this.gizmoLayer.textContent = '';
    const nodes = this.store.selectedNodes();
    for (const n of nodes) {
      this.selLayer.append(sv('rect', {
        class: 'selring', x: n.x - 4, y: n.y - 4, width: n.w + 8, height: n.h + 8, rx: 7,
        'vector-effect': 'non-scaling-stroke',
      }));
    }
    const gids = new Set(nodes.map((n) => n.group).filter(Boolean));
    for (const gid of gids) {
      const mem = this.store.doc.nodes.filter((n) => n.group === gid);
      const x0 = Math.min(...mem.map((n) => n.x)) - 10, y0 = Math.min(...mem.map((n) => n.y)) - 10;
      const x1 = Math.max(...mem.map((n) => n.x + n.w)) + 10, y1 = Math.max(...mem.map((n) => n.y + n.h)) + 10;
      this.selLayer.append(sv('rect', { class: 'groupring', x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: 10, 'vector-effect': 'non-scaling-stroke' }));
    }
    if (nodes.length === 1) {
      const n = nodes[0];
      for (const [name, fx, fy] of HANDLES) {
        this.gizmoLayer.append(sv('rect', {
          class: 'handle', 'data-handle': name, 'data-id': n.id,
          x: n.x + n.w * fx, y: n.y + n.h * fy, width: 1, height: 1,
          'vector-effect': 'non-scaling-stroke',
        }));
      }
      this.gizmoLayer.setAttribute('pointer-events', 'all');
    }
    this.renderPorts();
    this.renderFind();
    this.scaleGizmos();
  }
  renderPorts() {
    this.portLayer.textContent = '';
    const doc = this.store.doc;
    const ids = new Set(this.store.selNodes);
    if (this.hoverNode) ids.add(this.hoverNode);
    for (const id of ids) {
      const n = doc.nodes.find((x) => x.id === id);
      if (!n || n.type === 'note' || n.type === 'lane') continue;
      for (const p of PORTS) {
        const pt = portLocal(n.type, n.w, n.h, p);
        const cx = n.x + pt.x, cy = n.y + pt.y;
        this.portLayer.append(sv('circle', { class: 'porthit', 'data-port': p, 'data-id': n.id, cx, cy, r: 1 }));
        this.portLayer.append(sv('circle', { class: 'port', 'data-port': p, 'data-id': n.id, cx, cy, r: 1, 'vector-effect': 'non-scaling-stroke' }));
      }
    }
    this.scaleGizmos();
  }
  scaleGizmos() {
    const k = this.store.viewport.k || 1;
    const coarse = matchMedia('(pointer: coarse)').matches;
    const hs = (coarse ? 16 : 8) / k;
    for (const r of this.gizmoLayer.children) {
      const x = +r.getAttribute('x'), y = +r.getAttribute('y');
      if (r._cx === undefined) { r._cx = x; r._cy = y; }
      setAttrs(r, { x: r._cx - hs / 2, y: r._cy - hs / 2, width: hs, height: hs, rx: 2 / k });
    }
    for (const c of this.portLayer.children) {
      const isHit = c.classList.contains('porthit');
      c.setAttribute('r', (isHit ? (coarse ? 20 : 11) : (coarse ? 7 : 5)) / k);
      if (!isHit) c.setAttribute('stroke-width', 1.5 / k);
    }
    for (const r of this.findLayer.children) r.setAttribute('rx', 8 / k);
  }
  setHover(id) {
    if (this.hoverNode === id) return;
    this.hoverNode = id;
    this.renderPorts();
  }

  /* ---------- transient overlays ---------- */
  guides(list) {
    this.guideLayer.textContent = '';
    for (const g of list) {
      this.guideLayer.append(sv('line', { class: 'guide', x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2 }));
    }
  }
  marquee(rect) {
    if (!this._marq) { this._marq = sv('rect', { class: 'marquee', rx: 2 }); }
    if (!rect) { this._marq.remove(); return; }
    if (!this._marq.parentNode) this.guideLayer.append(this._marq);
    setAttrs(this._marq, { x: rect.x, y: rect.y, width: rect.w, height: rect.h });
  }
  linkPreview(d) {
    if (!this._link) this._link = sv('path', { class: 'linkpreview' });
    if (!d) { this._link.remove(); return; }
    if (!this._link.parentNode) this.guideLayer.append(this._link);
    this._link.setAttribute('d', d);
  }
  dropTarget(node, port) {
    if (!this._drop) this._drop = sv('path', { class: 'droptarget' });
    if (!node) { this._drop.remove(); return; }
    if (!this._drop.parentNode) this.guideLayer.append(this._drop);
    this._drop.setAttribute('transform', `translate(${node.x},${node.y})`);
    this._drop.setAttribute('d', shapePath(node.type, node.w, node.h, node.style?.radius ?? 10));
  }
  ghost(nodes) {
    if (!this._ghost) this._ghost = sv('g', { class: 'ghost' });
    if (!nodes) { this._ghost.remove(); this._ghost.textContent = ''; return; }
    if (!this._ghost.parentNode) this.guideLayer.append(this._ghost);
    this._ghost.textContent = '';
    for (const n of nodes) {
      this._ghost.append(sv('path', {
        d: shapePath(n.type, n.w, n.h, n.style?.radius ?? 10), transform: `translate(${n.x},${n.y})`,
        fill: n.style?.fill, stroke: n.style?.stroke, 'stroke-width': 2,
      }));
    }
  }

  /* ---------- search highlight ---------- */
  setFind(ids, current) {
    this.findIds = new Set(ids); this.findCurrent = current;
    this.renderFind(); this.scaleGizmos();
  }
  renderFind() {
    this.findLayer.textContent = '';
    if (!this.findIds.size) return;
    const doc = this.store.doc;
    for (const id of this.findIds) {
      const n = doc.nodes.find((x) => x.id === id);
      if (!n) continue;
      this.findLayer.append(sv('rect', {
        class: 'findring' + (id === this.findCurrent ? ' cur' : ''),
        x: n.x - 7, y: n.y - 7, width: n.w + 14, height: n.h + 14, rx: 8,
      }));
    }
  }

  /* ---------- issues ---------- */
  setIssues(map) {
    const changed = [];
    const all = new Set([...map.keys(), ...this.issues.keys()]);
    for (const id of all) if (map.get(id) !== this.issues.get(id)) changed.push(id);
    this.issues = map;
    for (const id of changed) {
      const n = this.store.doc.nodes.find((x) => x.id === id);
      if (n) { this.nodeSig.delete(id); this.syncNode(n); }
      const e = this.store.doc.edges.find((x) => x.id === id);
      if (e) this.syncEdge(e);
    }
  }

  /* ---------- camera ---------- */
  zoomAt(sx, sy, factor) {
    const vp = this.store.viewport;
    const k2 = clamp(vp.k * factor, 0.08, 6);
    const f = k2 / vp.k;
    const r = this.svg.getBoundingClientRect();
    const px = sx - r.left, py = sy - r.top;
    vp.x = px - (px - vp.x) * f;
    vp.y = py - (py - vp.y) * f;
    vp.k = k2;
    this.applyViewport();
    this.store.emit('viewport');
  }
  setZoom(k, anchor) {
    const { w, h } = this.size();
    const r = this.svg.getBoundingClientRect();
    const a = anchor || { x: r.left + w / 2, y: r.top + h / 2 };
    this.zoomAt(a.x, a.y, clamp(k, .08, 6) / this.store.viewport.k);
  }
  fit(bounds, pad = 60) {
    const { w, h } = this.size();
    if (!bounds || !bounds.w || !bounds.h || !w || !h) return;
    const k = clamp(Math.min((w - pad * 2) / bounds.w, (h - pad * 2) / bounds.h), .08, 2);
    const vp = this.store.viewport;
    vp.k = k;
    vp.x = w / 2 - (bounds.x + bounds.w / 2) * k;
    vp.y = h / 2 - (bounds.y + bounds.h / 2) * k;
    this.applyViewport();
    this.store.emit('viewport');
  }
  centerOn(node) {
    const { w, h } = this.size();
    const vp = this.store.viewport;
    vp.x = w / 2 - (node.x + node.w / 2) * vp.k;
    vp.y = h / 2 - (node.y + node.h / 2) * vp.k;
    this.applyViewport();
    this.store.emit('viewport');
  }
}
