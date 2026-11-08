// Left palette + right-hand Design / Code / Checks panes.
import { esc, h } from './util.js';
import { SHAPE_ORDER, SHAPES, thumbSVG } from './shapes.js';
import { THEMES, THEME_KEYS, LANGS, FONTS, DASHES, ARROWS, langLabel } from './model.js';
import { TEMPLATES } from './templates.js';
import { lintCode } from './lint.js';

const FILLS = ['#c8ff00', '#000000', '#ffffff', '#f4f6fa', '#e3f7ec', '#fff6e2', '#fdeaea', '#eef2ff', '#f3ecff', '#1b2431', '#16253f', '#102b20', '#30161a', '#30260f', '#221a36', 'none'];
const STROKES = ['#c8ff00', '#4a5a72', '#9fb0c6', '#5b8cff', '#3fbf7f', '#f4685f', '#f0b43c', '#a07ae0', '#20bfbf', '#111111', '#ffffff'];

/* ---------------- palette ---------------- */
export function buildPalette(app) {
  const host = document.getElementById('palette');
  host.textContent = '';
  for (const type of SHAPE_ORDER) {
    const def = SHAPES[type];
    const b = h('button', {
      class: 'shape-btn', draggable: 'true', 'data-type': type, type: 'button',
      title: `${def.label.replace('\n', ' ')} — drag onto the canvas or click then click the canvas`,
      html: thumbSVG(type) + '<span>' + esc(def.label.replace('\n', ' ')) + '</span>',
    });
    b.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-flowstate-shape', type);
      e.dataTransfer.setData('text/plain', type);
      e.dataTransfer.effectAllowed = 'copy';
    });
    b.addEventListener('click', () => {
      const already = b.classList.contains('armed');
      host.querySelectorAll('.shape-btn').forEach((x) => x.classList.remove('armed'));
      if (already) { app.ia.arm(null); return; }
      b.classList.add('armed');
      app.ia.arm(type);
      app.afterArm?.();
    });
    host.append(b);
  }
  app.clearArmed = () => host.querySelectorAll('.shape-btn').forEach((x) => x.classList.remove('armed'));
}

export function buildTemplates(app) {
  const host = document.getElementById('templateList');
  host.textContent = '';
  for (const t of TEMPLATES) {
    host.append(h('button', {
      class: 'tpl', type: 'button', onclick: () => app.openTemplate(t.id),
      html: `<b>${esc(t.name)}</b><span>${esc(t.desc)}</span>`,
    }));
  }
}

/* ---------------- design pane ---------------- */
export function renderDesign(app) {
  const pane = document.getElementById('pane-design');
  const nodes = app.store.selectedNodes();
  const edges = app.store.selectedEdges();
  const parts = [];
  if (nodes.length) parts.push(nodeSections(app, nodes));
  if (edges.length) parts.push(edgeSections(app, edges));
  if (!nodes.length && !edges.length) parts.push(docSections(app));
  pane.innerHTML = parts.join('');
  wire(app, pane);
}

function sect(title, body) { return `<div class="sect"><h3>${esc(title)}</h3><div>${body}</div></div>`; }
function swatches(kind, list, cur) {
  return `<div class="swatches">${list.map((c) => `<button class="sw" data-sw="${kind}" data-c="${c}" title="${c}" style="background:${c === 'none' ? 'repeating-conic-gradient(#999 0% 25%, #fff 0% 50%) 50%/8px 8px' : c}${c === cur ? ';outline:2px solid var(--accent);outline-offset:1px' : ''}"></button>`).join('')}</div>`;
}
function seg(kind, opts, cur) {
  return `<div class="seg">${opts.map(([v, l]) => `<button class="btn ${v === cur ? 'on' : ''}" data-seg="${kind}" data-v="${v}">${esc(l)}</button>`).join('')}</div>`;
}

function nodeSections(app, nodes) {
  const n = nodes[0];
  const multi = nodes.length > 1;
  const st = n.style || {};
  const shapeOpts = SHAPE_ORDER.map((t) => `<option value="${t}" ${t === n.type ? 'selected' : ''}>${esc(SHAPES[t].label.replace('\n', ' '))}</option>`).join('');
  let out = sect(multi ? `${nodes.length} steps selected` : 'Step', `
    <div class="row"><label for="pShape">Shape</label><select id="pShape" class="grow">${shapeOpts}</select></div>
    ${multi ? '' : `<div class="row"><label for="pText">${n.type === 'lane' ? 'Title' : 'Text'}</label><textarea id="pText" class="grow" rows="2" style="font-family:var(--sans);min-height:52px">${esc(n.text)}</textarea></div>`}
    <div class="row"><label>Position</label><input type="number" id="pX" class="grow" value="${Math.round(n.x)}" step="10"><input type="number" id="pY" class="grow" value="${Math.round(n.y)}" step="10"></div>
    <div class="row"><label>Size</label><input type="number" id="pW" class="grow" value="${Math.round(n.w)}" min="48" step="10"><input type="number" id="pH" class="grow" value="${Math.round(n.h)}" min="34" step="10"></div>
    <div class="seg"><button class="btn" data-act="fitText">Fit to text</button><button class="btn" data-act="dupe">Duplicate</button>${n.group || multi ? `<button class="btn" data-act="${nodes.every((x) => x.group && x.group === n.group) ? 'ungroup' : 'group'}">${nodes.every((x) => x.group && x.group === n.group) ? 'Ungroup' : 'Group'}</button>` : ''}<button class="btn danger" data-act="del">Delete</button></div>
  `);
  out += sect('Fill & outline', `
    <div class="row"><label>Fill</label><input type="color" data-color="fill" value="${hexOf(st.fill)}"><span class="grow muted">${esc(st.fill || '')}</span></div>
    ${swatches('fill', FILLS, st.fill)}
    <div class="row" style="margin-top:8px"><label>Outline</label><input type="color" data-color="stroke" value="${hexOf(st.stroke)}"><span class="grow muted">${esc(st.stroke || '')}</span></div>
    ${swatches('stroke', STROKES, st.stroke)}
    <div class="row" style="margin-top:8px"><label for="pSW">Thickness</label><input type="range" id="pSW" min="0" max="8" step="0.5" value="${st.strokeWidth ?? 2}"><span class="muted" id="pSWv">${st.strokeWidth ?? 2}</span></div>
    <div class="row"><label>Line style</label>${seg('ndash', Object.keys(DASHES).map((d) => [d, d]), st.dash || 'none')}</div>
    <div class="row"><label for="pR">Corners</label><input type="range" id="pR" min="0" max="36" step="1" value="${st.radius ?? 10}"></div>
  `);
  out += sect('Text', `
    <div class="row"><label for="pFont">Font</label><select id="pFont" class="grow">${FONTS.map(([v, l]) => `<option value="${esc(v)}" ${v === st.fontFamily ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
    <div class="row"><label for="pFS">Size</label><input type="number" id="pFS" class="grow" min="7" max="72" value="${st.fontSize ?? 14}"><input type="color" data-color="textColor" value="${hexOf(st.textColor)}"></div>
    <div class="row"><label>Style</label>${seg('weight', [[400, 'Regular'], [600, 'Semibold'], [700, 'Bold']], Number(st.fontWeight) || 400)}</div>
    <div class="row"><label>Italic</label>${seg('italic', [['normal', 'Off'], ['italic', 'On']], st.fontStyle || 'normal')}</div>
    <div class="row"><label>Align</label>${seg('align', [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']], st.align || 'center')}</div>
  `);
  if (nodes.length > 1) {
    out += sect('Apply to all selected', `<p class="muted" style="margin:0 0 8px;font-size:12px">Changes above affect every selected step.</p>
      <div class="seg"><button class="btn" data-act="sameSize">Match size of first</button><button class="btn" data-act="connectChain">Connect in order</button></div>`);
  }
  return out;
}

function edgeSections(app, edges) {
  const e = edges[0];
  const st = e.style || {};
  const portOpts = (cur) => ['auto', 'n', 'e', 's', 'w'].map((p) => `<option value="${p}" ${p === cur ? 'selected' : ''}>${{ auto: 'Automatic', n: 'Top', e: 'Right', s: 'Bottom', w: 'Left' }[p]}</option>`).join('');
  return sect(edges.length > 1 ? `${edges.length} connections` : 'Connection', `
    ${edges.length > 1 ? '' : `<div class="row"><label for="eLabel">Label</label><input type="text" id="eLabel" class="grow" value="${esc(e.label)}" placeholder="e.g. Yes"></div>`}
    <div class="row"><label>Routing</label>${seg('curve', [['orthogonal', 'Elbow'], ['curve', 'Curved'], ['straight', 'Straight']], st.curve || 'orthogonal')}</div>
    <div class="row"><label>Colour</label><input type="color" data-ecolor="stroke" value="${hexOf(st.stroke)}">${swatches('estroke', STROKES, st.stroke)}</div>
    <div class="row"><label for="eSW">Thickness</label><input type="range" id="eSW" min="1" max="8" step="0.5" value="${st.strokeWidth ?? 2}"></div>
    <div class="row"><label>Line style</label>${seg('edash', Object.keys(DASHES).map((d) => [d, d]), st.dash || 'none')}</div>
    <div class="row"><label for="eAS">Start cap</label><select id="eAS" class="grow">${ARROWS.map((a) => `<option value="${a}" ${a === st.arrowStart ? 'selected' : ''}>${a}</option>`).join('')}</select></div>
    <div class="row"><label for="eAE">End cap</label><select id="eAE" class="grow">${ARROWS.map((a) => `<option value="${a}" ${a === st.arrowEnd ? 'selected' : ''}>${a}</option>`).join('')}</select></div>
    ${edges.length > 1 ? '' : `<div class="row"><label for="eFP">Leaves from</label><select id="eFP" class="grow">${portOpts(e.fromPort)}</select></div>
    <div class="row"><label for="eTP">Arrives at</label><select id="eTP" class="grow">${portOpts(e.toPort)}</select></div>`}
    <div class="seg"><button class="btn" data-act="flip">Reverse direction</button><button class="btn danger" data-act="delEdge">Delete</button></div>
  `);
}

function docSections(app) {
  const d = app.store.doc;
  const s = d.settings;
  const counts = { n: d.nodes.length, e: d.edges.length, code: d.nodes.filter((x) => x.code?.source?.trim()).length };
  return sect('Nothing selected', `<p class="muted" style="margin:0;font-size:12.5px">Click a step or a connection to style it. These settings apply to the whole chart.</p>`)
    + sect('Theme', `
      <div class="themes">${THEME_KEYS.map((k) => `<button class="themecard ${k === s.theme ? 'on' : ''}" data-seg="theme" data-v="${k}" style="--tb:${THEMES[k].bg};--ti:${THEMES[k].roles.step[0]};--ts:${THEMES[k].roles.step[1]}"><i></i><span>${esc(THEMES[k].label)}</span></button>`).join('')}</div>
      <p class="muted" style="margin:8px 0 0;font-size:11.5px">Switching theme restyles every step and connection. Undo brings your colours back.</p>`)
    + sect('Canvas', `
      <div class="row"><label for="dGrid">Grid size</label><input type="number" id="dGrid" class="grow" min="2" max="80" value="${s.gridSize}"></div>
      <div class="row"><label>Default routing</label>${seg('dcurve', [['orthogonal', 'Elbow'], ['curve', 'Curved'], ['straight', 'Straight']], s.edgeCurve)}</div>
      <div class="row"><label>Code badges</label>${seg('badges', [[1, 'Show'], [0, 'Hide']], s.showCodeBadges ? 1 : 0)}</div>
      <div class="row"><label>Autosave</label>${seg('autosave', [[1, 'On'], [0, 'Off']], s.autosave ? 1 : 0)}</div>`)
    + sect('Code defaults', `
      <div class="row"><label for="dLang">New steps use</label><select id="dLang" class="grow">${LANGS.map((l) => `<option value="${l.id}" ${l.id === s.defaultLang ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}</select></div>
      <div class="seg"><button class="btn" data-act="langAll">Apply to every step</button></div>`)
    + sect('This chart', `
      <div class="kv"><span>Steps</span><b>${counts.n}</b></div>
      <div class="kv"><span>Connections</span><b>${counts.e}</b></div>
      <div class="kv"><span>Steps with code</span><b>${counts.code}</b></div>
      <div class="kv"><span>Last change</span><b>${new Date(d.updatedAt).toLocaleString()}</b></div>
      <div class="seg" style="margin-top:8px"><button class="btn" data-act="fit">Fit to view</button><button class="btn" data-act="tidy">Tidy up spacing</button></div>
      <div class="seg" style="margin-top:6px"><button class="btn" data-act="layoutTB">Auto layout ↓</button><button class="btn" data-act="layoutLR">Auto layout →</button></div>`);
}

const hexOf = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#888888');

function wire(app, pane) {
  const st = app.store;
  const nodes = () => st.selectedNodes();
  const edges = () => st.selectedEdges();
  const editNodes = (label, fn) => { st.commit(label, () => { for (const n of nodes()) fn(n); }); };
  const editEdges = (label, fn) => { st.commit(label, () => { for (const e of edges()) fn(e); }); };
  const q = (sel) => pane.querySelector(sel);

  q('#pShape')?.addEventListener('change', (e) => editNodes('Change shape', (n) => {
    n.type = e.target.value;
    const def = SHAPES[n.type];
    if (n.type === 'connector') { n.w = n.h = Math.min(n.w, def.size[0]); }
    if (n.type === 'decision') n.h = Math.max(n.h, 96);
  }));
  const txt = q('#pText');
  txt?.addEventListener('input', (e) => {
    const n = nodes()[0];
    if (!n) return;
    n.text = e.target.value;
    app.renderer.patchNodes([n.id]);
    app.store.touch('Edit text', false);
  });
  for (const [sel, key, cast] of [['#pX', 'x', Number], ['#pY', 'y', Number], ['#pW', 'w', Number], ['#pH', 'h', Number]]) {
    q(sel)?.addEventListener('change', (e) => editNodes('Resize step', (n) => { n[key] = cast(e.target.value); }));
  }
  q('#pSW')?.addEventListener('input', (e) => {
    const v = Number(e.target.value);
    q('#pSWv').textContent = v;
    editNodes('Outline width', (n) => (n.style.strokeWidth = v));
  });
  q('#pR')?.addEventListener('input', (e) => editNodes('Corner radius', (n) => (n.style.radius = Number(e.target.value))));
  q('#pFont')?.addEventListener('change', (e) => editNodes('Font', (n) => (n.style.fontFamily = e.target.value)));
  q('#pFS')?.addEventListener('change', (e) => editNodes('Font size', (n) => (n.style.fontSize = Number(e.target.value))));
  q('#eLabel')?.addEventListener('input', (e) => {
    const ed = edges()[0];
    if (!ed) return;
    ed.label = e.target.value;
    app.renderer.patchEdges([ed.id]);
    app.store.touch('Edit label', false);
  });
  q('#eSW')?.addEventListener('input', (e) => editEdges('Line width', (x) => (x.style.strokeWidth = Number(e.target.value))));
  q('#eAS')?.addEventListener('change', (e) => editEdges('Arrowhead', (x) => (x.style.arrowStart = e.target.value)));
  q('#eAE')?.addEventListener('change', (e) => editEdges('Arrowhead', (x) => (x.style.arrowEnd = e.target.value)));
  q('#eFP')?.addEventListener('change', (e) => editEdges('Route', (x) => (x.fromPort = e.target.value)));
  q('#eTP')?.addEventListener('change', (e) => editEdges('Route', (x) => (x.toPort = e.target.value)));
  q('#dTheme')?.addEventListener('change', (e) => app.setTheme(e.target.value, false));
  q('#dGrid')?.addEventListener('change', (e) => {
    st.commit('Grid size', (d) => { d.settings.gridSize = Math.max(2, Math.min(80, Number(e.target.value) || 10)); });
    app.renderer.applyTheme();
  });
  q('#dLang')?.addEventListener('change', (e) => st.commit('Default language', (d) => { d.settings.defaultLang = e.target.value; }));

  pane.querySelectorAll('[data-color]').forEach((inp) => inp.addEventListener('input', () =>
    editNodes('Colour', (n) => (n.style[inp.dataset.color] = inp.value))));
  pane.querySelectorAll('[data-ecolor]').forEach((inp) => inp.addEventListener('input', () =>
    editEdges('Colour', (e) => (e.style[inp.dataset.ecolor] = inp.value))));

  pane.querySelectorAll('[data-sw]').forEach((b) => b.addEventListener('click', () => {
    const c = b.dataset.c, kind = b.dataset.sw;
    if (kind === 'fill') editNodes('Fill', (n) => (n.style.fill = c));
    else if (kind === 'stroke') editNodes('Outline', (n) => (n.style.stroke = c));
    else if (kind === 'estroke') editEdges('Colour', (e) => (e.style.stroke = c));
    renderDesign(app);
  }));
  pane.querySelectorAll('[data-seg]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.v, kind = b.dataset.seg;
    const num = Number(v);
    if (kind === 'theme') { app.setTheme(v); return; }
    if (kind === 'ndash') editNodes('Line style', (n) => (n.style.dash = v));
    if (kind === 'weight') editNodes('Font weight', (n) => (n.style.fontWeight = num));
    if (kind === 'italic') editNodes('Italic', (n) => (n.style.fontStyle = v));
    if (kind === 'align') editNodes('Align text', (n) => (n.style.align = v));
    if (kind === 'curve') editEdges('Routing', (e) => (e.style.curve = v));
    if (kind === 'edash') editEdges('Line style', (e) => (e.style.dash = v));
    if (kind === 'dcurve') st.commit('Default routing', (d) => { d.settings.edgeCurve = v; });
    if (kind === 'badges') st.commit('Code badges', (d) => { d.settings.showCodeBadges = !!num; app.renderer.nodeSig.clear(); });
    if (kind === 'autosave') { st.commit('Autosave', (d) => { d.settings.autosave = !!num; }); app.refreshChrome(); }
    renderDesign(app);
  }));
  pane.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => app.panelAction(b.dataset.act)));
}

/* ---------------- code pane ---------------- */
export function renderCode(app) {
  const pane = document.getElementById('pane-code');
  const nodes = app.store.selectedNodes();
  if (nodes.length !== 1) {
    const withCode = app.store.doc.nodes.filter((n) => n.code?.source?.trim());
    pane.innerHTML = sect('Attach code to a step', `
      <p class="muted" style="margin:0 0 10px;font-size:12.5px">${nodes.length ? 'Select a single step' : 'Select a step'} to attach code or pseudocode to it, choose its language and see the checks for that language.</p>
      ${withCode.length ? `<p class="muted" style="font-size:12px;margin:0 0 6px">Steps that already carry code:</p><div class="issues">${withCode.map((n) => `<div class="issue" data-goto="${n.id}"><b>${esc((n.text || 'Untitled').slice(0, 40))}</b><p>${esc(langLabel(n.code.lang))} · ${n.code.source.split('\n').length} lines</p></div>`).join('')}</div>` : '<div class="empty-note">No step has code yet.</div>'}
    `) + supportSection();
    pane.querySelectorAll('[data-goto]').forEach((el) => el.addEventListener('click', () => app.focusNode(el.dataset.goto)));
    return;
  }
  const n = nodes[0];
  const res = lintCode(n, app.store.doc);
  const sup = res.supported;
  const langOpts = LANGS.map((l) => `<option value="${l.id}" ${l.id === n.code.lang ? 'selected' : ''}>${esc(l.label)}</option>`).join('');
  pane.innerHTML = sect(`Code for "${(n.text || 'step').slice(0, 24)}"`, `
    <div class="row"><label for="cLang">Language</label><select id="cLang" class="grow">${langOpts}</select></div>
    <textarea id="cSrc" spellcheck="false" rows="12" placeholder="${esc(placeholderFor(n.code.lang))}">${esc(n.code.source)}</textarea>
    <div class="row codeactions"><span class="muted grow">${res.lines} line${res.lines === 1 ? '' : 's'}</span>
      <button class="btn" data-act="clearCode">Clear</button><button class="btn" data-act="copyLangAll" title="Set this language on every step">Use for all steps</button></div>
  `) + sect('Checks for this snippet', checksBody(res)) + supportSection();

  const ta = pane.querySelector('#cSrc');
  let t;
  ta.addEventListener('input', () => {
    n.code.source = ta.value;
    clearTimeout(t);
    app.store.touch('Edit code', false);
    app.renderer.nodeSig.delete(n.id);
    app.renderer.syncNode(n);
    t = setTimeout(() => {
      const r2 = lintCode(n, app.store.doc);
      const box = pane.querySelector('[data-checkbox]');
      if (box) box.innerHTML = checksBody(r2);
      pane.querySelectorAll('[data-line]').forEach((el) => el.addEventListener('click', () => jumpLine(ta, Number(el.dataset.line))));
      app.revalidate();
    }, 320);
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); insert(ta, '  '); }
  });
  pane.querySelector('#cLang').addEventListener('change', (e) => {
    app.store.commit('Code language', () => { n.code.lang = e.target.value; });
    renderCode(app);
  });
  pane.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => app.panelAction(b.dataset.act)));
  pane.querySelectorAll('[data-line]').forEach((el) => el.addEventListener('click', () => jumpLine(ta, Number(el.dataset.line))));
  void sup;
}
function insert(ta, s) {
  const a = ta.selectionStart, b = ta.selectionEnd;
  ta.value = ta.value.slice(0, a) + s + ta.value.slice(b);
  ta.selectionStart = ta.selectionEnd = a + s.length;
  ta.dispatchEvent(new Event('input'));
}
function jumpLine(ta, line) {
  const lines = ta.value.split('\n');
  let pos = 0;
  for (let i = 0; i < Math.min(line - 1, lines.length); i++) pos += lines[i].length + 1;
  ta.focus();
  ta.setSelectionRange(pos, pos + (lines[line - 1]?.length || 0));
}
function checksBody(res) {
  if (res.unsupported) {
    return `<div data-checkbox><div class="empty-note">No automatic checks are available for <b>${esc(langLabel(res.lang))}</b>. The snippet is still saved, exported and included in backups.</div></div>`;
  }
  if (!res.lines) return `<div data-checkbox><div class="empty-note">Nothing to check yet.</div></div>`;
  if (!res.findings.length) return `<div data-checkbox><div class="okbox">No problems found by the ${esc(langLabel(res.lang))} checks.</div></div>`;
  return `<div data-checkbox><div class="issues">${res.findings.map((f) => `
    <div class="issue sev-${f.sev}" data-line="${f.line}">
      <b>Line ${f.line} · ${f.sev}</b><p>${esc(f.msg)}</p>
    </div>`).join('')}</div></div>`;
}
function supportSection() {
  return sect('About the checks', `<p class="muted" style="margin:0;font-size:11.5px">Checks cover Python, JavaScript, TypeScript, C++, C# and pseudocode: unbalanced brackets, <code>=</code> instead of <code>==</code>, missing colons or semicolons, endless loops, and code that disagrees with its shape. They are pattern-based, not compilers, and run only in your browser. Other languages are stored and exported but not checked.</p>`);
}
function placeholderFor(lang) {
  switch (lang) {
    case 'python': return 'if total > limit:\n    raise ValueError("over limit")';
    case 'javascript': case 'typescript': return 'const ok = await verify(token);\nif (!ok) return deny();';
    case 'cpp': return 'if (balance >= amount) {\n    balance -= amount;\n}';
    case 'csharp': return 'if (balance >= amount)\n{\n    balance -= amount;\n}';
    case 'pseudocode': return 'IF balance >= amount THEN\n    SUBTRACT amount FROM balance\nEND IF';
    default: return 'Notes or code for this step…';
  }
}

/* ---------------- checks pane ---------------- */
export function renderChecks(app) {
  const pane = document.getElementById('pane-checks');
  const issues = app.issues;
  const counts = { error: 0, warning: 0, info: 0 };
  for (const i of issues) counts[i.sev]++;
  if (!app.store.doc.nodes.length) {
    pane.innerHTML = `<div class="empty-note">Nothing to check yet — add a step and the logic checks start running as you draw.</div>`;
    return;
  }
  const head = `<div class="row" style="gap:6px"><span class="pill ${counts.error ? 'err' : 'ok'}">${counts.error}</span><span class="muted grow">error${counts.error === 1 ? '' : 's'}</span>
    <span class="pill ${counts.warning ? 'warn' : 'ok'}">${counts.warning}</span><span class="muted grow">warning${counts.warning === 1 ? '' : 's'}</span>
    <span class="pill">${counts.info}</span><span class="muted">note${counts.info === 1 ? '' : 's'}</span></div>`;
  if (!issues.length) {
    pane.innerHTML = head + `<div class="okbox" style="margin-top:10px"><b>This flow looks sound.</b><br>Every step is reachable, each decision has labelled branches, and no loop is missing an exit.</div>`;
    return;
  }
  pane.innerHTML = head + `<div class="issues" style="margin-top:10px">${issues.map((i, idx) => `
    <div class="issue sev-${i.sev}" data-issue="${idx}">
      <b>${esc(i.title)}</b>
      <p>${esc(i.detail)}</p>
      ${i.fix ? `<button class="btn fixbtn" data-fix="${idx}">${esc(i.fix.label)}</button>` : ''}
      ${i.code ? `<button class="btn fixbtn" data-opencode="${idx}">Open the code</button>` : ''}
    </div>`).join('')}</div>
    <p class="muted" style="font-size:11.5px;margin-top:10px">Checks re-run as you edit. Click an item to highlight the steps it refers to.</p>`;
  pane.querySelectorAll('[data-issue]').forEach((el) => el.addEventListener('click', (ev) => {
    if (ev.target.closest('button')) return;
    app.revealIssue(issues[Number(el.dataset.issue)]);
  }));
  pane.querySelectorAll('[data-fix]').forEach((b) => b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    app.applyFix(issues[Number(b.dataset.fix)]);
  }));
  pane.querySelectorAll('[data-opencode]').forEach((b) => b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const i = issues[Number(b.dataset.opencode)];
    app.store.select(i.nodes, []);
    app.setTab('code');
  }));
}
