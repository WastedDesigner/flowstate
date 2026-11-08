// Mermaid flowchart text <-> FlowState documents (flowchart / graph, nodes, links, labels, subgraphs).
import { newDoc, newNode, newEdge } from './model.js';
import { autoLayout } from './layout.js';
import { fitNode } from './codeflow.js';

/* ---------------- export ---------------- */
const WRAP = {
  process: ['[', ']'], decision: ['{', '}'], start: ['([', '])'], end: ['([', '])'], io: ['[/', '/]'],
  subroutine: ['[[', ']]'], data: ['[(', ')]'], document: ['[', ']'], manual: ['[\\', '\\]'],
  delay: ['(', ')'], connector: ['((', '))'], note: ['>', ']'],
};
const q = (s) => '"' + String(s || ' ').replace(/"/g, '#quot;').replace(/\n/g, '<br/>') + '"';

export function toMermaid(doc) {
  const real = doc.nodes.filter((n) => n.type !== 'lane');
  const name = new Map(real.map((n, i) => [n.id, 'n' + (i + 1)]));
  const lines = ['flowchart TD'];
  const inLane = (n, l) => { const cx = n.x + n.w / 2, cy = n.y + n.h / 2; return cx >= l.x && cx <= l.x + l.w && cy >= l.y && cy <= l.y + l.h; };
  const used = new Set();
  doc.nodes.filter((n) => n.type === 'lane').forEach((l, i) => {
    const mem = real.filter((n) => !used.has(n.id) && inLane(n, l));
    if (!mem.length) return;
    lines.push(`  subgraph lane${i + 1}[${q(l.text)}]`);
    for (const n of mem) { used.add(n.id); lines.push('    ' + decl(n)); }
    lines.push('  end');
  });
  function decl(n) { const [a, b] = WRAP[n.type] || WRAP.process; return name.get(n.id) + a + q(n.text) + b; }
  for (const n of real) if (!used.has(n.id)) lines.push('  ' + decl(n));
  for (const e of doc.edges) {
    if (!name.has(e.from) || !name.has(e.to)) continue;
    const dotted = e.style?.dash && e.style.dash !== 'none';
    const arrow = dotted ? '-.->' : '-->';
    lines.push(`  ${name.get(e.from)} ${arrow}${e.label ? '|' + q(e.label) + '|' : ''} ${name.get(e.to)}`);
  }
  return lines.join('\n') + '\n';
}

/* ---------------- import ---------------- */
const OPENERS = [  // longest first
  ['([', '])', 'start'], ['[[', ']]', 'subroutine'], ['[(', ')]', 'data'], ['((', '))', 'connector'],
  ['{{', '}}', 'decision'], ['[/', '\\]', 'manual'], ['[\\', '/]', 'manual'], ['[/', '/]', 'io'], ['[\\', '\\]', 'manual'],
  ['{', '}', 'decision'], ['[', ']', 'process'], ['(', ')', 'process'], ['>', ']', 'note'],
];
const ID = /^[\wÀ-￿-]+/;
const clean = (t) => t.trim().replace(/^"([\s\S]*)"$/, '$1').replace(/<br\s*\/?>/gi, '\n').replace(/#quot;/g, '"').replace(/&quot;/g, '"').trim();

/** Parse "A[Text] --> B{Q?} -->|Yes| C" style statements. Returns {doc, warnings} or {doc:null}. */
export function fromMermaid(src, settings, name = 'From Mermaid') {
  const warnings = [];
  const nodes = new Map();       // id -> {id,type,text,sub}
  const edges = [];
  const subs = [];               // {id,title,members:Set}
  const stack = [];
  let dir = 'TB';

  const touch = (id, shape, text) => {
    let n = nodes.get(id);
    if (!n) { n = { id, type: 'process', text: id, sub: stack.length ? stack[stack.length - 1] : null }; nodes.set(id, n); }
    if (shape) { n.type = shape; n.text = text; }
    if (stack.length && !n.sub) n.sub = stack[stack.length - 1];
    return n;
  };
  const readNode = (s) => {
    const m = ID.exec(s);
    if (!m) return null;
    const id = m[0];
    let rest = s.slice(id.length);
    for (const [o, c, type] of OPENERS) {
      if (!rest.startsWith(o)) continue;
      let end = -1, inQ = false;
      for (let i = o.length; i < rest.length; i++) {
        if (rest[i] === '"') inQ = !inQ;
        if (!inQ && rest.startsWith(c, i)) { end = i; break; }
      }
      if (end < 0) continue;
      const text = clean(rest.slice(o.length, end));
      let type2 = type;
      if (type === 'start') type2 = /^(end|stop|finish|done|exit)\b/i.test(text) ? 'end' : /^(start|begin)\b/i.test(text) ? 'start' : 'process';
      if (type === 'process' && o === '(' && /^(start|begin)\b/i.test(text)) type2 = 'start';
      touch(id, type2, text);
      return { id, rest: rest.slice(end + c.length) };
    }
    touch(id);
    return { id, rest };
  };
  const readGroup = (s) => {
    const ids = [];
    let r = s.trimStart();
    for (;;) {
      const n = readNode(r);
      if (!n) return null;
      ids.push(n.id);
      r = n.rest.trimStart();
      if (r.startsWith('&')) { r = r.slice(1).trimStart(); continue; }
      return { ids, rest: r };
    }
  };
  const LINK_TEXT = /^(--|==|-\.)\s+(.+?)\s+(-->|---|==>|===|\.->|-\.-)/;
  const LINK_PLAIN = /^(-{2,}>?|={2,}>?|-\.+-{1,2}>?)(?:\|([^|]*)\|)?/;

  const statement = (stmt) => {
    let g = readGroup(stmt);
    if (!g) { warnings.push('Skipped: ' + stmt.slice(0, 40)); return; }
    let rest = g.rest;
    while (rest) {
      let label = '', dash = false, thick = false, len = 0;
      let m = LINK_TEXT.exec(rest);
      if (m) { label = clean(m[2]); dash = m[1] === '-.'; thick = m[1] === '=='; len = m[0].length; }
      else if ((m = LINK_PLAIN.exec(rest))) { label = clean(m[2] || ''); dash = m[1].includes('.'); thick = m[1].startsWith('='); len = m[0].length; }
      else break;
      const g2 = readGroup(rest.slice(len));
      if (!g2) break;
      for (const a of g.ids) for (const b of g2.ids) edges.push({ from: a, to: b, label, dash, thick });
      g = g2; rest = g2.rest;
    }
  };

  for (const raw of String(src).split(/\r?\n/)) {
    for (let part of raw.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
      part = part.trim();
      if (!part || part.startsWith('%%')) continue;
      let m;
      if ((m = /^(?:flowchart|graph)\s*(TB|TD|BT|RL|LR)?/i.exec(part))) { dir = /LR|RL/i.test(m[1] || '') ? 'LR' : 'TB'; continue; }
      if (/^(classDef|class|style|linkStyle|click|direction|accTitle|accDescr)\b/i.test(part)) continue;
      if ((m = /^subgraph\s+(.+)$/i.exec(part))) {
        const t = m[1].trim();
        const br = /^([\w-]+)\s*\[(.*)\]$/.exec(t);
        const sub = { id: br ? br[1] : t, title: clean(br ? br[2] : t), members: new Set() };
        subs.push(sub); stack.push(sub);
        continue;
      }
      if (/^end$/i.test(part)) { stack.pop(); continue; }
      statement(part);
    }
  }
  if (!nodes.size) return { doc: null, warnings: ['No flowchart found. Start with "flowchart TD" and a line like A[Start] --> B[Next].'] };

  const doc = newDoc(name);
  doc.settings = { ...doc.settings, ...settings };
  const made = new Map();
  for (const n of nodes.values()) {
    const node = newNode(n.type, 0, 0, doc.settings, n.text);
    node.code = { lang: 'none', source: '' };
    fitNode(node);
    doc.nodes.push(node);
    made.set(n.id, node);
    if (n.sub) n.sub.members.add(node);
  }
  for (const e of edges) {
    const edge = newEdge(made.get(e.from).id, made.get(e.to).id, doc.settings, e.label);
    if (e.dash) edge.style.dash = 'dashed';
    if (e.thick) edge.style.strokeWidth = 3.5;
    doc.edges.push(edge);
  }
  autoLayout(doc, dir);
  for (const sub of subs) {
    const mem = [...sub.members];
    if (!mem.length) continue;
    const x0 = Math.min(...mem.map((n) => n.x)) - 30, y0 = Math.min(...mem.map((n) => n.y)) - 56;
    const x1 = Math.max(...mem.map((n) => n.x + n.w)) + 30, y1 = Math.max(...mem.map((n) => n.y + n.h)) + 30;
    const lane = newNode('lane', x0, y0, doc.settings, sub.title);
    lane.w = Math.round(x1 - x0); lane.h = Math.round(y1 - y0);
    doc.nodes.unshift(lane);
  }
  return { doc, warnings };
}
