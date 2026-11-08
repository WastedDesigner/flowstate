// Shared UI pieces: popover menus and the floating selection toolbar (the Canva-style "what can I do with this?" bar).
import { esc, clamp } from './util.js';
import { icon, alignIcon, ALIGN_LABELS } from './icons.js';
import { fitNode } from './codeflow.js';

/* ---------------- popover ---------------- */
let current = null;
export function closePopover() {
  if (!current) return;
  const { el, off } = current;
  current = null;
  off();
  el.remove();
}
/**
 * items: [{label, icon, hint, checked, danger, sep, onClick}] — anchor: element, or {x, y} for a context menu.
 */
export function openPopover(anchor, items, { width = 230 } = {}) {
  closePopover();
  const el = document.createElement('div');
  el.className = 'popover';
  el.setAttribute('role', 'menu');
  el.style.minWidth = width + 'px';
  for (const it of items) {
    if (it.sep) { el.append(Object.assign(document.createElement('div'), { className: 'pop-sep' })); continue; }
    if (it.heading) { el.append(Object.assign(document.createElement('div'), { className: 'pop-head', textContent: it.heading })); continue; }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pop-item' + (it.danger ? ' danger' : '') + (it.checked ? ' on' : '');
    b.setAttribute('role', 'menuitem');
    b.innerHTML = `<span class="pi-ic">${it.iconHtml || (it.icon ? icon(it.icon, 18) : '')}</span><span class="pi-label">${esc(it.label)}</span>${it.hint ? `<kbd>${esc(it.hint)}</kbd>` : ''}${it.checked ? `<span class="pi-check">${icon('checkmark', 16)}</span>` : ''}`;
    b.onclick = () => { closePopover(); it.onClick?.(); };
    el.append(b);
  }
  document.body.append(el);
  const vw = innerWidth, vh = innerHeight, r = el.getBoundingClientRect();
  let x, y;
  if (anchor instanceof Element) {
    const a = anchor.getBoundingClientRect();
    x = a.left; y = a.bottom + 6;
    if (y + r.height > vh - 8) y = Math.max(8, a.top - r.height - 6);
  } else { x = anchor.x; y = anchor.y; }
  el.style.left = clamp(x, 8, Math.max(8, vw - r.width - 8)) + 'px';
  el.style.top = clamp(y, 8, Math.max(8, vh - r.height - 8)) + 'px';
  const onDown = (e) => { if (!el.contains(e.target) && e.target !== anchor && !(anchor instanceof Element && anchor.contains(e.target))) closePopover(); };
  const onKey = (e) => { if (e.key === 'Escape') closePopover(); };
  setTimeout(() => { window.addEventListener('pointerdown', onDown, true); window.addEventListener('keydown', onKey, true); }, 0);
  window.addEventListener('resize', closePopover);
  current = { el, off: () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', closePopover); } };
  el.querySelector('.pop-item')?.focus({ preventScroll: true });
  return closePopover;
}

/* ---------------- selection toolbar ---------------- */
const hex = (c) => (/^#[0-9a-f]{6}/i.test(c || '') ? c.slice(0, 7) : '#888888');
const btn = (act, ic, title, extra = '') => `<button class="cx-btn ${extra}" data-cx="${act}" title="${esc(title)}" aria-label="${esc(title)}">${ic}</button>`;
const swatch = (kind, color, title) => `<label class="cx-color" title="${esc(title)}"><span style="background:${color === 'none' ? 'transparent' : hex(color)}"></span><input type="color" data-cx-color="${kind}" value="${hex(color)}" aria-label="${esc(title)}"></label>`;
const sep = '<span class="cx-sep"></span>';

export function renderCtxBar(app) {
  const bar = document.getElementById('ctxBar');
  if (!bar) return;
  if (bar.contains(document.activeElement) && document.activeElement.matches('input')) return;   // don't rebuild under a colour drag
  const st = app.store;
  const nodes = st.selectedNodes(), edges = st.selectedEdges();
  if (!nodes.length && !edges.length) { bar.hidden = true; bar.innerHTML = ''; return; }
  let html;
  if (nodes.length) {
    const n = nodes[0], s = n.style || {};
    const lane = nodes.every((x) => x.type === 'lane');
    const grouped = nodes.every((x) => x.group && x.group === n.group);
    html = swatch('fill', s.fill, 'Fill colour') + swatch('stroke', s.stroke, 'Outline colour');
    if (!lane) html += sep + btn('fs-', icon('minus', 16), 'Smaller text') + `<span class="cx-size cx-opt">${Math.round(s.fontSize || 14)}</span>` + btn('fs+', icon('plus', 16), 'Larger text')
      + btn('bold', icon('bold', 18), 'Bold', Number(s.fontWeight) >= 600 ? 'on' : '') + btn('italic', icon('italic', 18), 'Italic', 'cx-opt' + (s.fontStyle === 'italic' ? ' on' : ''));
    html += sep;
    if (nodes.length === 1) html += btn('edit', icon('pencil', 18), 'Edit text (Enter)');
    html += btn('dupe', icon('copy', 18), 'Duplicate (Ctrl+D)');
    if (nodes.length > 1) html += btn('align', icon('layout', 18), 'Align and distribute');
    if (nodes.length > 1 || grouped) html += btn(grouped ? 'ungroup' : 'group', icon(grouped ? 'ungroup' : 'group', 18), grouped ? 'Ungroup (Ctrl+Shift+G)' : 'Group (Ctrl+G)');
    html += btn('more', icon('design', 18), 'All style options') + btn('del', icon('trash', 18), 'Delete (Del)', 'danger');
  } else {
    const e = edges[0], s = e.style || {};
    html = swatch('estroke', s.stroke, 'Line colour') + sep
      + btn('curve:orthogonal', icon('elbow', 18), 'Elbow', (s.curve || 'orthogonal') === 'orthogonal' ? 'on' : '')
      + btn('curve:curve', icon('curve', 18), 'Curved', s.curve === 'curve' ? 'on' : '')
      + btn('curve:straight', icon('straight', 18), 'Straight', s.curve === 'straight' ? 'on' : '')
      + sep + btn('edash', '<span class="cx-txt">- - -</span>', 'Dashed line', s.dash && s.dash !== 'none' ? 'on' : '')
      + btn('earrow', '<span class="cx-txt">→</span>', 'Arrowhead', s.arrowEnd && s.arrowEnd !== 'none' ? 'on' : '')
      + sep + (edges.length === 1 ? btn('elabel', icon('pencil', 18), 'Edit label (Enter)') : '')
      + btn('flip', icon('flip', 18), 'Reverse direction') + btn('del', icon('trash', 18), 'Delete (Del)', 'danger');
  }
  bar.innerHTML = html;
  bar.hidden = false;
}

export function wireCtxBar(app) {
  const bar = document.getElementById('ctxBar');
  const st = app.store;
  const editNodes = (label, fn) => st.commit(label, () => { for (const n of st.selectedNodes()) fn(n); });
  const editEdges = (label, fn) => st.commit(label, () => { for (const e of st.selectedEdges()) fn(e); });
  bar.addEventListener('pointerdown', (e) => { if (!e.target.closest('input')) e.preventDefault(); });   // keep focus on the canvas
  bar.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-cx]');
    if (!b) return;
    const act = b.dataset.cx;
    if (act === 'fs-' || act === 'fs+') {
      const d = act === 'fs+' ? 1 : -1;
      editNodes('Text size', (n) => { n.style.fontSize = clamp((n.style.fontSize || 14) + d, 8, 48); fitNode(n); });
    } else if (act === 'bold') {
      const on = Number(st.selectedNodes()[0]?.style.fontWeight) >= 600;
      editNodes('Bold', (n) => { n.style.fontWeight = on ? 400 : 700; fitNode(n); });
    } else if (act === 'italic') {
      const on = st.selectedNodes()[0]?.style.fontStyle === 'italic';
      editNodes('Italic', (n) => { n.style.fontStyle = on ? 'normal' : 'italic'; });
    } else if (act === 'edit') app.editNodeText([...st.selNodes][0]);
    else if (act === 'elabel') app.editEdgeLabel([...st.selEdges][0]);
    else if (act === 'dupe') app.duplicateSelection();
    else if (act === 'del') app.deleteSelection();
    else if (act === 'group') app.groupSelection(true);
    else if (act === 'ungroup') app.groupSelection(false);
    else if (act === 'more') app.setPanel('design', false);
    else if (act === 'flip') app.panelAction('flip');
    else if (act.startsWith('curve:')) editEdges('Routing', (e) => { e.style.curve = act.slice(6); });
    else if (act === 'edash') {
      const on = st.selectedEdges()[0]?.style.dash && st.selectedEdges()[0].style.dash !== 'none';
      editEdges('Line style', (e) => { e.style.dash = on ? 'none' : 'dashed'; });
    } else if (act === 'earrow') {
      const on = st.selectedEdges()[0]?.style.arrowEnd && st.selectedEdges()[0].style.arrowEnd !== 'none';
      editEdges('Arrowhead', (e) => { e.style.arrowEnd = on ? 'none' : 'arrow'; });
    } else if (act === 'align') {
      openPopover(b, [
        ...['left', 'cx', 'right', 'top', 'cy', 'bottom'].map((k) => ({ label: ALIGN_LABELS[k], iconHtml: alignIcon(k), onClick: () => app.align(k) })),
        { sep: true },
        ...['dh', 'dv'].map((k) => ({ label: ALIGN_LABELS[k], iconHtml: alignIcon(k), onClick: () => app.align(k) })),
        { sep: true },
        { label: 'Smart align', icon: 'layout', onClick: () => app.smartAlign() },
      ]);
    }
  });
  // colour pickers edit live and land as one undo step
  bar.addEventListener('input', (ev) => {
    const inp = ev.target.closest('[data-cx-color]');
    if (!inp) return;
    st.beginGesture();
    const kind = inp.dataset.cxColor, v = inp.value;
    inp.previousElementSibling.style.background = v;
    if (kind === 'estroke') { for (const e of st.selectedEdges()) e.style.stroke = v; app.renderer.patchEdges([...st.selEdges]); }
    else { for (const n of st.selectedNodes()) n.style[kind] = v; app.renderer.patchNodes([...st.selNodes]); }
    st.live([]);
  });
  bar.addEventListener('change', (ev) => {
    if (ev.target.closest('[data-cx-color]')) { st.endGesture('Colour'); renderCtxBar(app); }
  });
}
