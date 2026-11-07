// Python source -> flowchart. Handles if/elif/else, while, for, def (first one), input/print as I/O, return.
// Anything else on a line becomes a Process step. try/with/class headers become a step with their body inlined.
import { newDoc, newNode, newEdge } from './model.js';
import { SHAPES } from './shapes.js';
import { measure, fontString, wrapText } from './util.js';

/** Grow a step (about its centre) until its text fits; never shrinks a size the user chose. */
export function fitNode(n) {
  const st = n.style || {}, font = fontString(st), t = (SHAPES[n.type] || SHAPES.process).text;
  const pad = 10, lh = (st.fontSize || 14) * 1.3;
  const word = Math.max(0, ...String(n.text).split(/\s+/).map((s) => measure(s, font)));
  const w = Math.max(n.w, Math.ceil((word + pad) / t[2]));
  const lines = wrapText(n.text, Math.max(w * t[2], 16), font).length;
  const hh = Math.max(n.h, Math.ceil((lines * lh + pad) / t[3]));
  if (w === n.w && hh === n.h) return false;
  n.x -= (w - n.w) / 2; n.y -= (hh - n.h) / 2; n.w = w; n.h = hh;
  return true;
}

/* ---------- parse: indentation -> statement tree ---------- */
function parse(src) {
  const lines = [];
  // shortcut: a '#' inside a string literal is treated as a comment start; upgrade if that bites
  for (const raw of src.replace(/\t/g, '    ').split('\n')) {
    const t = raw.replace(/\s+#.*$/, '').replace(/^\s*#.*$/, '').replace(/\s+$/, '');
    if (t.trim()) lines.push({ ind: t.length - t.trimStart().length, text: t.trim() });
  }
  let i = 0;
  const bodyOf = (ind) => (i < lines.length && lines[i].ind > ind ? block(lines[i].ind) : []);
  function block(ind) {
    const out = [];
    while (i < lines.length && lines[i].ind >= ind) {
      const { text } = lines[i++];
      const m = /^(if|elif|else|while|for|def|try|except|finally|with|class)\b(.*):$/.exec(text);
      if (!m) { out.push({ t: 'step', text, io: /\b(input|print)\s*\(/.test(text), ret: /^return\b/.test(text) }); continue; }
      const [, kw, rest] = m, ind0 = lines[i - 1].ind, head = rest.trim();
      if (kw === 'if') {
        const node = { t: 'if', cond: head, then: bodyOf(ind0), else: [] };
        let cur = node;
        while (i < lines.length && lines[i].ind === ind0) {
          const e = /^elif\b(.*):$/.exec(lines[i].text);
          if (e) { i++; const sub = { t: 'if', cond: e[1].trim(), then: bodyOf(ind0), else: [] }; cur.else = [sub]; cur = sub; continue; }
          if (/^else\s*:$/.test(lines[i].text)) { i++; cur.else = bodyOf(ind0); }
          break;
        }
        out.push(node);
      } else if (kw === 'while' || kw === 'for') out.push({ t: 'loop', kw, cond: head, body: bodyOf(ind0) });
      else if (kw === 'def') out.push({ t: 'def', name: head, body: bodyOf(ind0) });
      else if (kw === 'elif' || kw === 'else') out.push({ t: 'step', text, io: false, ret: false });
      else { out.push({ t: 'step', text: text.slice(0, -1), io: false, ret: false }, ...bodyOf(ind0)); }
    }
    return out;
  }
  return block(lines.length ? lines[0].ind : 0);
}

/* ---------- build nodes, then lay out ---------- */
const GAP_Y = 56, GAP_X = 50;
// the code linter wants a comparison in a decision's code, so bare names like `not done` are left unattached
const HAS_TEST = /[<>=]|\b(in|is)\b/;
const short = (s) => (s.length > 46 ? s.slice(0, 45) + '…' : s);

export function codeToDoc(src, settings, name = 'From code') {
  let tree = parse(src);
  const warnings = [];
  const defs = tree.filter((s) => s.t === 'def');
  let startText = 'Start';
  if (defs.length) {
    if (defs.length > 1) warnings.push(`Only the first function (${defs[0].name.split('(')[0]}) was charted.`);
    startText = 'Start: ' + defs[0].name;
    tree = defs[0].body;
  }
  if (!tree.length) return { doc: null, warnings: ['No code to chart.'] };

  const doc = newDoc(name);
  doc.settings = { ...doc.settings, ...settings };
  const mk = (type, text, code) => {
    const n = newNode(type, 0, 0, doc.settings, short(text));
    n.code = { lang: code ? 'python' : 'none', source: code || '' };
    fitNode(n);
    doc.nodes.push(n);
    return n;
  };
  const edges = [];

  // pass 1: a node for every statement
  (function make(b) {
    for (const s of b) {
      if (s.t === 'step') s.node = mk(s.io ? 'io' : 'process', s.text, s.text);
      else if (s.t === 'if') { s.node = mk('decision', s.cond + '?', HAS_TEST.test(s.cond) ? s.cond : ''); make(s.then); make(s.else); }
      else if (s.t === 'loop') {
        s.node = mk('decision', (s.kw === 'for' ? 'Next: ' : '') + s.cond + '?', s.kw === 'while' && HAS_TEST.test(s.cond) ? s.cond : '');
        make(s.body);
      }
    }
  })(tree);

  // extents from the spine centre line: how far a block reaches left and right
  const ext = (b) => b.reduce((e, s) => {
    const x = sext(s);
    return { l: Math.max(e.l, x.l), r: Math.max(e.r, x.r) };
  }, { l: 0, r: 0 });
  function sext(s) {
    const hw = s.node.w / 2;
    if (s.t === 'step') return { l: hw, r: hw };
    if (s.t === 'if' && s.else.length) {
      const a = ext(s.then), c = ext(s.else);
      return { l: Math.max(hw, GAP_X / 2 + a.l + a.r), r: Math.max(hw, GAP_X / 2 + c.l + c.r) };
    }
    const side = ext(s.t === 'if' ? s.then : s.body);
    return { l: hw, r: hw + GAP_X + side.l + side.r };
  }

  const rets = [];
  const join = (pend, n) => {
    for (const p of pend) edges.push([p.n.id, n.id, p.label || '', p.port, p.tp || (p.label ? 'n' : undefined)]);
  };
  // place a block with its spine at cx, top at y; pend = edges waiting for the next node
  function place(b, cx, y, pend) {
    for (const s of b) {
      const n = s.node;
      n.x = Math.round(cx - n.w / 2); n.y = Math.round(y);
      join(pend, n);
      const below = y + n.h + GAP_Y;
      if (s.t === 'step') {
        y = below; pend = [{ n }];
        if (s.ret) { rets.push(n); pend = []; }
      } else if (s.t === 'if' && s.else.length) {
        const a = ext(s.then), c = ext(s.else);
        const T = place(s.then, cx - GAP_X / 2 - a.r, below, [{ n, port: 'w', label: 'Yes', tp: 'n' }]);
        const E = place(s.else, cx + GAP_X / 2 + c.l, below, [{ n, port: 'e', label: 'No', tp: 'n' }]);
        y = Math.max(T.y, E.y); pend = [...T.pend, ...E.pend];
      } else {
        const body = s.t === 'if' ? s.then : s.body, side = ext(body);
        const B = place(body, cx + n.w / 2 + GAP_X + side.l, y, [{ n, port: 'e', label: 'Yes', tp: 'w' }]);
        if (s.t === 'loop') for (const p of B.pend) edges.push([p.n.id, n.id, p.label || '', p.port || 'e', 'n']);
        y = Math.max(B.y, below);
        pend = s.t === 'loop' ? [{ n, port: 's', label: 'No' }] : [...B.pend, { n, port: 's', label: 'No' }];
      }
    }
    return { y, pend };
  }

  const start = mk('start', startText);
  start.x = Math.round(-start.w / 2); start.y = 0;
  const R = place(tree, 0, start.h + GAP_Y, [{ n: start }]);
  const end = mk('end', 'End');
  end.x = Math.round(-end.w / 2); end.y = Math.round(R.y);
  join([...R.pend, ...rets.map((n) => ({ n, port: 's', tp: 'e' }))], end);

  // normalise so the chart starts near the top-left of the canvas
  const minX = Math.min(...doc.nodes.map((n) => n.x));
  for (const n of doc.nodes) { n.x += 80 - minX; n.y += 60; }
  for (const [from, to, label, fp, tp] of edges) {
    const e = newEdge(from, to, doc.settings, label);
    if (fp) e.fromPort = fp;
    if (tp) e.toPort = tp;
    doc.edges.push(e);
  }
  if (/\b(break|continue)\b/.test(src)) warnings.push('break and continue are shown as ordinary steps, not as jumps.');
  return { doc, warnings };
}
