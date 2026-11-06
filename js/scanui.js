// "Sketch to flowchart": the review workspace that sits between the photo and the canvas.
// The picture stays on screen next to every detected item so each guess can be checked,
// corrected or thrown away before anything touches the chart.
import { h, esc, toast, announce, clamp, uid } from './util.js';
import { scanImage, cropOf, isImageFile, SCAN_DEFAULTS } from './vision.js';
import { engineList, defaultEngine, prepare, readText, readAll } from './ocr.js';
import { newNode, newEdge, nodeById } from './model.js';
import { SHAPES } from './shapes.js';

const LOW = 0.55;                                   // below this, an item is "uncertain"
const KIND_TO_TYPE = { process: 'process', decision: 'decision', io: 'io', terminal: 'start', connector: 'connector' };
const TYPE_CHOICES = ['start', 'end', 'process', 'decision', 'io', 'subroutine', 'data', 'document', 'connector', 'note'];

export function canImport(file) { return isImageFile(file); }

export async function openSketchImport(app, file) {
  const ui = new SketchReview(app, file);
  await ui.open();
  return ui;
}

class SketchReview {
  constructor(app, file) {
    this.app = app;
    this.file = file;
    this.opts = { ...SCAN_DEFAULTS };
    this.engine = defaultEngine();
    this.model = null;
    this.sel = null;
    this.busy = false;
  }

  /* ------------------------------------------------------------- shell */
  async open() {
    this.root = h('div', { class: 'backdrop sketch-backdrop', onclick: (e) => { if (e.target === this.root) this.close(); } },
      this.panel = h('div', { class: 'sketch', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Sketch to flowchart' }));
    document.getElementById('modals').append(this.root);
    this.esc = (e) => { if (e.key === 'Escape' && !this.busy) { e.preventDefault(); this.close(); } };
    window.addEventListener('keydown', this.esc, true);
    this.panel.innerHTML = `<div class="sketch-loading"><div class="spinner"></div><p>Reading <b>${esc(this.file.name || 'the image')}</b>…</p></div>`;
    try {
      await this.scan();
    } catch (err) {
      this.panel.innerHTML = '';
      this.panel.append(
        h('header', {}, h('h2', {}, 'That image could not be read'),
          h('button', { class: 'btn icon ghost push', onclick: () => this.close(), 'aria-label': 'Close' }, '✕')),
        h('div', { class: 'sketch-body' }, h('div', { class: 'empty-note', style: 'margin:20px' },
          String(err.message || err) + ' Supported formats are PNG, JPEG, WebP, GIF, BMP and AVIF.')),
        h('footer', {}, h('button', { class: 'btn primary', onclick: () => this.close() }, 'Close')));
    }
  }
  close() {
    window.removeEventListener('keydown', this.esc, true);
    this.root?.remove();
    this.app.svg?.focus({ preventScroll: true });
  }

  /* -------------------------------------------------------------- scan */
  async scan() {
    this.busy = true;
    const res = await scanImage(this.file, this.opts);
    this.result = res;
    this.model = buildModel(res, this.engine === 'manual' ? null : this.engine);
    this.busy = false;
    this.render();
    // free, instant recognition can run straight away
    if (this.engine === 'builtin') this.runRecognition(true);
  }

  async rescan() {
    if (this.busy) return;
    this.busy = true;
    this.setStatus('Re-reading the image…');
    try {
      await this.scan();
      this.setStatus('');
    } catch (err) {
      this.busy = false;
      toast('Re-scan failed: ' + err.message, 'err');
    }
  }

  /* ------------------------------------------------------------ render */
  render() {
    const m = this.model;
    this.panel.innerHTML = '';
    this.panel.append(
      h('header', {},
        h('h2', {}, 'Sketch to flowchart'),
        h('span', { class: 'muted sketch-file' }, this.file.name || 'pasted image'),
        h('button', { class: 'btn icon ghost push', onclick: () => this.close(), 'aria-label': 'Close' }, '✕')),
      this.toolbar(),
      h('div', { class: 'sketch-body' }, this.imagePane(), this.listPane()),
      this.footer());
    this.paintOverlay();
    this.syncSelection();
  }

  toolbar() {
    const engines = engineList();
    const bar = h('div', { class: 'sketch-tools' },
      h('label', { class: 'muted', for: 'skSens' }, 'Ink sensitivity'),
      this.sens = h('input', { type: 'range', id: 'skSens', min: '0', max: '1', step: '0.05', value: String(this.opts.sensitivity), style: 'width:120px' }),
      h('button', { class: 'btn', onclick: () => this.rotate(-1), title: 'Rotate the photo a quarter turn left' }, '⟲'),
      h('button', { class: 'btn', onclick: () => this.rotate(1), title: 'Rotate the photo a quarter turn right' }, '⟳'),
      h('label', { class: 'checkline', title: 'Straighten a photo taken at an angle' },
        this.deskewBox = h('input', { type: 'checkbox', ...(this.opts.deskew ? { checked: '' } : {}) }), ' Auto-straighten'),
      h('button', { class: 'btn', onclick: () => this.rescan() }, 'Scan again'),
      h('div', { class: 'sketch-tools-right' },
        h('label', { class: 'muted', for: 'skEngine' }, 'Text'),
        this.engineSel = h('select', { id: 'skEngine' },
          ...engines.map((e) => h('option', {
            value: e.id, title: e.note,
            ...(e.disabled ? { disabled: '' } : {}), ...(e.id === this.engine ? { selected: '' } : {}),
          }, e.label))),
        this.readBtn = h('button', { class: 'btn', onclick: () => this.runRecognition(false) }, 'Read the text')),
    );
    this.sens.addEventListener('change', () => { this.opts.sensitivity = Number(this.sens.value); this.rescan(); });
    this.deskewBox.addEventListener('change', () => { this.opts.deskew = this.deskewBox.checked; this.rescan(); });
    this.engineSel.addEventListener('change', () => {
      this.engine = this.engineSel.value;
      const note = engines.find((e) => e.id === this.engine)?.note || '';
      this.setStatus(note);
      this.readBtn.disabled = this.engine === 'manual';
    });
    this.readBtn.disabled = this.engine === 'manual';
    return bar;
  }

  imagePane() {
    const r = this.result;
    const wrap = h('div', { class: 'sketch-image' });
    const holder = h('div', { class: 'sketch-canvas-holder' });
    r.canvas.classList.add('sketch-photo');
    r.canvas.setAttribute('alt', 'The photo you uploaded, straightened');
    this.overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.overlay.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
    this.overlay.setAttribute('class', 'sketch-overlay');
    this.overlay.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    holder.append(r.canvas, this.overlay);
    wrap.append(holder, h('p', { class: 'sketch-meta muted' },
      `${r.width}×${r.height} working size · ${r.angle ? `straightened ${r.angle > 0 ? '' : '−'}${Math.abs(r.angle).toFixed(1)}° · ` : ''}${r.stats.components} marks · traced in ${r.stats.ms} ms`));
    return wrap;
  }

  listPane() {
    const m = this.model;
    const pane = h('div', { class: 'sketch-list' });
    const uncertain = [...m.nodes, ...m.edges].filter((i) => i.keep && i.confidence < LOW);
    const warn = this.result.warnings;

    pane.append(h('div', { class: 'sketch-summary' },
      chip(`${m.nodes.filter((n) => n.keep).length} steps`, 'ok'),
      chip(`${m.edges.filter((e) => e.keep).length} connections`, 'ok'),
      chip(`${uncertain.length} to check`, uncertain.length ? 'warn' : 'ok'),
      chip(`${m.nodes.filter((n) => n.keep && !n.text.trim()).length} without text`, 'plain')));

    if (warn.length) {
      pane.append(h('div', { class: 'sketch-warn' }, ...warn.map((w) => h('p', {}, w))));
    }
    if (uncertain.length) {
      pane.append(section('Worth a look first', 'These are the guesses FlowState is least sure about.',
        uncertain.map((i) => (i.kind ? this.nodeRow(i) : this.edgeRow(i)))));
    }
    const nodes = m.nodes.filter((n) => n.keep);
    pane.append(section(`Steps (${nodes.length})`, nodes.length ? 'Check the shape and type what each one says.' : '',
      nodes.length ? nodes.map((n) => this.nodeRow(n))
        : [h('div', { class: 'empty-note' }, 'No closed shapes were found. Try the ink sensitivity slider, or a straighter, better-lit photo.')]));
    const edges = m.edges.filter((e) => e.keep);
    pane.append(section(`Connections (${edges.length})`, edges.length ? 'Arrow direction is a guess when no arrowhead was visible.' : '',
      edges.length ? edges.map((e) => this.edgeRow(e))
        : [h('div', { class: 'empty-note' }, 'No arrows were matched to shapes. You can draw them on the canvas after importing.')]));
    const dropped = [...m.nodes, ...m.edges].filter((i) => !i.keep);
    if (dropped.length) {
      pane.append(section(`Removed (${dropped.length})`, 'Click to put one back.',
        dropped.map((i) => h('button', {
          class: 'btn sketch-restore', onclick: () => { i.keep = true; this.render(); },
        }, (i.kind ? 'Step' : 'Connection') + ': ' + String(i.text || i.label || i.id).slice(0, 28)))));
    }
    return pane;
  }

  nodeRow(n) {
    const row = h('div', {
      class: 'sketch-row' + (n.confidence < LOW ? ' low' : ''), tabindex: '0', 'data-id': n.id,
      onmouseenter: () => this.highlight(n.id), onfocus: () => this.select(n.id), onclick: () => this.select(n.id),
    });
    const thumb = h('div', { class: 'sketch-thumb' });
    if (n.thumb) thumb.append(h('img', { src: n.thumb, alt: 'Crop of this shape in the photo' }));
    const typeSel = h('select', { 'aria-label': 'Shape for this step' },
      ...TYPE_CHOICES.map((t) => h('option', { value: t, ...(t === n.type ? { selected: '' } : {}) }, SHAPES[t].label.replace('\n', ' '))));
    typeSel.addEventListener('change', () => {
      n.type = typeSel.value;
      n.confidence = Math.max(n.confidence, 0.99);
      n.reasons = ['you set the shape yourself'];
      this.refreshRow(row, n);
      this.paintOverlay();
    });
    const text = h('input', {
      type: 'text', value: n.text, placeholder: n.textSource === 'none' ? 'Type what this says…' : '',
      'aria-label': 'Text for this step',
    });
    text.addEventListener('input', () => { n.text = text.value; n.textSource = 'manual'; });
    row.append(thumb, h('div', { class: 'sketch-fields' },
      h('div', { class: 'sketch-line' }, typeSel, confBadge(n.confidence),
        h('button', { class: 'btn icon ghost danger', title: 'Remove this step', 'aria-label': 'Remove this step', onclick: (e) => { e.stopPropagation(); n.keep = false; this.render(); } }, '✕')),
      text,
      h('p', { class: 'sketch-why muted' }, whyText(n))));
    return row;
  }

  edgeRow(e) {
    const m = this.model;
    const opts = (sel) => m.nodes.filter((n) => n.keep).map((n) =>
      h('option', { value: n.id, ...(n.id === sel ? { selected: '' } : {}) }, (n.text.trim() || labelFor(n)).slice(0, 28)));
    const row = h('div', {
      class: 'sketch-row' + (e.confidence < LOW ? ' low' : ''), tabindex: '0', 'data-id': e.id,
      onmouseenter: () => this.highlight(e.id), onfocus: () => this.select(e.id), onclick: () => this.select(e.id),
    });
    const from = h('select', { 'aria-label': 'Connection starts at' }, h('option', { value: '' }, '— pick a step —'), ...opts(e.from));
    const to = h('select', { 'aria-label': 'Connection ends at' }, h('option', { value: '' }, '— pick a step —'), ...opts(e.to));
    const label = h('input', { type: 'text', value: e.label || '', placeholder: 'Label (Yes / No)', 'aria-label': 'Connection label' });
    for (const [el, key] of [[from, 'from'], [to, 'to']]) {
      el.addEventListener('change', () => {
        e[key] = el.value || null;
        e[key === 'from' ? 'fromSide' : 'toSide'] = null;   // the drawn side no longer applies
        if (e.from && e.to && e.from !== e.to) { e.confidence = 0.99; e.reasons = ['you chose the steps yourself']; }
        this.refreshRow(row, e);
        this.paintOverlay();
      });
    }
    label.addEventListener('input', () => { e.label = label.value; e.labelSource = 'manual'; });
    row.append(
      h('div', { class: 'sketch-thumb arrow' }, h('span', {}, '→')),
      h('div', { class: 'sketch-fields' },
        h('div', { class: 'sketch-line' }, from, h('span', { class: 'muted' }, '→'), to, confBadge(e.confidence),
          h('button', { class: 'btn icon ghost danger', title: 'Remove this connection', 'aria-label': 'Remove this connection', onclick: (ev) => { ev.stopPropagation(); e.keep = false; this.render(); } }, '✕')),
        label,
        h('p', { class: 'sketch-why muted' }, whyText(e))));
    return row;
  }

  refreshRow(row, item) {
    row.classList.toggle('low', item.confidence < LOW);
    const badge = row.querySelector('.conf');
    if (badge) badge.replaceWith(confBadge(item.confidence));
    const why = row.querySelector('.sketch-why');
    if (why) why.textContent = whyText(item);
  }

  footer() {
    const m = this.model;
    const nodes = m.nodes.filter((n) => n.keep).length;
    const f = h('footer', {},
      this.status = h('span', { class: 'muted sketch-status' }, ''),
      h('span', { class: 'push' }),
      h('button', { class: 'btn', onclick: () => this.close() }, 'Cancel'),
      h('button', { class: 'btn', disabled: nodes ? null : '', onclick: () => this.apply(false) }, 'Add to this chart'),
      h('button', { class: 'btn primary', disabled: nodes ? null : '', onclick: () => this.apply(true) }, 'Open as a new chart'));
    return f;
  }
  setStatus(msg) { if (this.status) this.status.textContent = msg; }

  /* -------------------------------------------------------- highlight */
  paintOverlay() {
    const ns = 'http://www.w3.org/2000/svg';
    const o = this.overlay;
    if (!o) return;
    o.textContent = '';
    const mk = (tag, attrs) => {
      const el = document.createElementNS(ns, tag);
      for (const k in attrs) el.setAttribute(k, attrs[k]);
      return el;
    };
    for (const n of this.model.nodes) {
      if (!n.keep) continue;
      const cls = 'ov-node' + (n.confidence < LOW ? ' ov-low' : '') + (this.sel === n.id ? ' ov-sel' : '');
      const r = mk('rect', { x: n.box.x, y: n.box.y, width: n.box.w, height: n.box.h, rx: 6, class: cls, 'data-id': n.id });
      r.addEventListener('click', () => this.select(n.id, true));
      o.append(r);
    }
    for (const e of this.model.edges) {
      if (!e.keep) continue;
      const cls = 'ov-edge' + (e.confidence < LOW ? ' ov-low' : '') + (this.sel === e.id ? ' ov-sel' : '');
      const d = e.trace && e.trace.length > 2
        ? 'M' + e.trace.map((p) => `${p[0]},${p[1]}`).join('L')
        : e.mid
          ? `M${e.tail[0]},${e.tail[1]}Q${e.mid[0]},${e.mid[1]} ${e.head[0]},${e.head[1]}`
          : `M${e.tail[0]},${e.tail[1]}L${e.head[0]},${e.head[1]}`;
      const p = mk('path', { d, class: cls, 'data-id': e.id });
      p.addEventListener('click', () => this.select(e.id, true));
      o.append(p);
      o.append(mk('circle', { cx: e.head[0], cy: e.head[1], r: 5, class: cls + ' ov-head' }));
    }
  }
  highlight(id) { if (this.sel !== id) { this.sel = id; this.paintOverlay(); } }
  select(id, scroll = false) {
    this.sel = id;
    this.paintOverlay();
    this.syncSelection(scroll);
  }
  syncSelection(scroll) {
    for (const row of this.panel.querySelectorAll('.sketch-row')) {
      const on = row.dataset.id === this.sel;
      row.classList.toggle('sel', on);
      if (on && scroll) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  /* ------------------------------------------------------ recognition */
  async rotate(dir) {
    this.opts.rotate = ((this.opts.rotate || 0) + dir + 4) % 4;
    await this.rescan();
  }

  async runRecognition(quiet) {
    if (this.busy) return;
    const mode = this.engine;
    if (mode === 'manual') { this.setStatus('Recognition is off — type the labels yourself.'); return; }
    this.busy = true;
    this.readBtn.disabled = true;
    const ready = await prepare(mode, (p) => this.setStatus(p.message + (p.progress ? ` ${Math.round(p.progress * 100)}%` : '')));
    if (!ready.ok) {
      this.busy = false;
      this.readBtn.disabled = false;
      this.setStatus('');
      if (!quiet) toast(ready.error, 'warn', 6000);
      return;
    }
    const blocks = this.model.textJobs;
    if (!blocks.length) {
      this.busy = false; this.readBtn.disabled = false;
      this.setStatus('No text regions were found in the picture.');
      return;
    }
    const hits = await readAll(blocks, mode, (done, total) => this.setStatus(`Reading text… ${done} of ${total}`));
    this.busy = false;
    this.render();
    this.setStatus(hits ? `Read ${hits} of ${blocks.length} labels. Check them — recognition is rarely perfect.`
      : 'Nothing could be read. Type the labels yourself; each snippet is shown beside its box.');
    announce(`${hits} labels recognised`);
  }

  /* ------------------------------------------------------------ apply */
  apply(asNew) {
    const { nodes, edges } = toDocument(this.model, this.app.store.doc.settings, this.result);
    if (!nodes.length) { toast('Nothing to import.', 'warn'); return; }
    const app = this.app;
    if (asNew) {
      const doc = app.newProjectDoc(stripExt(this.file.name) || 'Scanned sketch');
      doc.nodes = nodes;
      doc.edges = edges;
      app.adoptDoc(doc);
    } else {
      const offset = placeBeside(app.store.doc, nodes);
      app.store.commit('Import sketch', (d) => {
        for (const n of nodes) { n.x += offset.x; n.y += offset.y; d.nodes.push(n); }
        for (const e of edges) d.edges.push(e);
      });
      app.store.select(nodes.map((n) => n.id), []);
      app.renderer.fit(boundsOf(app.store.doc));
    }
    this.close();
    const low = [...this.model.nodes, ...this.model.edges].filter((i) => i.keep && i.confidence < LOW).length;
    toast(`Imported ${nodes.length} steps and ${edges.length} connections${low ? ` — ${low} were uncertain, so check them on the canvas.` : '.'}`, low ? 'warn' : 'ok', 5200);
  }
}

/* ------------------------------------------------------------ helpers */

function chip(label, tone) { return h('span', { class: 'sketch-chip ' + tone }, label); }
function section(title, note, children) {
  return h('section', { class: 'sketch-section' },
    h('h3', {}, title), note ? h('p', { class: 'muted' }, note) : null, ...children);
}
function confBadge(c) {
  const tone = c >= 0.75 ? 'ok' : c >= LOW ? 'mid' : 'low';
  const word = c >= 0.75 ? 'confident' : c >= LOW ? 'likely' : 'unsure';
  return h('span', { class: 'conf ' + tone, title: `Confidence ${Math.round(c * 100)}%` }, word);
}
function whyText(item) {
  const bits = (item.reasons || []).slice(0, 2);
  if (item.textSource === 'ocr') bits.push('text read automatically — please check it');
  if (item.textSource === 'none' && item.kind) bits.push('no text could be read');
  return bits.join(' · ');
}
const labelFor = (n) => SHAPES[n.type]?.label.replace('\n', ' ') || 'Step';
const stripExt = (s) => String(s || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();

/** Scan result -> editable review model. */
function buildModel(res, engineMode) {
  const textById = new Map(res.texts.map((t) => [t.id, t]));
  const nodes = res.shapes.map((s) => {
    const owned = s.textIds.map((id) => textById.get(id)).filter(Boolean);
    return {
      id: s.id, kind: s.kind, type: KIND_TO_TYPE[s.kind] || 'process',
      box: { x: s.x, y: s.y, w: s.w, h: s.h },
      text: '', textSource: 'none', textBoxes: owned,
      confidence: s.confidence, reasons: s.reasons, keep: true,
      thumb: safeThumb(res.canvas, { x: s.x, y: s.y, w: s.w, h: s.h }),
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = res.arrows.filter((a) => a.from || a.to).map((a) => ({
    id: a.id, from: a.from, to: a.to, label: '',
    fromSide: a.fromSide, toSide: a.toSide,
    tail: a.tail, head: a.head, mid: a.mid, trace: a.trace,
    confidence: a.confidence, reasons: a.reasons, keep: true,
    labelBox: a.label ? textById.get(a.label) : null,
  }));
  // guess start / end from the graph once connections are known
  assignTerminals(nodes, edges, byId);

  // jobs the recognition engine can pick up later
  // One job per text block. Each writes into its own block and then rebuilds the
  // owner's label from all of them, so running recognition twice replaces the text
  // instead of doubling it — and anything typed by hand is left alone.
  const textJobs = [];
  for (const n of nodes) {
    for (const t of n.textBoxes) {
      textJobs.push({
        canvas: cropOf(res.canvas, t, 4, 2),
        apply: (r) => {
          if (n.textSource === 'manual') return false;
          t.value = r.text;
          n.text = n.textBoxes.map((b) => b.value).filter(Boolean).join(' ');
          n.textSource = 'ocr';
          n.textConfidence = r.confidence;
          return true;
        },
      });
    }
  }
  for (const e of edges) {
    if (!e.labelBox) continue;
    textJobs.push({
      canvas: cropOf(res.canvas, e.labelBox, 4, 2),
      apply: (r) => {
        if (e.labelSource === 'manual') return false;
        e.label = r.text.split('\n')[0].slice(0, 24);
        e.labelSource = 'ocr';
        return true;
      },
    });
  }
  const floating = res.texts.filter((t) => t.role === 'floating');
  void engineMode;
  return { nodes, edges, textJobs, floating, canvas: res.canvas };
}

function safeThumb(canvas, box) {
  try {
    const c = cropOf(canvas, box, 4, Math.min(1, 92 / Math.max(box.w, box.h)));
    return c.toDataURL('image/png');
  } catch { return null; }
}

/** Terminal-shaped boxes become Start or End depending on how they sit in the flow. */
function assignTerminals(nodes, edges, byId) {
  const hasIn = new Set(edges.map((e) => e.to).filter(Boolean));
  const hasOut = new Set(edges.map((e) => e.from).filter(Boolean));
  for (const n of nodes) {
    if (n.kind !== 'terminal') continue;
    const round = Math.abs(n.box.w / n.box.h - 1) < 0.22 && n.box.w < 90;
    if (round && !edges.some((e) => e.from === n.id || e.to === n.id)) { n.type = 'connector'; continue; }
    const incoming = hasIn.has(n.id), outgoing = hasOut.has(n.id);
    if (outgoing && !incoming) n.type = 'start';
    else if (incoming && !outgoing) n.type = 'end';
    else n.type = nodes.indexOf(n) === 0 ? 'start' : 'end';
  }
  // if two starts appeared, keep the topmost
  const starts = nodes.filter((n) => n.type === 'start').sort((a, b) => a.box.y - b.box.y);
  starts.slice(1).forEach((n) => { n.type = hasOut.has(n.id) && !hasIn.has(n.id) ? 'start' : 'end'; });
  void byId;
}

/** Review model -> FlowState nodes and edges. */
function toDocument(model, settings, res) {
  const kept = model.nodes.filter((n) => n.keep);
  if (!kept.length) return { nodes: [], edges: [] };
  // scale so a typical detected box lands near FlowState's default step size
  const widths = kept.map((n) => n.box.w).sort((a, b) => a - b);
  const typical = widths[Math.floor(widths.length / 2)] || 160;
  const scale = clamp(170 / typical, 0.35, 4);
  const minX = Math.min(...kept.map((n) => n.box.x)), minY = Math.min(...kept.map((n) => n.box.y));
  const snap = (v) => Math.round(v / 10) * 10;

  const idMap = new Map();
  const nodes = kept.map((n) => {
    const node = newNode(n.type, snap((n.box.x - minX) * scale) + 80, snap((n.box.y - minY) * scale) + 80, settings, n.text.trim());
    node.w = Math.max(n.type === 'connector' ? 48 : 90, snap(n.box.w * scale));
    node.h = Math.max(n.type === 'connector' ? 48 : 46, snap(n.box.h * scale));
    if (n.type === 'connector') node.w = node.h = Math.max(48, Math.min(node.w, node.h));
    node.code = { lang: settings.defaultLang || 'none', source: '' };
    idMap.set(n.id, node.id);
    return node;
  });
  const edges = [];
  for (const e of model.edges) {
    if (!e.keep || !e.from || !e.to) continue;
    const from = idMap.get(e.from), to = idMap.get(e.to);
    if (!from || !to || from === to) continue;
    if (edges.some((x) => x.from === from && x.to === to)) continue;
    const edge = newEdge(from, to, settings, (e.label || '').trim());
    if (e.fromSide) edge.fromPort = e.fromSide;
    if (e.toSide) edge.toPort = e.toSide;
    edges.push(edge);
  }
  // floating notes keep anything the reader scribbled outside a box
  for (const t of model.floating) {
    if (!t.value) continue;
    const note = newNode('note', snap((t.x - minX) * scale) + 80, snap((t.y - minY) * scale) + 80, settings, t.value);
    note.w = Math.max(110, snap(t.w * scale));
    note.h = Math.max(40, snap(t.h * scale));
    nodes.push(note);
  }
  void res;
  return { nodes, edges };
}

function boundsOf(doc) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of doc.nodes) {
    x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h);
  }
  return { x: x0 - 40, y: y0 - 40, w: x1 - x0 + 80, h: y1 - y0 + 80 };
}
/** Drop the imported block to the right of whatever is already on the canvas. */
function placeBeside(doc, nodes) {
  if (!doc.nodes.length) return { x: 0, y: 0 };
  const right = Math.max(...doc.nodes.map((n) => n.x + n.w));
  const top = Math.min(...doc.nodes.map((n) => n.y));
  const nx = Math.min(...nodes.map((n) => n.x)), ny = Math.min(...nodes.map((n) => n.y));
  return { x: right + 160 - nx, y: top - ny };
}
void uid; void nodeById;
