// Small shared helpers.
export const uid = (p = 'n') =>
  p + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const round = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;

export const clone = (o) =>
  typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o));

export function debounce(fn, ms) {
  let t;
  const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  f.cancel = () => clearTimeout(t);
  f.flush = (...a) => { clearTimeout(t); fn(...a); };
  return f;
}

export function rafThrottle(fn) {
  let queued = false, last;
  return (...a) => {
    last = a;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fn(...last); });
  };
}

export const SVGNS = 'http://www.w3.org/2000/svg';
export function sv(tag, attrs) {
  const e = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  return e;
}
export function setAttrs(e, attrs) {
  for (const k in attrs) {
    const v = attrs[k];
    if (v == null) e.removeAttribute(k);
    else if (e.getAttribute(k) !== String(v)) e.setAttribute(k, v);
  }
  return e;
}
export function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const k in props) {
    const v = props[k];
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v != null && v !== false) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
}
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- text measuring / wrapping ---------- */
let _ctx;
function ctx() {
  if (!_ctx) _ctx = document.createElement('canvas').getContext('2d');
  return _ctx;
}
const _mcache = new Map();
export function measure(text, font) {
  const key = font + '\u0000' + text;
  let v = _mcache.get(key);
  if (v === undefined) {
    const c = ctx();
    c.font = font;
    v = c.measureText(text).width;
    if (_mcache.size > 9000) _mcache.clear();
    _mcache.set(key, v);
  }
  return v;
}
export function fontString(style) {
  const w = style.fontWeight || 400;
  return `${style.fontStyle === 'italic' ? 'italic ' : ''}${w} ${style.fontSize || 14}px ${style.fontFamily || 'Inter, sans-serif'}`;
}
/** Greedy word wrap that also breaks very long words. Honours explicit newlines. */
export function wrapText(text, maxWidth, font) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    if (!para.trim()) { out.push(''); continue; }
    let line = '';
    for (const word of para.split(/\s+/)) {
      const probe = line ? line + ' ' + word : word;
      if (measure(probe, font) <= maxWidth || !line) {
        if (measure(probe, font) > maxWidth && !line && word.length > 1) {
          // hard-break a single long word
          let chunk = '';
          for (const ch of word) {
            if (measure(chunk + ch, font) > maxWidth && chunk) { out.push(chunk); chunk = ch; }
            else chunk += ch;
          }
          line = chunk;
        } else line = probe;
      } else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

/* ---------- misc ---------- */
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
export const fmtBytes = (n) =>
  n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';

export const fmtWhen = (ts) => {
  if (!ts) return 'never';
  const d = Date.now() - ts, m = Math.round(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const hrs = Math.round(m / 60);
  if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
  return new Date(ts).toLocaleDateString();
};

export function toast(msg, kind = '', ms = 3200) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const t = h('div', { class: 'toast ' + kind }, msg);
  host.append(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(6px)'; }, ms - 220);
  setTimeout(() => t.remove(), ms);
}
export function announce(msg) {
  const l = document.getElementById('live');
  if (l) { l.textContent = ''; setTimeout(() => (l.textContent = msg), 30); }
}
export const isMac = navigator.platform.toUpperCase().includes('MAC');
export const modKey = (e) => (isMac ? e.metaKey : e.ctrlKey);
