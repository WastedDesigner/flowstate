// Document model, themes, edge routing, backup format + migrations.
import { uid, clone, clamp } from './util.js';
import { SHAPES, TERMINALS, centerOf, portPoint, PORT_DIR } from './shapes.js';

export const APP = 'FlowState';
export const FILE_KIND = 'flowstate.flowchart';
export const DOC_VERSION = 3;          // current schema
export const MIN_READABLE = 1;         // oldest schema we can still read

/* ---------------- themes ---------------- */
export const THEMES = {
  classic: {
    label: 'Classic', bg: '#f7f9fc', grid: '#dde6f1', edge: '#58647a', ink: '#17202e',
    font: 'Inter, -apple-system, sans-serif', fontSize: 14,
    roles: {
      step: ['#ffffff', '#9fb0c6'], branch: ['#fff6e2', '#dfa636'], start: ['#e3f7ec', '#3fa96d'],
      end: ['#fdeaea', '#d4544f'], io: ['#eef2ff', '#7a90d8'], data: ['#f3ecff', '#9a79d4'],
      note: ['#fffceb', '#d6c266'], connector: ['#ffffff', '#9fb0c6'],
    },
  },
  blueprint: {
    label: 'Blueprint', bg: '#0e2a46', grid: '#1b4068', edge: '#8fc3f2', ink: '#eaf4ff',
    font: '"Trebuchet MS", Inter, sans-serif', fontSize: 14,
    roles: {
      step: ['#14395c', '#6fa8d6'], branch: ['#13455c', '#5fd0d0'], start: ['#0f4a44', '#4fd1a5'],
      end: ['#4a1f2a', '#f08a8a'], io: ['#1a3a6a', '#7f9ff0'], data: ['#2b2f66', '#9a9cf0'],
      note: ['#143047', '#5d82a3'], connector: ['#14395c', '#6fa8d6'],
    },
  },
  midnight: {
    label: 'Midnight', bg: '#111622', grid: '#1e2635', edge: '#8c9ab2', ink: '#e9edf5',
    font: 'Inter, -apple-system, sans-serif', fontSize: 14,
    roles: {
      step: ['#1b2431', '#4a5a72'], branch: ['#30260f', '#d2a53c'], start: ['#102b20', '#3fbf7f'],
      end: ['#30161a', '#f4685f'], io: ['#16253f', '#5b8cff'], data: ['#221a36', '#a07ae0'],
      note: ['#24220f', '#b7a94c'], connector: ['#1b2431', '#4a5a72'],
    },
  },
  pastel: {
    label: 'Pastel', bg: '#fdf7f3', grid: '#f0e3d8', edge: '#8a7a70', ink: '#3b2f2a',
    font: 'Verdana, Geneva, sans-serif', fontSize: 13,
    roles: {
      step: ['#ffffff', '#d8c3b4'], branch: ['#ffeede', '#e2a46d'], start: ['#e6f6e9', '#79bf8c'],
      end: ['#ffe8e8', '#dd8b8b'], io: ['#e8f1fb', '#8fb3d9'], data: ['#f1e9f8', '#b094cd'],
      note: ['#fff8dc', '#d9c68a'], connector: ['#ffffff', '#d8c3b4'],
    },
  },
  mono: {
    label: 'Mono', bg: '#ffffff', grid: '#ebebeb', edge: '#222222', ink: '#111111',
    font: 'Georgia, "Times New Roman", serif', fontSize: 14,
    roles: {
      step: ['#ffffff', '#111111'], branch: ['#f4f4f4', '#111111'], start: ['#111111', '#111111'],
      end: ['#111111', '#111111'], io: ['#f8f8f8', '#111111'], data: ['#f0f0f0', '#111111'],
      note: ['#fafafa', '#777777'], connector: ['#ffffff', '#111111'],
    },
  },
};
export const THEME_KEYS = Object.keys(THEMES);

function roleOf(type) {
  if (type === 'start' || type === 'end') return type;
  if (type === 'decision') return 'branch';
  if (type === 'io' || type === 'manual' || type === 'delay') return 'io';
  if (type === 'data' || type === 'document' || type === 'subroutine') return 'data';
  if (type === 'note') return 'note';
  if (type === 'connector') return 'connector';
  return 'step';
}
/** Default visual style for a node type under a theme. */
export function themeNodeStyle(themeKey, type) {
  const t = THEMES[themeKey] || THEMES.midnight;
  const [fill, stroke] = t.roles[roleOf(type)] || t.roles.step;
  const darkFill = isDark(fill);
  return {
    fill, stroke, strokeWidth: 2, radius: 10,
    textColor: themeKey === 'mono' && (type === 'start' || type === 'end') ? '#ffffff' : (darkFill ? '#f2f5fa' : t.ink),
    fontFamily: t.font, fontSize: t.fontSize, fontWeight: type === 'start' || type === 'end' ? 600 : 400,
    fontStyle: 'normal', align: 'center', dash: 'none',
  };
}
export function themeEdgeStyle(themeKey) {
  const t = THEMES[themeKey] || THEMES.midnight;
  return {
    stroke: t.edge, strokeWidth: 2, dash: 'none', curve: 'orthogonal',
    arrowStart: 'none', arrowEnd: 'arrow', labelColor: t.ink, fontSize: 12,
  };
}
function isDark(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 140;
}

/* ---------------- languages ---------------- */
export const LANGS = [
  { id: 'none', label: 'No code', checks: [] },
  { id: 'pseudocode', label: 'Pseudocode', checks: ['structure'] },
  { id: 'python', label: 'Python', checks: ['delimiters', 'syntax', 'logic', 'structure'] },
  { id: 'javascript', label: 'JavaScript', checks: ['delimiters', 'syntax', 'logic', 'structure'] },
  { id: 'typescript', label: 'TypeScript', checks: ['delimiters', 'syntax', 'logic', 'structure'] },
  { id: 'java', label: 'Java', checks: ['delimiters', 'syntax', 'structure'] },
  { id: 'cpp', label: 'C++', checks: ['delimiters', 'syntax', 'structure'] },
  { id: 'csharp', label: 'C#', checks: ['delimiters', 'syntax', 'structure'] },
  { id: 'sql', label: 'SQL', checks: ['delimiters', 'structure'] },
  { id: 'other', label: 'Other / plain text', checks: [] },
];
export const langLabel = (id) => (LANGS.find((l) => l.id === id) || LANGS[0]).label;

export const FONTS = [
  ['Inter, -apple-system, sans-serif', 'Inter / System'],
  ['"Segoe UI", Tahoma, sans-serif', 'Segoe UI'],
  ['Verdana, Geneva, sans-serif', 'Verdana'],
  ['"Trebuchet MS", sans-serif', 'Trebuchet'],
  ['Georgia, "Times New Roman", serif', 'Georgia'],
  ['"Courier New", monospace', 'Courier New'],
  ['"Comic Sans MS", "Chalkboard SE", cursive', 'Comic Sans'],
];

export const DASHES = { none: '', dotted: '2 4', dashed: '8 5', 'dash-dot': '10 4 2 4' };
export const ARROWS = ['none', 'arrow', 'open', 'circle', 'diamond', 'bar'];

/* ---------------- factories ---------------- */
export function defaultSettings() {
  return {
    theme: 'midnight', grid: true, snap: true, gridSize: 10, hints: true,
    autosave: true, defaultLang: 'python', edgeCurve: 'orthogonal', showCodeBadges: true,
  };
}
export function newDoc(name = 'Untitled flowchart') {
  const now = Date.now();
  return {
    kind: FILE_KIND, version: DOC_VERSION, id: uid('doc'), name,
    createdAt: now, updatedAt: now,
    settings: defaultSettings(),
    nodes: [], edges: [],
  };
}
export function newNode(type, x, y, settings = defaultSettings(), text) {
  const def = SHAPES[type] || SHAPES.process;
  return {
    id: uid('n'), type,
    x: Math.round(x), y: Math.round(y),
    w: def.size[0], h: def.size[1],
    text: text !== undefined ? text : def.label,
    style: themeNodeStyle(settings.theme, type),
    code: { lang: settings.defaultLang || 'none', source: '' },
  };
}
export function newEdge(from, to, settings = defaultSettings(), label = '') {
  const s = themeEdgeStyle(settings.theme);
  s.curve = settings.edgeCurve || 'orthogonal';
  return { id: uid('e'), from, to, fromPort: 'auto', toPort: 'auto', label, style: s };
}

export const nodeById = (doc, id) => doc.nodes.find((n) => n.id === id);
export const edgeById = (doc, id) => doc.edges.find((e) => e.id === id);
export const outgoing = (doc, id) => doc.edges.filter((e) => e.from === id);
export const incoming = (doc, id) => doc.edges.filter((e) => e.to === id);

export function docBounds(doc, pad = 0) {
  if (!doc.nodes.length) return { x: 0, y: 0, w: 400, h: 300 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of doc.nodes) {
    x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h);
  }
  // keep edge labels in view
  for (const e of doc.edges) {
    const p = edgeLabelPoint(doc, e);
    if (p) { x0 = Math.min(x0, p.x - 40); x1 = Math.max(x1, p.x + 40); y0 = Math.min(y0, p.y - 14); y1 = Math.max(y1, p.y + 14); }
  }
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

/* ---------------- edge routing ---------------- */
export function resolvePorts(a, b, edge) {
  let pa = edge.fromPort || 'auto', pb = edge.toPort || 'auto';
  if (a.id === b.id) return [pa === 'auto' ? 'e' : pa, pb === 'auto' ? 'n' : pb];
  const ca = centerOf(a), cb = centerOf(b);
  const dx = cb.x - ca.x, dy = cb.y - ca.y;
  const vertical = Math.abs(dy) * 1.15 >= Math.abs(dx);
  if (pa === 'auto') pa = vertical ? (dy >= 0 ? 's' : 'n') : (dx >= 0 ? 'e' : 'w');
  if (pb === 'auto') pb = vertical ? (dy >= 0 ? 'n' : 's') : (dx >= 0 ? 'w' : 'e');
  return [pa, pb];
}

const STUB = 20;
function orthPoints(p1, d1, p2, d2) {
  const a = { x: p1.x + d1[0] * STUB, y: p1.y + d1[1] * STUB };
  const b = { x: p2.x + d2[0] * STUB, y: p2.y + d2[1] * STUB };
  const pts = [p1, a];
  const h1 = d1[0] !== 0, h2 = d2[0] !== 0;
  if (h1 && h2) {
    const mx = (a.x + b.x) / 2;
    pts.push({ x: mx, y: a.y }, { x: mx, y: b.y });
  } else if (!h1 && !h2) {
    const my = (a.y + b.y) / 2;
    pts.push({ x: a.x, y: my }, { x: b.x, y: my });
  } else if (h1) {
    pts.push({ x: b.x, y: a.y });
  } else {
    pts.push({ x: a.x, y: b.y });
  }
  pts.push(b, p2);
  return dedupe(pts);
}
function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < .5 && Math.abs(last.y - p.y) < .5) continue;
    out.push(p);
  }
  // drop collinear middles
  const res = [out[0]];
  for (let i = 1; i < out.length - 1; i++) {
    const a = res[res.length - 1], b = out[i], c = out[i + 1];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(cross) > .5) res.push(b);
  }
  res.push(out[out.length - 1]);
  return res;
}

export function routeEdge(doc, edge) {
  const a = nodeById(doc, edge.from), b = nodeById(doc, edge.to);
  if (!a || !b) return null;
  const [pa, pb] = resolvePorts(a, b, edge);
  const p1 = portPoint(a, pa), p2 = portPoint(b, pb);
  const d1 = PORT_DIR[pa] || [0, 1], d2 = PORT_DIR[pb] || [0, -1];
  const curve = edge.style?.curve || 'orthogonal';

  if (a.id === b.id) {                       // self loop
    const r = 34;
    const s = portPoint(a, pa), t = portPoint(a, pb);
    const d = `M${s.x},${s.y}C${s.x + r * 1.6},${s.y} ${t.x + r * .4},${t.y - r * 1.8} ${t.x},${t.y}`;
    return { d, pts: [s, t], label: { x: s.x + r, y: Math.min(s.y, t.y) - r * .7 }, kind: 'curve' };
  }
  if (curve === 'straight') {
    const d = `M${p1.x},${p1.y}L${p2.x},${p2.y}`;
    return { d, pts: [p1, p2], label: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }, kind: 'line' };
  }
  if (curve === 'curve') {
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const k = clamp(dist * .42, 32, 180);
    const c1 = { x: p1.x + d1[0] * k, y: p1.y + d1[1] * k };
    const c2 = { x: p2.x + d2[0] * k, y: p2.y + d2[1] * k };
    const d = `M${p1.x},${p1.y}C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
    const label = {
      x: (p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8,
      y: (p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8,
    };
    return { d, pts: [p1, p2], label, kind: 'curve' };
  }
  const pts = orthPoints(p1, d1, p2, d2);
  return { d: roundedPoly(pts, 9), pts, label: polyMid(pts), kind: 'poly' };
}

function roundedPoly(pts, r) {
  if (pts.length < 3) return `M${pts[0].x},${pts[0].y}L${pts[pts.length - 1].x},${pts[pts.length - 1].y}`;
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
    const l1 = Math.hypot(p1.x - p0.x, p1.y - p0.y), l2 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    if (rr < 1.2) { d += `L${p1.x},${p1.y}`; continue; }
    const a = { x: p1.x + (p0.x - p1.x) / l1 * rr, y: p1.y + (p0.y - p1.y) / l1 * rr };
    const b = { x: p1.x + (p2.x - p1.x) / l2 * rr, y: p1.y + (p2.y - p1.y) / l2 * rr };
    d += `L${a.x},${a.y}Q${p1.x},${p1.y} ${b.x},${b.y}`;
  }
  const e = pts[pts.length - 1];
  return d + `L${e.x},${e.y}`;
}
function polyMid(pts) {
  let total = 0;
  const segs = [];
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    segs.push(l); total += l;
  }
  let half = total / 2;
  for (let i = 0; i < segs.length; i++) {
    if (half <= segs[i]) {
      const t = segs[i] ? half / segs[i] : 0;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t };
    }
    half -= segs[i];
  }
  return pts[Math.floor(pts.length / 2)];
}
export function edgeLabelPoint(doc, edge) {
  if (!edge.label) return null;
  const r = routeEdge(doc, edge);
  return r ? r.label : null;
}

/* ---------------- backup file: write ---------------- */
export function toFile(doc) {
  const d = clone(doc);
  d.kind = FILE_KIND;
  d.version = DOC_VERSION;
  d.app = APP;
  d.exportedAt = new Date().toISOString();
  d.updatedAt = Date.now();
  d.stats = { nodes: d.nodes.length, edges: d.edges.length };
  return d;
}

/* ---------------- backup file: read + migrate ---------------- */
class ImportError extends Error {}

/**
 * Parse + validate + migrate an imported backup.
 * Returns { ok, doc, errors:[], warnings:[], fromVersion }
 */
export function readFile(raw) {
  const errors = [], warnings = [];
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); }
    catch (err) {
      return { ok: false, errors: [`That file is not valid JSON. ${friendlyJson(err.message)}`], warnings };
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, errors: ['The file does not contain a flowchart object at the top level.'], warnings };
  }
  if (obj.kind && obj.kind !== FILE_KIND) {
    warnings.push(`File says it was made by "${String(obj.kind).slice(0, 40)}". FlowState will try to read it anyway.`);
  }
  let v = Number(obj.version);
  if (!Number.isFinite(v)) {
    v = Array.isArray(obj.links) ? 1 : Array.isArray(obj.edges) ? 2 : 0;
    if (!v) return { ok: false, errors: ['No version number and no recognisable "nodes"/"edges" lists — this does not look like a FlowState backup.'], warnings };
    warnings.push(`No version field; read as version ${v}.`);
  }
  if (v > DOC_VERSION) {
    return {
      ok: false,
      errors: [`This backup is version ${v}, but this copy of FlowState understands up to version ${DOC_VERSION}. Open it in the newer version of FlowState, or ask whoever sent it for a version ${DOC_VERSION} backup.`],
      warnings,
    };
  }
  if (v < MIN_READABLE) return { ok: false, errors: [`Version ${v} is too old to read.`], warnings };

  let doc;
  try { doc = migrate(obj, v, warnings); }
  catch (err) {
    return { ok: false, errors: [err instanceof ImportError ? err.message : 'Unexpected problem reading the file: ' + err.message], warnings };
  }
  const res = sanitize(doc, errors, warnings);
  if (errors.length) return { ok: false, errors, warnings, fromVersion: v };
  return { ok: true, doc: res, errors, warnings, fromVersion: v };
}
function friendlyJson(msg) {
  if (/position (\d+)/i.test(msg)) return msg + ' — the file may be truncated.';
  return msg;
}

function migrate(obj, v, warnings) {
  let d = clone(obj);
  if (v === 1) {
    if (!Array.isArray(d.nodes)) throw new ImportError('Version 1 backup has no "nodes" array.');
    d = {
      kind: FILE_KIND, version: 2, id: d.id || uid('doc'), name: d.name || d.title || 'Imported flowchart',
      createdAt: d.createdAt || Date.now(), updatedAt: Date.now(),
      settings: { ...defaultSettings(), theme: d.theme && THEMES[d.theme] ? d.theme : 'classic' },
      nodes: d.nodes.map((n) => ({
        id: n.id, type: n.type || n.shape || 'process', x: n.x, y: n.y,
        w: n.w || n.width, h: n.h || n.height,
        text: n.text ?? n.label ?? n.title ?? '',
        lang: n.lang || 'none', code: n.code || '',
      })),
      edges: (d.links || d.connections || []).map((l) => ({
        id: l.id || uid('e'), from: l.from ?? l.source, to: l.to ?? l.target, label: l.label || '',
      })),
    };
    warnings.push('Upgraded a version 1 backup: styles were not stored back then, so the current theme was applied.');
    v = 2;
  }
  if (v === 2) {
    const theme = d.settings?.theme && THEMES[d.settings.theme] ? d.settings.theme : 'classic';
    d = {
      kind: FILE_KIND, version: 3, id: d.id || uid('doc'), name: d.name || 'Imported flowchart',
      createdAt: d.createdAt || Date.now(), updatedAt: Date.now(),
      settings: { ...defaultSettings(), ...(d.settings || {}), theme },
      nodes: (d.nodes || []).map((n) => {
        const base = themeNodeStyle(theme, n.type || 'process');
        return {
          ...n,
          style: { ...base, ...(typeof n.style === 'object' && n.style ? n.style : {}) },
          code: typeof n.code === 'string' || n.lang
            ? { lang: n.lang || 'none', source: typeof n.code === 'string' ? n.code : (n.code?.source || '') }
            : (n.code || { lang: 'none', source: '' }),
        };
      }),
      edges: (d.edges || []).map((e) => ({
        ...e,
        fromPort: e.fromPort || 'auto', toPort: e.toPort || 'auto',
        style: { ...themeEdgeStyle(theme), ...(typeof e.style === 'object' && e.style ? e.style : {}) },
      })),
    };
    warnings.push('Upgraded a version 2 backup to the current format (per-node code language and arrow styles added).');
  }
  return d;
}

/** Repair-in-place validation. Fatal problems go to `errors`, recoverable ones to `warnings`. */
function sanitize(d, errors, warnings) {
  if (!Array.isArray(d.nodes)) { errors.push('"nodes" is missing or is not a list.'); return d; }
  if (!Array.isArray(d.edges)) { warnings.push('"edges" was missing; treated as an empty list.'); d.edges = []; }

  const settings = { ...defaultSettings(), ...(d.settings || {}) };
  if (!THEMES[settings.theme]) { warnings.push(`Unknown theme "${settings.theme}"; using Classic.`); settings.theme = 'classic'; }
  if (!LANGS.some((l) => l.id === settings.defaultLang)) settings.defaultLang = 'none';
  settings.gridSize = clamp(Number(settings.gridSize) || 10, 2, 100);

  const seen = new Set();
  const nodes = [];
  let fixedGeom = 0, renamed = 0, unknownType = 0;
  for (const raw of d.nodes) {
    if (!raw || typeof raw !== 'object') { warnings.push('Skipped an entry in "nodes" that was not an object.'); continue; }
    let id = typeof raw.id === 'string' && raw.id ? raw.id : uid('n');
    if (seen.has(id)) { const old = id; id = uid('n'); renamed++; remap(d.edges, old, id); }
    seen.add(id);
    let type = String(raw.type || 'process');
    if (!SHAPES[type]) { unknownType++; type = 'process'; }
    const def = SHAPES[type];
    const num = (v, f) => (Number.isFinite(Number(v)) ? Number(v) : (fixedGeom++, f));
    const size = (v, f) => (Number.isFinite(Number(v)) ? Number(v) : f);
    const n = {
      id, type,
      x: num(raw.x, 0), y: num(raw.y, 0),
      w: clamp(size(raw.w, def.size[0]), 24, 4000),
      h: clamp(size(raw.h, def.size[1]), 24, 4000),
      text: typeof raw.text === 'string' ? raw.text : String(raw.text ?? ''),
      style: { ...themeNodeStyle(settings.theme, type), ...(raw.style && typeof raw.style === 'object' ? raw.style : {}) },
      code: {
        lang: LANGS.some((l) => l.id === raw.code?.lang) ? raw.code.lang : 'none',
        source: typeof raw.code?.source === 'string' ? raw.code.source : '',
      },
    };
    nodes.push(n);
  }
  if (!nodes.length) errors.push('The file contains no usable steps.');
  if (fixedGeom) warnings.push(`${fixedGeom} missing or invalid position value${fixedGeom > 1 ? 's were' : ' was'} replaced with 0.`);
  if (renamed) warnings.push(`${renamed} duplicate step id${renamed > 1 ? 's were' : ' was'} renumbered; connections were updated.`);
  if (unknownType) warnings.push(`${unknownType} step${unknownType > 1 ? 's used' : ' used'} an unknown shape and became a Process box.`);

  const ids = new Set(nodes.map((n) => n.id));
  const eseen = new Set();
  const edges = [];
  let dropped = 0, dupes = 0;
  for (const raw of d.edges) {
    if (!raw || typeof raw !== 'object') { dropped++; continue; }
    if (!ids.has(raw.from) || !ids.has(raw.to)) { dropped++; continue; }
    let id = typeof raw.id === 'string' && raw.id ? raw.id : uid('e');
    if (eseen.has(id)) id = uid('e');
    eseen.add(id);
    const key = raw.from + '>' + raw.to + '>' + (raw.label || '');
    if (eseen.has(key)) { dupes++; continue; }
    eseen.add(key);
    edges.push({
      id, from: raw.from, to: raw.to,
      fromPort: ['n', 'e', 's', 'w', 'auto'].includes(raw.fromPort) ? raw.fromPort : 'auto',
      toPort: ['n', 'e', 's', 'w', 'auto'].includes(raw.toPort) ? raw.toPort : 'auto',
      label: typeof raw.label === 'string' ? raw.label : '',
      style: { ...themeEdgeStyle(settings.theme), ...(raw.style && typeof raw.style === 'object' ? raw.style : {}) },
    });
  }
  if (dropped) warnings.push(`${dropped} connection${dropped > 1 ? 's' : ''} pointed at steps that are not in the file and ${dropped > 1 ? 'were' : 'was'} dropped.`);
  if (dupes) warnings.push(`${dupes} duplicate connection${dupes > 1 ? 's' : ''} removed.`);

  return {
    kind: FILE_KIND, version: DOC_VERSION,
    id: typeof d.id === 'string' && d.id ? d.id : uid('doc'),
    name: (typeof d.name === 'string' && d.name.trim()) || 'Imported flowchart',
    createdAt: Number(d.createdAt) || Date.now(),
    updatedAt: Date.now(),
    settings, nodes, edges,
  };
}
function remap(edges, from, to) {
  if (!Array.isArray(edges)) return;
  for (const e of edges) { if (e && e.from === from) e.from = to; if (e && e.to === from) e.to = to; }
}

/** Re-style every node/edge from a theme (used by "Apply theme to all"). */
export function applyTheme(doc, themeKey) {
  doc.settings.theme = themeKey;
  for (const n of doc.nodes) n.style = { ...themeNodeStyle(themeKey, n.type), align: n.style?.align || 'center' };
  for (const e of doc.edges) {
    const base = themeEdgeStyle(themeKey);
    e.style = { ...base, curve: e.style?.curve || base.curve, arrowEnd: e.style?.arrowEnd ?? base.arrowEnd, arrowStart: e.style?.arrowStart ?? base.arrowStart };
  }
}
