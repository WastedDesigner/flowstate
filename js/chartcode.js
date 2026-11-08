// Flowchart -> code: Python, JavaScript, C++, C# or pseudocode.
// 1. Follow the chart from Start; edges that close a loop in a depth-first walk mark loop headers.
// 2. Each loop's body is the nodes that can reach a back edge without passing its header.
// 3. Branches end where they rejoin: the immediate post-dominator, computed on a graph where
//    "back to the header" and "out of the loop" are their own end points (continue / break).
// 4. That structure prints as if / else, while, for-each, do-while, break, continue and return.
export const OUT_LANGS = { py: 'Python', js: 'JavaScript', cpp: 'C++', cs: 'C#', pseudo: 'Pseudocode' };
export const OUT_EXT = { py: 'py', js: 'js', cpp: 'cpp', cs: 'cs', pseudo: 'txt' };
const TAG = { py: 'python', js: 'javascript', cpp: 'cpp', cs: 'csharp', pseudo: 'pseudocode' };
const YES = /^(yes|y|true|ok|correct|pass(ed)?)$/i, NO = /^(no|n|false|fail(ed)?)$/i;
const rank = (l) => (YES.test((l || '').trim()) ? 0 : NO.test((l || '').trim()) ? 2 : 1);
const EXIT = 'EXIT', ROOT = 'ROOT';
const isSink = (id) => id === EXIT || id.startsWith('C:') || id.startsWith('B:');

/* ---------- words -> identifiers and literals ---------- */
const words = (t) => String(t).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 8);
function ident(t, style) {
  const w = words(t);
  if (!w.length) return style === 'snake' ? 'step' : 'step';
  let s = style === 'snake' ? w.join('_') : style === 'pascal' ? w.map(cap).join('') : w[0] + w.slice(1).map(cap).join('');
  if (/^\d/.test(s)) s = (style === 'pascal' ? 'Step' : 'step_') + s;
  return s;
}
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
const str = (t) => '"' + String(t).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

/* ---------- conditions and statements in each language ---------- */
function toPy(c) { return c.replace(/&&/g, ' and ').replace(/\|\|/g, ' or ').replace(/!(?!=)/g, 'not ').replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False').replace(/\bnull\b/g, 'None').replace(/\s+/g, ' ').trim(); }
function toC(c, lang) {
  if (lang === 'js') c = c.replace(/\blen\(([^()]+)\)/g, '$1.length');
  else if (lang === 'cs') c = c.replace(/\blen\(([^()]+)\)/g, '$1.Length');
  else if (lang === 'cpp') c = c.replace(/\blen\(([^()]+)\)/g, '$1.size()');
  return c.replace(/\band\b/g, '&&').replace(/\bor\b/g, '||').replace(/\bnot\s+/g, '!').replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null'); }
const SYMBOLIC = /[<>=!]=?|&&|\|\||%|[[\]]/;
const isExpr = (t) => SYMBOLIC.test(t) || /^[\w.]+(\(.*\))?$/.test(t) || (/\b(in|is|not|and|or|of)\b/.test(t) && !/[A-Z]/.test(t) && t.split(/\s+/).length <= 6);
/** Would this line still parse in the target language? Constructs from the other side become a TODO. */
function fits(code, lang) {
  if (lang === 'pseudo') return true;
  if (lang === 'py') return !/\bnew\s+[\w.]+|=>|::|;\s*\S|\+\+|--|&&|\|\||<[A-Z]\w*>|^\s*(var|let|const|auto|int|string|double|bool)\s+\w/.test(code);
  if (lang === 'js' && /\bnew\s+[\w.]+\s*</.test(code)) return false;
  return !/\bfor\b[^()]*\bin\b|\blambda\b|\[[^\][]*:[^\][]*\]|\belif\b|\bNone\b|\*\*|\bnot\s|\band\s|\bor\s|\bis\s/.test(code)
    && !(lang !== 'js' && /\bin\b/.test(code));
}
const todo = (l, lang) => (lang === 'py' ? '# TODO: ' : '// TODO: ') + l;

function codeOf(node, lang) {
  const src = (node.code?.source || '').trim();
  return src && node.code.lang === TAG[lang] ? src : '';
}
/** The best one-line source for a step written in another language: its attached code, else its text. */
function foreignLine(node) {
  const src = (node.code?.source || '').trim();
  return (src && !src.includes('\n') ? src : node.text).replace(/\s+/g, ' ').replace(/;\s*$/, '').trim();
}
function splitArgs(s) {
  const out = [];
  let depth = 0, q = null, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === '\\') { cur += s[++i] ?? ''; } else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
/** Recognise input / output calls from any of the four languages. */
function ioOf(t) {
  let m;
  if ((m = /^(?:std::)?cout\s*<<\s*(.*)$/.exec(t))) return { out: m[1].split('<<').map((p) => p.trim()).filter((p) => p && !/^(std::)?endl$|^"\\n"$|^'\\n'$/.test(p)) };
  if ((m = /^(?:std::)?cin\s*>>\s*(.*)$/.exec(t))) return { in: m[1].split('>>').map((p) => p.trim()).filter(Boolean), assign: true };
  if ((m = /^Console\.Write(?:Line)?\((.*)\)$/.exec(t))) return { out: m[1].trim() ? [m[1].trim()] : [] };
  if ((m = /^console\.(?:log|error|warn)\((.*)\)$/.exec(t))) return { out: splitArgs(m[1]) };
  if ((m = /^print\((.*)\)$/.exec(t))) return { out: splitArgs(m[1]).filter((a) => !/^(end|sep|file|flush)\s*=/.test(a)) };
  if ((m = /^printf\((.*)\)$/.exec(t))) return { out: splitArgs(m[1]) };
  if ((m = /^(?:(?:var|let|const|string|auto|std::string|int|long|double|float|decimal)\s+)?(\w+)\s*=\s*(?:(int|float|str|double\.Parse|int\.Parse|float\.Parse|decimal\.Parse|parseInt|parseFloat|Number)\s*\()?\s*(?:input|prompt|Console\.ReadLine)\((.*?)\)\)?$/.exec(t))) {
    const conv = /^(int|int\.Parse|parseInt)$/.test(m[2] || '') ? 'int' : /^(float|double\.Parse|float\.Parse|decimal\.Parse|parseFloat|Number)$/.test(m[2] || '') ? 'float' : null;
    return { in: [m[1]], prompt: m[3] || '', conv };
  }
  return null;
}
function interp(part) {
  let m = /^f(["'])(.*)\1$/.exec(part) || /^\$(")(.*)"$/.exec(part);
  let body = m ? m[2] : null, re = /\{([^{}]+)\}/g;
  if (!m && (m = /^`(.*)`$/.exec(part))) { body = m[1]; re = /\$\{([^{}]+)\}/g; }
  if (body === null) return null;
  const segs = [];
  let last = 0, x;
  while ((x = re.exec(body))) { if (x.index > last) segs.push({ lit: body.slice(last, x.index) }); segs.push({ expr: x[1].trim() }); last = x.index + x[0].length; }
  if (last < body.length) segs.push({ lit: body.slice(last) });
  return segs;
}
function strFor(part, lang) {
  const segs = interp(part);
  if (!segs) return [part];
  const lit = (t) => '"' + t.replace(/"/g, '\\"') + '"';
  if (lang === 'py') return ['f"' + segs.map((g) => (g.lit ?? `{${g.expr}}`)).join('') + '"'];
  if (lang === 'js') return ['`' + segs.map((g) => (g.lit ?? '${' + g.expr + '}')).join('') + '`'];
  if (lang === 'cs') return ['$"' + segs.map((g) => (g.lit ?? `{${g.expr}}`)).join('') + '"'];
  if (lang === 'cpp') return segs.map((g) => (g.lit !== undefined ? lit(g.lit) : g.expr));
  return [part];
}
function ioCode(io, lang) {
  if (io.out) {
    const p = io.out.flatMap((x) => strFor(x, lang));
    return { py: `print(${p.join(', ')})`, js: `console.log(${p.join(', ')});`, cpp: `cout << ${p.length ? p.join(' << ') + ' << ' : ''}endl;`, cs: `Console.WriteLine(${p.join(' + ')});`, pseudo: `OUTPUT ${p.join(', ')}` }[lang];
  }
  const v = io.in, pr = io.prompt ? io.prompt : '', cv = io.conv;
  const wrap = { py: (e) => (cv === 'int' ? `int(${e})` : cv === 'float' ? `float(${e})` : e), js: (e) => (cv ? `Number(${e})` : e), cs: (e) => (cv === 'int' ? `int.Parse(${e})` : cv === 'float' ? `double.Parse(${e})` : e) };
  const cppDecl = io.assign ? '' : `${cv === 'int' ? 'int' : cv === 'float' ? 'double' : 'string'} ${v.join(', ')}; `;
  return {
    py: v.map((x) => `${x} = ${wrap.py(`input(${pr})`)}`).join('\n'),
    js: v.map((x) => `${io.assign ? '' : 'let '}${x} = ${wrap.js(`prompt(${pr})`)};`).join('\n'),
    cpp: `${cppDecl}${pr ? `cout << ${pr}; ` : ''}cin >> ${v.join(' >> ')};`,
    cs: v.map((x) => `${io.assign ? '' : 'var '}${x} = ${wrap.cs('Console.ReadLine()')};`).join('\n'),
    pseudo: `INPUT ${v.join(', ')}`,
  }[lang];
}
const DECL = /^(?:const\s+)?(int|long|short|double|float|char|bool|string|std::string|auto|var|let|const|decimal|unsigned(?:\s+int)?|size_t)\s+(?![=(])(.+)$/;
/** Carry a plain statement over to another language: declarations, ++ / --, and/or/not. */
function translate(t, lang) {
  let m;
  if ((m = DECL.exec(t))) {
    const parts = splitArgs(m[2]);
    if (lang === 'py' || lang === 'pseudo') return parts.map((p) => (p.includes('=') ? p.replace(/\s*=\s*/, ' = ') : `${p} = None`)).map((l) => (lang === 'py' ? toPy(l) : l));
    const kw = { js: 'let', cpp: 'auto', cs: 'var' }[lang];
    if (/^(int|long|short|double|float|char|bool|string|std::string|decimal|unsigned|size_t)/.test(m[1]) && (lang === 'cpp' || lang === 'cs')) return [`${m[1] === 'std::string' && lang === 'cs' ? 'string' : m[1]} ${m[2]};`];
    return parts.map((p) => `${kw} ${p.includes('=') ? p : p + (lang === 'js' ? '' : ' = 0')};`);
  }
  if ((m = /^(\w[\w.[\]]*)\s*(\+\+|--)$/.exec(t)) || (m = /^(\+\+|--)(\w[\w.[\]]*)$/.exec(t))) {
    const v = m[1].startsWith('+') || m[1].startsWith('-') ? m[2] : m[1], op = t.includes('++') ? '+' : '-';
    return [lang === 'py' || lang === 'pseudo' ? `${v} ${op}= 1` : `${v}${op}${op};`];
  }
  if (lang === 'py') return [toPy(t).replace(/\bthis\./g, 'self.')];
  if (lang === 'pseudo') return [t];
  return [toC(t, lang) + ';'];
}
/** The condition in a snippet: the whole line, or the test on its first "if" / "while" line. */
function testIn(src) {
  const first = src.split('\n')[0].trim();
  if (!src.includes('\n') || /^(if|elif|while|else\s+if)\b/.test(first)) {
    return first.replace(/^(if|elif|while|else\s+if)\s*/, '').replace(/\{\s*$/, '').replace(/:\s*$/, '').trim().replace(/^\((.*)\)$/, '$1').trim();
  }
  return '';
}
/** One line of code from another language, in this one. */
function carry(l, lang) {
  let m;
  const io = ioOf(l);
  if (io) return ioCode(io, lang).split('\n').map((x) => (fits(x, lang) ? x : todo(l, lang)));
  if ((m = /^with\s+(.+?)\s+as\s+(\w+)\s*:?$/.exec(l))) return translate(`${m[2]} = ${m[1]}`, lang === 'py' ? 'py' : lang).map((x) => (lang === 'py' || lang === 'pseudo' ? x : x.replace(/^(\w+ = )/, { js: 'let $1', cpp: 'auto $1', cs: 'var $1' }[lang])));
  if (/:\s*$/.test(l) || /^(import|from|using|#include|package)\b/.test(l)) return [(lang === 'py' ? '# ' : '// ') + l];
  if (CODEY.test(l)) return translate(l, lang).map((x) => (fits(x, lang) ? x : todo(l, lang)));
  return [todo(l, lang)];
}
function condOf(node, lang) {
  const code = codeOf(node, lang);
  const native = code ? testIn(code) : '';
  if (native) return native;
  const src = (node.code?.source || '').trim();
  const foreign = src ? testIn(src) : '';
  const t = (foreign || node.text).replace(/\s+/g, ' ').replace(/\?\s*$/, '').replace(/^Next:\s*/i, '').trim();
  if (lang === 'pseudo') return node.text.replace(/\s+/g, ' ').replace(/\?\s*$/, '').trim();
  if (isExpr(t) && t.length < 90 && !/^(is|are|does|do|has|can|should|was|will)\s/i.test(t)) {
    const c = lang === 'py' ? toPy(t) : toC(t, lang);
    if (fits(c, lang)) return c;
  }
  return ident(t, lang === 'py' ? 'snake' : lang === 'cs' ? 'pascal' : 'camel') + '()';
}
function negate(c, lang) {
  let m;
  if ((m = /^not\s+\((.*)\)$/.exec(c)) || (m = /^!\((.*)\)$/.exec(c)) || (m = /^NOT\s+\((.*)\)$/.exec(c))) return m[1];
  if ((m = /^not\s+([\w.]+(\(.*\))?)$/.exec(c)) || (m = /^!([\w.]+(\(.*\))?)$/.exec(c))) return m[1];
  const simple = /^[\w.]+(\(.*\))?$/.test(c);
  if (lang === 'py') return simple ? `not ${c}` : `not (${c})`;
  if (lang === 'pseudo') return `NOT (${c})`;
  return simple ? `!${c}` : `!(${c})`;
}
const OUT_RE = /^(print|display|show|output|write|say|tell|report)\b\s*:?\s*(.*)$/i;
const IN_RE = /^(read|enter|input|get|ask(?: for)?|type|scan)\b\s*:?\s*(.*)$/i;
const CODEY = /^[A-Za-z_][\w.[\]]*\s*([+\-*/%]?=|\+\+|--)|^(\+\+|--)\w|^[\w.:]+\(.*\)$|^(return|break|continue|throw|raise)\b|^(?:std::)?(cout|cin)\b|^(const|let|var|auto|int|long|double|float|char|bool|string|decimal)\s+\w/;
function stmtOf(node, lang) {
  const code = codeOf(node, lang);
  if (code) {
    const lines = code.split('\n');
    if (lang === 'py') return lines.map((l) => l.replace(/;\s*$/, '')).flatMap((l) => (/^\s*(with|try|except|finally|else)\b.*:\s*$/.test(l) ? carry(l.trim(), 'py') : [l]));
    if (lang !== 'pseudo' && lines.length === 1 && !/[;{}]\s*$/.test(lines[0])) lines[0] += ';';
    return lines;
  }
  if (/^(try|finally|else|catch\b.*|except\b.*)$/i.test(node.text.trim())) return [(lang === 'py' ? '# ' : lang === 'pseudo' ? '// ' : '// ') + node.text.trim()];
  const src = (node.code?.source || '').trim();
  if (src) {
    // code in another language: carry each line across, keeping what cannot be translated as a comment
    const out = [];
    for (const raw of src.split('\n')) {
      const l = raw.trim().replace(/;\s*$/, '');
      if (!l) continue;
      out.push(...carry(l, lang));
    }
    if (out.length) return out;
  }
  const line = foreignLine(node);
  const io = ioOf(line);
  if (io) return ioCode(io, lang).split('\n').map((x) => (fits(x, lang) ? x : todo(line, lang)));
  if (/^with\s/.test(line) || CODEY.test(line)) return carry(line, lang);
  const t = node.text.replace(/\s+/g, ' ').trim();
  const semi = lang === 'py' || lang === 'pseudo' ? '' : ';';
  if (node.type === 'io' || OUT_RE.test(t) || IN_RE.test(t)) {
    const inp = IN_RE.exec(t);
    if (inp) {
      const v = ident(inp[2] || 'value', lang === 'py' ? 'snake' : 'camel');
      return [{ py: `${v} = input(${str(t + ': ')})`, js: `let ${v} = prompt(${str(t)});`, cpp: `string ${v}; cout << ${str(t + ': ')}; cin >> ${v};`, cs: `var ${v} = Console.ReadLine();`, pseudo: `INPUT ${v}` }[lang]];
    }
    const out = OUT_RE.exec(t);
    const said = out && out[2] ? out[2].trim() : t;
    const msg = /^(["']).*\1$/.test(said) ? '"' + said.slice(1, -1).replace(/"/g, '\\"') + '"' : str(said);
    return [ioCode({ out: [msg] }, lang)];
  }
  if (lang === 'pseudo') return [t];
  return [ident(t, lang === 'py' ? 'snake' : lang === 'cs' ? 'pascal' : 'camel') + '()' + semi];
}

/* ---------- graph analysis ---------- */
export function docToCode(doc, lang = 'py') {
  const warnings = new Set();
  const nodes = doc.nodes.filter((n) => n.type !== 'note' && n.type !== 'lane');
  if (!nodes.length) return { code: '', warnings: ['The chart is empty.'] };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outs = new Map(nodes.map((n) => [n.id, []]));
  const incoming = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of doc.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    outs.get(e.from).push(e);
    incoming.set(e.to, incoming.get(e.to) + 1);
  }
  const start = nodes.find((n) => n.type === 'start') || nodes.find((n) => !incoming.get(n.id)) || nodes[0];
  const isDecision = (id) => byId.get(id).type === 'decision' && outs.get(id).length >= 2;
  const flow = (id) => {
    const es = outs.get(id);
    if (isDecision(id)) return [...es].sort((a, b) => rank(a.label) - rank(b.label));
    if (es.length > 1) warnings.add(`"${byId.get(id).text}" has more than one exit but is not a Decision, so only its first arrow was followed.`);
    return es.slice(0, 1);
  };

  // depth-first walk: back edges and the order to solve post-dominators in
  const state = new Map(), back = new Set(), post = [];
  const preds = new Map(nodes.map((n) => [n.id, []]));
  (function dfs(u) {
    state.set(u, 1);
    for (const e of flow(u)) {
      preds.get(e.to).push(u);
      if (state.get(e.to) === 1) back.add(e.id);
      else if (!state.get(e.to)) dfs(e.to);
    }
    state.set(u, 2);
    post.push(u);
  })(start.id);
  const unreached = nodes.filter((n) => !state.has(n.id) && n.type !== 'end');
  if (unreached.length) warnings.add(`${unreached.length} step${unreached.length === 1 ? ' is' : 's are'} not connected to Start and ${unreached.length === 1 ? 'was' : 'were'} left out.`);

  // natural loops
  const loops = new Map();
  for (const u of state.keys()) for (const e of flow(u)) {
    if (!back.has(e.id)) continue;
    const L = loops.get(e.to) || { h: e.to, nodes: new Set([e.to]), latches: [] };
    loops.set(e.to, L);
    L.latches.push(u);
    const stack = [u];
    while (stack.length) { const x = stack.pop(); if (!L.nodes.has(x)) { L.nodes.add(x); stack.push(...preds.get(x).filter((p) => state.has(p))); } }
  }
  const loopList = [...loops.values()];
  for (const L of loopList) {
    L.parent = loopList.filter((l) => l !== L && l.nodes.has(L.h) && l.nodes.size > L.nodes.size).sort((a, b) => a.nodes.size - b.nodes.size)[0] || null;
    const exits = [];
    for (const x of L.nodes) for (const e of flow(x)) if (!L.nodes.has(e.to) && byId.get(e.to).type !== 'end') exits.push(e.to);
    const counts = new Map();
    for (const t of exits) counts.set(t, (counts.get(t) || 0) + 1);
    // a while-style loop leaves through its header; otherwise take the most common way out
    const headExit = isDecision(L.h) ? flow(L.h).find((e) => !L.nodes.has(e.to) && byId.get(e.to).type !== 'end') : null;
    L.exit = headExit ? headExit.to : [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    // steps reached only from inside the loop (a break step, a return path) belong to its body
    for (let grew = true; grew;) {
      grew = false;
      for (const x of state.keys()) {
        if (L.nodes.has(x) || x === L.exit || byId.get(x).type === 'end' || loops.has(x) && x !== L.h) continue;
        const ps = preds.get(x).filter((q) => state.has(q));
        if (ps.length && ps.every((q) => L.nodes.has(q))) { L.nodes.add(x); grew = true; }
      }
    }
  }
  const innermost = (id) => loopList.filter((l) => l.nodes.has(id)).sort((a, b) => a.nodes.size - b.nodes.size)[0] || null;
  // where an arrow lands, seen from inside loop P: a node, or continue / break / exit
  const rel = (P, s) => {
    if (byId.get(s).type === 'end') return EXIT;
    for (let l = P; l; l = l.parent) {
      if (s === l.h) return 'C:' + l.h;
      if (l.nodes.has(s)) return s;
      if (s === l.exit) return 'B:' + l.h;
    }
    return s;
  };
  const target = (id, e) => rel(innermost(id), e.to);

  // Post-dominators, one region at a time (the whole function, or one loop's body). Inside a region a
  // nested loop counts as a single step whose only way on is that loop's exit, so branches rejoin after it.
  const pdomCache = new Map();
  function pdomFor(R) {
    const key = R ? R.h : '';
    if (pdomCache.has(key)) return pdomCache.get(key);
    const child = (v) => { const L = loops.get(v); return L && L !== R && L.parent === R ? L : null; };
    const visible = (v) => innermost(v) === R || !!child(v);
    const succ = (v) => {
      if (isSink(v)) return [ROOT];
      const L = child(v);
      const ts = L ? (L.exit ? [rel(R, L.exit)] : []) : flow(v).map((e) => rel(R, e.to));
      return ts.length ? ts : [ROOT];
    };
    const verts = [...state.keys()].filter(visible);
    const all = new Set([...verts, EXIT, ROOT]);
    for (const v of verts) for (const t of succ(v)) all.add(t);
    const pd = new Map([...all].map((v) => [v, v === ROOT ? new Set([ROOT]) : null]));
    const order = [...[...all].filter(isSink), ...post.filter((v) => all.has(v))];
    for (let changed = true, pass = 0; changed && pass < 200; pass++) {
      changed = false;
      for (const v of order) {
        let acc = null;
        for (const t of succ(v)) {
          const ps = pd.get(t);
          if (!ps) continue;
          acc = acc ? new Set([...acc].filter((x) => ps.has(x))) : new Set(ps);
        }
        if (!acc) continue;
        acc.add(v);
        const old = pd.get(v);
        if (!old || old.size !== acc.size) { pd.set(v, acc); changed = true; }
      }
    }
    pdomCache.set(key, pd);
    return pd;
  }
  const ipdom = (v) => {
    const pd = pdomFor(innermost(v));
    const ps = pd.get(v);
    if (!ps) return ROOT;
    for (const d of ps) if (d !== v && pd.get(d)?.size === ps.size - 1) return d;
    return ROOT;
  };

  /* ---------- structure ---------- */
  const seen = new Map();
  let steps = 0;
  function seq(n, stop, ctx) {
    const out = [];
    while (n && n !== stop && n !== ROOT) {
      if (++steps > 6000) { warnings.add('The chart is too tangled to finish converting.'); break; }
      if (isSink(n)) { out.push(sinkStmt(n, ctx)); break; }
      const L = loops.get(n);
      if (L && !ctx.active.has(n)) { const r = loopAst(L, ctx); out.push(...r.ast); n = r.next; continue; }
      const node = byId.get(n);
      seen.set(n, (seen.get(n) || 0) + 1);
      if (seen.get(n) === 2) warnings.add(`"${node.text}" is written in more than one branch, because two paths share it without a single place where they rejoin.`);
      const f = flow(n);
      if (isDecision(n)) {
        const m0 = ipdom(n), m = m0 === ROOT ? stop : m0;   // no rejoin: each branch runs to the end of this block
        const arms = f.map((e) => ({ label: e.label, ast: seq(target(n, e), m, ctx) }));
        out.push(ifAst(node, arms));
        n = m;
      } else {
        // a step that only says "break" or "continue" is already expressed by where its arrow goes
        const jumpOnly = /^(break|continue);?$/.test(node.text.trim());
        if (node.type !== 'start' && node.type !== 'end' && node.type !== 'connector' && !jumpOnly) {
          const lines = stmtOf(node, lang);
          out.push({ k: 'stmt', lines });
          if (/^\s*(return|throw|raise)\b/i.test(lines[lines.length - 1] || '')) break;   // it already leaves
        }
        n = f.length ? target(n, f[0]) : EXIT;
      }
    }
    return out;
  }
  function sinkStmt(n, ctx) {
    if (n === EXIT) return { k: 'return' };
    const h = n.slice(2), inner = ctx.stack[ctx.stack.length - 1];
    if (inner && inner.h === h) return { k: n[0] === 'C' ? 'continue' : 'break' };
    if (ctx.stack.some((l) => l.h === h)) { warnings.add('An arrow jumps out of two loops at once; it is written as a single break or continue.'); return { k: n[0] === 'C' ? 'continue' : 'break' }; }
    warnings.add('An arrow jumps back into a loop from outside it; that step was written as a comment.');
    return { k: 'comment', text: `goes back to "${byId.get(h).text}"` };
  }
  function ifAst(node, arms) {
    const cond = condOf(node, lang);
    if (arms.length === 2) {
      let [a, b] = arms, c = cond;
      if (!a.ast.length && b.ast.length) { [a, b] = [b, a]; c = negate(cond, lang); }
      return { k: 'if', cond: c, then: a.ast, else: b.ast };
    }
    // three or more labelled arrows: compare the question's subject with each label
    let chain = [];
    for (const arm of [...arms].reverse()) {
      const c = lang === 'pseudo' ? `${cond} = ${str(arm.label || '?')}` : `${cond} == ${str(arm.label || '?')}`;
      chain = arm === arms[arms.length - 1] && !arm.label ? arm.ast : [{ k: 'if', cond: c, then: arm.ast, else: chain }];
    }
    return chain[0] || { k: 'stmt', lines: [] };
  }
  function loopAst(L, ctx) {
    const h = L.h, node = byId.get(h);
    const inner = { active: new Set([...ctx.active, h]), stack: [...ctx.stack, L] };
    const after = (s) => rel(L.parent, s);
    const f = flow(h);
    if (isDecision(h) && f.length === 2) {
      const ins = f.filter((e) => L.nodes.has(e.to)), outE = f.filter((e) => !L.nodes.has(e.to));
      if (ins.length === 1 && outE.length === 1) {
        seen.set(h, (seen.get(h) || 0) + 1);
        const body = trim(seq(target(h, ins[0]), 'C:' + h, inner), 'continue');
        const each = /^Next:\s*(.+?)\s+(in|of)\s+(.+?)\??$/i.exec(node.text.trim());
        if (each && rank(ins[0].label) !== 2) return { ast: [{ k: 'each', v: each[1], coll: each[3], body }], next: after(outE[0].to) };
        let cond = condOf(node, lang);
        if (rank(ins[0].label) === 2) cond = negate(cond, lang);
        return { ast: [{ k: 'while', cond, body }], next: after(outE[0].to) };
      }
    }
    const exits = [];
    for (const x of L.nodes) for (const e of flow(x)) if (!L.nodes.has(e.to)) exits.push(e);
    if (L.latches.length === 1 && isDecision(L.latches[0])) {
      const d = L.latches[0], fd = flow(d);
      const backE = fd.find((e) => e.to === h), outE = fd.find((e) => e.to !== h);
      if (fd.length === 2 && backE && outE && !L.nodes.has(outE.to) && exits.every((e) => e.from === d || byId.get(e.to).type === 'end')) {
        const body = seq(h, d, inner);
        seen.set(d, (seen.get(d) || 0) + 1);
        let cond = condOf(byId.get(d), lang);
        if (rank(backE.label) === 2) cond = negate(cond, lang);
        return { ast: [{ k: 'dowhile', cond, body }], next: after(outE.to) };
      }
    }
    const body = trim(seq(h, 'C:' + h, inner), 'continue');
    return { ast: [{ k: 'while', cond: lang === 'py' ? 'True' : lang === 'pseudo' ? 'TRUE' : 'true', body }], next: L.exit ? after(L.exit) : ROOT };
  }
  /** Drop a redundant final continue / return (also inside a final if). */
  function trim(ast, kind) {
    const last = ast[ast.length - 1];
    if (!last) return ast;
    if (last.k === kind) return ast.slice(0, -1);
    if (last.k === 'if') { last.then = trim(last.then, kind); last.else = trim(last.else, kind); }
    return ast;
  }

  const body = guard(trim(seq(start.id, ROOT, { active: new Set(), stack: [] }), 'return'), lang);
  return { code: printProgram(doc, start, body, lang), warnings: [...warnings] };
}

/** "if (c) { break; } else { x; }" -> "if (c) { break; } x;" — applied throughout. */
const JUMPS = new Set(['break', 'continue', 'return']);
function guard(ast, lang) {
  const out = [];
  for (const s of ast) {
    if (s.k === 'if') {
      s.then = guard(s.then, lang); s.else = guard(s.else, lang);
      if (!s.then.length && s.else.length) { s.then = s.else; s.else = []; s.cond = negate(s.cond, lang); }
      const last = s.then[s.then.length - 1];
      if (last && JUMPS.has(last.k) && s.else.length && !(s.else.length === 1 && s.else[0].k === 'if')) { const rest = s.else; s.else = []; out.push(s, ...rest); continue; }
      out.push(s);
    } else {
      if (s.body) s.body = guard(s.body, lang);
      out.push(s);
    }
  }
  return out;
}

/* ---------- printing ---------- */
const IND = { py: '    ', js: '  ', cpp: '    ', cs: '    ', pseudo: '    ' };
function printBlock(ast, lang, depth) {
  const pad = IND[lang].repeat(depth), out = [];
  const C = lang === 'js' || lang === 'cpp' || lang === 'cs';
  const open = (head) => (lang === 'cs' ? [pad + head, pad + '{'] : [pad + head + ' {']);
  for (const s of ast) {
    if (s.k === 'stmt') for (const l of s.lines) out.push(pad + l);
    else if (s.k === 'comment') out.push(pad + (lang === 'py' ? '# ' : lang === 'pseudo' ? '// ' : '// ') + s.text);
    else if (s.k === 'break' || s.k === 'continue' || s.k === 'return') out.push(pad + (lang === 'pseudo' ? s.k.toUpperCase() : s.k + (C ? ';' : '')));
    else if (s.k === 'if') {
      let node = s, first = true;
      while (node) {
        const kw = first ? 'if' : (lang === 'py' ? 'elif' : lang === 'pseudo' ? 'ELSE IF' : 'else if');
        if (lang === 'py') out.push(`${pad}${kw} ${node.cond}:`, ...printBlock(node.then, lang, depth + 1).concat(node.then.length ? [] : [pad + IND.py + 'pass']));
        else if (lang === 'pseudo') out.push(`${pad}${first ? 'IF' : kw} ${node.cond} THEN`, ...printBlock(node.then, lang, depth + 1));
        else {
          if (first) out.push(...open(`if (${node.cond})`));
          else if (lang === 'cs') out.push(pad + '}', `${pad}else if (${node.cond})`, pad + '{');
          else out.push(`${pad}} else if (${node.cond}) {`);
          out.push(...printBlock(node.then, lang, depth + 1));
        }
        first = false;
        const els = node.else;
        if (els.length === 1 && els[0].k === 'if') { node = els[0]; continue; }
        if (els.length) {
          if (lang === 'py') out.push(`${pad}else:`);
          else if (lang === 'pseudo') out.push(`${pad}ELSE`);
          else if (lang === 'cs') out.push(pad + '}', pad + 'else', pad + '{');
          else out.push(`${pad}} else {`);
          out.push(...printBlock(els, lang, depth + 1));
        }
        node = null;
      }
      if (lang === 'pseudo') out.push(pad + 'END IF');
      else if (C) out.push(pad + '}');
    } else if (s.k === 'while') {
      if (lang === 'py') out.push(`${pad}while ${s.cond}:`, ...(s.body.length ? printBlock(s.body, lang, depth + 1) : [pad + IND.py + 'pass']));
      else if (lang === 'pseudo') out.push(`${pad}WHILE ${s.cond} DO`, ...printBlock(s.body, lang, depth + 1), pad + 'END WHILE');
      else out.push(...open(`while (${s.cond})`), ...printBlock(s.body, lang, depth + 1), pad + '}');
    } else if (s.k === 'each' && lang !== 'py' && /^range\((.*)\)$/.test(s.coll)) {
      const a = splitArgs(/^range\((.*)\)$/.exec(s.coll)[1]).map((x) => toC(x, lang));
      const [from, to, by] = a.length === 1 ? ['0', a[0], '1'] : [a[0], a[1], a[2] || '1'];
      const step = by === '1' ? `${s.v}++` : `${s.v} += ${by}`;
      const head = lang === 'pseudo' ? `FOR ${s.v} FROM ${from} TO ${to} - 1 DO` : `for (${{ js: 'let', cpp: 'int', cs: 'int' }[lang]} ${s.v} = ${from}; ${s.v} < ${to}; ${step})`;
      if (lang === 'pseudo') out.push(pad + head, ...printBlock(s.body, lang, depth + 1), pad + 'END FOR');
      else out.push(...open(head), ...printBlock(s.body, lang, depth + 1), pad + '}');
    } else if (s.k === 'each') {
      const head = { py: `for ${s.v} in ${s.coll}:`, js: `for (const ${s.v} of ${s.coll})`, cpp: `for (auto& ${s.v} : ${s.coll})`, cs: `foreach (var ${s.v} in ${s.coll})`, pseudo: `FOR EACH ${s.v} IN ${s.coll} DO` }[lang];
      if (lang === 'py') out.push(pad + head, ...(s.body.length ? printBlock(s.body, lang, depth + 1) : [pad + IND.py + 'pass']));
      else if (lang === 'pseudo') out.push(pad + head, ...printBlock(s.body, lang, depth + 1), pad + 'END FOR');
      else out.push(...open(head), ...printBlock(s.body, lang, depth + 1), pad + '}');
    } else if (s.k === 'dowhile') {
      if (lang === 'py') out.push(`${pad}while True:`, ...printBlock(s.body, lang, depth + 1), `${pad}${IND.py}if ${negate(s.cond, 'py')}:`, `${pad}${IND.py}${IND.py}break`);
      else if (lang === 'pseudo') out.push(`${pad}REPEAT`, ...printBlock(s.body, lang, depth + 1), `${pad}UNTIL ${negate(s.cond, 'pseudo')}`);
      else if (lang === 'cs') out.push(pad + 'do', pad + '{', ...printBlock(s.body, lang, depth + 1), `${pad}} while (${s.cond});`);
      else out.push(pad + 'do {', ...printBlock(s.body, lang, depth + 1), `${pad}} while (${s.cond});`);
    }
  }
  return out;
}

function printProgram(doc, start, body, lang) {
  const sig = /^start\s*:\s*(.+)$/i.exec(start.text.trim());
  let fname, params = '';
  if (sig) {
    const m = /^([\w.]+)\s*\((.*)\)$/.exec(sig[1].trim());
    fname = m ? m[1].split('.').pop() : ident(sig[1], lang === 'py' ? 'snake' : lang === 'cs' || lang === 'pseudo' ? 'pascal' : 'camel');
    params = m ? m[2].trim() : '';
  } else fname = ident(doc.name || 'flowchart', lang === 'py' ? 'snake' : lang === 'cs' || lang === 'pseudo' ? 'pascal' : 'camel');
  const plist = params ? params.split(',').map((p) => p.trim().split(/[\s=:]+/).filter((w) => !/^(int|double|float|string|bool|var|auto|const|let|object|char|long|void|decimal)$/.test(w)).pop()).filter(Boolean) : [];
  const note = `Generated by FlowState from "${doc.name || 'flowchart'}". Calls such as ${lang === 'py' ? 'check_balance()' : lang === 'cs' ? 'CheckBalance()' : 'checkBalance()'} stand for steps written in plain words; fill them in.`;
  const B = (d) => printBlock(body, lang, d);
  if (lang === 'py') {
    const lines = [`# ${note}`, '', `${B(1).some((l) => /\bawait\s/.test(l)) ? 'async ' : ''}def ${fname}(${plist.join(', ')}):`, ...(body.length ? B(1) : ['    pass'])];
    if (!plist.length) lines.push('', '', 'if __name__ == "__main__":', `    ${fname}()`);
    return lines.join('\n') + '\n';
  }
  const isAsync = B(1).some((l) => /\bawait\s/.test(l));
  if (lang === 'js') return [`// ${note}`, '', `${isAsync ? 'async ' : ''}function ${fname}(${plist.join(', ')}) {`, ...B(1), '}', ''].join('\n');
  if (lang === 'cpp') {
    const isMain = /^main$/i.test(fname);
    const head = isMain ? 'int main()' : `void ${fname}(${plist.map((p) => 'auto ' + p).join(', ')})`;
    return [`// ${note}`, '#include <iostream>', '#include <string>', 'using namespace std;', '', `${head} {`, ...B(1), ...(isMain && !/^\s*return\b/.test(B(1).slice(-1)[0] || '') ? ['    return 0;'] : []), '}', ''].join('\n');
  }
  if (lang === 'cs') {
    const name = /^main$/i.test(fname) ? 'Main' : cap(fname);
    return [`// ${note}`, 'using System;', '', 'class Program', '{', `    static void ${name}(${plist.map((p) => 'object ' + p).join(', ')})`, '    {', ...B(2), '    }', '}', ''].join('\n');
  }
  return [`// ${note}`, '', `PROCEDURE ${cap(fname)}(${plist.join(', ')})`, ...B(1), 'END PROCEDURE', ''].join('\n');
}
