// Per-language code checks (Python, JavaScript, TypeScript, C++, C#, pseudocode) for the snippet attached to a step.
// These are deliberately heuristic — they are not compilers. The support table
// below is shown in the UI so it is clear what each language actually gets.
import { LANGS, langLabel, outgoing } from './model.js';

export const CHECK_LABELS = {
  delimiters: 'Brackets & quotes',
  syntax: 'Common syntax slips',
  logic: 'Likely logic mistakes',
  structure: 'Matches the shape',
};
export const ALL_CHECKS = Object.keys(CHECK_LABELS);
export function supportFor(lang) {
  const l = LANGS.find((x) => x.id === lang) || LANGS[0];
  return new Set(l.checks);
}
export function supportTable() {
  return LANGS.filter((l) => l.id !== 'none').map((l) => ({ id: l.id, label: l.label, checks: new Set(l.checks) }));
}

/* ---------- lexical pre-pass: blank out strings and comments ---------- */
function strip(src, lang) {
  const lineCmt = lang === 'python' ? '#' : '//';
  const hasBlockCmt = lang !== 'python';
  const tripleQuotes = lang === 'python';
  const backtick = ['javascript', 'typescript'].includes(lang);
  const out = Array.from(src);
  const errors = [];
  let i = 0, line = 1;
  const blank = (from, to) => { for (let j = from; j < to && j < out.length; j++) if (out[j] !== '\n') out[j] = ' '; };
  while (i < src.length) {
    const c = src[i], c2 = src.slice(i, i + 2), c3 = src.slice(i, i + 3);
    if (c === '\n') { line++; i++; continue; }
    if (src.startsWith(lineCmt, i)) { const nl = src.indexOf('\n', i); blank(i, nl < 0 ? src.length : nl); i = nl < 0 ? src.length : nl; continue; }
    if (hasBlockCmt && c2 === '/*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) { errors.push({ sev: 'error', line, msg: 'Block comment /* is never closed.' }); blank(i, src.length); break; }
      for (let j = i; j < end + 2; j++) if (src[j] === '\n') line++;
      blank(i, end + 2); i = end + 2; continue;
    }
    if (tripleQuotes && (c3 === '"""' || c3 === "'''")) {
      const end = src.indexOf(c3, i + 3);
      if (end < 0) { errors.push({ sev: 'error', line, msg: `Triple-quoted string ${c3} is never closed.` }); blank(i, src.length); break; }
      for (let j = i; j < end + 3; j++) if (src[j] === '\n') line++;
      blank(i, end + 3); i = end + 3; continue;
    }
    if (c === '"' || c === "'" || (backtick && c === '`')) {
      const q = c; let j = i + 1; let closed = false;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '\n' && q !== '`') break;
        if (src[j] === q) { closed = true; j++; break; }
        if (src[j] === '\n') line++;
        j++;
      }
      if (!closed) errors.push({ sev: 'error', line, msg: `Unclosed ${q === '`' ? 'template' : 'string'} literal — add the matching ${q}.` });
      blank(i, j); i = j; continue;
    }
    i++;
  }
  return { code: out.join(''), lexErrors: errors };
}
const lineOf = (code, idx) => code.slice(0, idx).split('\n').length;

/* ---------- checks ---------- */
function checkDelimiters(code) {
  const out = [];
  const pairs = { ')': '(', ']': '[', '}': '{' };
  const open = { '(': ')', '[': ']', '{': '}' };
  const stack = [];
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (open[c]) stack.push({ c, i });
    else if (pairs[c]) {
      const top = stack.pop();
      if (!top) out.push({ sev: 'error', line: lineOf(code, i), msg: `Stray "${c}" — there is no matching "${pairs[c]}".` });
      else if (top.c !== pairs[c]) out.push({ sev: 'error', line: lineOf(code, i), msg: `"${c}" closes a "${top.c}" opened on line ${lineOf(code, top.i)}.` });
    }
  }
  for (const s of stack) out.push({ sev: 'error', line: lineOf(code, s.i), msg: `"${s.c}" is never closed — add "${open[s.c]}".` });
  return out;
}

const PY_BLOCK = /^\s*(if|elif|else|for|while|def|class|try|except|finally|with|match|case)\b/;

function checkPython(code, lines) {
  const out = [];
  let unit = 0, sawTab = false, sawSpace = false;
  lines.forEach((raw, i) => {
    const ln = i + 1;
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) return;
    const indent = raw.match(/^[ \t]*/)[0];
    if (indent.includes('\t')) sawTab = true;
    if (indent.includes(' ')) sawSpace = true;
    if (PY_BLOCK.test(line) && !line.trimEnd().endsWith(':') && !line.includes('#')) {
      const kw = line.trim().split(/[\s(:]/)[0];
      out.push({ sev: 'error', line: ln, msg: `"${kw}" opens a block, so this line must end with a colon.` });
    }
    const m = /^\s*(if|elif|while)\s+(.+?):?\s*$/.exec(line);
    if (m && /[^=!<>+\-*/%&|^]=[^=]/.test(' ' + m[2])) {
      out.push({ sev: 'error', line: ln, msg: `"=" assigns a value; use "==" to compare inside ${m[1]}.` });
    }
    if (/^\s*print\s+[^(=]/.test(line)) out.push({ sev: 'error', line: ln, msg: 'Python 3 needs print(...) with brackets.' });
    if (/\belif\b/.test(line) && !/^\s*elif\b/.test(line)) out.push({ sev: 'warning', line: ln, msg: '"elif" should start the line.' });
    if (indent && !unit) unit = indent.replace(/\t/g, '    ').length;
  });
  if (sawTab && sawSpace) out.push({ sev: 'error', line: 1, msg: 'Indentation mixes tabs and spaces — Python will reject this. Pick one.' });
  if (/\bwhile\s+True\s*:/.test(code) && !/\b(break|return|raise|sys\.exit|exit)\b/.test(code)) {
    out.push({ sev: 'warning', line: lineOf(code, code.indexOf('while True')), msg: '"while True:" has no break/return, so this loop never ends.', kind: 'logic' });
  }
  if (/\breturn\b/.test(code)) {
    lines.forEach((l, i) => {
      if (!/^\s*return\b/.test(l)) return;
      const ind = l.match(/^\s*/)[0].length;
      const next = lines.slice(i + 1).find((x) => x.trim());
      if (next && next.match(/^\s*/)[0].length >= ind && !PY_BLOCK.test(next) && !/^\s*(#|\))/.test(next)) {
        out.push({ sev: 'warning', line: i + 2, msg: 'This line sits after a return at the same level, so it can never run.', kind: 'logic' });
      }
    });
  }
  return out;
}

const C_LIKE_END = /[;{}:,]$|^\s*[})\]]|^\s*(#|@|\/\/)|\\$|^\s*(public|private|protected|static|class|interface|enum|namespace|using|import|package|template|struct|if|else|for|while|do|switch|case|default|try|catch|finally)\b.*[({:]\s*$/;

function checkCLike(code, lines, lang) {
  const out = [];
  lines.forEach((raw, i) => {
    const ln = i + 1;
    const line = raw.trim();
    if (!line) return;
    const m = /^(if|while)\s*\((.+)\)\s*$/.exec(line) || /^(if|while)\s*\((.+)\)\s*\{?$/.exec(line);
    if (m && /[^=!<>+\-*/%&|^]=[^=]/.test(' ' + m[2])) {
      out.push({ sev: 'error', line: ln, msg: `"=" assigns inside ${m[1]}(...); use "==" (or "===") to compare.` });
    }
    const looksStatement = !C_LIKE_END.test(line) && !/^\s*\w+\s*:\s*$/.test(line) && !line.endsWith(';');
    if (looksStatement && /[\w)\]"']$/.test(line) && !/^(if|else|for|while|do|switch|try|catch|finally|public|private|protected|class|interface|struct|namespace|template|#)/.test(line)) {
      out.push({ sev: 'warning', line: ln, msg: 'This statement does not end with a semicolon.' });
    }
    if (lang === 'javascript' || lang === 'typescript') {
      if (/\bvar\s+\w/.test(line)) out.push({ sev: 'info', line: ln, msg: 'Prefer "let" or "const" over "var".' });
      if (/[^=!<>]==[^=]/.test(line)) out.push({ sev: 'info', line: ln, msg: '"==" coerces types; "===" is usually what you want.' });
    }
    if (lang === 'typescript' && /:\s*any\b/.test(line)) out.push({ sev: 'info', line: ln, msg: '": any" switches type checking off for this value.' });
  });
  if (/\b(while|for)\s*\(\s*(true|1|;;)\s*\)/.test(code) && !/\b(break|return|goto|exit|throw)\b/.test(code)) {
    out.push({ sev: 'warning', line: lineOf(code, code.search(/\b(while|for)\s*\(\s*(true|1|;;)/)), msg: 'This loop never ends — there is no break or return inside it.', kind: 'logic' });
  }
  if ((lang === 'javascript' || lang === 'typescript') && /\bif\s*\([^)]*\)\s*;/.test(code)) {
    out.push({ sev: 'warning', line: lineOf(code, code.search(/\bif\s*\([^)]*\)\s*;/)), msg: 'An empty statement follows this if — the body is the ";".', kind: 'logic' });
  }
  return out;
}

function checkPseudo(code) {
  const out = [];
  const up = code.toUpperCase();
  const count = (re) => (up.match(re) || []).length;
  const checkPair = (openRe, closeRe, name) => {
    const o = count(openRe), c = count(closeRe);
    if (o > c) out.push({ sev: 'warning', line: 1, msg: `${o} ${name} but only ${c} END ${name} — one block is not closed.` });
    if (c > o) out.push({ sev: 'warning', line: 1, msg: `More END ${name} than ${name}.` });
  };
  checkPair(/\bIF\b/g, /\bEND\s*IF\b/g, 'IF');
  checkPair(/\bWHILE\b/g, /\bEND\s*WHILE\b/g, 'WHILE');
  checkPair(/\bFOR\b/g, /\bEND\s*FOR\b/g, 'FOR');
  if (/\bIF\b/.test(up) && !/\bTHEN\b/.test(up)) out.push({ sev: 'info', line: 1, msg: 'IF without THEN — add THEN so the branch is explicit.' });
  return out;
}

/** Does the snippet agree with the shape it is attached to? */
function checkStructure(node, code, doc) {
  const out = [];
  const src = code.trim();
  if (!src) return out;
  const branchy = /\b(if|elif|else|switch|case|when|while|until|unless|repeat|in|is|not|and|or|of)\b|[<>]=?|==|!=/.test(src);
  if (node.type === 'decision' && !branchy) {
    out.push({ sev: 'warning', line: 1, msg: 'This is a Decision, but the code contains no condition or comparison.' });
  }
  if (node.type === 'process' && /^\s*(if|while|for)\b/m.test(src) && /\belse\b/.test(src)) {
    out.push({ sev: 'info', line: 1, msg: 'This Process holds a branch. Consider splitting it into a Decision with Yes/No arrows.' });
  }
  if ((node.type === 'start' || node.type === 'end') && src.length > 80) {
    out.push({ sev: 'info', line: 1, msg: `${node.type === 'start' ? 'Start' : 'End'} steps normally carry little or no code.` });
  }
  if (doc && node.type === 'decision') {
    const branches = outgoing(doc, node.id).length;
    const cases = (src.match(/\b(elif|else\s+if|case)\b/g) || []).length + (/\belse\b/.test(src) ? 1 : 0) + 1;
    if (branches && cases > branches + 1) {
      out.push({ sev: 'warning', line: 1, msg: `The code looks like it has ${cases} branches, but only ${branches} arrow${branches === 1 ? '' : 's'} leave this diamond.` });
    }
  }
  if (/\bTODO\b|\bFIXME\b/i.test(src)) out.push({ sev: 'info', line: 1, msg: 'Contains a TODO/FIXME note.' });
  return out;
}

/**
 * Lint one snippet.
 * @returns {{supported:Set<string>, findings:Array, lang:string, unsupported:boolean}}
 */
export function lintCode(node, doc) {
  const lang = node.code?.lang || 'none';
  const src = node.code?.source || '';
  const supported = supportFor(lang);
  const res = { lang, supported, findings: [], unsupported: supported.size === 0, lines: src ? src.split('\n').length : 0 };
  if (!src.trim() || supported.size === 0) return res;

  const { code, lexErrors } = strip(src, lang);
  const lines = code.split('\n');
  let findings = [...lexErrors];
  if (supported.has('delimiters')) findings.push(...checkDelimiters(code));
  if (supported.has('syntax') || supported.has('logic')) {
    if (lang === 'python') findings.push(...checkPython(code, lines));
    else if (['javascript', 'typescript', 'cpp', 'csharp'].includes(lang)) findings.push(...checkCLike(code, lines, lang));
  }
  if (lang === 'pseudocode') findings.push(...checkPseudo(code));
  if (supported.has('structure')) findings.push(...checkStructure(node, src, doc));

  if (!supported.has('logic')) findings = findings.filter((f) => f.kind !== 'logic');
  if (node.type === 'decision') findings = findings.filter((f) => !/semicolon/.test(f.msg));   // a condition is an expression, not a statement
  const rank = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => rank[a.sev] - rank[b.sev] || a.line - b.line);
  res.findings = findings.slice(0, 40);
  return res;
}

/** Document-wide roll-up, in the same shape as flow-logic issues. */
export function lintDoc(doc) {
  const issues = [];
  for (const n of doc.nodes) {
    if (!n.code?.source?.trim()) continue;
    const r = lintCode(n, doc);
    if (r.unsupported) continue;
    const worst = r.findings.find((f) => f.sev === 'error') || r.findings.find((f) => f.sev === 'warning');
    if (!worst) continue;
    const errs = r.findings.filter((f) => f.sev === 'error').length;
    const warns = r.findings.filter((f) => f.sev === 'warning').length;
    issues.push({
      id: 'code-' + n.id, sev: worst.sev,
      title: `${langLabel(r.lang)} code in "${(n.text || 'step').trim().slice(0, 28)}"`,
      detail: `Line ${worst.line}: ${worst.msg}` + (errs + warns > 1 ? ` (+${errs + warns - 1} more)` : ''),
      nodes: [n.id], edges: [], code: true,
    });
  }
  return issues;
}
