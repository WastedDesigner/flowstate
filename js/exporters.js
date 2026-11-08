// Export: SVG, PNG, JPEG and PDF (no third-party libraries), JSON backups, and diagrams embedded in images.
// Every export draws a prepared copy of the document (whole or selection only, optionally in another theme)
// through its own off-screen renderer, so the on-screen view never changes.
import { docBounds, THEMES, toFile, applyTheme } from './model.js';
import { download, clone } from './util.js';
import { Renderer } from './render.js';

const XMLNS = 'http://www.w3.org/2000/svg';

export const PAGES = {
  fit: { label: 'Fit to drawing' },
  a4: { label: 'A4 (210 × 297 mm)', w: 595.28, h: 841.89 },
  a3: { label: 'A3 (297 × 420 mm)', w: 841.89, h: 1190.55 },
  letter: { label: 'US Letter (8.5 × 11 in)', w: 612, h: 792 },
};
export const DPIS = [72, 96, 150, 300, 600];

/** The document to draw: the selection only (if given) and/or restyled in another theme. */
export function exportDoc(doc, { selection = null, theme = null } = {}) {
  const d = clone(doc);
  if (selection && selection.size) {
    d.nodes = d.nodes.filter((n) => selection.has(n.id));
    const ids = new Set(d.nodes.map((n) => n.id));
    d.edges = d.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  }
  if (theme && THEMES[theme] && theme !== d.settings.theme) applyTheme(d, theme);
  return d;
}

function scene(d) {
  const svg = document.createElementNS(XMLNS, 'svg');
  const store = { doc: d, viewport: { x: 0, y: 0, k: 1 }, selNodes: new Set(), selEdges: new Set(), selectedNodes: () => [], selectedEdges: () => [] };
  const r = new Renderer(svg, store);
  r.render();
  return r;
}

const bgOf = (d, o) => (o.transparent ? null : o.bgColor || (THEMES[d.settings.theme] || THEMES.midnight).bg);

function b64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}
const unb64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

/**
 * Build a self-contained SVG document string.
 * opts: padding, transparent, bgColor, grid, shadow, embed
 */
export function buildSvg(d, opts = {}) {
  const renderer = scene(d);
  const pad = opts.padding ?? 32;
  const b = docBounds(d, pad);
  const svg = document.createElementNS(XMLNS, 'svg');
  svg.setAttribute('xmlns', XMLNS);
  svg.setAttribute('width', Math.max(1, Math.round(b.w)));
  svg.setAttribute('height', Math.max(1, Math.round(b.h)));
  svg.setAttribute('viewBox', `${b.x} ${b.y} ${b.w} ${b.h}`);
  const title = document.createElementNS(XMLNS, 'title');
  title.textContent = d.name || 'Flowchart';
  svg.append(title);
  if (opts.embed) {
    const meta = document.createElementNS(XMLNS, 'metadata');
    meta.setAttribute('id', 'flowstate-data');
    meta.textContent = b64(JSON.stringify(toFile(d)));
    svg.append(meta);
  }

  const defs = document.createElementNS(XMLNS, 'defs');
  for (const m of renderer.defs.querySelectorAll('marker')) defs.append(m.cloneNode(true));
  if (opts.shadow) {
    const f = document.createElementNS(XMLNS, 'filter');
    f.setAttribute('id', 'fsShadow'); f.setAttribute('x', '-20%'); f.setAttribute('y', '-20%'); f.setAttribute('width', '150%'); f.setAttribute('height', '150%');
    const s = document.createElementNS(XMLNS, 'feDropShadow');
    for (const [k, v] of Object.entries({ dx: 2, dy: 3, stdDeviation: 3, 'flood-color': '#000000', 'flood-opacity': 0.35 })) s.setAttribute(k, v);
    f.append(s); defs.append(f);
  }
  svg.append(defs);

  const bg = bgOf(d, opts);
  if (bg) {
    const r = document.createElementNS(XMLNS, 'rect');
    r.setAttribute('x', b.x); r.setAttribute('y', b.y); r.setAttribute('width', b.w); r.setAttribute('height', b.h);
    r.setAttribute('fill', bg);
    svg.append(r);
  }
  if (opts.grid) {
    const t = THEMES[d.settings.theme] || THEMES.midnight;
    const step = (d.settings.gridSize || 10) * 2;
    const g = document.createElementNS(XMLNS, 'g');
    g.setAttribute('stroke', t.grid); g.setAttribute('stroke-width', 1);
    const x0 = Math.ceil(b.x / step) * step, y0 = Math.ceil(b.y / step) * step;
    let dd = '';
    for (let x = x0; x < b.x + b.w; x += step) dd += `M${x},${b.y}V${b.y + b.h}`;
    for (let y = y0; y < b.y + b.h; y += step) dd += `M${b.x},${y}H${b.x + b.w}`;
    const p = document.createElementNS(XMLNS, 'path');
    p.setAttribute('d', dd); p.setAttribute('fill', 'none');
    g.append(p); svg.append(g);
  }
  const nodes = renderer.nodeLayer.cloneNode(true);
  if (opts.shadow) nodes.setAttribute('filter', 'url(#fsShadow)');
  svg.append(renderer.edgeLayer.cloneNode(true), nodes);

  for (const el of svg.querySelectorAll('[tabindex],[data-id]')) { el.removeAttribute('tabindex'); el.removeAttribute('data-id'); }
  for (const el of svg.querySelectorAll('.edge-hit,.badges')) el.remove();
  for (const el of svg.querySelectorAll('.sel')) el.classList.remove('sel');

  const style = document.createElementNS(XMLNS, 'style');
  style.textContent = 'text{white-space:pre}.wire{fill:none;stroke-linecap:round;stroke-linejoin:round}.shape{stroke-linejoin:round}.elabel{paint-order:stroke;stroke-linejoin:round}';
  svg.insertBefore(style, svg.firstChild);
  return { markup: '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg), bounds: b, bg };
}

/** Rasterise SVG markup to a canvas at `scale`. */
export function toCanvas(markup, bounds, opts = {}) {
  const scale = opts.scale || 1;
  const w = Math.max(1, Math.round(bounds.w * scale));
  const h = Math.max(1, Math.round(bounds.h * scale));
  if (w * h > 72_000_000) {
    return Promise.reject(new Error(`That would be ${w} × ${h} pixels, which browsers cannot allocate. Lower the zoom or DPI.`));
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
const fileBase = (d, o) => safeName(o.filename || d.name);
const opaque = (o) => o.format === 'jpg' || o.format === 'pdf';

async function canvasFor(d, o) {
  const flat = opaque(o);
  const { markup, bounds, bg } = buildSvg(d, { ...o, transparent: flat ? false : o.transparent, embed: o.format === 'png' && o.embed });
  const canvas = await toCanvas(markup, bounds, { scale: o.scale, flatten: flat ? (bg || '#ffffff') : null });
  return { canvas, bounds, markup };
}

export async function exportSvg(d, o) {
  const { markup } = buildSvg(d, { ...o, embed: o.embed });
  download(new Blob([markup], { type: 'image/svg+xml' }), fileBase(d, o) + '.svg');
  return { bytes: markup.length };
}

/** PNG or JPEG as a Blob (PNG carries the DPI and, optionally, the diagram). */
export async function rasterBlob(d, o) {
  const { canvas } = await canvasFor(d, o);
  const jpg = o.format === 'jpg';
  let blob = await new Promise((res) => canvas.toBlob(res, jpg ? 'image/jpeg' : 'image/png', o.quality ?? 0.92));
  if (!jpg) blob = await pngWithMeta(blob, { dpi: o.dpi, json: o.embed ? JSON.stringify(toFile(d)) : null });
  return { blob, w: canvas.width, h: canvas.height };
}
export async function exportRaster(d, o) {
  const r = await rasterBlob(d, o);
  download(r.blob, fileBase(d, o) + '.' + (o.format === 'jpg' ? 'jpg' : 'png'));
  return { bytes: r.blob.size, w: r.w, h: r.h };
}
export async function copyPng(d, o) {
  const r = await rasterBlob(d, { ...o, format: 'png', embed: false });
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': r.blob })]);
  return r;
}

export async function exportPdf(d, o) {
  const { canvas, bounds } = await canvasFor(d, { ...o, scale: Math.max(o.scale, 2) });
  const dataUrl = canvas.toDataURL('image/jpeg', o.quality ?? 0.92);
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const spec = PAGES[o.page] || PAGES.fit;
  const margin = o.page === 'fit' ? 0 : 28;
  let pw, ph;
  if (o.page === 'fit') { pw = Math.max(36, bounds.w * 0.75); ph = Math.max(36, bounds.h * 0.75); }
  else {
    const landscape = o.orientation === 'landscape' || (o.orientation === 'auto' && bounds.w > bounds.h);
    pw = landscape ? spec.h : spec.w;
    ph = landscape ? spec.w : spec.h;
  }
  const blob = pdfFromJpeg(bytes, canvas.width, canvas.height, { w: pw, h: ph, margin }, d.name);
  download(blob, fileBase(d, o) + '.pdf');
  return { bytes: blob.size, page: `${Math.round(pw)} × ${Math.round(ph)} pt` };
}

/** Minimal single-page PDF wrapping one JPEG. */
export function pdfFromJpeg(jpeg, imgW, imgH, page, title = 'Flowchart') {
  const enc = new TextEncoder();
  const parts = [];
  let len = 0;
  const put = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const offs = {};
  put('%PDF-1.4\n');
  put(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));
  const m = page.margin || 0;
  const s = Math.min((page.w - 2 * m) / imgW, (page.h - 2 * m) / imgH);
  const dw = imgW * s, dh = imgH * s;
  const dx = (page.w - dw) / 2, dy = (page.h - dh) / 2;
  const content = `q\n${dw.toFixed(3)} 0 0 ${dh.toFixed(3)} ${dx.toFixed(3)} ${dy.toFixed(3)} cm\n/Im0 Do\nQ\n`;
  const pdfStr = (t) => '(' + String(t).replace(/[\\()]/g, (c) => '\\' + c).replace(/[^\x20-\x7e]/g, '') + ')';
  const simple = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.w.toFixed(2)} ${page.h.toFixed(2)}] /Resources << /XObject << /Im0 5 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 4 0 R >>`,
  ];
  simple.forEach((body, i) => { offs[i + 1] = len; put(`${i + 1} 0 obj\n${body}\nendobj\n`); });
  offs[4] = len;
  put(`4 0 obj\n<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`);
  offs[5] = len;
  put(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  put(jpeg);
  put('\nendstream\nendobj\n');
  offs[6] = len;
  put(`6 0 obj\n<< /Title ${pdfStr(title)} /Producer (FlowState) /Creator (FlowState) >>\nendobj\n`);
  const xref = len;
  let x = 'xref\n0 7\n0000000000 65535 f \n';
  for (let i = 1; i <= 6; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
  x += `trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  put(x);
  return new Blob(parts, { type: 'application/pdf' });
}

/* ---------- PNG metadata: print resolution and an embedded copy of the diagram ---------- */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
export async function pngWithMeta(blob, { dpi, json }) {
  if (!dpi && !json) return blob;
  const buf = new Uint8Array(await blob.arrayBuffer());
  const extra = [];
  if (dpi) {
    const ppm = Math.round(dpi / 0.0254), d = new Uint8Array(9), dv = new DataView(d.buffer);
    dv.setUint32(0, ppm); dv.setUint32(4, ppm); d[8] = 1;
    extra.push(pngChunk('pHYs', d));
  }
  if (json) extra.push(pngChunk('tEXt', new TextEncoder().encode('flowstate\0' + b64(json))));
  return new Blob([buf.subarray(0, 33), ...extra, buf.subarray(33)], { type: 'image/png' });   // 8-byte signature + IHDR = 33
}

/** The FlowState diagram embedded in an exported PNG or SVG, as JSON text, or null. */
export async function readEmbedded(file) {
  try {
    if (/\.svg$/i.test(file.name) || file.type === 'image/svg+xml') {
      const m = /<metadata[^>]*id="flowstate-data"[^>]*>([^<]*)</.exec(await file.text());
      return m ? unb64(m[1].trim()) : null;
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    const dv = new DataView(buf.buffer);
    const latin = new TextDecoder('latin1');
    for (let p = 8; p + 8 <= buf.length;) {
      const len = dv.getUint32(p), type = latin.decode(buf.subarray(p + 4, p + 8));
      if (type === 'tEXt') {
        const data = buf.subarray(p + 8, p + 8 + len), z = data.indexOf(0);
        if (latin.decode(data.subarray(0, z)) === 'flowstate') return unb64(latin.decode(data.subarray(z + 1)));
      }
      if (type === 'IEND') break;
      p += 12 + len;
    }
  } catch {}
  return null;
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
