// Export: standalone SVG, PNG, JPG, PDF (single page, no third-party libraries).
import { docBounds, THEMES, toFile } from './model.js';
import { download } from './util.js';

const XMLNS = 'http://www.w3.org/2000/svg';

export const PAGES = {
  fit: { label: 'Fit to drawing' },
  a4: { label: 'A4 (210 × 297 mm)', w: 595.28, h: 841.89 },
  a3: { label: 'A3 (297 × 420 mm)', w: 841.89, h: 1190.55 },
  letter: { label: 'US Letter (8.5 × 11 in)', w: 612, h: 792 },
};

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
export async function exportPdf(renderer, doc, opts) {
  const bgMode = opts.background === 'transparent' ? 'white' : opts.background;
  const { markup, bounds } = buildSvg(renderer, doc, { ...opts, background: bgMode });
  const canvas = await toCanvas(markup, bounds, { scale: opts.scale, flatten: bgColor(doc, bgMode) || '#ffffff' });
  const dataUrl = canvas.toDataURL('image/jpeg', opts.quality ?? 0.92);
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const spec = PAGES[opts.page] || PAGES.fit;
  const margin = opts.page === 'fit' ? 0 : (opts.margin ?? 28);
  let pw, ph;
  if (opts.page === 'fit') {
    pw = Math.max(36, bounds.w * 0.75); ph = Math.max(36, bounds.h * 0.75);
  } else {
    const landscape = opts.orientation === 'landscape' || (opts.orientation === 'auto' && bounds.w > bounds.h);
    pw = landscape ? spec.h : spec.w;
    ph = landscape ? spec.w : spec.h;
  }
  const blob = pdfFromJpeg(bytes, canvas.width, canvas.height, { w: pw, h: ph, margin }, doc.name);
  download(blob, safeName(doc.name) + '.pdf');
  return { bytes: blob.size, page: `${Math.round(pw)} × ${Math.round(ph)} pt` };
}

/** Minimal single-page PDF wrapping one JPEG. */
export function pdfFromJpeg(jpeg, imgW, imgH, page, title = 'Flowchart') {
  const enc = new TextEncoder();
  const parts = [];
  let len = 0;
  const put = (d) => { const b = typeof d === 'string' ? enc.encode(d) : d; parts.push(b); len += b.length; };
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

/* ---------- JSON backup ---------- */
export function exportJson(doc) {
  const payload = JSON.stringify(toFile(doc), null, 2);
  download(new Blob([payload], { type: 'application/json' }), safeName(doc.name) + '.flowstate.json');
  return { bytes: payload.length };
}

/* ---------- share link ---------- */
export async function makeShareLink(doc) {
  const json = JSON.stringify(toFile(doc));
  let payload, tag = 'j';
  if (typeof CompressionStream === 'function') {
    const cs = new CompressionStream('deflate-raw');
    const buf = await new Response(new Blob([json]).stream().pipeThrough(cs)).arrayBuffer();
    payload = new Uint8Array(buf); tag = 'z';
  } else {
    payload = new TextEncoder().encode(json);
  }
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < payload.length; i += CH) bin += String.fromCharCode.apply(null, payload.subarray(i, i + CH));
  const b = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return location.origin + location.pathname + '#' + tag + ':' + b;
}
export async function readShareHash(hash) {
  const raw = hash.replace(/^#/, '');
  const i = raw.indexOf(':');
  if (i < 0) return null;
  const tag = raw.slice(0, i);
  let b = raw.slice(i + 1).replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  const bin = atob(b);
  const bytes = new Uint8Array(bin.length);
  for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
  if (tag === 'z') {
    const ds = new DecompressionStream('deflate-raw');
    const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
    return new TextDecoder().decode(buf);
  }
  return new TextDecoder().decode(bytes);
}
