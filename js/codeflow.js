// Source code -> flowchart, for Python, JavaScript, C++ and C#.
// Two front ends build the same statement tree:
//   Python: logical lines (brackets and backslashes joined) -> indentation blocks.
//   C-style (C++, C#, JavaScript): statements split at ; { } -> brace blocks (Allman or K&R, braces optional).
// Tree nodes: step | if | loop (while / for / foreach) | dowhile | def. Then one layout pass draws it.
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

export const CODE_LANGS = { py: 'Python', js: 'JavaScript', cpp: 'C++', cs: 'C#' };
const CODE_TAG = { py: 'python', js: 'javascript', cpp: 'cpp', cs: 'csharp' };
const IO = /\b(input|print|console\.(log|error|warn)|prompt|alert|cout|cin|cerr|printf|scanf|puts|gets|getline|fgets|Console\.(Write|WriteLine|Read|ReadLine|ReadKey))\b/;

/** Best guess at the language of a snippet, or null. */
export function guessLang(src) {
  const s = String(src);
  if (/^\s*#include\b|\bstd::|\bcout\s*<<|\bcin\s*>>|\bprintf\s*\(/m.test(s)) return 'cpp';
  if (/\busing\s+System\b|\bConsole\.\w+\s*\(|\bstatic\s+void\s+Main\b|\bforeach\s*\(|\bnamespace\s+[\w.]+/.test(s)) return 'cs';
  if (/\bfunction\b|=>|\bconsole\.log\b|\b(let|const)\s+\w+\s*=|===/.test(s)) return 'js';
  if (/^\s*(def|elif|import|from)\b|:\s*$/m.test(s) && !/[;{]\s*$/m.test(s)) return 'py';
  return null;
}

/* ================= Python front end ================= */
/** Join physical lines into logical ones (open brackets, triple quotes, backslashes) and drop comments. */
function pyLines(src) {
  const out = [];
  let buf = null, ind = 0, depth = 0, q = null, triple = false;
  for (const raw of String(src).replace(/\t/g, '    ').replace(/\r/g, '').split('\n')) {
    let line = '';
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (q) {
        line += c;
        if (c === '\\') { line += raw[i + 1] ?? ''; i++; continue; }
        if (triple ? raw.startsWith(q.repeat(3), i) : c === q) {
          if (triple) { line += q + q; i += 2; }
          q = null; triple = false;
        }
        continue;
      }
      if (c === '#') break;
      if (c === '"' || c === "'") {
        if (raw.startsWith(c.repeat(3), i)) { q = c; triple = true; line += c.repeat(3); i += 2; continue; }
        q = c; line += c; continue;
      }
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
      line += c;
    }
    if (q && !triple) q = null;                          // an unclosed quote ends with its line
    const cont = depth > 0 || triple || /\\\s*$/.test(line);
    const text = line.replace(/\\\s*$/, '');
    if (buf === null) {
      if (!text.trim()) continue;
      buf = text.trim(); ind = text.length - text.trimStart().length;
    } else buf += ' ' + text.trim();
    if (!cont) { out.push({ ind, text: buf.trim() }); buf = null; }
  }
  if (buf && buf.trim()) out.push({ ind, text: buf.trim() });
  return out;
}

/** Index of the first character `ch` outside brackets and strings, or -1. */
function topLevel(text, ch, from = 0) {
  let depth = 0, q = null;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (depth === 0 && text.startsWith(ch, i)) return i;
  }
  return -1;
}
const PY_HEAD = /^(?:async\s+)?(if|elif|else|while|for|with|try|except|finally|def|class|match|case)\b/;

/** Split "if x: return y" into a header line and a deeper body line; split "a = 1; b = 2". */
function pyExpand(lines) {
  const out = [];
  for (const { ind, text } of lines) {
    let t = text;
    if (PY_HEAD.test(t)) {
      let c = topLevel(t, ':');
      while (c >= 0 && t[c + 1] === '=') c = topLevel(t, ':', c + 2);   // skip the walrus :=
      if (c >= 0 && t.slice(c + 1).trim()) {
        out.push({ ind, text: t.slice(0, c + 1).replace(/^async\s+/, '') });
        for (const part of splitTop(t.slice(c + 1), ';')) out.push({ ind: ind + 1, text: part });
        continue;
      }
      t = t.replace(/^async\s+/, '');
    }
    for (const part of splitTop(t, ';')) out.push({ ind, text: part });
  }
  return out;
}
function splitTop(text, ch) {
  const parts = [];
  let rest = text;
  for (let i = topLevel(rest, ch); i >= 0; i = topLevel(rest, ch)) { parts.push(rest.slice(0, i)); rest = rest.slice(i + 1); }
  parts.push(rest);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const PY_SKIP = /^(import\s|from\s+\S+\s+import\s|pass$|@|global\s|nonlocal\s)|^[rbuf]*("""|'''|"|')[\s\S]*\2$/i;

function parsePython(src) {
  const lines = pyExpand(pyLines(src));
  let i = 0;
  const bodyOf = (ind) => (i < lines.length && lines[i].ind > ind ? block(lines[i].ind) : []);
  function block(ind) {
    const out = [];
    while (i < lines.length && lines[i].ind >= ind) {
      const { text: tx, ind: ind0 } = lines[i++];
      if (PY_SKIP.test(tx)) { bodyOf(ind0); continue; }
      const m = /^(if|elif|else|while|for|def|try|except|finally|with|class|match|case)\b(.*):$/.exec(tx);
      if (!m) { out.push(step(tx, 'py')); continue; }
      const [, kw, rest] = m, head = rest.trim();
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
      else if (kw === 'class') out.push(...bodyOf(ind0).filter((s) => s.t === 'def'));
      else if (kw === 'match') {
        const cases = [];
        while (i < lines.length && lines[i].ind > ind0) {
          const c = /^case\s+(.*):$/.exec(lines[i].text);
          const at = lines[i++].ind;
          const body = bodyOf(at);
          if (c) cases.push({ pat: c[1].trim(), body });
        }
        out.push(...switchChain(head, cases.map((c) => ({ labels: [c.pat === '_' ? null : c.pat], body: c.body })), ' or '));
      } else if (kw === 'elif' || kw === 'else' || kw === 'case') out.push(step(tx, 'py'));
      else out.push({ ...step(tx.slice(0, -1), 'py'), code: tx }, ...bodyOf(ind0));
    }
    return out;
  }
  return block(lines.length ? lines[0].ind : 0);
}

/* ================= C-style front end: C++, C#, JavaScript ================= */
const BLOCK_END = /(\)|\belse|\bdo|\btry|\bfinally|=>|\bconst|\boverride|\bnoexcept|\bfinal|\bmutable|:|\)\s*->\s*[\w:<>*&\s]+|\b(get|set|init|add|remove))\s*$/;
const TYPE_HEAD = /^((public|private|protected|internal|static|sealed|abstract|partial|export|default|final|unsafe|readonly|ref|file|inline|template\s*<[^>]*>)\s+)*(class|struct|namespace|interface|enum|record|union)\b/;

/** Split C-style source into statements/headers and braces. Initialiser braces stay inside their statement. */
function cTokens(src, lang) {
  const s = String(src).replace(/\r/g, '');
  const items = [];
  let buf = '', depth = 0;
  const push = () => { const t = buf.replace(/\s+/g, ' ').trim(); if (t) items.push(t); buf = ''; };
  for (let i = 0; i < s.length;) {
    const c = s[i], c2 = s.slice(i, i + 2);
    if (c2 === '//') { const nl = s.indexOf('\n', i); i = nl < 0 ? s.length : nl; continue; }
    if (c2 === '/*') { const e = s.indexOf('*/', i + 2); i = e < 0 ? s.length : e + 2; buf += ' '; continue; }
    if (c === '#' && lang !== 'js' && !buf.trim()) { const nl = s.indexOf('\n', i); i = nl < 0 ? s.length : nl; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const verbatim = lang === 'cs' && s[i - 1] === '@';
      let j = i + 1;
      while (j < s.length) {
        if (!verbatim && s[j] === '\\') { j += 2; continue; }
        if (s[j] === c) { if (verbatim && s[j + 1] === c) { j += 2; continue; } j++; break; }
        if (s[j] === '\n' && c !== '`' && !verbatim) break;
        j++;
      }
      buf += s.slice(i, j); i = j; continue;
    }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    if (depth === 0 && c === '{') {
      const head = buf.replace(/\s+/g, ' ').trim();
      if (!head || BLOCK_END.test(head) || TYPE_HEAD.test(head) || /^(case\s.*|default)\s*:$/.test(head)) { push(); items.push('{'); i++; continue; }
      // an initialiser or object literal: copy the balanced braces into the statement
      let d = 0, j = i;
      for (; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}' && --d === 0) { j++; break; } }
      buf += s.slice(i, j); i = j; continue;
    }
    if (depth === 0 && c === '}') { push(); items.push('}'); i++; continue; }
    if (depth === 0 && c === ';') { push(); i++; continue; }
    if (lang === 'js' && depth === 0 && c === '\n') {
      const next = (s.slice(i + 1).split('\n')[0] || '').trim();
      const endsOp = /[=+\-*/%&|^<>!?:,.(]\s*$/.test(buf) && !/(\+\+|--)\s*$/.test(buf);
      if (buf.trim() && !endsOp && !/^[.?:+\-*/%&|)\]]/.test(next)) push(); else buf += ' ';
      i++; continue;
    }
    buf += c; i++;
  }
  push();
  return items;
}

/** "(cond) rest" -> [cond, rest]; t must start with the keyword and then "(". */
function parens(t, kw) {
  const at = t.indexOf('(', kw.length);
  if (at < 0) return [t.slice(kw.length).trim(), ''];
  let d = 0, q = null;
  for (let i = at; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '(') d++;
    else if (c === ')' && --d === 0) return [t.slice(at + 1, i).trim(), t.slice(i + 1).trim()];
  }
  return [t.slice(at + 1).trim(), ''];
}
/** "var x in xs", "const x of xs", "auto& x : xs" -> "x in xs" / "x of xs". */
function eachCond(inside) {
  let m = /^(.*?)\s+(in|of)\s+(.+)$/.exec(inside), op;
  if (m) op = m[2]; else if ((m = /^(.*?[^:]):(?!:)\s*(.+)$/.exec(inside))) { m = [m[0], m[1], 'in', m[2]]; op = 'in'; }
  if (!m) return inside;
  const lhs = m[1].trim();
  const v = /[[{]/.test(lhs) ? lhs.replace(/^(const|let|var)\s+/, '') : lhs.split(/[\s*&]+/).filter(Boolean).pop();
  return `${v} ${op} ${m[3].trim()}`;
}
const SKIP_C = /^(using\s+(static\s+)?[\w.]+(\s*=\s*[\w.<>]+)?|using\s+namespace\s+\w+|import\b.*|export\s*\{.*\}|package\s.*|namespace\s+[\w.]+|['"]use strict['"]|(public|private|protected|internal)\s*:|template\s*<.*>)$/;
const FUNC = /^(?!(if|for|foreach|while|switch|catch|using|lock|fixed|return|new|else|do|try|await|throw|delete|typeof|sizeof)\b)[^=]*?\b([~\w]+(?:::~?\w+)?)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*(const|override|noexcept|final|mutable|async)?\s*(->\s*[\w:<>*&\s]+)?(\s*:\s*.+)?$/;
const ARROW = /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\(([^)]*)\)|(\w+))\s*=>$/;

function parseCLike(src, lang) {
  const items = cTokens(src, lang);
  let i = 0;
  const block = () => {                        // called just after a "{"
    const out = [];
    while (i < items.length && items[i] !== '}') out.push(...stmt());
    if (items[i] === '}') i++;
    return out;
  };
  const body = (rest) => {                     // the body of a control header
    if (rest) return text(rest);
    if (items[i] === '{') { i++; return block(); }
    if (i < items.length && items[i] !== '}') return stmt();
    return [];
  };
  function stmt() {
    const t = items[i++];
    if (t === '{') return block();
    if (t === '}' || t === undefined) return [];
    return text(t);
  }
  function text(t) {
    let m;
    if (/^if\s*\(/.test(t)) {
      const [cond, rest] = parens(t, 'if');
      const node = { t: 'if', cond, then: body(rest), else: [] };
      if (typeof items[i] === 'string' && /^else\b/.test(items[i])) {
        const r = items[i++].replace(/^else\s*/, '');
        node.else = /^if\s*\(/.test(r) ? text(r) : body(r);
      }
      return [node];
    }
    if (/^while\s*\(/.test(t)) { const [cond, rest] = parens(t, 'while'); return [{ t: 'loop', kw: 'while', cond: cond || 'true', body: body(rest) }]; }
    if (/^for\s*\(/.test(t)) {
      const [inside, rest] = parens(t, 'for');
      const parts = inside.split(';');
      if (parts.length >= 3) {
        const [init, cond, update] = parts.map((p) => p.trim());
        const b = body(rest);
        const out = init ? [step(init, lang)] : [];
        const loop = { t: 'loop', kw: 'while', cond: cond || 'true', body: b };
        if (update) { loop.update = step(update, lang); b.push(loop.update); }
        out.push(loop);
        return out;
      }
      return [{ t: 'loop', kw: 'for', cond: eachCond(inside), body: body(rest) }];
    }
    if (/^foreach\s*\(/.test(t)) { const [inside, rest] = parens(t, 'foreach'); return [{ t: 'loop', kw: 'for', cond: eachCond(inside), body: body(rest) }]; }
    if (/^do\b/.test(t)) {
      const b = body(t.slice(2).trim());
      let cond = 'true';
      if (typeof items[i] === 'string' && /^while\s*\(/.test(items[i])) cond = parens(items[i++], 'while')[0];
      return [{ t: 'dowhile', cond, body: b }];
    }
    if (/^switch\s*\(/.test(t)) {
      const [subj] = parens(t, 'switch');
      if (items[i] !== '{') return [step(t, lang)];
      i++;
      const groups = [];
      let cur = null;
      while (i < items.length && items[i] !== '}') {
        let s2 = items[i];
        const labels = [];
        while (typeof s2 === 'string' && (m = /^(case\s+(.+?)|default)\s*:(?!:)\s*/.exec(s2))) { labels.push(m[2] ?? null); s2 = s2.slice(m[0].length); }
        if (labels.length) {
          if (!cur || cur.body.length) { cur = { labels: [], body: [] }; groups.push(cur); }
          cur.labels.push(...labels);
          if (!s2) { i++; continue; }
          items[i] = s2;
        }
        if (!cur) { cur = { labels: [null], body: [] }; groups.push(cur); }
        cur.body.push(...stmt());
      }
      if (items[i] === '}') i++;
      return switchChain(subj, groups, ' || ');
    }
    if (/^try\b/.test(t)) {
      const out = [step('try', lang, ''), ...body(t.slice(3).trim())];
      while (typeof items[i] === 'string' && /^(catch|finally)\b/.test(items[i])) {
        const h = items[i++];
        let head = h, rest = '';
        if (/^catch\s*\(/.test(h)) { const [x, r] = parens(h, 'catch'); head = `catch (${x})`; rest = r; }
        else if (/^catch\b/.test(h)) { head = 'catch'; rest = h.slice(5).trim(); }
        else { head = 'finally'; rest = h.slice(7).trim(); }
        out.push(step(head, lang, ''), ...body(rest));
      }
      return out;
    }
    if (TYPE_HEAD.test(t)) {                                   // class / struct / namespace: keep only its functions
      if (items[i] !== '{') return [];
      i++;
      return block().filter((s) => s.t === 'def');
    }
    if (items[i] === '{') {
      if ((m = ARROW.exec(t))) { i++; return [{ t: 'def', name: `${m[1]}(${m[2] ?? m[3] ?? ''})`, body: block() }]; }
      if ((m = FUNC.exec(t))) { i++; return [{ t: 'def', name: `${m[2].split('::').pop()}(${m[3].trim()})`, body: block() }]; }
      i++;                                                     // using (...) { }, lock (...) { }, labelled blocks
      return [step(t, lang, ''), ...block()];
    }
    if (SKIP_C.test(t)) return [];
    if (/^else\b/.test(t)) return [step(t, lang)];
    return [step(t, lang)];
  }
  const out = [];
  while (i < items.length) out.push(...stmt());
  return out;
}

/* ================= shared ================= */
function step(text, lang, code) {
  const jump = /^(break|continue)\b/.exec(text);
  const c = code !== undefined ? code : lang === 'py' ? text : /[;}]$/.test(text) ? text : text + ';';
  return { t: 'step', text, code: c, io: IO.test(text), ret: /^(return|throw|raise|exit|sys\.exit)\b/.test(text), jump: jump ? jump[1] : null };
}
/** switch / match groups -> an if / else-if chain. Trailing breaks are dropped; default becomes the final else. */
function switchChain(subj, groups, or) {
  const def = groups.find((g) => g.labels.includes(null));
  const named = groups.filter((g) => g !== def);
  const trim = (b) => (b.length && b[b.length - 1].jump === 'break' ? b.slice(0, -1) : b);
  let chain = def ? trim(def.body) : [];
  for (const g of named.reverse()) {
    const cond = g.labels.filter((l) => l !== null).map((l) => `${subj} == ${l}`).join(or);
    chain = [{ t: 'if', cond, then: trim(g.body), else: chain }];
  }
  return chain;
}
/** What to draw: main() if there is one, else the top-level script, else the first function. */
function pickBody(tree, warnings) {
  const defs = tree.filter((s) => s.t === 'def');
  const fname = (d) => d.name.split('(')[0];
  const guard = tree.find((s) => s.t === 'if' && /__name__\s*==/.test(s.cond));
  const script = tree.filter((s) => s.t !== 'def' && s !== guard);
  const called = guard && defs.find((d) => guard.then.some((s) => s.t === 'step' && new RegExp(`\\b${fname(d)}\\s*\\(`).test(s.text)));
  const main = defs.find((d) => /^main$/i.test(fname(d))) || called;
  const others = (keep) => defs.filter((d) => d !== keep).map(fname);
  if (main) {
    if (defs.length > 1) warnings.push(`Charted ${fname(main)}(); ${others(main).join(', ')} ${others(main).length === 1 ? 'was' : 'were'} left out.`);
    return { start: 'Start: ' + main.name, body: main.body };
  }
  if (script.length) {
    if (defs.length) warnings.push(`Charted the main script; the function${defs.length === 1 ? '' : 's'} ${defs.map(fname).join(', ')} ${defs.length === 1 ? 'was' : 'were'} left out.`);
    return { start: 'Start', body: guard ? [...script, guard] : script };
  }
  if (defs.length) {
    if (defs.length > 1) warnings.push(`Only the first function (${fname(defs[0])}) was charted.`);
    return { start: 'Start: ' + defs[0].name, body: defs[0].body };
  }
  return { start: 'Start', body: tree };
}

/* ================= build nodes, then lay out ================= */
const GAP_Y = 56, GAP_X = 50;
// a decision gets its condition as code only when the code checks will see a real test in it
const HAS_TEST = /[<>=!]|&&|\|\||\b(in|is|of|not|and|or)\b/;
const short = (s) => (s.length > 46 ? s.slice(0, 45) + '…' : s);

/** @param {'py'|'js'|'cpp'|'cs'} lang */
export function codeToDoc(src, settings, name = 'From code', lang = 'py') {
  const warnings = [];
  const guess = guessLang(src);
  if (guess && guess !== lang && String(src).trim()) warnings.push(`This looks like ${CODE_LANGS[guess]}, not ${CODE_LANGS[lang]}. Switch the language if the chart looks wrong.`);
  const tree = lang === 'py' ? parsePython(src) : parseCLike(src, lang);
  const { start: startText, body } = pickBody(tree, warnings);
  if (!body.length) return { doc: null, warnings: ['No code to chart.'] };

  const doc = newDoc(name);
  doc.settings = { ...doc.settings, ...settings };
  const tag = CODE_TAG[lang] || 'python';
  const mk = (type, text, code) => {
    const n = newNode(type, 0, 0, doc.settings, short(text));
    n.code = { lang: code ? tag : 'none', source: code || '' };
    fitNode(n);
    doc.nodes.push(n);
    return n;
  };
  const edges = [];

  // pass 1: a node for every statement
  (function make(b) {
    for (const s of b) {
      if (s.t === 'step') s.node = mk(s.io ? 'io' : 'process', s.text, s.code);
      else if (s.t === 'if') { s.node = mk('decision', s.cond + '?', HAS_TEST.test(s.cond) ? s.cond : ''); make(s.then); make(s.else); }
      else if (s.t === 'loop') {
        s.node = mk('decision', (s.kw === 'for' ? 'Next: ' : '') + s.cond + '?', s.kw === 'while' && HAS_TEST.test(s.cond) ? s.cond : '');
        make(s.body);
      } else if (s.t === 'dowhile') { s.node = mk('decision', s.cond + '?', HAS_TEST.test(s.cond) ? s.cond : ''); make(s.body); }
    }
  })(body);

  // extents from the spine centre line: how far a block reaches left and right
  const ext = (b) => b.reduce((e, s) => {
    const x = sext(s);
    return { l: Math.max(e.l, x.l), r: Math.max(e.r, x.r) };
  }, { l: 0, r: 0 });
  function sext(s) {
    const hw = s.node.w / 2;
    if (s.t === 'step') return { l: hw, r: hw };
    if (s.t === 'dowhile') { const e = ext(s.body); return { l: Math.max(hw, e.l), r: Math.max(hw, e.r) + GAP_X / 2 }; }
    if (s.t === 'if' && s.else.length) {
      const a = ext(s.then), c = ext(s.else);
      return { l: Math.max(hw, GAP_X / 2 + a.l + a.r), r: Math.max(hw, GAP_X / 2 + c.l + c.r) };
    }
    const side = ext(s.t === 'if' ? s.then : s.body);
    return { l: hw, r: hw + GAP_X + side.l + side.r };
  }

  const rets = [];
  const loops = [];          // innermost loop last: where break / continue go
  const join = (pend, n) => {
    for (const p of pend) edges.push([p.n.id, n.id, p.label || '', p.port, p.tp || (p.label ? 'n' : undefined)]);
  };
  // place a block with its spine at cx, top at y; pend = edges waiting for the next node
  function place(b, cx, y, pend) {
    for (const s of b) {
      const n = s.node;
      if (s.t === 'dowhile') {                                  // body first, then the test that loops back
        const L = { n, breaks: [], cont: n };
        loops.push(L);
        const B = place(s.body, cx, y, pend);
        loops.pop();
        n.x = Math.round(cx - n.w / 2); n.y = Math.round(B.y);
        join(B.pend, n);
        const first = s.body.find((x) => x.node)?.node || n;
        edges.push([n.id, first.id, 'Yes', 'e', 'e']);
        y = n.y + n.h + GAP_Y;
        pend = [{ n, port: 's', label: 'No' }, ...L.breaks.map((x) => ({ n: x, port: 's' }))];
        continue;
      }
      n.x = Math.round(cx - n.w / 2); n.y = Math.round(y);
      join(pend, n);
      const below = y + n.h + GAP_Y;
      if (s.t === 'step') {
        y = below; pend = [{ n }];
        if (s.ret) { rets.push(n); pend = []; }
        else if (s.jump && loops.length) {
          const L = loops[loops.length - 1];
          if (s.jump === 'continue') edges.push(L.cont === L.n ? [n.id, L.n.id, '', 'e', 'n'] : [n.id, L.cont.id, '', undefined, undefined]);
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
        const bodyList = isLoop ? s.body : s.then, side = ext(bodyList);
        const L = { n, breaks: [], cont: s.update?.node || n };
        if (isLoop) loops.push(L);
        const B = place(bodyList, cx + n.w / 2 + GAP_X + side.l, y, [{ n, port: 'e', label: 'Yes', tp: 'w' }]);
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
  const R = place(body, 0, start.h + GAP_Y, [{ n: start }]);
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
