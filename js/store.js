// Document state: selection, viewport, undo/redo history, autosave and project storage.
import { clone, debounce, uid } from './util.js';
import { newDoc, DOC_VERSION, FILE_KIND, readFile, toFile } from './model.js';

const LS_INDEX = 'flowstate.projects.v1';
const LS_DOC = (id) => 'flowstate.doc.' + id;
const LS_LAST = 'flowstate.last';
const LS_UI = 'flowstate.ui';
const HISTORY_LIMIT = 120;

export class Store {
  constructor() {
    this.doc = newDoc();
    this.selNodes = new Set();
    this.selEdges = new Set();
    this.viewport = { x: 0, y: 0, k: 1 };
    this.undoStack = [];
    this.redoStack = [];
    this._pending = null;         // snapshot taken at gesture start
    this._listeners = new Map();
    this._saveState = 'idle';
    this.autosave = debounce(() => this.saveLocal(), 700);
  }

  /* ---- events ---- */
  on(evt, fn) {
    (this._listeners.get(evt) || this._listeners.set(evt, new Set()).get(evt)).add(fn);
    return () => this._listeners.get(evt).delete(fn);
  }
  emit(evt, payload) {
    const s = this._listeners.get(evt);
    if (s) for (const fn of [...s]) fn(payload);
  }

  /* ---- history ---- */
  /** Run a mutation as one undoable step. */
  commit(label, fn) {
    const before = clone(this.doc);
    const r = fn(this.doc);
    if (r === false) return false;                      // mutation declined
    this._push(before, label);
    this.touch(label);
    return true;
  }
  /** Snapshot now; call `endGesture(label)` once a drag/resize finishes. */
  beginGesture() { if (!this._pending) this._pending = clone(this.doc); }
  endGesture(label = 'Edit', changed = true) {
    if (!this._pending) return;
    const before = this._pending;
    this._pending = null;
    if (!changed || JSON.stringify(before) === JSON.stringify(this.doc)) return;
    this._push(before, label);
    this.touch(label);
  }
  cancelGesture() {
    if (!this._pending) return;
    this.doc = this._pending;
    this._pending = null;
    this.emit('change', { label: 'Cancel', full: true });
  }
  _push(before, label) {
    this.undoStack.push({ doc: before, label });
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
  }
  /** Mark the document dirty and notify. */
  touch(label = 'Edit', full = true) {
    this.doc.updatedAt = Date.now();
    this.emit('change', { label, full });
    if (this.doc.settings.autosave) { this._saveState = 'saving'; this.emit('savestate', 'saving'); this.autosave(); }
  }
  /** Lightweight notify during a drag (no history, no autosave). */
  live(ids) { this.emit('live', ids); }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }
  undoLabel() { return this.undoStack.at(-1)?.label || ''; }
  redoLabel() { return this.redoStack.at(-1)?.label || ''; }
  undo() {
    const e = this.undoStack.pop();
    if (!e) return null;
    this.redoStack.push({ doc: clone(this.doc), label: e.label });
    this.doc = e.doc;
    this._afterTimeTravel();
    return e.label;
  }
  redo() {
    const e = this.redoStack.pop();
    if (!e) return null;
    this.undoStack.push({ doc: clone(this.doc), label: e.label });
    this.doc = e.doc;
    this._afterTimeTravel();
    return e.label;
  }
  _afterTimeTravel() {
    const ids = new Set(this.doc.nodes.map((n) => n.id));
    const eids = new Set(this.doc.edges.map((e) => e.id));
    for (const id of [...this.selNodes]) if (!ids.has(id)) this.selNodes.delete(id);
    for (const id of [...this.selEdges]) if (!eids.has(id)) this.selEdges.delete(id);
    this.emit('change', { label: 'History', full: true });
    this.emit('selection');
    if (this.doc.settings.autosave) this.autosave();
  }

  /* ---- selection ---- */
  select(nodeIds = [], edgeIds = [], additive = false) {
    if (!additive) { this.selNodes.clear(); this.selEdges.clear(); }
    for (const id of nodeIds) this.selNodes.add(id);
    for (const id of edgeIds) this.selEdges.add(id);
    this.emit('selection');
  }
  toggleNode(id) {
    this.selNodes.has(id) ? this.selNodes.delete(id) : this.selNodes.add(id);
    this.emit('selection');
  }
  clearSelection() {
    if (!this.selNodes.size && !this.selEdges.size) return;
    this.selNodes.clear(); this.selEdges.clear();
    this.emit('selection');
  }
  selectedNodes() { return this.doc.nodes.filter((n) => this.selNodes.has(n.id)); }
  selectedEdges() { return this.doc.edges.filter((e) => this.selEdges.has(e.id)); }

  /* ---- load / replace ---- */
  setDoc(doc, { resetHistory = true, label = 'Open' } = {}) {
    this.doc = doc;
    if (resetHistory) { this.undoStack.length = 0; this.redoStack.length = 0; }
    this.selNodes.clear(); this.selEdges.clear();
    this.emit('change', { label, full: true });
    this.emit('selection');
    this.emit('docswap');
    localStorage.setItem(LS_LAST, doc.id);
    this.saveLocal();
  }

  /* ---- local storage: projects ---- */
  index() {
    try { return JSON.parse(localStorage.getItem(LS_INDEX) || '[]'); } catch { return []; }
  }
  writeIndex(list) { localStorage.setItem(LS_INDEX, JSON.stringify(list)); }
  saveLocal() {
    const d = this.doc;
    try {
      localStorage.setItem(LS_DOC(d.id), JSON.stringify(toFile(d)));
      const list = this.index().filter((p) => p.id !== d.id);
      list.unshift({ id: d.id, name: d.name, updatedAt: d.updatedAt, nodes: d.nodes.length, edges: d.edges.length });
      this.writeIndex(list.slice(0, 60));
      localStorage.setItem(LS_LAST, d.id);
      this._saveState = 'saved';
      this.emit('savestate', 'saved');
    } catch (err) {
      this._saveState = 'error';
      this.emit('savestate', 'error');
      this.emit('saveerror', err);
    }
  }
  loadLocal(id) {
    const raw = localStorage.getItem(LS_DOC(id));
    if (!raw) return null;
    const res = readFile(raw);
    return res.ok ? res.doc : null;
  }
  deleteLocal(id) {
    localStorage.removeItem(LS_DOC(id));
    this.writeIndex(this.index().filter((p) => p.id !== id));
  }
  duplicateLocal(id) {
    const d = this.loadLocal(id);
    if (!d) return null;
    d.id = uid('doc');
    d.name = d.name + ' copy';
    d.createdAt = d.updatedAt = Date.now();
    localStorage.setItem(LS_DOC(d.id), JSON.stringify(toFile(d)));
    const list = this.index();
    list.unshift({ id: d.id, name: d.name, updatedAt: d.updatedAt, nodes: d.nodes.length, edges: d.edges.length });
    this.writeIndex(list);
    return d;
  }
  lastId() { return localStorage.getItem(LS_LAST); }

  /* ---- ui prefs (interface theme, rail state) ---- */
  ui() { try { return JSON.parse(localStorage.getItem(LS_UI) || '{}'); } catch { return {}; } }
  setUi(patch) { localStorage.setItem(LS_UI, JSON.stringify({ ...this.ui(), ...patch })); }
}

export const FORMAT = { FILE_KIND, DOC_VERSION };
