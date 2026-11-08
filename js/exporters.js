// Export: standalone SVG, PNG and JPG (no third-party libraries), plus JSON backups.
import { docBounds, THEMES, toFile } from './model.js';
import { download } from './util.js';

const XMLNS = 'http://www.w3.org/2000/svg';

function bgColor(doc, mode) {
  if (mode === 'transparent') return null;
  if (mode === 'white') return '#ffffff';
  return (THEMES[doc.settings.theme] || THEMES.midnight).bg;
}

/** Build a self-contained SVG document string from the live scene. */
export function buildSvg(renderer, doc, opts = {}) {
  const pad = opts.padding ?? 32;
  const b = docBounds(doc, pad);
  const svg = document.createElementNS(XMLNS, 'svg');
  svg.setAttribute('xmlns', XMLNS);
  svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  svg.setAttribute('width', Math.max(1, Math.round(b.w)));
  svg.setAttribute('height', Math.max(1, Math.round(b.h)));
  svg.setAttribute('viewBox', `${b.x} ${b.y} ${b.w} ${b.h}`);
  const title = document.createElementNS(XMLNS, 'title');
  title.textContent = doc.name || 'Flowchart';
  svg.append(title);

  // only the arrowhead markers are needed
  const defs = document.createElementNS(XMLNS, 'defs');
  for (const m of renderer.defs.querySelectorAll('marker')) defs.append(m.cloneNode(true));
  svg.append(defs);

  const bg = bgColor(doc, opts.background || 'theme');
  if (bg) {
    const r = document.createElementNS(XMLNS, 'rect');
    r.setAttribute('x', b.x); r.setAttribute('y', b.y);
    r.setAttribute('width', b.w); r.setAttribute('height', b.h);
    r.setAttribute('fill', bg);
    svg.append(r);
  }
  if (opts.grid) {
    const t = THEMES[doc.settings.theme] || THEMES.midnight;
    const step = (doc.settings.gridSize || 10) * 2;
    const g = document.createElementNS(XMLNS, 'g');
    g.setAttribute('stroke', t.grid); g.setAttribute('stroke-width', 1);
    const x0 = Math.ceil(b.x / step) * step, y0 = Math.ceil(b.y / step) * step;
    let d = '';
    for (let x = x0; x < b.x + b.w; x += step) d += `M${x},${b.y}V${b.y + b.h}`;
    for (let y = y0; y < b.y + b.h; y += step) d += `M${b.x},${y}H${b.x + b.w}`;
    const p = document.createElementNS(XMLNS, 'path');
    p.setAttribute('d', d); p.setAttribute('fill', 'none');
    g.append(p); svg.append(g);
  }
  svg.append(renderer.edgeLayer.cloneNode(true), renderer.nodeLayer.cloneNode(true));

  // strip editor-only attributes
  for (const el of svg.querySelectorAll('[tabindex],[data-id],.edge-hit')) {
    el.removeAttribute('tabindex');
    el.removeAttribute('data-id');
  }
  // editor-only: hit areas, issue/code badges, selection state
  for (const el of svg.querySelectorAll('.edge-hit,.badges')) el.remove();
  for (const el of svg.querySelectorAll('.sel')) el.classList.remove('sel');

  const style = document.createElementNS(XMLNS, 'style');
  style.textContent = 'text{white-space:pre}.wire{fill:none;stroke-linecap:round;stroke-linejoin:round}.shape{stroke-linejoin:round}.elabel{paint-order:stroke;stroke-linejoin:round}';
  svg.insertBefore(style, svg.firstChild);
  return { markup: '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg), bounds: b };
}

function b64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}

/** Rasterise the SVG markup to a canvas. */
export function toCanvas(markup, bounds, opts = {}) {
  const scale = opts.scale || 2;
  const w = Math.max(1, Math.round(bounds.w * scale));
  const h = Math.max(1, Math.round(bounds.h * scale));
  if (w * h > 72_000_000) {
    return Promise.reject(new Error(`That would be ${w} × ${h} pixels, which browsers cannot allocate. Lower the scale.`));
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'sync';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      if (opts.flatten) { ctx.fillStyle = opts.flatten; ctx.fillRect(0, 0, w, h); }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(c);
    };
    img.onerror = () => reject(new Error('The browser refused to render the diagram to an image.'));
    img.src = 'data:image/svg+xml;base64,' + b64(markup);
  });
}

const safeName = (s) => (s || 'flowchart').replace(/[^\w\-. ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'flowchart';

export async function exportSvg(renderer, doc, opts) {
  const { markup } = buildSvg(renderer, doc, opts);
  download(new Blob([markup], { type: 'image/svg+xml' }), safeName(doc.name) + '.svg');
  return { bytes: markup.length };
}
export async function exportRaster(renderer, doc, opts) {
  const fmt = opts.format === 'jpg' ? 'jpg' : 'png';
  const bgMode = fmt === 'jpg' && opts.background === 'transparent' ? 'white' : opts.background;
  const { markup, bounds } = buildSvg(renderer, doc, { ...opts, background: bgMode });
  const canvas = await toCanvas(markup, bounds, {
    scale: opts.scale,
    flatten: fmt === 'jpg' ? (bgColor(doc, bgMode) || '#ffffff') : null,
  });
  const blob = await new Promise((res) => canvas.toBlob(res, fmt === 'jpg' ? 'image/jpeg' : 'image/png', opts.quality ?? 0.92));
  download(blob, safeName(doc.name) + '.' + fmt);
  return { bytes: blob.size, w: canvas.width, h: canvas.height };
}
/* ---------- JSON backup ---------- */
export function exportJson(doc) {
  const payload = JSON.stringify(toFile(doc), null, 2);
  download(new Blob([payload], { type: 'application/json' }), safeName(doc.name) + '.flowstate.json');
  return { bytes: payload.length };
}

/** Every saved project in one file. */
export function exportBundle(docs) {
  const payload = JSON.stringify({ kind: 'flowstate.bundle', version: 1, exportedAt: new Date().toISOString(), docs: docs.map(toFile) }, null, 2);
  download(new Blob([payload], { type: 'application/json' }), 'flowstate-all-projects.json');
  return { bytes: payload.length, count: docs.length };
}
