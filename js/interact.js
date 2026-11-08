// Pointer interactions: select, drag, resize, connect, marquee, pan, zoom, snap guides.
import { clamp } from './util.js';
import { newNode, newEdge, nodeById } from './model.js';
import { portLocal, PORT_DIR } from './shapes.js';

const SNAP_PX = 7;          // screen px tolerance for alignment guides
const MIN_W = 48, MIN_H = 34;

export class Interactions {
  constructor(app) {
    this.app = app;
    this.store = app.store;
    this.r = app.renderer;
    this.svg = app.svg;
    this.tool = 'select';
    this.armed = null;          // shape type queued from the palette
    this.spaceDown = false;
    this.mode = 'idle';
    this.pointers = new Map();     // active touch points, for pinch zoom
    this.lastTap = null;
    this.bind();
  }

  setTool(t) {
    this.tool = t;
    this.armed = null;
    this.updateCursor();
    this.app.onToolChange?.(t);
  }
  arm(type) {
    this.armed = type;
    this.updateCursor();
  }
  updateCursor() {
    const c = this.svg.classList;
    c.toggle('panready', this.tool === 'pan' || this.spaceDown);
    c.toggle('connecting', this.tool === 'connect');
    c.toggle('placing', !!this.armed);
  }

  bind() {
    const svg = this.svg;
    svg.addEventListener('pointerdown', (e) => this.down(e));
    svg.addEventListener('pointermove', (e) => this.move(e));
    svg.addEventListener('pointerup', (e) => this.up(e));
    svg.addEventListener('pointercancel', (e) => this.up(e));
    svg.addEventListener('dblclick', (e) => this.dbl(e));
    svg.addEventListener('contextmenu', (e) => this.context(e));
    svg.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    svg.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    svg.addEventListener('drop', (e) => this.drop(e));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !isTyping(e.target)) { this.spaceDown = true; this.updateCursor(); }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') { this.spaceDown = false; this.updateCursor(); }
    });
    window.addEventListener('blur', () => { this.spaceDown = false; this.updateCursor(); });
  }

  /** Capture the pointer only once the gesture actually moves, so dblclick still fires. */
  deferCapture(e) { this._pendingCapture = e.pointerId; }
  takeCapture() {
    if (this._pendingCapture == null) return;
    try { this.svg.setPointerCapture(this._pendingCapture); } catch {}
    this._pendingCapture = null;
  }

  pt(e) { return this.r.screenToWorld(e.clientX, e.clientY); }
  hit(e) {
    const t = e.target;
    return {
      handle: t.closest?.('[data-handle]'),
      port: t.closest?.('.port,.porthit'),
      node: t.closest?.('.node'),
      edge: t.closest?.('.edge'),
    };
  }

  /* ---------------- pointer down ---------------- */
  down(e) {
    if (e.button === 2) return;
    this.svg.focus({ preventScroll: true });
    if (e.pointerType === 'touch') {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) return this.startPinch();
      if (this.pointers.size > 2) return;
      const now = performance.now(), t = this.lastTap;
      if (t && now - t.t < 320 && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 28) { this.lastTap = null; this.dbl(e); return; }
      this.lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
    const p = this.pt(e);
    const hit = this.hit(e);

    if (this.armed && !hit.node) {
      const type = this.armed;
      this.armed = null;
      this.updateCursor();
      this.app.addNodeAt(type, p.x, p.y, true);
      return;
    }
    if (e.button === 1 || this.tool === 'pan' || this.spaceDown) return this.startPan(e);

    if (hit.handle) return this.startResize(e, hit.handle);
    if (hit.port) return this.startLink(e, hit.port.dataset.id, hit.port.dataset.port);

    if (hit.node) {
      const id = hit.node.dataset.id;
      if (this.tool === 'connect') return this.startLink(e, id, 'auto');
      const ids = this.expand([id]);
      if (e.shiftKey) {
        const on = this.store.selNodes.has(id);
        this.store.select(on ? [...this.store.selNodes].filter((x) => !ids.includes(x)) : [...this.store.selNodes, ...ids], []);
      } else if (!this.store.selNodes.has(id)) this.store.select(ids, []);
      if (this.store.selNodes.has(id)) this.startDrag(e);
      return;
    }
    if (hit.edge) {
      const id = hit.edge.dataset.id;
      this.store.select([], [id], e.shiftKey);
      return;
    }
    // empty canvas: a finger pans, a mouse draws a selection box
    if (!e.shiftKey) this.store.clearSelection();
    if (e.pointerType === 'touch') return this.startPan(e);
    this.mode = 'marquee';
    this.start = p;
    this.baseSel = new Set(this.store.selNodes);
    this.deferCapture(e);
  }

  /** Selecting one member of a group selects the whole group. */
  expand(ids) {
    const d = this.store.doc, groups = new Set();
    for (const id of ids) { const n = nodeById(d, id); if (n?.group) groups.add(n.group); }
    if (!groups.size) return ids;
    return [...new Set([...ids, ...d.nodes.filter((n) => groups.has(n.group)).map((n) => n.id)])];
  }

  startPinch() {
    if (this.mode === 'drag' || this.mode === 'resize') this.store.cancelGesture();
    this.r.guides([]); this.r.marquee(null); this.r.linkPreview(null); this.r.dropTarget(null);
    this._pendingCapture = null;
    this.svg.classList.remove('panning');
    const [a, b] = [...this.pointers.values()];
    const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const vp = this.store.viewport, r = this.svg.getBoundingClientRect();
    this.mode = 'pinch';
    this.pinch = { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), k: vp.k, wx: (c.x - r.left - vp.x) / vp.k, wy: (c.y - r.top - vp.y) / vp.k };
  }

  startPan(e) {
    this.mode = 'pan';
    const vp = this.store.viewport;
    this.start = { x: e.clientX, y: e.clientY, vx: vp.x, vy: vp.y };
    this.svg.classList.add('panning');
    this.svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  startDrag(e) {
    this.mode = 'drag';
    this.start = this.pt(e);
    this.store.beginGesture();
    const sel = this.store.selectedNodes(), carried = [];
    for (const l of sel.filter((n) => n.type === 'lane')) {   // a swimlane carries what sits inside it
      for (const n of this.store.doc.nodes) {
        const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
        if (n.type !== 'lane' && !this.store.selNodes.has(n.id) && !carried.includes(n) && cx >= l.x && cx <= l.x + l.w && cy >= l.y && cy <= l.y + l.h) carried.push(n);
      }
    }
    const moving = [...sel, ...carried];
    this.dragNodes = moving.map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h }));
    const movingIds = new Set(moving.map((n) => n.id));
    this.others = this.store.doc.nodes.filter((n) => !movingIds.has(n.id) && n.type !== 'lane');
    this.moved = false;
    this.deferCapture(e);
  }

  startResize(e, handle) {
    this.mode = 'resize';
    this.start = this.pt(e);
    this.handleName = handle.dataset.handle;
    const n = nodeById(this.store.doc, handle.dataset.id);
    this.resizeId = n.id;
    this.base = { x: n.x, y: n.y, w: n.w, h: n.h };
    this.store.beginGesture();
    this.svg.setPointerCapture(e.pointerId);
    e.stopPropagation();
  }

  startLink(e, nodeId, port) {
    this.mode = 'link';
    this.linkFrom = { id: nodeId, port };
    this.linkTo = null;
    this.svg.setPointerCapture(e.pointerId);
    e.stopPropagation();
    this.move(e);
  }

  /* ---------------- pointer move ---------------- */
  move(e) {
    if (e.pointerType === 'touch' && this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.mode === 'pinch') {
      const [a, b] = [...this.pointers.values()];
      if (!a || !b) return;
      const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const st = this.pinch, vp = this.store.viewport, r = this.svg.getBoundingClientRect();
      vp.k = clamp(st.k * Math.hypot(a.x - b.x, a.y - b.y) / st.d, 0.08, 6);
      vp.x = c.x - r.left - st.wx * vp.k;
      vp.y = c.y - r.top - st.wy * vp.k;
      this.r.applyViewport();
      return;
    }
    const p = this.pt(e);
    if (this.mode === 'idle') {
      const hit = this.hit(e);
      this.r.setHover(hit.node ? hit.node.dataset.id : null);
      return;
    }
    if (this.mode === 'pan') {
      const vp = this.store.viewport;
      vp.x = this.start.vx + (e.clientX - this.start.x);
      vp.y = this.start.vy + (e.clientY - this.start.y);
      this.r.applyViewport();
      return;
    }
    if (this.mode === 'marquee') {
      this.takeCapture();
      const r = {
        x: Math.min(this.start.x, p.x), y: Math.min(this.start.y, p.y),
        w: Math.abs(p.x - this.start.x), h: Math.abs(p.y - this.start.y),
      };
      this.r.marquee(r);
      const inside = this.store.doc.nodes.filter((n) => (n.type === 'lane'
        ? n.x >= r.x && n.x + n.w <= r.x + r.w && n.y >= r.y && n.y + n.h <= r.y + r.h
        : n.x < r.x + r.w && n.x + n.w > r.x && n.y < r.y + r.h && n.y + n.h > r.y));
      this.store.select(this.expand([...this.baseSel, ...inside.map((n) => n.id)]), [], false);
      return;
    }
    if (this.mode === 'drag') {
      let dx = p.x - this.start.x, dy = p.y - this.start.y;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) { this.moved = true; this.takeCapture(); }
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const snapped = this.snap(dx, dy, e.altKey);
      for (const d of this.dragNodes) {
        const n = nodeById(this.store.doc, d.id);
        if (n) { n.x = Math.round(d.x + snapped.dx); n.y = Math.round(d.y + snapped.dy); }
      }
      this.r.guides(snapped.guides);
      this.r.patchNodes(this.dragNodes.map((d) => d.id));
      this.store.live(this.dragNodes.map((d) => d.id));
      return;
    }
    if (this.mode === 'resize') {
      const n = nodeById(this.store.doc, this.resizeId);
      if (!n) return;
      const b = this.base, hn = this.handleName;
      let dx = p.x - this.start.x, dy = p.y - this.start.y;
      let x = b.x, y = b.y, w = b.w, h = b.h;
      if (hn.includes('e')) w = b.w + dx;
      if (hn.includes('s')) h = b.h + dy;
      if (hn.includes('w')) { w = b.w - dx; x = b.x + dx; }
      if (hn.includes('n')) { h = b.h - dy; y = b.y + dy; }
      if (e.shiftKey) {
        const ar = b.w / b.h;
        if (hn === 'n' || hn === 's') w = h * ar;
        else h = w / ar;
        if (hn.includes('w')) x = b.x + b.w - w;
        if (hn.includes('n')) y = b.y + b.h - h;
      }
      const g = this.store.doc.settings.snap ? this.store.doc.settings.gridSize : 1;
      w = Math.max(MIN_W, Math.round(w / g) * g);
      h = Math.max(MIN_H, Math.round(h / g) * g);
      if (hn.includes('w')) x = b.x + b.w - w;
      if (hn.includes('n')) y = b.y + b.h - h;
      Object.assign(n, { x: Math.round(x), y: Math.round(y), w, h });
      this.r.patchNodes([n.id]);
      this.r.decorate();
      this.store.live([n.id]);
      return;
    }
    if (this.mode === 'link') {
      const from = nodeById(this.store.doc, this.linkFrom.id);
      if (!from) return;
      const port = this.linkFrom.port === 'auto' ? autoPortToward(from, p) : this.linkFrom.port;
      const pl = portLocal(from.type, from.w, from.h, port);
      const s = { x: from.x + pl.x, y: from.y + pl.y };
      const dir = PORT_DIR[port] || [0, 1];
      const k = Math.max(40, Math.hypot(p.x - s.x, p.y - s.y) * .4);
      this.r.linkPreview(`M${s.x},${s.y}C${s.x + dir[0] * k},${s.y + dir[1] * k} ${p.x},${p.y} ${p.x},${p.y}`);
      const over = this.nodeAt(p, from.id);
      this.linkTo = over;
      this.r.dropTarget(over || null);
      return;
    }
  }

  nodeAt(p, exceptId) {
    const ns = this.store.doc.nodes;
    for (let i = ns.length - 1; i >= 0; i--) {
      const n = ns[i];
      if (n.type === 'note' || n.type === 'lane') continue;
      if (p.x >= n.x - 2 && p.x <= n.x + n.w + 2 && p.y >= n.y - 2 && p.y <= n.y + n.h + 2) {
        if (n.id === exceptId) return null;
        return n;
      }
    }
    return null;
  }

  /** Grid + alignment snapping for the current drag. */
  snap(dx, dy, disabled) {
    const guides = [];
    const s = this.store.doc.settings;
    if (disabled || !s.snap) return { dx, dy, guides };
    const tol = SNAP_PX / (this.store.viewport.k || 1);
    const bb = bbox(this.dragNodes);
    const cand = (vals, axis) => {
      let best = null;
      for (const other of this.others) {
        const o = axis === 'x'
          ? [other.x, other.x + other.w / 2, other.x + other.w]
          : [other.y, other.y + other.h / 2, other.y + other.h];
        for (const v of vals) for (const ov of o) {
          const d = ov - v;
          if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: ov, other };
        }
      }
      return best;
    };
    const xs = [bb.x + dx, bb.x + bb.w / 2 + dx, bb.x + bb.w + dx];
    const ys = [bb.y + dy, bb.y + bb.h / 2 + dy, bb.y + bb.h + dy];
    const bx = cand(xs, 'x'), by = cand(ys, 'y');
    if (bx) {
      dx += bx.d;
      const y0 = Math.min(bb.y + dy, bx.other.y) - 24, y1 = Math.max(bb.y + bb.h + dy, bx.other.y + bx.other.h) + 24;
      guides.push({ x1: bx.at, y1: y0, x2: bx.at, y2: y1 });
    } else if (s.snap) {
      const g = s.gridSize || 10;
      dx = Math.round((bb.x + dx) / g) * g - bb.x;
    }
    if (by) {
      dy += by.d;
      const x0 = Math.min(bb.x + dx, by.other.x) - 24, x1 = Math.max(bb.x + bb.w + dx, by.other.x + by.other.w) + 24;
      guides.push({ x1: x0, y1: by.at, x2: x1, y2: by.at });
    } else if (s.snap) {
      const g = s.gridSize || 10;
      dy = Math.round((bb.y + dy) / g) * g - bb.y;
    }
    return { dx, dy, guides };
  }

  /* ---------------- pointer up ---------------- */
  up(e) {
    if (e.pointerType === 'touch') {
      this.pointers.delete(e.pointerId);
      if (this.mode === 'pinch') {
        if (this.pointers.size < 2) { this.mode = 'idle'; this.store.emit('viewport'); }
        return;
      }
    }
    const mode = this.mode;
    this.mode = 'idle';
    this._pendingCapture = null;
    try { this.svg.releasePointerCapture(e.pointerId); } catch {}
    this.svg.classList.remove('panning');
    this.r.guides([]); this.r.marquee(null); this.r.linkPreview(null); this.r.dropTarget(null);

    if (mode === 'pan') { this.store.emit('viewport'); return; }
    if (mode === 'marquee') { this.r.marquee(null); return; }
    if (mode === 'drag') { this.store.endGesture('Move step', this.moved); this.r.decorate(); return; }
    if (mode === 'resize') { this.store.endGesture('Resize step'); return; }
    if (mode === 'link') {
      const fromId = this.linkFrom.id;
      const target = this.linkTo;
      const p = this.pt(e);
      if (target) {
        this.app.connect(fromId, target.id, this.linkFrom.port);
      } else {
        const from = nodeById(this.store.doc, fromId);
        const dist = from ? Math.hypot(p.x - (from.x + from.w / 2), p.y - (from.y + from.h / 2)) : 0;
        if (dist > 60) this.app.connectToNew(fromId, p.x, p.y, this.linkFrom.port);
      }
      this.linkFrom = null; this.linkTo = null;
      return;
    }
  }

  /* ---------------- other gestures ---------------- */
  dbl(e) {
    const now = performance.now();
    if (now - (this._dblAt || 0) < 500) return;       // a touch double-tap can raise both paths
    this._dblAt = now;
    const hit = this.hit(e);
    if (hit.node) { this.app.editNodeText(hit.node.dataset.id); return; }
    if (hit.edge) { this.app.editEdgeLabel(hit.edge.dataset.id); return; }
    const p = this.pt(e);
    this.app.addNodeAt('process', p.x, p.y, true, true);
  }
  context(e) {
    const hit = this.hit(e);
    if (!hit.node && !hit.edge) return;
    e.preventDefault();
    if (hit.node && !this.store.selNodes.has(hit.node.dataset.id)) this.store.select([hit.node.dataset.id], []);
    if (hit.edge && !hit.node) this.store.select([], [hit.edge.dataset.id]);
    this.app.showContextMenu(e.clientX, e.clientY);
  }
  wheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const f = Math.exp(-e.deltaY * 0.0022);
      this.r.zoomAt(e.clientX, e.clientY, f);
    } else {
      const vp = this.store.viewport;
      const mult = e.deltaMode === 1 ? 18 : 1;
      vp.x -= e.deltaX * mult;
      vp.y -= e.deltaY * mult;
      this.r.applyViewport();
      this.store.emit('viewport');
    }
  }
  drop(e) {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/x-flowstate-shape') || e.dataTransfer.getData('text/plain');
    if (!type) return;
    const p = this.r.screenToWorld(e.clientX, e.clientY);
    this.app.addNodeAt(type, p.x, p.y, true);
  }
}

function bbox(list) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of list) {
    x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export function autoPortToward(node, p) {
  const cx = node.x + node.w / 2, cy = node.y + node.h / 2;
  const dx = p.x - cx, dy = p.y - cy;
  if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? 's' : 'n';
  return dx >= 0 ? 'e' : 'w';
}
export const isTyping = (el) =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
void clamp; void newNode; void newEdge;
