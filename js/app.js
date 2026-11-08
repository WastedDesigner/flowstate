// FlowState — application wiring.
import { h, esc, debounce, toast, announce, fmtBytes, fmtWhen, modKey, clamp, uid, clone } from './util.js';
import { SHAPES, textBox } from './shapes.js';
import {
  newDoc, newNode, newEdge, nodeById, edgeById, docBounds, readFile, routeEdge,
  applyTheme, THEMES, THEME_KEYS, langLabel, DOC_VERSION, themeKey,
} from './model.js';
import { Store } from './store.js';
import { Renderer } from './render.js';
import { Interactions, isTyping } from './interact.js';
import { runChecks, issueMaps } from './validate.js';
import { lintDoc } from './lint.js';
import { freeSpot, autoLayout } from './layout.js';
import { TEMPLATES, buildTemplate } from './templates.js';
import { codeToDoc, fitNode } from './codeflow.js';
import { toMermaid, fromMermaid } from './mermaid.js';
import { buildPalette, buildTemplates, renderDesign, renderCode, renderChecks } from './panels.js';
import { openPopover, closePopover, renderCtxBar, wireCtxBar } from './ui.js';
import { icon, alignIcon, ALIGN_LABELS } from './icons.js';
import * as EX from './exporters.js';

const $ = (id) => document.getElementById(id);
const isDesktop = () => matchMedia('(min-width: 1000px)').matches;
const LEFT = ['add', 'templates', 'create'];
const SIDE_TITLES = { add: 'Elements', templates: 'Templates', create: 'Create' };

class App {
  constructor() {
    this.store = new Store();
    this.svg = $('canvas');
    this.renderer = new Renderer(this.svg, this.store);
    this.ia = new Interactions(this);
    this.issues = [];
    this.tab = 'design';
    this.panel = 'add';
    this.find = { q: '', ids: [], i: 0 };
    this.clip = null;
    this.pasteN = 0;
    this.exportOpts = { format: 'png', scale: 2, background: 'theme', padding: 32, quality: 0.92, grid: false };
    this.revalidate = debounce(() => this.runValidation(), 170);

    this.wireIcons();
    this.wireChrome();
    this.wireClipboard();
    this.wireKeys();
    wireCtxBar(this);
    buildPalette(this);
    buildTemplates(this);
    this.afterArm = () => { if (!isDesktop()) { $('leftRail').classList.add('collapsed'); this.updateDock(); toast('Now tap the canvas to place it.', '', 2200); } };
    this.store.on('change', () => this.afterChange());
    this.store.on('live', () => this.syncStatus());
    this.store.on('selection', () => this.onSelection());
    this.store.on('viewport', () => this.updateZoomLabel());
    this.store.on('savestate', (s) => this.setSaveState(s));
    this.store.on('saveerror', () => toast('Could not autosave — browser storage may be full. Use Backup to keep a copy.', 'err', 6000));
    window.addEventListener('resize', debounce(() => this.renderer.applyViewport(), 120));
    window.addEventListener('beforeunload', (e) => {
      if (this.store._saveState === 'saving') { e.preventDefault(); e.returnValue = ''; }
    });
    this.boot();
  }

  /* ================= boot ================= */
  boot() {
    let loaded = false;
    const last = this.store.lastId();
    const d = last && this.store.loadLocal(last);
    if (d) { this.store.setDoc(d); loaded = true; }
    if (!loaded) {
      const fresh = newDoc();
      fresh.settings.theme = themeKey(this.store.ui().theme);
      this.store.setDoc(fresh);
    }
    this.syncTheme();
    this.renderer.render();
    this.renderer.fit(docBounds(this.store.doc, 40));
    this.afterChange();
    this.renderAllPanes();
    if (isDesktop()) { this.setPanel('add', false); this.setTab('design'); }
    this.updateDock();
  }

  wireIcons() {
    const set = (id, name, size = 20) => { const el = $(id); if (el) el.innerHTML = icon(name, size); };
    set('btnMenu', 'menu'); set('btnUndo', 'undo'); set('btnRedo', 'redo'); set('btnTheme', 'theme'); set('btnHelp', 'help');
    document.querySelectorAll('[data-icon]').forEach((el) => {
      el.innerHTML = icon(el.dataset.icon, el.closest('.dock-btn') ? 22 : el.closest('.card') ? 24 : 18);
    });
  }

  /* ================= theme ================= */
  syncTheme() {
    const t = this.store.doc.settings.theme;
    if (document.documentElement.dataset.theme !== t) document.documentElement.dataset.theme = t;
    const meta = $('themeColor');
    if (meta) meta.content = (THEMES[t] || THEMES.midnight).ui;
  }
  setTheme(key) {
    if (!THEMES[key] || this.store.doc.settings.theme === key) return;
    this.renderer.nodeSig.clear();
    this.store.commit('Change theme', (d) => applyTheme(d, key));
    this.store.setUi({ theme: key });
    toast(`${THEMES[key].label} theme applied to every step. Undo brings the old colours back.`, 'ok', 3200);
  }

  /* ================= panels & dock ================= */
  setPanel(name, toggle = true) {
    const L = $('leftRail'), R = $('rightRail');
    if (LEFT.includes(name)) {
      const same = this.panel === name && !L.classList.contains('collapsed');
      if (same && toggle) L.classList.add('collapsed');
      else {
        this.panel = name;
        document.querySelectorAll('.side-pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === name));
        $('sideTitle').textContent = SIDE_TITLES[name];
        L.classList.remove('collapsed');
        if (!isDesktop()) R.classList.add('collapsed');
      }
    } else {
      const same = this.tab === name && !R.classList.contains('collapsed');
      if (same && toggle) R.classList.add('collapsed');
      else { this.setTab(name); if (!isDesktop()) L.classList.add('collapsed'); }
    }
    this.updateDock();
  }
  updateDock() {
    const L = $('leftRail'), R = $('rightRail');
    document.querySelectorAll('.dock-btn').forEach((b) => {
      const n = b.dataset.panel;
      const on = LEFT.includes(n) ? this.panel === n && !L.classList.contains('collapsed') : this.tab === n && !R.classList.contains('collapsed');
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    document.body.classList.toggle('sheet-open', !isDesktop() && (!L.classList.contains('collapsed') || !R.classList.contains('collapsed')));
  }
  setTab(name) {
    this.tab = name;
    document.querySelectorAll('.tab[data-tab]').forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('active', p.id === 'pane-' + name));
    $('rightRail').classList.remove('collapsed');
    if (!isDesktop()) $('leftRail').classList.add('collapsed');
    if (name === 'design') renderDesign(this);
    if (name === 'code') renderCode(this);
    if (name === 'checks') renderChecks(this);
    this.updateDock();
  }

  /* ================= chrome wiring ================= */
  wireChrome() {
    $('projName').addEventListener('input', (e) => {
      this.store.doc.name = e.target.value;
      this.store.touch('Rename', false);
    });
    $('btnUndo').onclick = () => this.undo();
    $('btnRedo').onclick = () => this.redo();
    $('btnMenu').onclick = (e) => openPopover(e.currentTarget, this.menuItems(), { width: 250 });
    $('btnTheme').onclick = (e) => openPopover(e.currentTarget, THEME_KEYS.map((k) => ({
      label: THEMES[k].label, checked: this.store.doc.settings.theme === k, onClick: () => this.setTheme(k),
      iconHtml: `<i class="tdot" style="background:${THEMES[k].bg};border-color:${THEMES[k].roles.step[1]}"></i>`,
    })), { width: 200 });
    $('btnHelp').onclick = () => this.openShortcuts();
    $('btnExport').onclick = () => this.openExport();
    $('btnArrange').onclick = (e) => openPopover(e.currentTarget, this.arrangeItems(), { width: 260 });
    document.querySelectorAll('.dock-btn').forEach((b) => b.onclick = () => this.setPanel(b.dataset.panel));
    document.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => {
      $(b.dataset.close === 'left' ? 'leftRail' : 'rightRail').classList.add('collapsed');
      this.updateDock();
    });
    for (const id of ['crBlank', 'esNew']) $(id).onclick = () => this.newBlank();
    for (const id of ['crCode', 'esCode']) $(id).onclick = () => this.openCodeToChart();
    for (const id of ['crMermaid', 'esMermaid']) $(id).onclick = () => this.openMermaid();
    for (const id of ['crImport', 'esImport']) $(id).onclick = () => this.pickImport();
    $('crProjects').onclick = () => this.openProjects();
    $('esTemplate').onclick = () => this.openTemplatePicker();

    document.querySelectorAll('.btn.tool').forEach((b) => b.onclick = () => { this.ia.setTool(b.dataset.tool); this.clearArmed?.(); });
    this.onToolChange = (t) => document.querySelectorAll('.btn.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    $('btnGrid').onclick = () => this.toggleSetting('grid');
    $('btnSnap').onclick = () => this.toggleSetting('snap');
    $('btnSearch').onclick = () => this.openSearch();
    $('btnZoomIn').onclick = () => this.renderer.setZoom(this.store.viewport.k * 1.25);
    $('btnZoomOut').onclick = () => this.renderer.setZoom(this.store.viewport.k / 1.25);
    $('btnZoomLevel').onclick = () => this.renderer.setZoom(1);
    $('btnFit').onclick = () => this.renderer.fit(docBounds(this.store.doc, 40));
    $('stDelete').onclick = () => this.deleteSelection();
    document.querySelectorAll('.tab[data-tab]').forEach((b) => b.onclick = () => this.setTab(b.dataset.tab));

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
      if (f) this.importFile(f);
    });
    window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
    window.addEventListener('drop', (e) => {
      const f = e.dataTransfer?.files?.[0];
      if (f && /\.json$/i.test(f.name)) { e.preventDefault(); this.importFile(f); }
    });
  }

  menuItems() {
    return [
      { label: 'New blank chart', icon: 'plus', onClick: () => this.newBlank() },
      { label: 'My projects', icon: 'folder', hint: 'Ctrl O', onClick: () => this.openProjects() },
      { label: 'Templates', icon: 'templates', onClick: () => this.openTemplatePicker() },
      { sep: true },
      { label: 'Code to flowchart', icon: 'code', onClick: () => this.openCodeToChart() },
      { label: 'Mermaid import / export', icon: 'graph', onClick: () => this.openMermaid() },
      { sep: true },
      { label: 'Open a backup (.json)', icon: 'upload', onClick: () => this.pickImport() },
      { label: 'Back up this chart', icon: 'download', hint: 'Ctrl S', onClick: () => this.backupJson() },
      { label: 'Back up all projects', icon: 'download', onClick: () => this.backupAll() },
      { sep: true },
      { label: 'Paste', icon: 'paste', onClick: () => this.pasteFromMenu() },
      { label: 'Keyboard shortcuts', icon: 'help', hint: '?', onClick: () => this.openShortcuts() },
    ];
  }
  arrangeItems() {
    const many = this.store.selNodes.size > 1;
    const items = [
      { label: 'Auto layout, top to bottom', icon: 'layout', onClick: () => this.autoLayout('TB') },
      { label: 'Auto layout, left to right', icon: 'layout', onClick: () => this.autoLayout('LR') },
      { label: 'Smart align', icon: 'layout', onClick: () => this.smartAlign() },
      { label: 'Snap positions to grid', icon: 'grid', onClick: () => this.tidy() },
      { label: 'Fit text (selected steps)', icon: 'fit', onClick: () => this.fitToText() },
      { sep: true },
      { label: 'Add a swimlane', icon: 'lane', onClick: () => this.addLane() },
    ];
    if (many) {
      items.push({ sep: true }, { label: 'Group', icon: 'group', hint: 'Ctrl G', onClick: () => this.groupSelection(true) }, { sep: true });
      for (const k of ['left', 'cx', 'right', 'top', 'cy', 'bottom', 'dh', 'dv']) items.push({ label: ALIGN_LABELS[k], iconHtml: alignIcon(k), onClick: () => this.align(k) });
    }
    return items;
  }

  toggleSetting(key) {
    this.store.commit(key === 'grid' ? 'Grid' : 'Snapping', (d) => { d.settings[key] = !d.settings[key]; });
    this.renderer.applyTheme();
    this.refreshChrome();
  }
  refreshChrome() {
    const s = this.store.doc.settings;
    $('btnGrid').classList.toggle('on', !!s.grid);
    $('btnSnap').classList.toggle('on', !!s.snap);
    $('btnUndo').disabled = !this.store.canUndo();
    $('btnRedo').disabled = !this.store.canRedo();
    $('btnUndo').title = this.store.canUndo() ? `Undo ${this.store.undoLabel()} (Ctrl+Z)` : 'Nothing to undo';
    $('btnRedo').title = this.store.canRedo() ? `Redo ${this.store.redoLabel()} (Ctrl+Shift+Z)` : 'Nothing to redo';
    const nameInput = $('projName');
    if (nameInput.value !== this.store.doc.name && document.activeElement !== nameInput) nameInput.value = this.store.doc.name;
  }
  updateZoomLabel() { $('btnZoomLevel').textContent = Math.round(this.store.viewport.k * 100) + '%'; }
  setSaveState(s) {
    const el = $('stSave');
    el.className = s === 'saving' ? 'saving' : s === 'saved' ? 'saved' : 'muted';
    el.textContent = !this.store.doc.settings.autosave ? 'Autosave off' : s === 'saving' ? 'Saving…' : s === 'error' ? 'Save failed' : 'Saved ' + fmtWhen(this.store.doc.updatedAt);
  }

  /* ================= reactions ================= */
  afterChange() {
    this.syncTheme();
    this.renderer.render();
    this.refreshChrome();
    this.syncStatus();
    this.revalidate();
    $('emptyState').hidden = this.store.doc.nodes.length > 0;
    const inRail = $('rightRail').contains(document.activeElement);
    if (this.tab === 'design' && !inRail) renderDesign(this);
    renderCtxBar(this);
  }
  onSelection() {
    this.renderer.decorate();
    this.syncStatus();
    renderDesign(this);
    if (this.tab === 'code') renderCode(this);
    renderCtxBar(this);
  }
  renderAllPanes() { renderDesign(this); renderCode(this); renderChecks(this); }
  syncStatus() {
    const d = this.store.doc;
    $('stCounts').textContent = `${d.nodes.length} step${d.nodes.length === 1 ? '' : 's'} · ${d.edges.length} connection${d.edges.length === 1 ? '' : 's'}`;
    const ns = this.store.selNodes.size, es = this.store.selEdges.size;
    let sel = 'Nothing selected';
    if (ns === 1 && !es) {
      const n = this.store.selectedNodes()[0];
      sel = `${SHAPES[n.type].label.replace('\n', ' ')} · ${Math.round(n.w)}×${Math.round(n.h)} at ${Math.round(n.x)},${Math.round(n.y)}`;
    } else if (ns || es) sel = `${ns ? ns + ' step' + (ns === 1 ? '' : 's') : ''}${ns && es ? ' + ' : ''}${es ? es + ' connection' + (es === 1 ? '' : 's') : ''} selected`;
    $('stSel').textContent = sel;
    const del = $('stDelete');
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
    for (const id of ['checkPill', 'dockPill']) {
      const pill = $(id);
      pill.textContent = errs + warns;
      pill.className = 'pill ' + (errs ? 'err' : warns ? 'warn' : 'ok');
    }
    const st = $('stChecks');
    st.textContent = !this.store.doc.nodes.length ? 'Checks: —'
      : errs || warns ? `Checks: ${errs} error${errs === 1 ? '' : 's'}, ${warns} warning${warns === 1 ? '' : 's'}`
        : 'Checks: all clear';
    st.className = errs ? '' : 'muted';
    st.style.color = errs ? 'var(--err)' : warns ? 'var(--warn)' : '';
    if (this.tab === 'checks') renderChecks(this);
  }

  /* ================= editing ================= */
  addNodeAt(type, x, y, center = false, edit = false) {
    if (!SHAPES[type]) return;
    const def = SHAPES[type];
    let px = center ? x - def.size[0] / 2 : x;
    let py = center ? y - def.size[1] / 2 : y;
    const g = this.store.doc.settings.snap ? this.store.doc.settings.gridSize : 1;
    px = Math.round(px / g) * g; py = Math.round(py / g) * g;
    const spot = type === 'lane' ? { x: px, y: py } : freeSpot(this.store.doc, px, py, def.size[0], def.size[1]);
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
  addLane() { this.addNodeAt('lane', ...this.viewCenter(), true, true); }
  connect(fromId, toId, fromPort = 'auto') {
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
    const def = SHAPES.process;
    const g = this.store.doc.settings.snap ? this.store.doc.settings.gridSize : 1;
    const spot = freeSpot(this.store.doc, Math.round((x - def.size[0] / 2) / g) * g, Math.round((y - def.size[1] / 2) / g) * g, def.size[0], def.size[1]);
    let n, e;
    this.store.commit('Add connected step', (d) => {
      n = newNode('process', spot.x, spot.y, d.settings, '');
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
    const layer = $('editorLayer');
    const r = this.svg.getBoundingClientRect();
    const k = this.store.viewport.k;
    const st = n.style || {};
    const grow = n.type !== 'lane';
    const ta = h('textarea', {
      class: 'node-editor', spellcheck: 'false', 'aria-label': 'Step text',
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
        this.store.commit('Edit text', () => { const t = nodeById(this.store.doc, id); if (t) { t.text = val; if (grow) fitNode(t); } });
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
      if (grow) fitNode(n);
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
    const inp = h('input', {
      class: 'edge-editor', type: 'text', 'aria-label': 'Connection label', placeholder: 'e.g. Yes',
      style: `left:${mid.x - r.left - 65}px;top:${mid.y - r.top - 15}px;width:130px`,
    });
    inp.value = e.label || '';
    $('editorLayer').append(inp);
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
    inp.addEventListener('input', () => { e.label = inp.value; this.renderer.patchEdges([id]); });
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

  /** Copy nodes (and the connections between them) into a document, shifted by `offset`; groups get fresh ids. */
  cloneInto(d, nodes, edges, offset) {
    const map = new Map(), gmap = new Map(), made = [];
    for (const n of nodes) {
      const c = clone(n);
      c.id = uid('n');
      if (c.group) { if (!gmap.has(c.group)) gmap.set(c.group, uid('g')); c.group = gmap.get(c.group); }
      c.x = Math.round(n.x + offset); c.y = Math.round(n.y + offset);
      map.set(n.id, c.id);
      d.nodes.push(c);
      made.push(c.id);
    }
    for (const e of edges) {
      if (!map.has(e.from) || !map.has(e.to)) continue;
      const c = clone(e);
      c.id = uid('e'); c.from = map.get(e.from); c.to = map.get(e.to);
      d.edges.push(c);
    }
    return made;
  }
  selectionEdges() {
    const ids = this.store.selNodes;
    return this.store.doc.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  }
  duplicateSelection() {
    const sel = this.store.selectedNodes();
    if (!sel.length) return;
    let made;
    this.store.commit('Duplicate', (d) => { made = this.cloneInto(d, sel, this.selectionEdges(), 40); });
    this.store.select(made, []);
  }

  /* ---- clipboard: Ctrl+C / X / V also work across tabs because the payload is JSON text ---- */
  clipPayload() {
    const nodes = this.store.selectedNodes();
    if (!nodes.length) return null;
    return { kind: 'flowstate.clip', v: 1, nodes: clone(nodes), edges: clone(this.selectionEdges()) };
  }
  pasteClip(p) {
    if (!p || p.kind !== 'flowstate.clip' || !Array.isArray(p.nodes) || !p.nodes.length) return false;
    this.pasteN++;
    let made;
    this.store.commit('Paste', (d) => { made = this.cloneInto(d, p.nodes, p.edges || [], 40 * this.pasteN); });
    this.store.select(made, []);
    toast(`Pasted ${made.length} step${made.length === 1 ? '' : 's'}.`, 'ok', 1800);
    return true;
  }
  copySelection(cut = false) {
    const p = this.clipPayload();
    if (!p) { toast('Select something first.', 'warn', 1800); return; }
    this.clip = p; this.pasteN = 0;
    navigator.clipboard?.writeText(JSON.stringify(p)).catch(() => {});
    if (cut) this.deleteSelection();
    toast(cut ? 'Cut.' : 'Copied.', 'ok', 1400);
  }
  async pasteFromMenu() {
    let p = null;
    try { p = JSON.parse(await navigator.clipboard.readText()); } catch {}
    if (!this.pasteClip(p) && !this.pasteClip(this.clip)) toast('Nothing to paste yet. Copy some steps first.', 'warn', 2200);
  }
  wireClipboard() {
    const live = (e) => !this.editor && !isTyping(e.target) && !document.querySelector('.backdrop');
    window.addEventListener('copy', (e) => {
      if (!live(e)) return;
      const p = this.clipPayload();
      if (!p) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', JSON.stringify(p));
      this.clip = p; this.pasteN = 0;
      toast('Copied.', 'ok', 1200);
    });
    window.addEventListener('cut', (e) => {
      if (!live(e)) return;
      const p = this.clipPayload();
      if (!p) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', JSON.stringify(p));
      this.clip = p; this.pasteN = 0;
      this.deleteSelection();
    });
    window.addEventListener('paste', (e) => {
      if (!live(e)) return;
      let p = null;
      try { p = JSON.parse(e.clipboardData.getData('text/plain')); } catch {}
      if (p?.kind === 'flowstate.clip') { e.preventDefault(); this.pasteClip(p); }
      else if (this.clip && !e.clipboardData.getData('text/plain')) { e.preventDefault(); this.pasteClip(this.clip); }
    });
  }

  /* ---- groups ---- */
  groupSelection(on) {
    const sel = this.store.selectedNodes();
    if (on) {
      if (sel.length < 2) { toast('Select two or more steps to group them.', 'warn'); return; }
      const gid = uid('g');
      this.store.commit('Group', () => { for (const n of sel) n.group = gid; });
      toast('Grouped. They now move and select together.', 'ok', 2000);
    } else {
      this.store.commit('Ungroup', () => { for (const n of sel) delete n.group; });
    }
    this.renderer.decorate();
    renderCtxBar(this);
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
    const nodes = (sel.length >= 2 ? sel : this.store.doc.nodes).filter((n) => n.type !== 'lane');
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
  autoLayout(dir) {
    const d = this.store.doc;
    if (d.nodes.filter((n) => n.type !== 'lane' && n.type !== 'note').length < 2) { toast('Add a few connected steps first.', 'warn'); return; }
    this.store.commit('Auto layout', (doc) => autoLayout(doc, dir));
    this.renderer.fit(docBounds(this.store.doc, 40));
    toast(d.nodes.some((n) => n.type === 'lane') ? 'Laid out. Swimlanes stay where they are, so move them to fit.' : 'Chart laid out.', 'ok', 2600);
  }
  tidy() {
    const d = this.store.doc;
    if (!d.nodes.length) return;
    const g = d.settings.gridSize || 10;
    this.store.commit('Tidy up spacing', () => {
      for (const n of d.nodes) { n.x = Math.round(n.x / g) * g; n.y = Math.round(n.y / g) * g; }
      for (let i = 0; i < d.nodes.length; i++) {
        for (let j = i + 1; j < d.nodes.length; j++) {
          const a = d.nodes[i], b = d.nodes[j];
          if (a.type !== 'lane' && b.type !== 'lane' && a.x === b.x && a.y === b.y) { b.x += 40; b.y += 40; }
        }
      }
    });
    toast('Positions snapped to the grid.', 'ok');
  }
  fitToText() {
    const sel = this.store.selectedNodes().filter((n) => n.type !== 'lane');
    if (!sel.length) { toast('Select the steps you want to resize first.', 'warn', 2200); return; }
    this.store.commit('Fit to text', () => { for (const n of sel) fitNode(n, true); });
  }

  /* ================= checks actions ================= */
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

  /* ================= panel actions ================= */
  panelAction(act) {
    const sel = this.store.selectedNodes();
    switch (act) {
      case 'del': case 'delEdge': this.deleteSelection(); break;
      case 'dupe': this.duplicateSelection(); break;
      case 'fitText': this.fitToText(); break;
      case 'group': this.groupSelection(true); break;
      case 'ungroup': this.groupSelection(false); break;
      case 'layoutTB': this.autoLayout('TB'); break;
      case 'layoutLR': this.autoLayout('LR'); break;
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
            if (!d.edges.some((e) => e.from === order[i].id && e.to === order[i + 1].id)) d.edges.push(newEdge(order[i].id, order[i + 1].id, d.settings));
          }
        });
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
    }
  }
  focusNode(id) {
    const n = nodeById(this.store.doc, id);
    if (!n) return;
    this.store.select([id], []);
    this.renderer.centerOn(n);
  }

  /* ================= search ================= */
  openSearch() {
    $('searchBar').hidden = false;
    const i = $('searchInput');
    i.focus(); i.select();
    if (i.value) this.runSearch(i.value);
  }
  closeSearch() {
    $('searchBar').hidden = true;
    this.renderer.setFind([], null);
    this.svg.focus({ preventScroll: true });
  }
  runSearch(q) {
    const term = q.trim().toLowerCase();
    this.find.q = term;
    if (!term) { this.find.ids = []; this.renderer.setFind([], null); $('searchCount').textContent = '0'; return; }
    const d = this.store.doc;
    const ids = [];
    for (const n of d.nodes) {
      const hay = [n.text, n.code?.source, SHAPES[n.type].label, langLabel(n.code?.lang)].join(' ').toLowerCase();
      if (hay.includes(term)) ids.push(n.id);
    }
    for (const e of d.edges) if ((e.label || '').toLowerCase().includes(term) && !ids.includes(e.from)) ids.push(e.from);
    this.find.ids = ids;
    this.find.i = 0;
    $('searchCount').textContent = ids.length ? `1 / ${ids.length}` : 'none';
    this.renderer.setFind(ids, ids[0]);
    if (ids.length) { const n = nodeById(d, ids[0]); if (n) this.renderer.centerOn(n); }
  }
  stepSearch(dir) {
    const { ids } = this.find;
    if (!ids.length) return;
    this.find.i = (this.find.i + dir + ids.length) % ids.length;
    const id = ids[this.find.i];
    $('searchCount').textContent = `${this.find.i + 1} / ${ids.length}`;
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
      const key = e.key.toLowerCase();
      if (typing && !(mod && ['s', 'e', 'o', 'f'].includes(key))) return;

      if (mod && key === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
      if (mod && key === 'y') { e.preventDefault(); this.redo(); return; }
      if (mod && key === 's') { e.preventDefault(); this.backupJson(); return; }
      if (mod && key === 'e') { e.preventDefault(); this.openExport(); return; }
      if (mod && key === 'o') { e.preventDefault(); this.openProjects(); return; }
      if (mod && key === 'f') { e.preventDefault(); this.openSearch(); return; }
      if (mod && key === 'a') { e.preventDefault(); this.store.select(this.store.doc.nodes.map((n) => n.id), this.store.doc.edges.map((x) => x.id)); return; }
      if (mod && key === 'd') { e.preventDefault(); this.duplicateSelection(); return; }
      if (mod && key === 'g') { e.preventDefault(); this.groupSelection(!e.shiftKey); return; }
      if (mod && (e.key === '0')) { e.preventDefault(); this.renderer.setZoom(1); return; }
      if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); this.renderer.setZoom(this.store.viewport.k * 1.25); return; }
      if (mod && e.key === '-') { e.preventDefault(); this.renderer.setZoom(this.store.viewport.k / 1.25); return; }
      if (typing) return;

      if (e.key === 'Escape') {
        if (!$('searchBar').hidden) this.closeSearch();
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
      if (e.key === '1' && e.shiftKey) { e.preventDefault(); this.renderer.fit(docBounds(this.store.doc, 40)); return; }
      if (!e.shiftKey && !e.altKey) {
        if (key === 'v') { this.ia.setTool('select'); return; }
        if (key === 'h') { this.ia.setTool('pan'); return; }
        if (key === 'c') { this.ia.setTool('connect'); return; }
        if (key === 'g') { this.toggleSetting('grid'); return; }
        if (key === 'n') { this.store.doc.nodes.length ? this.addNodeAt('process', ...this.viewCenter(), true, true) : this.openTemplate('starter'); return; }
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
    const { w, h: hh } = this.renderer.size();
    const r = this.svg.getBoundingClientRect();
    const p = this.renderer.screenToWorld(r.left + w / 2, r.top + hh / 2);
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
    const hasNode = this.store.selNodes.size > 0, hasEdge = this.store.selEdges.size > 0;
    const sel = this.store.selectedNodes();
    const grouped = hasNode && sel.every((n) => n.group && n.group === sel[0].group);
    const items = [];
    if (hasNode) items.push({ label: 'Edit text', icon: 'pencil', hint: 'Enter', onClick: () => this.editNodeText([...this.store.selNodes][0]) });
    if (hasEdge && !hasNode) items.push({ label: 'Edit label', icon: 'pencil', hint: 'Enter', onClick: () => this.editEdgeLabel([...this.store.selEdges][0]) });
    if (hasNode) items.push(
      { label: 'Duplicate', icon: 'copy', hint: 'Ctrl D', onClick: () => this.duplicateSelection() },
      { label: 'Copy', icon: 'copy', hint: 'Ctrl C', onClick: () => this.copySelection() },
      { label: 'Cut', icon: 'copy', hint: 'Ctrl X', onClick: () => this.copySelection(true) },
    );
    items.push({ label: 'Paste', icon: 'paste', hint: 'Ctrl V', onClick: () => this.pasteFromMenu() });
    if (this.store.selNodes.size > 1 || grouped) items.push({ label: grouped ? 'Ungroup' : 'Group', icon: grouped ? 'ungroup' : 'group', hint: 'Ctrl G', onClick: () => this.groupSelection(!grouped) });
    if (hasNode) items.push({ label: 'Attach code', icon: 'code', onClick: () => this.setTab('code') });
    if (hasEdge) items.push({ label: 'Reverse direction', icon: 'flip', onClick: () => this.panelAction('flip') });
    items.push({ sep: true }, { label: 'Delete', icon: 'trash', hint: 'Del', danger: true, onClick: () => this.deleteSelection() });
    openPopover({ x, y }, items, { width: 210 });
  }
  hideContextMenu() { closePopover(); }

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
      h('header', {}, h('h2', {}, title), h('button', { class: 'btn icon ghost push', 'aria-label': 'Close', html: icon('close'), onclick: () => this.closeModal() })),
      bodyEl, footer);
    const back = h('div', { class: 'backdrop', onclick: (e) => { if (e.target === back) this.closeModal(); } }, modal);
    $('modals').append(back);
    this._modal = back;
    onMount?.(modal, bodyEl);
    modal.querySelector('input,select,textarea,button:not(.ghost)')?.focus({ preventScroll: true });
    return modal;
  }
  closeModal() { this._modal?.remove(); this._modal = null; }

  openShortcuts() {
    const rows = [
      ['Select tool', 'V'], ['Pan tool / hold', 'H / Space'], ['Connect tool', 'C'],
      ['New step at centre', 'N'], ['Edit text', 'Enter or F2'], ['Finish editing', 'Enter'],
      ['Cancel editing', 'Esc'], ['Delete selection', 'Delete'], ['Duplicate', 'Ctrl D'],
      ['Copy / Cut / Paste', 'Ctrl C / X / V'], ['Group / Ungroup', 'Ctrl G / Ctrl Shift G'],
      ['Select all', 'Ctrl A'], ['Undo / Redo', 'Ctrl Z / Ctrl Shift Z'],
      ['Move selection', 'Arrow keys'], ['Move further', 'Shift + Arrows'],
      ['Walk the flow', 'Alt + Arrows'], ['Next step', 'Tab'],
      ['Zoom', 'Ctrl + scroll'], ['Zoom in / out', 'Ctrl + / Ctrl -'], ['Reset zoom', 'Ctrl 0'],
      ['Fit to view', 'Shift 1'], ['Grid on/off', 'G'],
      ['Find in chart', 'Ctrl F'], ['Backup .json', 'Ctrl S'], ['Export', 'Ctrl E'],
      ['Projects', 'Ctrl O'], ['This list', '?'],
    ];
    this.openModal({
      title: 'Keyboard shortcuts', wide: true,
      body: `<div class="keys">${rows.map(([a, b]) => `<div><span>${esc(a)}</span><span>${b.split(' ').map((k) => `<kbd>${esc(k)}</kbd>`).join(' ')}</span></div>`).join('')}</div>
        <p class="muted" style="margin-top:14px;font-size:12.5px">On a touch screen: drag with one finger to pan, pinch to zoom, double-tap to add or edit a step. Drag the dots on a selected step to connect it; drop on empty canvas and the next step is created for you. Hold <kbd>Alt</kbd> while dragging to ignore snapping.</p>`,
      actions: [{ label: 'Close', primary: true, onClick: () => this.closeModal() }],
    });
  }

  openTemplatePicker() {
    this.openModal({
      title: 'Start from a template', wide: true,
      body: `<div class="grid2">${TEMPLATES.map((t) => `<button class="tpl" data-t="${t.id}"><b>${esc(t.name)}</b><span>${esc(t.desc)}</span></button>`).join('')}</div>
        <p class="muted" style="margin-top:12px;font-size:12px">A template opens as a new project, so your current chart is left untouched.</p>`,
      actions: [{ label: 'Cancel', onClick: () => this.closeModal() }],
      onMount: (m) => m.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { this.closeModal(); this.openTemplate(b.dataset.t); }),
    });
  }
  openTemplate(id) {
    const d = buildTemplate(id, this.store.doc.settings);
    if (!d) return;
    this.adoptDoc(d);
    if (!isDesktop()) { $('leftRail').classList.add('collapsed'); this.updateDock(); }
    toast(`Opened the "${d.name}" template as a new project.`, 'ok');
  }

  openCodeToChart() {
    const samples = {
      py: 'def make_tea(strength):\n    boil_water()\n    while not water_boiled:\n        wait()\n    if strength > 3:\n        add("two bags")\n    elif strength > 1:\n        add("one bag")\n    else:\n        add("no bags")\n    print("Done")\n',
      js: 'function makeTea(strength) {\n  boilWater();\n  while (!waterBoiled) {\n    wait();\n  }\n  if (strength > 3) {\n    add("two bags");\n  } else if (strength > 1) {\n    add("one bag");\n  } else {\n    add("no bags");\n  }\n  console.log("Done");\n}\n',
    };
    const body = h('div', {});
    body.innerHTML = `<div class="tabrow"><button class="btn on" data-l="py">Python</button><button class="btn" data-l="js">JavaScript</button></div>
      <p class="muted" style="margin:0 0 8px;font-size:12.5px"><b>if / else</b>, <b>while</b>, <b>for</b>, functions, <b>break</b>, <b>continue</b>, <b>return</b> and <b>input / print</b> become shapes; other lines become steps. It opens as a new project.</p>
      <textarea id="codeSrc" class="codebox" spellcheck="false"></textarea>
      <p id="codeMsg" class="muted" style="margin:8px 0 0;font-size:12.5px" aria-live="polite"></p>`;
    let lang = 'py';
    this.openModal({
      title: 'Code to flowchart', wide: true, body,
      actions: [
        { label: 'Cancel', onClick: () => this.closeModal() },
        { label: 'Generate flowchart', primary: true, onClick: (m) => {
          const { doc, warnings } = codeToDoc(m.querySelector('#codeSrc').value, this.store.doc.settings, 'From code', lang);
          if (!doc) { m.querySelector('#codeMsg').textContent = warnings[0]; return; }
          this.closeModal();
          this.adoptDoc(doc);
          toast(warnings.length ? 'Chart generated. ' + warnings.join(' ') : 'Chart generated from your code.', warnings.length ? 'warn' : 'ok');
        } },
      ],
      onMount: (m) => {
        const ta = m.querySelector('#codeSrc');
        ta.value = samples.py;
        m.querySelectorAll('[data-l]').forEach((b) => b.onclick = () => {
          const was = samples[lang];
          lang = b.dataset.l;
          m.querySelectorAll('[data-l]').forEach((x) => x.classList.toggle('on', x === b));
          if (!ta.value.trim() || ta.value === was) ta.value = samples[lang];
        });
        ta.addEventListener('keydown', (e) => {
          if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '    '); }
          else e.stopPropagation();
        });
      },
    });
  }

  openMermaid() {
    const sample = 'flowchart TD\n  A([Start]) --> B[Read the order]\n  B --> C{In stock?}\n  C -->|Yes| D[Ship it]\n  C -->|No| E[Back-order]\n  D --> F([End])\n  E --> F\n';
    const body = h('div', {});
    body.innerHTML = `<div class="tabrow"><button class="btn on" data-m="in">Import</button><button class="btn" data-m="out">Export this chart</button></div>
      <div data-view="in"><p class="muted" style="margin:0 0 8px;font-size:12.5px">Paste Mermaid <b>flowchart</b> text. Shapes, labels, dotted links and subgraphs (as swimlanes) are kept, and the chart is laid out for you. It opens as a new project.</p>
        <textarea id="mmIn" class="codebox" spellcheck="false" placeholder="flowchart TD&#10;  A[Start] --> B[Next]"></textarea>
        <p id="mmMsg" class="muted" style="margin:8px 0 0;font-size:12.5px" aria-live="polite"></p></div>
      <div data-view="out" hidden><p class="muted" style="margin:0 0 8px;font-size:12.5px">The current chart as Mermaid text. Paste it into GitHub, Notion, Obsidian or any Mermaid editor.</p>
        <textarea id="mmOut" class="codebox" readonly spellcheck="false"></textarea></div>`;
    this.openModal({
      title: 'Mermaid', wide: true, body,
      actions: [
        { label: 'Close', onClick: () => this.closeModal() },
        { label: 'Copy', onClick: async (m) => {
          const v = m.querySelector('[data-view="out"]').hidden ? m.querySelector('#mmIn').value : m.querySelector('#mmOut').value;
          try { await navigator.clipboard.writeText(v); toast('Copied.', 'ok', 1400); } catch { toast('Select the text and copy it.', 'warn'); }
        } },
        { label: 'Open as new chart', primary: true, onClick: (m) => {
          const { doc, warnings } = fromMermaid(m.querySelector('#mmIn').value, this.store.doc.settings, 'From Mermaid');
          if (!doc) { m.querySelector('#mmMsg').textContent = warnings[0]; return; }
          this.closeModal();
          this.adoptDoc(doc);
          toast(warnings.length ? `Imported with ${warnings.length} skipped line${warnings.length > 1 ? 's' : ''}.` : 'Imported from Mermaid.', warnings.length ? 'warn' : 'ok');
        } },
      ],
      onMount: (m) => {
        m.querySelector('#mmIn').value = this.store.doc.nodes.length ? '' : sample;
        m.querySelector('#mmOut').value = toMermaid(this.store.doc);
        m.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => {
          m.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x === b));
          m.querySelectorAll('[data-view]').forEach((v) => (v.hidden = v.dataset.view !== b.dataset.m));
        });
        m.querySelector('#mmIn').addEventListener('keydown', (e) => e.stopPropagation());
        if (this.store.doc.nodes.length) m.querySelector('[data-m="out"]').click();
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
        <button class="btn" data-imp>Open a backup</button>
        <button class="btn" data-all>Back up all</button>
      </div>
      ${list.length ? `<div class="plist">${list.map((p) => `
        <div class="pitem ${p.id === cur ? 'cur' : ''}">
          <div class="meta"><b>${esc(p.name || 'Untitled')}</b><span>${p.nodes || 0} steps · ${p.edges || 0} connections · saved ${esc(fmtWhen(p.updatedAt))}${p.id === cur ? ' · open now' : ''}</span></div>
          <button class="btn" data-open="${p.id}" ${p.id === cur ? 'disabled' : ''}>Open</button>
          <button class="btn icon" data-dup="${p.id}" title="Duplicate" aria-label="Duplicate">${icon('copy', 18)}</button>
          <button class="btn icon danger" data-del="${p.id}" title="Delete" aria-label="Delete">${icon('trash', 18)}</button>
        </div>`).join('')}</div>`
        : `<div class="empty-note">No saved projects yet. Everything you draw is autosaved here in this browser.</div>`}
      <p class="muted" style="font-size:11.5px;margin-top:12px">Projects live in this browser's local storage. <b>Back up all</b> saves every project into one <code>.json</code> file you can keep or move to another machine, and opening that file restores them.</p>`;
    this.openModal({
      title: 'Projects', wide: true, body,
      actions: [{ label: 'Close', onClick: () => this.closeModal() }],
      onMount: (m) => {
        m.querySelector('[data-new]').onclick = () => { this.closeModal(); this.newBlank(); };
        m.querySelector('[data-tpl]').onclick = () => { this.closeModal(); this.openTemplatePicker(); };
        m.querySelector('[data-imp]').onclick = () => { this.closeModal(); this.pickImport(); };
        m.querySelector('[data-all]').onclick = () => this.backupAll();
        m.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => {
          const d = this.store.loadLocal(b.dataset.open);
          if (!d) { toast('That project could not be read.', 'err'); return; }
          this.closeModal();
          this.adoptDoc(d);
        });
        m.querySelectorAll('[data-dup]').forEach((b) => b.onclick = () => {
          if (this.store.duplicateLocal(b.dataset.dup)) { this.closeModal(); this.openProjects(); toast('Duplicated.', 'ok'); }
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
  /** New blank chart, with the name field ready so the first thing you do is name it. */
  newBlank() {
    this.newProject();
    if (!isDesktop()) { $('leftRail').classList.add('collapsed'); this.updateDock(); }
    const name = $('projName');
    name.focus(); name.select();
    toast('Blank chart ready. Name it, then double-tap the canvas to add a step.', 'ok', 3200);
  }

  /* ================= backup / import ================= */
  backupJson() {
    const r = EX.exportJson(this.store.doc);
    toast(`Backup saved (${fmtBytes(r.bytes)}, format v${DOC_VERSION}).`, 'ok');
  }
  backupAll() {
    this.store.saveLocal();
    const docs = this.store.index().map((p) => this.store.loadLocal(p.id)).filter(Boolean);
    if (!docs.length) { toast('There are no saved projects yet.', 'warn'); return; }
    const r = EX.exportBundle(docs);
    toast(`Saved ${r.count} project${r.count === 1 ? '' : 's'} (${fmtBytes(r.bytes)}).`, 'ok');
  }
  pickImport() { $('filePicker').click(); }

  /** A fresh document: swap the editor over to it and refit the view. */
  adoptDoc(doc) {
    this.store.setDoc(doc);
    this.renderer.nodeSig.clear();
    this.renderer.render();
    this.renderer.fit(docBounds(doc, 40));
    this.afterChange();
    this.renderAllPanes();
  }
  async importFile(file) {
    if (file.size > 40 * 1024 * 1024) { toast('That file is too large to be a FlowState backup.', 'err', 5000); return; }
    let text;
    try { text = await file.text(); }
    catch { toast('The file could not be read.', 'err'); return; }
    let obj = null;
    try { obj = JSON.parse(text); } catch {}
    if (obj?.kind === 'flowstate.bundle' && Array.isArray(obj.docs)) {
      let n = 0;
      for (const raw of obj.docs) {
        const res = readFile(raw);
        if (!res.ok) continue;
        if (this.store.index().some((p) => p.id === res.doc.id)) res.doc.id = uid('doc');   // never overwrite newer work
        this.store.putLocal(res.doc);
        n++;
      }
      toast(n ? `Restored ${n} project${n === 1 ? '' : 's'} from the backup.` : 'That backup held no readable projects.', n ? 'ok' : 'err', 4000);
      if (n) this.openProjects();
      return;
    }
    this.showImportReport(readFile(text), file.name);
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
      this.adoptDoc(d);
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

  /* ================= export ================= */
  openExport() {
    if (!this.store.doc.nodes.length) { toast('There is nothing to export yet.', 'warn'); return; }
    const o = this.exportOpts;
    const body = h('div', {});
    body.innerHTML = `
      <div class="row"><label for="xFmt">Format</label><select id="xFmt" class="grow">
        <option value="png">PNG — lossless, transparent background possible</option>
        <option value="jpg">JPG — smaller, always opaque</option>
        <option value="svg">SVG — vector, stays sharp at any size</option>
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
      <div class="row"><label for="xGrid">Include grid</label><input type="checkbox" id="xGrid" style="width:auto"></div>
      <p class="muted" id="xInfo" style="font-size:12px;margin:8px 0 0"></p>
      <div class="preview-box" id="xPrev" style="margin-top:12px"><span class="muted">Preview appears here</span></div>
      <p class="muted" style="font-size:11.5px;margin-bottom:0">Fonts are referenced by name, not embedded. PNG and JPG are rendered from the vector drawing, so they stay crisp.</p>`;
    this.openModal({
      title: 'Export', wide: true, body,
      actions: [
        { label: 'Preview', onClick: () => this.exportPreview(body) },
        { label: 'Cancel', onClick: () => this.closeModal() },
        { label: 'Download', primary: true, onClick: () => this.doExport(body) },
      ],
      onMount: (m, bodyEl) => {
        bodyEl.querySelector('#xFmt').value = o.format === 'pdf' ? 'png' : o.format;
        bodyEl.querySelector('#xScale').value = String(o.scale);
        bodyEl.querySelector('#xBg').value = o.background;
        bodyEl.querySelector('#xGrid').checked = !!o.grid;
        const sync = () => {
          const f = bodyEl.querySelector('#xFmt').value;
          bodyEl.querySelector('#rScale').style.display = f === 'svg' ? 'none' : '';
          bodyEl.querySelector('#rQual').style.display = f === 'jpg' ? '' : 'none';
          const bgSel = bodyEl.querySelector('#xBg');
          const noAlpha = f === 'jpg';
          bgSel.querySelector('[value=transparent]').disabled = noAlpha;
          if (noAlpha && bgSel.value === 'transparent') bgSel.value = 'white';
          this.readExportOpts(bodyEl);
          const bb = docBounds(this.store.doc, this.exportOpts.padding);
          const px = f === 'svg' ? `${Math.round(bb.w)} × ${Math.round(bb.h)} units` : `${Math.round(bb.w * this.exportOpts.scale)} × ${Math.round(bb.h * this.exportOpts.scale)} pixels`;
          bodyEl.querySelector('#xInfo').textContent = `Output: ${px}${noAlpha ? ' · transparency is not available in JPG' : ''}`;
        };
        bodyEl.addEventListener('change', sync);
        bodyEl.addEventListener('input', (e) => {
          if (e.target.id === 'xQ') bodyEl.querySelector('#xQv').textContent = Math.round(e.target.value * 100) + '%';
          sync();
        });
        sync();
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
      grid: g('xGrid').checked,
    };
    return this.exportOpts;
  }
  async exportPreview(bodyEl) {
    const o = this.readExportOpts(bodyEl);
    const box = bodyEl.querySelector('#xPrev');
    box.innerHTML = '<span class="muted">Rendering…</span>';
    try {
      const { markup, bounds } = EX.buildSvg(this.renderer, this.store.doc, { ...o, background: o.format === 'jpg' ? (o.background === 'transparent' ? 'white' : o.background) : o.background });
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
    try {
      const r = o.format === 'svg' ? await EX.exportSvg(this.renderer, this.store.doc, o) : await EX.exportRaster(this.renderer, this.store.doc, o);
      this.closeModal();
      toast(`Exported ${o.format.toUpperCase()} (${fmtBytes(r.bytes)}${r.w ? `, ${r.w}×${r.h} px` : ''}).`, 'ok', 4200);
    } catch (err) {
      toast('Export failed: ' + err.message, 'err', 6000);
    }
  }
}

window.flowstate = new App();
void newNode;
