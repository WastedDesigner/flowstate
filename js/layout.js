// Placement helpers: finding free space, and a layered auto-layout.
const LAYOUT_SKIP = new Set(['lane', 'note']);

export function freeSpot(doc, x, y, w, h, skip = new Set()) {
  const hits = (ax, ay) => doc.nodes.some((n) => n.type !== 'lane' && !skip.has(n.id) && ax < n.x + n.w + 16 && ax + w + 16 > n.x && ay < n.y + n.h + 16 && ay + h + 16 > n.y);
  let px = x, py = y;
  for (let i = 0; i < 60 && hits(px, py); i++) {
    if (i % 2 === 0) py += 40; else px += 60;
  }
  return { x: Math.round(px), y: Math.round(py) };
}

/**
 * Layered auto-layout (rank by longest path, order by barycentre, then pull children under their parents).
 * Mutates node positions and resets connection ports. dir: 'TB' (top to bottom) or 'LR'.
 */
export function autoLayout(doc, dir = 'TB') {
  const nodes = doc.nodes.filter((n) => !LAYOUT_SKIP.has(n.type));
  if (!nodes.length) return;
  const ids = new Set(nodes.map((n) => n.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map(nodes.map((n) => [n.id, []]));
  const inn = new Map(nodes.map((n) => [n.id, []]));
  const edges = doc.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  const pref = (l) => (/^(yes|y|true|ok)$/i.test((l || '').trim()) ? 0 : /^(no|n|false)$/i.test((l || '').trim()) ? 2 : 1);
  for (const e of [...edges].sort((a, b) => pref(a.label) - pref(b.label))) { out.get(e.from).push(e.to); inn.get(e.to).push(e.from); }

  // break cycles: edges that close a loop in a depth-first walk are "back edges"
  const state = new Map(), back = new Set();
  const dfs = (u) => {
    state.set(u, 1);
    for (const v of out.get(u)) { if (state.get(v) === 1) back.add(u + '>' + v); else if (!state.get(v)) dfs(v); }
    state.set(u, 2);
  };
  const roots = [...nodes.filter((n) => n.type === 'start'), ...nodes.filter((n) => n.type !== 'start' && !inn.get(n.id).length), ...nodes];
  for (const n of roots) if (!state.get(n.id)) dfs(n.id);
  const next = (u) => out.get(u).filter((v) => !back.has(u + '>' + v));

  // rank = longest path from any source
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  for (const n of nodes) for (const v of next(n.id)) indeg.set(v, indeg.get(v) + 1);
  const order = nodes.filter((n) => !indeg.get(n.id)).map((n) => n.id);
  const rank = new Map(order.map((id) => [id, 0]));
  for (let i = 0; i < order.length; i++) {
    const u = order[i];
    for (const v of next(u)) {
      rank.set(v, Math.max(rank.get(v) || 0, rank.get(u) + 1));
      indeg.set(v, indeg.get(v) - 1);
      if (!indeg.get(v)) order.push(v);
    }
  }
  const layers = [];
  for (const id of order) (layers[rank.get(id)] ||= []).push(id);
  const preds = (id) => inn.get(id).filter((p) => !back.has(p + '>' + id));
  const pos = new Map();
  const reindex = () => layers.forEach((L) => L.forEach((id, i) => pos.set(id, i)));
  reindex();
  for (let pass = 0; pass < 4; pass++) {
    const down = pass % 2 === 0;
    for (const L of (down ? layers : [...layers].reverse())) {
      const nb = (id) => (down ? preds(id) : next(id));
      const bary = new Map(L.map((id) => { const n = nb(id); return [id, n.length ? n.reduce((a, q) => a + pos.get(q), 0) / n.length : pos.get(id)]; }));
      L.sort((a, b) => bary.get(a) - bary.get(b));
      L.forEach((id, i) => pos.set(id, i));
    }
  }

  // coordinates: "along" runs through the layers, "across" runs within a layer
  const tb = dir !== 'LR';
  const size = (n) => (tb ? [n.w, n.h] : [n.h, n.w]);   // [across, along]
  const GAP_ACROSS = 60, GAP_ALONG = 72;
  const centre = new Map();
  let alongAt = 0;
  for (const L of layers) {
    if (!L) continue;
    const thick = Math.max(...L.map((id) => size(byId.get(id))[1]));
    const want = L.map((id) => {
      const p = preds(id).filter((q) => centre.has(q));
      return p.length ? p.reduce((a, q) => a + centre.get(q), 0) / p.length : null;
    });
    let cursor = -Infinity;
    const placed = L.map((id, i) => {
      const w = size(byId.get(id))[0];
      const base = want[i] ?? (cursor === -Infinity ? 0 : cursor + GAP_ACROSS + w / 2);
      const c = Math.max(base, cursor === -Infinity ? base : cursor + GAP_ACROSS + w / 2);
      cursor = c + w / 2;
      return c;
    });
    const shifts = L.map((id, i) => (want[i] == null ? null : want[i] - placed[i])).filter((v) => v != null);
    const shift = shifts.length ? shifts.reduce((a, v) => a + v, 0) / shifts.length : 0;
    L.forEach((id, i) => centre.set(id, placed[i] + shift));
    L.forEach((id) => { byId.get(id)._along = alongAt + thick / 2; });
    alongAt += thick + GAP_ALONG;
  }
  const g = doc.settings.gridSize || 10;
  let minX = Infinity, minY = Infinity;
  for (const n of nodes) {
    const a = centre.get(n.id), b = n._along;
    n.x = tb ? a - n.w / 2 : b - n.w / 2;
    n.y = tb ? b - n.h / 2 : a - n.h / 2;
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    delete n._along;
  }
  for (const n of nodes) { n.x = Math.round((n.x - minX + 80) / g) * g; n.y = Math.round((n.y - minY + 60) / g) * g; }

  for (const e of edges) {
    const isBack = back.has(e.from + '>' + e.to);
    e.fromPort = isBack ? (tb ? 'e' : 's') : 'auto';
    e.toPort = isBack ? (tb ? 'e' : 's') : 'auto';
  }
}
