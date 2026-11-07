// FlowState — application wiring.
import { h, esc, debounce, toast, announce, download, fmtBytes, fmtWhen, modKey, clamp, uid } from './util.js';
import { SHAPES, SHAPE_ORDER, textBox } from './shapes.js';
import {
  newDoc, newNode, newEdge, nodeById, edgeById, docBounds, readFile, toFile, routeEdge,
  applyTheme, THEMES, LANGS, langLabel, DOC_VERSION,
} from './model.js';
import { Store } from './store.js';
import { Renderer } from './render.js';
import { Interactions, isTyping } from './interact.js';
import { runChecks, issueMaps } from './validate.js';
import { lintDoc, lintCode } from './lint.js';
import { getHints, freeSpot } from './hints.js';
import { TEMPLATES, buildTemplate } from './templates.js';
import { codeToDoc, fitNode } from './codeflow.js';
import { buildPalette, buildTemplates, renderDesign, renderCode, renderChecks, renderHints } from './panels.js';
import * as EX from './exporters.js';
import { openSketchImport } from './scanui.js';
import { isImageFile } from './vision.js';

class App {
  constructor() {
    this.store = new Store();
    this.svg = document.getElementById('canvas');
    this.renderer = new Renderer(this.svg, this.store);
    this.ia = new Interactions(this);
    this.issues = [];
    this.hints = [];
    this.dismissed = new Set();
    this.tab = 'design';
    this.find = { q: '', ids: [], i: 0 };
    this.exportOpts = { format: 'png', scale: 2, background: 'theme', padding: 32, quality: 0.92, page: 'fit', orientation: 'auto', grid: false };

    this.revalidate = debounce(() => this.runValidation(), 170);
    this.recomputeHints = debounce(() => this.runHints(), 260);

    this.wireChrome();
    this.wireKeys();
    buildPalette(this);
    buildTemplates(this);
    this.store.on('change', () => { this.afterChange(); });
    this.store.on('live', () => { this.syncStatus(); });
    this.store.on('selection', () => { this.onSelection(); });
    this.store.on('viewport', () => { this.updateZoomLabel(); });
    this.store.on('savestate', (s) => this.setSaveState(s));
    this.store.on('saveerror', () => toast('Could not autosave — browser storage may be full. Use Backup to keep a copy.', 'err', 6000));
    window.addEventListener('resize', debounce(() => this.renderer.applyViewport(), 120));
    window.addEventListener('beforeunload', (e) => {
      if (this.store._saveState === 'saving') { e.preventDefault(); e.returnValue = ''; }
    });
    this.boot();
  }

  /* ================= boot ================= */
  async boot() {
    const ui = this.store.ui();
    if (ui.theme) document.documentElement.dataset.ui = ui.theme;
    let loaded = false;
    if (location.hash.length > 4) {
      try {
        const json = await EX.readShareHash(location.hash);
        if (json) {
          const res = readFile(json);
          if (res.ok) {
            res.doc.id = uid('doc');
            res.doc.name = res.doc.name + ' (shared)';
            this.store.setDoc(res.doc);
            loaded = true;
            toast('Opened a shared flowchart. It is now saved in your projects.', 'ok', 4500);
          } else this.showImportReport(res, 'the shared link');
        }
      } catch { toast('That share link could not be decoded.', 'err'); }
      history.replaceState(null, '', location.pathname);
    }
    if (!loaded) {
      const last = this.store.lastId();
      const d = last && this.store.loadLocal(last);
      if (d) { this.store.setDoc(d); loaded = true; }
    }
    if (!loaded) this.store.setDoc(newDoc());
    this.renderer.render();
    this.renderer.fit(docBounds(this.store.doc, 40));
    this.afterChange();
    this.renderAllPanes();
  }

  /* ================= chrome wiring ================= */
  wireChrome() {
    const $ = (id) => document.getElementById(id);
    $('projName').addEventListener('input', (e) => {
      this.store.doc.name = e.target.value;
      this.store.touch('Rename', false);
    });
    $('btnUndo').onclick = () => this.undo();
    $('btnRedo').onclick = () => this.redo();
    $('btnNew').onclick = () => { this.newProject(); toast('Started a blank project.', 'ok'); };
    $('btnSaveJson').onclick = () => this.backupJson();
    $('btnImport').onclick = () => this.pickImport();
    $('btnSketch').onclick = () => this.pickSketch();
    $('btnCode').onclick = () => this.openCodeToChart();
    $('esCode').onclick = () => this.openCodeToChart();
    $('btnExport').onclick = () => this.openExport();
    $('btnShare').onclick = () => this.share();
    $('btnHelp').onclick = () => this.openShortcuts();
    $('btnUi').onclick = () => {
      const next = document.documentElement.dataset.ui === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.ui = next;
      this.store.setUi({ theme: next });
    };
    document.querySelectorAll('.btn.tool').forEach((b) => b.onclick = () => {
      this.ia.setTool(b.dataset.tool);
      this.clearArmed?.();
    });
    this.onToolChange = (t) => document.querySelectorAll('.btn.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    $('btnSmartAlign').onclick = () => this.smartAlign();
    document.querySelectorAll('[data-align]').forEach((b) => b.onclick = () => this.align(b.dataset.align));
    $('btnGrid').onclick = () => this.toggleSetting('grid');
    $('btnSnap').onclick = () => this.toggleSetting('snap');
    $('btnHints').onclick = () => this.toggleSetting('hints');
    $('btnSearch').onclick = () => this.openSearch();
    $('btnZoomIn').onclick = () => this.renderer.setZoom(this.store.viewport.k * 1.25);
    $('btnZoomOut').onclick = () => this.renderer.setZoom(this.store.viewport.k / 1.25);
    $('btnZoomLevel').onclick = () => this.renderer.setZoom(1);
    $('btnFit').onclick = () => this.renderer.fit(docBounds(this.store.doc, 40));
    $('stDelete').onclick = () => this.deleteSelection();
    $('esNew').onclick = () => { this.newProject(); toast('Started a blank project.', 'ok'); };
    $('esStarter').onclick = () => this.openTemplate('starter');
    $('esTemplate').onclick = () => this.openTemplatePicker();
    $('esImport').onclick = () => this.pickImport();
    $('esSketch').onclick = () => this.pickSketch();
    document.querySelectorAll('.tab[data-tab]').forEach((b) => b.onclick = () => this.setTab(b.dataset.tab));
    document.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => document.getElementById(b.dataset.close === 'left' ? 'leftRail' : 'rightRail').classList.add('collapsed'));
    document.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => {
      const el = document.getElementById(b.dataset.open === 'left' ? 'leftRail' : 'rightRail');
      el.classList.toggle('collapsed');
      if (window.innerWidth <= 1000) {
        const other = document.getElementById(b.dataset.open === 'left' ? 'rightRail' : 'leftRail');
        other.classList.add('collapsed');
      }
    });
    if (window.innerWidth <= 1000) {
      document.getElementById('leftRail').classList.add('collapsed');
      document.getElementById('rightRail').classList.add('collapsed');
    }
    // search bar
    const si = $('searchInput');
    si.addEventListener('input', () => this.runSearch(si.value));
    si.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.stepSearch(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') { e.preventDefault(); this.closeSearch(); }
    });
    $('searchNext').onclick = () => this.stepSearch(1);
    $('searchPrev').onclick = () => this.stepSearch(-1);
    $('searchClose').onclick = () => this.closeSearch();
    $('filePicker').addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      if (isImageFile(f)) this.importSketch(f);
      else this.importFile(f);
    });
    $('imgPicker').addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (f) this.importSketch(f);
    });
    // drag a .json onto the window
    window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
    window.addEventListener('drop', (e) => {
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      if (/\.json$/i.test(f.name)) { e.preventDefault(); this.importFile(f); }
      else if (isImageFile(f)) { e.preventDefault(); this.importSketch(f); }
    });
    window.addEventListener('paste', (e) => {
      if (this.editor || isTyping(e.target)) return;
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (!item) return;
      const f = item.getAsFile();
      if (f) { e.preventDefault(); this.importSketch(f); }
    });
  }

  toggleSetting(key) {
    this.store.commit(key === 'grid' ? 'Grid' : key === 'snap' ? 'Snapping' : 'Smart hints', (d) => { d.settings[key] = !d.settings[key]; });
    this.renderer.applyTheme();
    this.refreshChrome();
    if (key === 'hints') { this.runHints(); announce('Smart hints ' + (this.store.doc.settings.hints ? 'on' : 'off')); }
  }
  refreshChrome() {
    const s = this.store.doc.settings;
    document.getElementById('btnGrid').classList.toggle('on', !!s.grid);
    document.getElementById('btnSnap').classList.toggle('on', !!s.snap);
    document.getElementById('btnHints').classList.toggle('on', !!s.hints);
    document.getElementById('btnUndo').disabled = !this.store.canUndo();
    document.getElementById('btnRedo').disabled = !this.store.canRedo();
    document.getElementById('btnUndo').title = this.store.canUndo() ? `Undo ${this.store.undoLabel()} (Ctrl+Z)` : 'Nothing to undo';
    document.getElementById('btnRedo').title = this.store.canRedo() ? `Redo ${this.store.redoLabel()} (Ctrl+Shift+Z)` : 'Nothing to redo';
    const nameInput = document.getElementById('projName');
    if (nameInput.value !== this.store.doc.name && document.activeElement !== nameInput) nameInput.value = this.store.doc.name;
  }
  updateZoomLabel() {
    document.getElementById('btnZoomLevel').textContent = Math.round(this.store.viewport.k * 100) + '%';
  }
  setSaveState(s) {
    const el = document.getElementById('stSave');
    el.className = s === 'saving' ? 'saving' : s === 'saved' ? 'saved' : 'muted';
    el.textContent = !this.store.doc.settings.autosave ? 'Autosave off' : s === 'saving' ? 'Saving…' : s === 'error' ? 'Save failed' : 'Saved ' + fmtWhen(this.store.doc.updatedAt);
  }

  /* ================= reactions ================= */
  afterChange() {
    this.renderer.render();
    this.refreshChrome();
    this.syncStatus();
    this.revalidate();
    this.recomputeHints();
    document.getElementById('emptyState').hidden = this.store.doc.nodes.length > 0;
    // Don't rebuild the properties form while the user is interacting with it.
    const inRail = document.getElementById('rightRail').contains(document.activeElement);
    if (this.tab === 'design' && !inRail) renderDesign(this);
  }
  onSelection() {
    this.renderer.decorate();
    this.syncStatus();
    renderDesign(this);
    if (this.tab === 'code') renderCode(this);
    this.recomputeHints();
  }
  renderAllPanes() {
    renderDesign(this);
    renderCode(this);
    renderChecks(this);
    renderHints(this);
  }
  setTab(name) {
    this.tab = name;
    document.querySelectorAll('.tab[data-tab]').forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('active', p.id === 'pane-' + name));
    document.getElementById('rightRail').classList.remove('collapsed');
    if (name === 'design') renderDesign(this);
    if (name === 'code') renderCode(this);
    if (name === 'checks') renderChecks(this);
    if (name === 'hints') renderHints(this);
  }
  syncStatus() {
    const d = this.store.doc;
    document.getElementById('stCounts').textContent = `${d.nodes.length} step${d.nodes.length === 1 ? '' : 's'} · ${d.edges.length} connection${d.edges.length === 1 ? '' : 's'}`;
    const ns = this.store.selNodes.size, es = this.store.selEdges.size;
    let sel = 'Nothing selected';
    if (ns === 1 && !es) {
      const n = this.store.selectedNodes()[0];
      sel = `${SHAPES[n.type].label.replace('\n', ' ')} · ${Math.round(n.w)}×${Math.round(n.h)} at ${Math.round(n.x)},${Math.round(n.y)}`;
    } else if (ns || es) sel = `${ns ? ns + ' step' + (ns === 1 ? '' : 's') : ''}${ns && es ? ' + ' : ''}${es ? es + ' connection' + (es === 1 ? '' : 's') : ''} selected`;
    document.getElementById('stSel').textContent = sel;
    const del = document.getElementById('stDelete');
    del.hidden = !(ns || es);
    del.textContent = `Delete ${ns && es ? 'selection' : ns ? ns + ' step' + (ns === 1 ? '' : 's') : es + ' connection' + (es === 1 ? '' : 's')}`;
  }

  runValidation() {
    const flow = runChecks(this.store.doc);
    const code = lintDoc(this.store.doc);
    const order = { error: 0, warning: 1, info: 2 };
    this.issues = [...flow, ...code].sort((a, b) => order[a.sev] - order[b.sev]);
    this.renderer.setIssues(issueMaps(this.issues));
    const errs = this.issues.filter((i) => i.sev === 'error').length;
    const warns = this.issues.filter((i) => i.sev === 'warning').length;
    const pill = document.getElementById('checkPill');
    pill.textContent = errs + warns;
    pill.className = 'pill ' + (errs ? 'err' : warns ? 'warn' : 'ok');
    const st = document.getElementById('stChecks');
    st.textContent = !this.store.doc.nodes.length ? 'Checks: —'
      : errs || warns ? `Checks: ${errs} error${errs === 1 ? '' : 's'}, ${warns} warning${warns === 1 ? '' : 's'}`
        : 'Checks: all clear';
    st.className = errs ? '' : 'muted';
    st.style.color = errs ? 'var(--err)' : warns ? 'var(--warn)' : '';
    if (this.tab === 'checks') renderChecks(this);
  }
  runHints() {
    this.hints = this.store.doc.settings.hints ? getHints(this.store.doc, this.store.selNodes, this.dismissed) : [];
    const pill = document.getElementById('hintPill');
    pill.textContent = this.hints.length;
    pill.className = 'pill' + (this.hints.length ? '' : ' ok');
    if (this.tab === 'hints') renderHints(this);
  }

  /* ================= editing ================= */
  addNodeAt(type, x, y, center = false, edit = false) {
    if (!SHAPES[type]) return;
    const def = SHAPES[type];
    let px = center ? x - def.size[0] / 2 : x;
    let py = center ? y - def.size[1] / 2 : y;
    const g = this.store.doc.settings.snap ? this.store.doc.settings.gridSize : 1;
    px = Math.round(px / g) * g; py = Math.round(py / g) * g;
    const spot = freeSpot(this.store.doc, px, py, def.size[0], def.size[1]);
    let created;
    this.store.commit('Add ' + def.label.replace('\n', ' '), (d) => {
      created = newNode(type, spot.x, spot.y, d.settings);
      d.nodes.push(created);
    });
    this.store.select([created.id], []);
    this.clearArmed?.();
    announce(`${def.label.replace('\n', ' ')} added`);
    if (edit) this.editNodeText(created.id);
    return created;
  }
  connect(fromId, toId, fromPort = 'auto') {
    if (fromId === toId) {
      const exists = this.store.doc.edges.some((e) => e.from === fromId && e.to === toId);
      if (exists) { toast('Those steps are already connected.', 'warn'); return; }
    }
    const dupe = this.store.doc.edges.find((e) => e.from === fromId && e.to === toId);
    if (dupe) { this.store.select([], [dupe.id]); toast('Those steps are already connected.', 'warn'); return; }
    let created;
    this.store.commit('Connect steps', (d) => {
      created = newEdge(fromId, toId, d.settings);
      if (fromPort && fromPort !== 'auto') created.fromPort = fromPort;
      const from = nodeById(d, fromId);
      if (from?.type === 'decision') {
        const sibs = d.edges.filter((e) => e.from === fromId);
        const used = sibs.map((e) => (e.label || '').toLowerCase());
        if (sibs.length === 0) created.label = 'Yes';
        else if (sibs.length === 1 && !used.includes('no')) created.label = 'No';
      }
      d.edges.push(created);
    });
    this.store.select([], [created.id]);
    announce('Connected');
  }
  connectToNew(fromId, x, y, port) {
    const from = nodeById(this.store.doc, fromId);
    if (!from) return;
    const type = from.type === 'decision' ? 'process' : from.type === 'start' ? 'process' : 'process';
    const def = SHAPES[type];
    const g = this.store.doc.settings.snap ? this.store.doc.settings.gridSize : 1;
    const spot = freeSpot(this.store.doc, Math.round((x - def.size[0] / 2) / g) * g, Math.round((y - def.size[1] / 2) / g) * g, def.size[0], def.size[1]);
    let n, e;
    this.store.commit('Add connected step', (d) => {
      n = newNode(type, spot.x, spot.y, d.settings, '');
      d.nodes.push(n);
      e = newEdge(fromId, n.id, d.settings);
      if (port && port !== 'auto') e.fromPort = port;
      const src = nodeById(d, fromId);
      if (src?.type === 'decision') {
        const sibs = d.edges.filter((x2) => x2.from === fromId);
        e.label = sibs.length === 0 ? 'Yes' : sibs.length === 1 ? 'No' : '';
      }
      d.edges.push(e);
    });
    this.store.select([n.id], []);
    this.editNodeText(n.id);
  }

  editNodeText(id) {
    const n = nodeById(this.store.doc, id);
    if (!n) return;
    this.closeEditor();
    const layer = document.getElementById('editorLayer');
    const r = this.svg.getBoundingClientRect();
    const k = this.store.viewport.k;
    const st = n.style || {};
    const ta = h('textarea', {
      class: 'node-editor', spellcheck: 'false',
      'aria-label': 'Step text',
      // Transparent: the shape's own label re-renders live as you type, so the text appears inside the shape.
      style: `font-family:${st.fontFamily};font-size:${(st.fontSize || 14) * k}px;font-weight:${st.fontWeight || 400};
              font-style:${st.fontStyle === 'italic' ? 'italic' : 'normal'};line-height:1.3;text-align:${st.align || 'center'};
              caret-color:${st.textColor || '#111'};`,
    });
    const geo = { x: n.x, y: n.y, w: n.w, h: n.h };
    const place = () => {
      const q = this.renderer.worldToScreen(n.x, n.y), box = textBox(n.type, n.w, n.h);
      ta.style.left = q.x - r.left + box.x * k + 'px';
      ta.style.width = box.w * k + 'px';
      ta.style.height = 'auto';
      const hgt = Math.min(ta.scrollHeight, box.h * k);
      ta.style.height = hgt + 'px';
      ta.style.top = q.y - r.top + (box.y + box.h / 2) * k - hgt / 2 + 'px';
    };
    ta.value = n.text;
    layer.append(ta);
    place();
    this.editor = { el: ta, nodeId: id, before: n.text };
    ta.focus();
    ta.select();
    const commit = (keep) => {
      if (!this.editor || this.editor.el !== ta) return;
      const val = ta.value;
      const before = this.editor.before;
      this.editor = null;
      ta.remove();
      Object.assign(n, geo); // undo history must see the original size
      if (keep && val !== before) {
        n.text = before;
        this.store.commit('Edit text', () => { const t = nodeById(this.store.doc, id); if (t) { t.text = val; fitNode(t); } });
      } else {
        n.text = before;
        this.renderer.render();
      }
      this.svg.focus({ preventScroll: true });
    };
    ta.addEventListener('blur', () => commit(true));
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); commit(false); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) { e.preventDefault(); commit(true); }
      else if (e.key === 'Tab') {
        e.preventDefault();
        commit(true);
        const order = this.store.doc.nodes;
        const i = order.findIndex((x) => x.id === id);
        const next = order[(i + (e.shiftKey ? -1 : 1) + order.length) % order.length];
        if (next) { this.store.select([next.id], []); this.editNodeText(next.id); }
      }
    });
    ta.addEventListener('input', () => {
      n.text = ta.value;
      fitNode(n);
      this.renderer.render();
      place();
    });
  }
  editEdgeLabel(id) {
    const e = edgeById(this.store.doc, id);
    if (!e) return;
    this.closeEditor();
    const route = routeEdge(this.store.doc, e);
    if (!route) return;
    const mid = this.renderer.worldToScreen(route.label.x, route.label.y);
    const r = this.svg.getBoundingClientRect();
    const layer = document.getElementById('editorLayer');
    const inp = h('input', {
      class: 'edge-editor', type: 'text', 'aria-label': 'Connection label', placeholder: 'e.g. Yes',
      style: `left:${mid.x - r.left - 65}px;top:${mid.y - r.top - 15}px;width:130px`,
    });
    inp.value = e.label || '';
    layer.append(inp);
    this.editor = { el: inp, edgeId: id, before: e.label };
    inp.focus(); inp.select();
    const commit = (keep) => {
      if (!this.editor || this.editor.el !== inp) return;
      const val = inp.value, before = this.editor.before;
      this.editor = null;
      inp.remove();
      e.label = before;
      if (keep && val !== before) this.store.commit('Edit label', () => { const t = edgeById(this.store.doc, id); if (t) t.label = val; });
      else this.renderer.patchEdges([id]);
      this.svg.focus({ preventScroll: true });
    };
    inp.addEventListener('blur', () => commit(true));
    inp.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape') { ev.preventDefault(); commit(false); }
      if (ev.key === 'Enter') { ev.preventDefault(); commit(true); }
    });
    inp.addEventListener('input', () => {
      e.label = inp.value;
      this.renderer.patchEdges([id]);
    });
  }
  closeEditor() {
    const ed = this.editor;
    if (!ed) return;
    this.editor = null;                     // clear first: removing fires blur
    try { ed.el.remove(); } catch {}
  }

  deleteSelection() {
    const ns = new Set(this.store.selNodes), es = new Set(this.store.selEdges);
    if (!ns.size && !es.size) return;
    const label = ns.size && es.size ? 'Delete selection' : ns.size ? `Delete ${ns.size} step${ns.size === 1 ? '' : 's'}` : `Delete ${es.size} connection${es.size === 1 ? '' : 's'}`;
    this.store.commit(label, (d) => {
      d.nodes = d.nodes.filter((n) => !ns.has(n.id));
      d.edges = d.edges.filter((e) => !es.has(e.id) && !ns.has(e.from) && !ns.has(e.to));
    });
    this.store.clearSelection();
    announce(label);
  }
  duplicateSelection() {
    const sel = this.store.selectedNodes();
    if (!sel.length) return;
    const map = new Map();
    const made = [];
    this.store.commit('Duplicate', (d) => {
      for (const n of sel) {
        const copy = JSON.parse(JSON.stringify(n));
        copy.id = uid('n');
        const spot = freeSpot(d, n.x + 40, n.y + 40, n.w, n.h);
        copy.x = spot.x; copy.y = spot.y;
        map.set(n.id, copy.id);
        d.nodes.push(copy);
        made.push(copy.id);
      }
      for (const e of [...d.edges]) {
        if (map.has(e.from) && map.has(e.to)) {
          const c = JSON.parse(JSON.stringify(e));
          c.id = uid('e'); c.from = map.get(e.from); c.to = map.get(e.to);
          d.edges.push(c);
        }
      }
    });
    this.store.select(made, []);
  }

  align(kind) {
    const sel = this.store.selectedNodes();
    if (sel.length < 2) { toast('Select two or more steps to align them.', 'warn'); return; }
    this.store.commit('Align', () => {
      const xs = sel.map((n) => n.x), ys = sel.map((n) => n.y);
      const r = Math.max(...sel.map((n) => n.x + n.w)), b = Math.max(...sel.map((n) => n.y + n.h));
      const l = Math.min(...xs), t = Math.min(...ys);
      const cx = sel.reduce((a, n) => a + n.x + n.w / 2, 0) / sel.length;
      const cy = sel.reduce((a, n) => a + n.y + n.h / 2, 0) / sel.length;
      if (kind === 'left') sel.forEach((n) => (n.x = l));
      if (kind === 'right') sel.forEach((n) => (n.x = r - n.w));
      if (kind === 'cx') sel.forEach((n) => (n.x = Math.round(cx - n.w / 2)));
      if (kind === 'top') sel.forEach((n) => (n.y = t));
      if (kind === 'bottom') sel.forEach((n) => (n.y = b - n.h));
      if (kind === 'cy') sel.forEach((n) => (n.y = Math.round(cy - n.h / 2)));
      if (kind === 'dh' || kind === 'dv') {
        const horiz = kind === 'dh';
        const sorted = [...sel].sort((p, q) => (horiz ? p.x - q.x : p.y - q.y));
        const first = sorted[0], last = sorted[sorted.length - 1];
        const span = horiz ? (last.x + last.w) - first.x : (last.y + last.h) - first.y;
        const used = sorted.reduce((a, n) => a + (horiz ? n.w : n.h), 0);
        const gap = (span - used) / (sorted.length - 1);
        let cur = horiz ? first.x : first.y;
        for (const n of sorted) {
          if (horiz) { n.x = Math.round(cur); cur += n.w + gap; }
          else { n.y = Math.round(cur); cur += n.h + gap; }
        }
      }
    });
    announce('Aligned ' + sel.length + ' steps');
  }
  /** Snap nearly-aligned steps onto shared columns (centre x) and rows (centre y). Uses the selection, or every step. */
  smartAlign() {
    const sel = this.store.selectedNodes();
    const nodes = sel.length >= 2 ? sel : this.store.doc.nodes;
    if (nodes.length < 2) { toast('Add at least two steps first.', 'warn'); return; }
    const T = 24; // steps whose centres are within this many px count as "meant to line up"
    const pos = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    const clusters = (key) => {
      const out = [];
      for (const n of [...nodes].sort((a, b) => key(a) - key(b))) {
        const g = out[out.length - 1];
        if (g && key(n) - key(g[g.length - 1]) <= T) g.push(n); else out.push([n]);
      }
      return out.filter((g) => g.length > 1);
    };
    const apart = (g, lo, len) => { // members must not overlap along the axis we are NOT aligning
      const s = [...g].sort((a, b) => pos.get(a.id)[lo] - pos.get(b.id)[lo]);
      return s.every((n, i) => !i || pos.get(n.id)[lo] >= pos.get(s[i - 1].id)[lo] + s[i - 1][len]);
    };
    let cols = 0, rows = 0;
    for (const g of clusters((n) => pos.get(n.id).x + n.w / 2)) {
      if (!apart(g, 'y', 'h')) continue;
      const c = g.reduce((a, n) => a + pos.get(n.id).x + n.w / 2, 0) / g.length;
      for (const n of g) pos.get(n.id).x = Math.round(c - n.w / 2);
      cols++;
    }
    for (const g of clusters((n) => pos.get(n.id).y + n.h / 2)) {
      if (!apart(g, 'x', 'w')) continue;
      const c = g.reduce((a, n) => a + pos.get(n.id).y + n.h / 2, 0) / g.length;
      for (const n of g) pos.get(n.id).y = Math.round(c - n.h / 2);
      rows++;
    }
    if (nodes.every((n) => pos.get(n.id).x === n.x && pos.get(n.id).y === n.y)) { toast('Everything is already lined up.', 'ok'); return; }
    this.store.commit('Smart align', () => {
      for (const n of nodes) { const t = nodeById(this.store.doc, n.id); if (t) Object.assign(t, pos.get(n.id)); }
    });
    toast(`Lined up ${cols} column${cols === 1 ? '' : 's'} and ${rows} row${rows === 1 ? '' : 's'}.`, 'ok');
  }
  tidy() {
    const d = this.store.doc;
    if (!d.nodes.length) return;
    const g = d.settings.gridSize || 10;
    this.store.commit('Tidy up spacing', () => {
      for (const n of d.nodes) { n.x = Math.round(n.x / g) * g; n.y = Math.round(n.y / g) * g; }
      // nudge apart any exact overlaps
      for (let i = 0; i < d.nodes.length; i++) {
        for (let j = i + 1; j < d.nodes.length; j++) {
          const a = d.nodes[i], b = d.nodes[j];
          if (a.x === b.x && a.y === b.y) { b.x += 40; b.y += 40; }
        }
      }
    });
    toast('Positions snapped to the grid.', 'ok');
  }

  /* ================= checks & hints actions ================= */
  revealIssue(issue) {
    if (!issue) return;
    this.store.select(issue.nodes || [], issue.edges || []);
    const n = (issue.nodes || []).map((id) => nodeById(this.store.doc, id)).filter(Boolean)[0];
    if (n) this.renderer.centerOn(n);
    announce(issue.title);
  }
  applyFix(issue) {
    if (!issue?.fix) return;
    this.store.commit(issue.fix.label, (d) => issue.fix.apply(d));
    toast(issue.fix.label + ' — done.', 'ok');
    this.runValidation();
  }
  applyHint(hint) {
    if (!hint?.apply) return;
    let made = [];
    this.store.commit(hint.title, (d) => { made = hint.apply(d) || []; });
    if (made.length) this.store.select(made, []);
    toast('Applied: ' + hint.title, 'ok');
    this.runHints();
  }
  dismissHint(id) {
    this.dismissed.add(id);
    this.runHints();
  }

  /** Switch the drawing palette. Existing steps keep their colours unless `restyleAll`. */
  setTheme(key, restyleAll = false) {
    if (!THEMES[key]) return;
    this.store.commit('Change palette', (d) => {
      d.settings.theme = key;
      if (restyleAll) applyTheme(d, key);
    });
    if (restyleAll) this.renderer.nodeSig.clear();
    this.renderer.applyTheme();
    this.renderer.render();
    renderDesign(this);
  }

  /* ================= panel actions ================= */
  panelAction(act) {
    const sel = this.store.selectedNodes();
    switch (act) {
      case 'del': this.deleteSelection(); break;
      case 'delEdge': this.deleteSelection(); break;
      case 'dupe': this.duplicateSelection(); break;
      case 'fitText': this.fitToText(); break;
      case 'flip':
        this.store.commit('Reverse connection', () => {
          for (const e of this.store.selectedEdges()) {
            [e.from, e.to] = [e.to, e.from];
            [e.fromPort, e.toPort] = [e.toPort, e.fromPort];
          }
        });
        break;
      case 'sameSize':
        if (sel.length > 1) this.store.commit('Match size', () => { const f = sel[0]; for (const n of sel) { n.w = f.w; n.h = f.h; } });
        break;
      case 'connectChain':
        if (sel.length > 1) this.store.commit('Connect in order', (d) => {
          const order = [...sel].sort((a, b) => a.y - b.y || a.x - b.x);
          for (let i = 0; i < order.length - 1; i++) {
            if (!d.edges.some((e) => e.from === order[i].id && e.to === order[i + 1].id)) {
              d.edges.push(newEdge(order[i].id, order[i + 1].id, d.settings));
            }
          }
        });
        break;
      case 'applyTheme':
        this.store.commit('Restyle every step', (d) => applyTheme(d, d.settings.theme));
        this.renderer.nodeSig.clear();
        this.renderer.render();
        toast('Every step restyled from the palette.', 'ok');
        break;
      case 'langAll':
        this.store.commit('Set language everywhere', (d) => { for (const n of d.nodes) n.code.lang = d.settings.defaultLang; });
        toast('Language applied to all ' + this.store.doc.nodes.length + ' steps.', 'ok');
        break;
      case 'clearCode':
        this.store.commit('Clear code', () => { for (const n of sel) n.code.source = ''; });
        renderCode(this);
        break;
      case 'copyLangAll': {
        const lang = sel[0]?.code?.lang;
        if (lang) {
          this.store.commit('Set language everywhere', (d) => { for (const n of d.nodes) n.code.lang = lang; d.settings.defaultLang = lang; });
          toast(langLabel(lang) + ' set on every step.', 'ok');
        }
        break;
      }
      case 'fit': this.renderer.fit(docBounds(this.store.doc, 40)); break;
      case 'tidy': this.tidy(); break;
      case 'resetHints': this.dismissed.clear(); this.runHints(); break;
    }
  }
  fitToText() {
    const sel = this.store.selectedNodes();
    if (!sel.length) return;
    this.store.commit('Fit to text', () => {
      for (const n of sel) {
        const lines = (n.text || '').split('\n');
        const fs = n.style.fontSize || 14;
        const longest = Math.max(...lines.map((l) => l.length), 6);
        const t = SHAPES[n.type].text;
        n.w = clamp(Math.round((longest * fs * 0.58) / t[2] / 10) * 10 + 20, 70, 520);
        n.h = clamp(Math.round((lines.length * fs * 1.35) / t[3] / 10) * 10 + 10, 40, 420);
      }
    });
  }
  focusNode(id) {
    const n = nodeById(this.store.doc, id);
    if (!n) return;
    this.store.select([id], []);
    this.renderer.centerOn(n);
  }

  /* ================= search ================= */
  openSearch() {
    const bar = document.getElementById('searchBar');
    bar.hidden = false;
    const i = document.getElementById('searchInput');
    i.focus(); i.select();
    if (i.value) this.runSearch(i.value);
  }
  closeSearch() {
    document.getElementById('searchBar').hidden = true;
    this.renderer.setFind([], null);
    this.svg.focus({ preventScroll: true });
  }
  runSearch(q) {
    const term = q.trim().toLowerCase();
    this.find.q = term;
    if (!term) {
      this.find.ids = [];
      this.renderer.setFind([], null);
      document.getElementById('searchCount').textContent = '0';
      return;
    }
    const d = this.store.doc;
    const ids = [];
    for (const n of d.nodes) {
      const hay = [n.text, n.code?.source, SHAPES[n.type].label, langLabel(n.code?.lang)].join(' ').toLowerCase();
      if (hay.includes(term)) ids.push(n.id);
    }
    for (const e of d.edges) {
      if ((e.label || '').toLowerCase().includes(term) && !ids.includes(e.from)) ids.push(e.from);
    }
    this.find.ids = ids;
    this.find.i = 0;
    document.getElementById('searchCount').textContent = ids.length ? `1 / ${ids.length}` : 'none';
    this.renderer.setFind(ids, ids[0]);
    if (ids.length) { const n = nodeById(d, ids[0]); if (n) this.renderer.centerOn(n); }
  }
  stepSearch(dir) {
    const { ids } = this.find;
    if (!ids.length) return;
    this.find.i = (this.find.i + dir + ids.length) % ids.length;
    const id = ids[this.find.i];
    document.getElementById('searchCount').textContent = `${this.find.i + 1} / ${ids.length}`;
    this.renderer.setFind(ids, id);
    const n = nodeById(this.store.doc, id);
    if (n) { this.renderer.centerOn(n); this.store.select([id], []); }
  }

  /* ================= history ================= */
  undo() {
    const l = this.store.undo();
    if (l) { this.renderer.nodeSig.clear(); this.afterChange(); toast('Undid: ' + l, '', 1600); }
    else toast('Nothing left to undo.', 'warn', 1500);
  }
  redo() {
    const l = this.store.redo();
    if (l) { this.renderer.nodeSig.clear(); this.afterChange(); toast('Redid: ' + l, '', 1600); }
    else toast('Nothing to redo.', 'warn', 1500);
  }

  /* ================= keyboard ================= */
  wireKeys() {
    window.addEventListener('keydown', (e) => {
      if (this.editor) return;
      const typing = isTyping(e.target);
      const mod = modKey(e);
      if (typing && !(mod && ['s', 'e', 'o', 'f'].includes(e.key.toLowerCase()))) return;

      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); this.backupJson(); return; }
      if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); this.openExport(); return; }
      if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); this.openProjects(); return; }
      if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); this.openSearch(); return; }
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); this.store.select(this.store.doc.nodes.map((n) => n.id), this.store.doc.edges.map((x) => x.id)); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); this.duplicateSelection(); return; }
      if (mod && (e.key === '0')) { e.preventDefault(); this.renderer.setZoom(1); return; }
      if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); this.renderer.setZoom(this.store.viewport.k * 1.25); return; }
      if (mod && e.key === '-') { e.preventDefault(); this.renderer.setZoom(this.store.viewport.k / 1.25); return; }
      if (typing) return;

      if (e.key === 'Escape') {
        if (!document.getElementById('searchBar').hidden) this.closeSearch();
        else if (document.querySelector('.backdrop')) this.closeModal();
        else if (this.ia.armed) { this.ia.arm(null); this.clearArmed?.(); }
        else this.store.clearSelection();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.deleteSelection(); return; }
      if (e.key === 'Enter' || e.key === 'F2') {
        const n = this.store.selectedNodes()[0];
        const ed = this.store.selectedEdges()[0];
        if (n) { e.preventDefault(); this.editNodeText(n.id); }
        else if (ed) { e.preventDefault(); this.editEdgeLabel(ed.id); }
        return;
      }
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) { e.preventDefault(); this.openShortcuts(); return; }
      if (e.key === 'H' && e.shiftKey) { e.preventDefault(); this.toggleSetting('hints'); return; }
      if (e.key === '1' && e.shiftKey) { e.preventDefault(); this.renderer.fit(docBounds(this.store.doc, 40)); return; }
      const k = e.key.toLowerCase();
      if (!e.shiftKey && !e.altKey) {
        if (k === 'v') { this.ia.setTool('select'); return; }
        if (k === 'h') { this.ia.setTool('pan'); return; }
        if (k === 'c') { this.ia.setTool('connect'); return; }
        if (k === 'g') { this.toggleSetting('grid'); return; }
        if (k === 'n') { this.store.doc.nodes.length ? this.addNodeAt('process', ...this.viewCenter(), true, true) : this.openTemplate('starter'); return; }
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const order = this.store.doc.nodes;
        if (!order.length) return;
        const cur = [...this.store.selNodes][0];
        const i = order.findIndex((n) => n.id === cur);
        const next = order[(i + (e.shiftKey ? -1 : 1) + order.length) % order.length];
        this.store.select([next.id], []);
        this.renderer.centerOn(next);
        announce(`${SHAPES[next.type].label.replace('\n', ' ')}: ${next.text || 'untitled'}`);
        return;
      }
      if (e.key.startsWith('Arrow')) {
        const dir = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
        if (!dir) return;
        e.preventDefault();
        if (e.altKey) { this.navigateGraph(dir); return; }
        const sel = this.store.selectedNodes();
        if (!sel.length) {
          const vp = this.store.viewport;
          vp.x -= dir[0] * 80; vp.y -= dir[1] * 80;
          this.renderer.applyViewport();
          return;
        }
        const step = (this.store.doc.settings.gridSize || 10) * (e.shiftKey ? 5 : 1);
        this.store.commit('Move step', () => { for (const n of sel) { n.x += dir[0] * step; n.y += dir[1] * step; } });
      }
    });
  }
  viewCenter() {
    const { w, h } = this.renderer.size();
    const p = this.renderer.screenToWorld(this.svg.getBoundingClientRect().left + w / 2, this.svg.getBoundingClientRect().top + h / 2);
    return [p.x, p.y];
  }
  navigateGraph(dir) {
    const cur = this.store.selectedNodes()[0];
    const d = this.store.doc;
    if (!cur) { if (d.nodes.length) this.focusNode(d.nodes[0].id); return; }
    const linked = [
      ...d.edges.filter((e) => e.from === cur.id).map((e) => nodeById(d, e.to)),
      ...d.edges.filter((e) => e.to === cur.id).map((e) => nodeById(d, e.from)),
    ].filter(Boolean);
    const cx = cur.x + cur.w / 2, cy = cur.y + cur.h / 2;
    let best = null;
    for (const n of linked) {
      const dx = n.x + n.w / 2 - cx, dy = n.y + n.h / 2 - cy;
      const score = dx * dir[0] + dy * dir[1];
      if (score <= 0) continue;
      const off = Math.abs(dx * dir[1] + dy * dir[0]);
      const total = score - off * 0.6;
      if (!best || total > best.total) best = { n, total };
    }
    if (best) {
      this.focusNode(best.n.id);
      announce(`${SHAPES[best.n.type].label.replace('\n', ' ')}: ${best.n.text || 'untitled'}`);
    } else announce('No connected step that way');
  }

  /* ================= context menu ================= */
  showContextMenu(x, y) {
    this.hideContextMenu();
    const hasNode = this.store.selNodes.size > 0;
    const hasEdge = this.store.selEdges.size > 0;
    const items = [];
    if (hasNode) items.push(['Edit text', () => this.editNodeText([...this.store.selNodes][0])]);
    if (hasEdge && !hasNode) items.push(['Edit label', () => this.editEdgeLabel([...this.store.selEdges][0])]);
    if (hasNode) items.push(['Attach code', () => this.setTab('code')]);
    if (hasNode) items.push(['Duplicate', () => this.duplicateSelection()]);
    if (hasEdge) items.push(['Reverse direction', () => this.panelAction('flip')]);
    items.push(['Delete', () => this.deleteSelection()]);
    const menu = h('div', {
      class: 'modal', role: 'menu',
      style: `position:fixed;left:${x}px;top:${y}px;width:auto;min-width:170px;z-index:70;padding:6px;border-radius:12px`,
    }, ...items.map(([label, fn]) => h('button', {
      class: 'btn ghost', style: 'display:block;width:100%;text-align:left',
      onclick: () => { this.hideContextMenu(); fn(); },
    }, label)));
    document.body.append(menu);
    this._ctx = menu;
    const off = () => { this.hideContextMenu(); };
    setTimeout(() => window.addEventListener('pointerdown', off, { once: true }), 0);
  }
  hideContextMenu() { this._ctx?.remove(); this._ctx = null; }

  /* ================= modals ================= */
  openModal({ title, body, wide, actions = [], onMount }) {
    this.closeModal();
    const footer = h('footer', {}, ...actions.map((a) => h('button', {
      class: 'btn ' + (a.primary ? 'primary' : '') + (a.danger ? ' danger' : ''),
      onclick: () => a.onClick?.(modal),
    }, a.label)));
    const bodyEl = h('div', { class: 'body' });
    if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.append(body);
    const modal = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('header', {}, h('h2', {}, title), h('button', { class: 'btn icon ghost push', 'aria-label': 'Close', onclick: () => this.closeModal() }, '✕')),
      bodyEl, footer);
    const back = h('div', { class: 'backdrop', onclick: (e) => { if (e.target === back) this.closeModal(); } }, modal);
    document.getElementById('modals').append(back);
    this._modal = back;
    onMount?.(modal, bodyEl);
    const focusable = modal.querySelector('input,select,textarea,button:not(.ghost)');
    focusable?.focus();
    return modal;
  }
  closeModal() { this._modal?.remove(); this._modal = null; }

  openShortcuts() {
    const rows = [
      ['Select tool', 'V'], ['Pan tool / hold', 'H / Space'], ['Connect tool', 'C'],
      ['New step at centre', 'N'], ['Edit text', 'Enter or F2'], ['Finish editing', 'Enter'],
      ['Cancel editing', 'Esc'], ['Delete selection', 'Delete'], ['Duplicate', 'Ctrl D'],
      ['Select all', 'Ctrl A'], ['Undo / Redo', 'Ctrl Z / Ctrl Shift Z'],
      ['Move selection', 'Arrow keys'], ['Move further', 'Shift + Arrows'],
      ['Walk the flow', 'Alt + Arrows'], ['Next step', 'Tab'],
      ['Zoom', 'Ctrl + scroll'], ['Zoom in / out', 'Ctrl + / Ctrl -'], ['Reset zoom', 'Ctrl 0'],
      ['Fit to view', 'Shift 1'], ['Grid on/off', 'G'], ['Hints on/off', 'Shift H'],
      ['Find in chart', 'Ctrl F'], ['Backup .json', 'Ctrl S'], ['Export', 'Ctrl E'],
      ['Projects', 'Ctrl O'], ['This list', '?'],
    ];
    this.openModal({
      title: 'Keyboard shortcuts',
      wide: true,
      body: `<p class="muted" style="margin-top:0;font-size:12.5px">Drop or paste a photo of a hand-drawn chart anywhere on the page to trace it into steps.</p>
        <div class="keys">${rows.map(([a, b]) => `<div><span>${esc(a)}</span><span>${b.split(' ').map((k) => `<kbd>${esc(k)}</kbd>`).join(' ')}</span></div>`).join('')}</div>
        <p class="muted" style="margin-top:14px;font-size:12.5px">Drag the small dots on a selected step to draw a connection. Drop a connection on empty canvas and FlowState creates the next step for you. Hold <kbd>Alt</kbd> while dragging to ignore snapping.</p>`,
      actions: [{ label: 'Close', primary: true, onClick: () => this.closeModal() }],
    });
  }

  openTemplatePicker() {
    this.openModal({
      title: 'Start from a template',
      wide: true,
      body: `<div class="grid2">${TEMPLATES.map((t) => `<button class="tpl" data-t="${t.id}"><b>${esc(t.name)}</b><span>${esc(t.desc)}</span></button>`).join('')}</div>
        <p class="muted" style="margin-top:12px;font-size:12px">A template opens as a new project, so your current chart is left untouched.</p>`,
      actions: [{ label: 'Cancel', onClick: () => this.closeModal() }],
      onMount: (m) => m.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { this.closeModal(); this.openTemplate(b.dataset.t); }),
    });
  }
  openTemplate(id) {
    const d = buildTemplate(id, this.store.doc.settings);
    if (!d) return;
    this.store.setDoc(d);
    this.renderer.nodeSig.clear();
    this.renderer.render();
    this.renderer.fit(docBounds(d, 50));
    this.afterChange();
    this.renderAllPanes();
    toast(`Opened the "${d.name}" template as a new project.`, 'ok');
  }

  openCodeToChart() {
    const sample = 'def make_tea(strength):\n    boil_water()\n    while not water_boiled:\n        wait()\n    if strength > 3:\n        add("two bags")\n    elif strength > 1:\n        add("one bag")\n    else:\n        add("no bags")\n    print("Done")\n';
    const body = h('div', {});
    body.innerHTML = `<p class="muted" style="margin:0 0 8px;font-size:12.5px">Paste or type Python. <b>if / elif / else</b>, <b>while</b>, <b>for</b>, <b>def</b>, <b>return</b> and <b>input / print</b> become shapes; other lines become steps. It opens as a new project.</p>
      <textarea id="codeSrc" spellcheck="false" style="width:100%;height:300px;font-family:var(--mono);font-size:13px;line-height:1.5;resize:vertical"></textarea>
      <p id="codeMsg" class="muted" style="margin:8px 0 0;font-size:12.5px" aria-live="polite"></p>`;
    this.openModal({
      title: 'Code to flowchart', wide: true, body,
      actions: [
        { label: 'Cancel', onClick: () => this.closeModal() },
        { label: 'Generate flowchart', primary: true, onClick: (m) => {
          const { doc, warnings } = codeToDoc(m.querySelector('#codeSrc').value, this.store.doc.settings, 'From code');
          if (!doc) { m.querySelector('#codeMsg').textContent = warnings[0]; return; }
          this.closeModal();
          this.adoptDoc(doc);
          toast(warnings.length ? 'Chart generated. ' + warnings.join(' ') : 'Chart generated from your code.', warnings.length ? 'warn' : 'ok');
        } },
      ],
      onMount: (m) => {
        const ta = m.querySelector('#codeSrc');
        ta.value = sample;
        ta.addEventListener('keydown', (e) => {
          if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '    '); }
          else e.stopPropagation();
        });
      },
    });
  }

  openProjects() {
    const list = this.store.index();
    const cur = this.store.doc.id;
    const body = h('div', {});
    body.innerHTML = `
      <div class="seg" style="margin-bottom:12px">
        <button class="btn primary" data-new>New blank chart</button>
        <button class="btn" data-tpl>From a template</button>
        <button class="btn" data-imp>Import .json</button>
      </div>
      ${list.length ? `<div class="plist">${list.map((p) => `
        <div class="pitem ${p.id === cur ? 'cur' : ''}">
          <div class="meta"><b>${esc(p.name || 'Untitled')}</b><span>${p.nodes || 0} steps · ${p.edges || 0} connections · saved ${esc(fmtWhen(p.updatedAt))}${p.id === cur ? ' · open now' : ''}</span></div>
          <button class="btn" data-open="${p.id}" ${p.id === cur ? 'disabled' : ''}>Open</button>
          <button class="btn icon" data-dup="${p.id}" title="Duplicate">⧉</button>
          <button class="btn icon danger" data-del="${p.id}" title="Delete">🗑</button>
        </div>`).join('')}</div>`
        : `<div class="empty-note">No saved projects yet. Everything you draw is autosaved here in this browser.</div>`}
      <p class="muted" style="font-size:11.5px;margin-top:12px">Projects live in this browser's local storage. Use <b>Backup</b> for a portable <code>.json</code> file you can keep or move to another machine.</p>`;
    this.openModal({
      title: 'Projects',
      wide: true,
      body,
      actions: [{ label: 'Close', onClick: () => this.closeModal() }],
      onMount: (m) => {
        m.querySelector('[data-new]').onclick = () => { this.closeModal(); this.newProject(); };
        m.querySelector('[data-tpl]').onclick = () => { this.closeModal(); this.openTemplatePicker(); };
        m.querySelector('[data-imp]').onclick = () => { this.closeModal(); this.pickImport(); };
        m.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => {
          const d = this.store.loadLocal(b.dataset.open);
          if (!d) { toast('That project could not be read.', 'err'); return; }
          this.closeModal();
          this.store.setDoc(d);
          this.renderer.nodeSig.clear();
          this.renderer.render();
          this.renderer.fit(docBounds(d, 40));
          this.afterChange();
          this.renderAllPanes();
        });
        m.querySelectorAll('[data-dup]').forEach((b) => b.onclick = () => {
          const d = this.store.duplicateLocal(b.dataset.dup);
          if (d) { this.closeModal(); this.openProjects(); toast('Duplicated.', 'ok'); }
        });
        m.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
          const id = b.dataset.del;
          const p = this.store.index().find((x) => x.id === id);
          if (!confirm(`Delete "${p?.name || 'this project'}" from this browser? This cannot be undone — take a Backup first if you need it.`)) return;
          this.store.deleteLocal(id);
          if (id === this.store.doc.id) this.newProject();
          this.closeModal();
          this.openProjects();
        });
      },
    });
  }
  newProject() {
    const d = newDoc();
    d.settings = { ...this.store.doc.settings };
    this.store.setDoc(d);
    this.renderer.nodeSig.clear();
    this.renderer.render();
    this.store.viewport = { x: 0, y: 0, k: 1 };
    this.renderer.applyViewport();
    this.afterChange();
    this.renderAllPanes();
  }

  /* ================= backup / import ================= */
  backupJson() {
    const r = EX.exportJson(this.store.doc);
    toast(`Backup saved (${fmtBytes(r.bytes)}, format v${DOC_VERSION}).`, 'ok');
  }
  pickImport() { document.getElementById('filePicker').click(); }
  pickSketch() { document.getElementById('imgPicker').click(); }

  /** Photo or scan of a hand-drawn chart -> the review workspace. */
  async importSketch(file) {
    if (!isImageFile(file)) { toast('That is not an image FlowState can read.', 'err'); return; }
    if (file.size > 25 * 1024 * 1024) {
      toast('That image is larger than 25 MB. A smaller photo traces faster and just as well.', 'warn', 5000);
      return;
    }
    try { this.sketch = await openSketchImport(this, file); }
    catch (err) { toast('The sketch could not be opened: ' + err.message, 'err', 6000); }
  }

  /** A fresh document that inherits the current settings (used by sketch import). */
  newProjectDoc(name) {
    const d = newDoc(name || 'Untitled flowchart');
    d.settings = { ...this.store.doc.settings };
    return d;
  }
  /** Swap the editor over to a document and refit the view. */
  adoptDoc(doc) {
    this.store.setDoc(doc);
    this.renderer.nodeSig.clear();
    this.renderer.render();
    this.renderer.fit(docBounds(doc, 40));
    this.afterChange();
    this.renderAllPanes();
  }
  async importFile(file) {
    if (file.size > 12 * 1024 * 1024) {
      toast('That file is larger than 12 MB — it is probably not a flowchart backup.', 'err', 5000);
      return;
    }
    let text;
    try { text = await file.text(); }
    catch { toast('The file could not be read.', 'err'); return; }
    const res = readFile(text);
    this.showImportReport(res, file.name);
  }
  showImportReport(res, name) {
    if (!res.ok) {
      this.openModal({
        title: 'That backup could not be opened',
        body: `<p>FlowState could not read <b>${esc(name)}</b>.</p>
          <ul class="errlist">${res.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
          ${res.warnings?.length ? `<p class="muted" style="margin-top:10px">Also noted:</p><ul class="warnlist">${res.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
          <p class="muted" style="margin-top:12px;font-size:12.5px">FlowState reads its own <code>.json</code> backups, format versions 1 to ${DOC_VERSION}. Nothing on the canvas has been changed.</p>`,
        actions: [{ label: 'Choose another file', onClick: () => { this.closeModal(); this.pickImport(); } }, { label: 'Close', primary: true, onClick: () => this.closeModal() }],
      });
      return;
    }
    const d = res.doc;
    const open = () => {
      this.closeModal();
      this.store.setDoc(d);
      this.renderer.nodeSig.clear();
      this.renderer.render();
      this.renderer.fit(docBounds(d, 40));
      this.afterChange();
      this.renderAllPanes();
      toast(`Imported "${d.name}" — ${d.nodes.length} steps, ${d.edges.length} connections.`, 'ok');
    };
    if (!res.warnings.length && res.fromVersion === DOC_VERSION) { open(); return; }
    this.openModal({
      title: 'Import ' + (res.fromVersion < DOC_VERSION ? `an older backup (v${res.fromVersion})` : 'backup'),
      body: `<p><b>${esc(d.name)}</b> — ${d.nodes.length} steps, ${d.edges.length} connections, ${d.nodes.filter((n) => n.code?.source).length} with code.</p>
        ${res.fromVersion < DOC_VERSION ? `<p class="muted">Saved in format version ${res.fromVersion}; it will be upgraded to version ${DOC_VERSION} when you open it. Your original file is not modified.</p>` : ''}
        ${res.warnings.length ? `<p style="margin-top:10px">Things FlowState had to adjust:</p><ul class="warnlist">${res.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}`,
      actions: [{ label: 'Cancel', onClick: () => this.closeModal() }, { label: 'Open it', primary: true, onClick: open }],
    });
  }

  async share() {
    try {
      const url = await EX.makeShareLink(this.store.doc);
      if (url.length > 60000) { toast('This chart is too large for a share link — send a .json backup instead.', 'warn', 5000); return; }
      let copied = false;
      try { await navigator.clipboard.writeText(url); copied = true; } catch {}
      this.openModal({
        title: 'Share this flowchart',
        body: `<p class="muted" style="margin-top:0">The whole chart is packed into the link itself — no server, no account. Anyone who opens it gets an editable copy.</p>
          <textarea readonly rows="4" style="font-size:11.5px">${esc(url)}</textarea>
          <p class="muted" style="font-size:12px;margin-bottom:0">${copied ? 'Copied to your clipboard.' : 'Select the text above and copy it.'} Link length: ${fmtBytes(url.length)}.</p>`,
        actions: [{ label: 'Close', primary: true, onClick: () => this.closeModal() }],
      });
    } catch { toast('Could not build a share link.', 'err'); }
  }

  /* ================= export ================= */
  openExport() {
    if (!this.store.doc.nodes.length) { toast('There is nothing to export yet.', 'warn'); return; }
    const o = this.exportOpts;
    const b = docBounds(this.store.doc, o.padding);
    const body = h('div', {});
    body.innerHTML = `
      <div class="row"><label for="xFmt">Format</label><select id="xFmt" class="grow">
        <option value="png">PNG — lossless, transparent background possible</option>
        <option value="jpg">JPG — smaller, always opaque</option>
        <option value="svg">SVG — vector, stays sharp at any size</option>
        <option value="pdf">PDF — one page, ready to print</option>
      </select></div>
      <div class="row" id="rScale"><label for="xScale">Resolution</label><select id="xScale" class="grow">
        <option value="1">1× — screen size</option><option value="2">2× — retina (recommended)</option>
        <option value="3">3×</option><option value="4">4× — print</option>
      </select></div>
      <div class="row"><label for="xBg">Background</label><select id="xBg" class="grow">
        <option value="theme">Match the theme</option><option value="white">White</option><option value="transparent">Transparent</option>
      </select></div>
      <div class="row"><label for="xPad">Margin</label><input type="number" id="xPad" class="grow" min="0" max="200" value="${o.padding}"> <span class="muted">px</span></div>
      <div class="row" id="rQual"><label for="xQ">Quality</label><input type="range" id="xQ" min="0.5" max="1" step="0.02" value="${o.quality}"><span class="muted" id="xQv">${Math.round(o.quality * 100)}%</span></div>
      <div class="row" id="rPage"><label for="xPage">Page</label><select id="xPage" class="grow">${Object.entries(EX.PAGES).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select></div>
      <div class="row" id="rOrient"><label for="xOr">Orientation</label><select id="xOr" class="grow"><option value="auto">Automatic</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></div>
      <div class="row"><label for="xGrid">Include grid</label><input type="checkbox" id="xGrid" style="width:auto"></div>
      <p class="muted" id="xInfo" style="font-size:12px;margin:8px 0 0"></p>
      <div class="preview-box" id="xPrev" style="margin-top:12px"><span class="muted">Preview appears here</span></div>
      <p class="muted" style="font-size:11.5px;margin-bottom:0">Fonts are referenced by name, not embedded. PNG, JPG and PDF are rendered from the vector drawing, so they stay crisp. PDF is a single page containing the whole chart.</p>`;
    this.openModal({
      title: 'Export',
      wide: true,
      body,
      actions: [
        { label: 'Preview', onClick: () => this.exportPreview(body) },
        { label: 'Cancel', onClick: () => this.closeModal() },
        { label: 'Download', primary: true, onClick: () => this.doExport(body) },
      ],
      onMount: (m, bodyEl) => {
        bodyEl.querySelector('#xFmt').value = o.format;
        bodyEl.querySelector('#xScale').value = String(o.scale);
        bodyEl.querySelector('#xBg').value = o.background;
        bodyEl.querySelector('#xPage').value = o.page;
        bodyEl.querySelector('#xOr').value = o.orientation;
        bodyEl.querySelector('#xGrid').checked = !!o.grid;
        const sync = () => {
          const f = bodyEl.querySelector('#xFmt').value;
          bodyEl.querySelector('#rScale').style.display = f === 'svg' ? 'none' : '';
          bodyEl.querySelector('#rQual').style.display = f === 'jpg' || f === 'pdf' ? '' : 'none';
          bodyEl.querySelector('#rPage').style.display = f === 'pdf' ? '' : 'none';
          bodyEl.querySelector('#rOrient').style.display = f === 'pdf' && bodyEl.querySelector('#xPage').value !== 'fit' ? '' : 'none';
          const bgSel = bodyEl.querySelector('#xBg');
          const transparentOpt = bgSel.querySelector('[value=transparent]');
          const noAlpha = f === 'jpg' || f === 'pdf';
          transparentOpt.disabled = noAlpha;
          if (noAlpha && bgSel.value === 'transparent') bgSel.value = 'white';
          this.readExportOpts(bodyEl);
          const bb = docBounds(this.store.doc, this.exportOpts.padding);
          const px = f === 'svg' ? `${Math.round(bb.w)} × ${Math.round(bb.h)} units` : `${Math.round(bb.w * this.exportOpts.scale)} × ${Math.round(bb.h * this.exportOpts.scale)} pixels`;
          bodyEl.querySelector('#xInfo').textContent = `Output: ${px}${noAlpha ? ' · transparency is not available in this format' : ''}`;
        };
        bodyEl.addEventListener('change', sync);
        bodyEl.addEventListener('input', (e) => {
          if (e.target.id === 'xQ') bodyEl.querySelector('#xQv').textContent = Math.round(e.target.value * 100) + '%';
          sync();
        });
        sync();
        void b;
      },
    });
  }
  readExportOpts(bodyEl) {
    const g = (id) => bodyEl.querySelector('#' + id);
    this.exportOpts = {
      format: g('xFmt').value,
      scale: Number(g('xScale').value) || 2,
      background: g('xBg').value,
      padding: clamp(Number(g('xPad').value) || 0, 0, 200),
      quality: Number(g('xQ').value) || 0.92,
      page: g('xPage').value,
      orientation: g('xOr').value,
      grid: g('xGrid').checked,
    };
    return this.exportOpts;
  }
  async exportPreview(bodyEl) {
    const o = this.readExportOpts(bodyEl);
    const box = bodyEl.querySelector('#xPrev');
    box.innerHTML = '<span class="muted">Rendering…</span>';
    try {
      const { markup, bounds } = EX.buildSvg(this.renderer, this.store.doc, { ...o, background: o.format === 'jpg' || o.format === 'pdf' ? (o.background === 'transparent' ? 'white' : o.background) : o.background });
      const scale = Math.min(1.5, 420 / Math.max(bounds.w, 1));
      const canvas = await EX.toCanvas(markup, bounds, { scale, flatten: null });
      box.innerHTML = '';
      const img = h('img', { alt: 'Export preview' });
      img.src = canvas.toDataURL('image/png');
      box.append(img);
    } catch (err) {
      box.innerHTML = `<span class="muted">Preview failed: ${esc(err.message)}</span>`;
    }
  }
  async doExport(bodyEl) {
    const o = this.readExportOpts(bodyEl);
    const doc = this.store.doc;
    try {
      let r;
      if (o.format === 'svg') r = await EX.exportSvg(this.renderer, doc, o);
      else if (o.format === 'pdf') r = await EX.exportPdf(this.renderer, doc, o);
      else r = await EX.exportRaster(this.renderer, doc, o);
      this.closeModal();
      toast(`Exported ${o.format.toUpperCase()} (${fmtBytes(r.bytes)}${r.w ? `, ${r.w}×${r.h} px` : ''}${r.page ? `, page ${r.page}` : ''}).`, 'ok', 4200);
    } catch (err) {
      toast('Export failed: ' + err.message, 'err', 6000);
    }
  }
}

window.flowstate = new App();
void download; void lintCode; void SHAPE_ORDER; void LANGS; void THEMES; void toFile; void newEdge;
