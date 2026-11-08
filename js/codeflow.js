// Python / JavaScript source -> flowchart. Handles if/elif/else, while, for, def/function (first one),
// break/continue as real jumps, input/print as I/O, return. Anything else becomes a Process step.
import { newDoc, newNode, newEdge } from './model.js';
import { SHAPES } from './shapes.js';
import { measure, fontString, wrapText, clamp } from './util.js';

/** Grow a step (about its centre) until its text fits. With `tight` it also shrinks to a snug size. */
export function fitNode(n, tight = false) {
  if (n.type === 'lane') return false;
  const st = n.style || {}, font = fontString(st), t = (SHAPES[n.type] || SHAPES.process).text;
  const pad = 10, lh = (st.fontSize || 14) * 1.3, text = String(n.text);
  const word = Math.max(0, ...text.split(/\s+/).map((s) => measure(s, font)));
  let w0 = n.w, h0 = n.h;
  if (tight) {
    const longest = Math.max(0, ...text.split('\n').map((s) => measure(s, font)));
    w0 = clamp(Math.ceil((longest + pad + 6) / t[2]), 90, 260);
    h0 = 40;
  }
  const w = Math.max(w0, Math.ceil((word + pad) / t[2]));
  const lines = wrapText(text, Math.max(w * t[2], 16), font).length;
  const hh = Math.max(h0, Math.ceil((lines * lh + pad) / t[3]));
  if (w === n.w && hh === n.h) return false;
  n.x -= (w - n.w) / 2; n.y -= (hh - n.h) / 2; n.w = w; n.h = hh;
  return true;
}

/* ---------- source clean-up ---------- */
/** Drop a trailing comment without touching a comment marker that sits inside a string. */
function stripComment(line, lang) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || (lang === 'js' && c === '`')) { q = c; continue; }
    if (lang === 'py' ? c === '#' : (c === '/' && line[i + 1] === '/')) return line.slice(0, i);
  }
  return line;
}

/** Rewrite brace-style JavaScript as indented, Python-shaped lines so one parser serves both. */
function jsToIndented(src) {
  const out = [];
  let depth = 0;
  for (const raw of src.replace(/\t/g, '    ').split('\n')) {
    let t = stripComment(raw, 'js').trim();
    if (!t) continue;
    let closers = 0;
    while (t.startsWith('}')) { closers++; t = t.slice(1).trim(); }
    depth = Math.max(0, depth - closers);
    t = t.replace(/;+\s*$/, '');
    if (!t) continue;
    const opens = t.endsWith('{');
    if (opens) t = t.slice(0, -1).trim();
    if (opens) {
      let m;
      if ((m = /^else\s+if\s*\((.*)\)$/.exec(t))) t = `elif ${m[1]}:`;
      else if (t === 'else') t = 'else:';
      else if ((m = /^if\s*\((.*)\)$/.exec(t))) t = `if ${m[1]}:`;
      else if ((m = /^while\s*\((.*)\)$/.exec(t))) t = `while ${m[1]}:`;
      else if ((m = /^for\s*\((.*)\)$/.exec(t))) t = `for ${m[1].replace(/^(const|let|var)\s+/, '')}:`;
      else if ((m = /^(?:async\s+)?function\s*\*?\s*(\w+)\s*\((.*)\)$/.exec(t))) t = `def ${m[1]}(${m[2]}):`;
      else if ((m = /^(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\((.*)\)\s*=>$/.exec(t))) t = `def ${m[1]}(${m[2]}):`;
      else if (/^(try|finally)$/.test(t)) t += ':';
      else if (/^catch\b/.test(t)) t = t.replace(/^catch\s*/, 'except ') + ':';
      else t += ':';
    }
    out.push(' '.repeat(depth * 4) + t);
    if (opens) depth++;
  }
  return out.join('\n');
}

/* ---------- parse: indentation -> statement tree ---------- */
const IO = /\b(input|print|console\.log|prompt|alert)\s*\(/;

function parse(src, lang) {
  const lines = [];
  const text = lang === 'js' ? jsToIndented(src) : src.replace(/\t/g, '    ').split('\n').map((l) => stripComment(l, 'py')).join('\n');
  for (const raw of text.split('\n')) {
    const t = raw.replace(/\s+$/, '');
    if (t.trim()) lines.push({ ind: t.length - t.trimStart().length, text: t.trim() });
  }
  let i = 0;
  const bodyOf = (ind) => (i < lines.length && lines[i].ind > ind ? block(lines[i].ind) : []);
  function block(ind) {
    const out = [];
    while (i < lines.length && lines[i].ind >= ind) {
      const { text: tx } = lines[i++];
      const m = /^(if|elif|else|while|for|def|try|except|finally|with|class)\b(.*):$/.exec(tx);
      if (!m) {
        const jump = /^(break|continue)\b/.exec(tx);
        out.push({ t: 'step', text: tx, io: IO.test(tx), ret: /^return\b/.test(tx), jump: jump ? jump[1] : null });
        continue;
      }
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
      else if (kw === 'elif' || kw === 'else') out.push({ t: 'step', text: tx, io: false, ret: false });
      else out.push({ t: 'step', text: tx.slice(0, -1), io: false, ret: false }, ...bodyOf(ind0));
    }
    return out;
  }
  return block(lines.length ? lines[0].ind : 0);
}

/* ---------- build nodes, then lay out ---------- */
const GAP_Y = 56, GAP_X = 50;
// the code linter wants a comparison in a decision's code, so bare names like `not done` are left unattached
const HAS_TEST = /[<>=]|\b(in|is|of)\b/;
const short = (s) => (s.length > 46 ? s.slice(0, 45) + '…' : s);

/** @param {'py'|'js'} lang */
export function codeToDoc(src, settings, name = 'From code', lang = 'py') {
  let tree = parse(src, lang);
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
  const codeLang = lang === 'js' ? 'javascript' : 'python';
  const mk = (type, text, code) => {
    const n = newNode(type, 0, 0, doc.settings, short(text));
    n.code = { lang: code ? codeLang : 'none', source: code || '' };
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
  const loops = [];          // innermost loop last: where break / continue jump to
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
        else if (s.jump && loops.length) {
          const L = loops[loops.length - 1];
          if (s.jump === 'continue') edges.push([n.id, L.n.id, '', 'e', 'n']);
          else L.breaks.push(n);
          pend = [];
        }
      } else if (s.t === 'if' && s.else.length) {
        const a = ext(s.then), c = ext(s.else);
        const T = place(s.then, cx - GAP_X / 2 - a.r, below, [{ n, port: 'w', label: 'Yes', tp: 'n' }]);
        const E = place(s.else, cx + GAP_X / 2 + c.l, below, [{ n, port: 'e', label: 'No', tp: 'n' }]);
        y = Math.max(T.y, E.y); pend = [...T.pend, ...E.pend];
      } else {
        const isLoop = s.t === 'loop';
        const body = isLoop ? s.body : s.then, side = ext(body);
        const L = { n, breaks: [] };
        if (isLoop) loops.push(L);
        const B = place(body, cx + n.w / 2 + GAP_X + side.l, y, [{ n, port: 'e', label: 'Yes', tp: 'w' }]);
        if (isLoop) {
          loops.pop();
          for (const p of B.pend) edges.push([p.n.id, n.id, p.label || '', p.port || 'e', 'n']);
        }
        y = Math.max(B.y, below);
        pend = isLoop
          ? [{ n, port: 's', label: 'No' }, ...L.breaks.map((x) => ({ n: x, port: 's' }))]
          : [...B.pend, { n, port: 's', label: 'No' }];
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
  return { doc, warnings };
}
