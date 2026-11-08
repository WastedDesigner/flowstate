// Sketch recognition: photo or scan of a hand-drawn flowchart -> shapes, arrows, text.
//
// Everything runs in the browser on a 2D canvas. The pipeline is:
//   decode -> downscale -> grey -> adaptive threshold -> deskew -> connected components
//   -> classify (shape / line / glyph) -> group glyphs into labels -> trace arrows
//   -> attach arrow ends to shapes -> score confidence.
// Nothing here is certain, so every item carries a confidence and the reasons behind it;
// the review step shows the doubtful ones first.

export const SCAN_DEFAULTS = {
  maxDim: 1400,        // working resolution
  sensitivity: 0.5,    // 0 = only the darkest ink, 1 = faint pencil too
  deskew: true,
  rotate: 0,           // extra quarter turns the user asked for
};

/* ---------------------------------------------------------------- decoding */

export async function decode(src) {
  if (src instanceof HTMLCanvasElement) return src;
  if (typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap) return src;
  if (src instanceof HTMLImageElement) { if (!src.complete) await src.decode(); return src; }
  if (typeof createImageBitmap === 'function' && (src instanceof Blob)) {
    try { return await createImageBitmap(src, { imageOrientation: 'from-image' }); }
    catch { /* older browsers: fall through */ }
  }
  const url = src instanceof Blob ? URL.createObjectURL(src) : String(src);
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    if (src instanceof Blob) setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/avif'];
export const isImageFile = (f) => !!f && (IMAGE_TYPES.includes(f.type) || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name || ''));

function toCanvas(img, maxDim, quarterTurns = 0) {
  const sw = img.width || img.naturalWidth, sh = img.height || img.naturalHeight;
  if (!sw || !sh) throw new Error('The image has no readable pixels.');
  const turned = quarterTurns % 2 === 1;
  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const w = Math.max(1, Math.round((turned ? sh : sw) * scale));
  const h = Math.max(1, Math.round((turned ? sw : sh) * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate((quarterTurns % 4) * Math.PI / 2);
  ctx.drawImage(img, -sw * scale / 2, -sh * scale / 2, sw * scale, sh * scale);
  ctx.restore();
  return c;
}

/* ------------------------------------------------------------ binarisation */

/** Mean of a w*h window using an integral image. */
function boxMean(gray, W, H, radius) {
  const sum = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let rowSum = 0;
    for (let x = 0; x < W; x++) {
      rowSum += gray[y * W + x];
      sum[(y + 1) * (W + 1) + x + 1] = sum[y * (W + 1) + x + 1] + rowSum;
    }
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - radius), y1 = Math.min(H - 1, y + radius);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - radius), x1 = Math.min(W - 1, x + radius);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const s = sum[(y1 + 1) * (W + 1) + x1 + 1] - sum[y0 * (W + 1) + x1 + 1]
        - sum[(y1 + 1) * (W + 1) + x0] + sum[y0 * (W + 1) + x0];
      out[y * W + x] = s / area;
    }
  }
  return out;
}

/** Adaptive threshold that copes with shadows and uneven phone lighting. */
function binarize(canvas, sensitivity) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const px = ctx.getImageData(0, 0, W, H).data;
  const gray = new Float32Array(W * H);
  let mean = 0;
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const a = px[p + 3] / 255;
    // treat transparent pixels as paper
    const v = (0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2]) * a + 255 * (1 - a);
    gray[i] = v;
    mean += v;
  }
  mean /= gray.length;

  const radius = Math.max(8, Math.round(Math.min(W, H) / 14));
  const local = boxMean(gray, W, H, radius);
  // sensitivity 0 -> needs to be 18% darker than its surroundings; 1 -> 2% is enough
  const k = 0.18 - 0.16 * Math.min(1, Math.max(0, sensitivity));
  const bias = 2;

  const ink = new Uint8Array(W * H);
  let inkCount = 0;
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] < local[i] * (1 - k) - bias) { ink[i] = 1; inkCount++; }
  }
  // photo of a whiteboard shot in the dark, or an inverted export: flip it
  let inverted = false;
  if (inkCount > gray.length * 0.42) {
    inverted = true;
    inkCount = 0;
    for (let i = 0; i < gray.length; i++) {
      ink[i] = gray[i] > local[i] * (1 + k) + bias ? 1 : 0;
      inkCount += ink[i];
    }
  }
  return { ink, W, H, inkCount, meanLuma: mean, inverted };
}

/* ---------------------------------------------------------------- deskewing */

/** Rotation that makes horizontal runs line up best (projection sharpness). */
function estimateSkew(ink, W, H) {
  // Sample columns, never rows: skipping rows makes the untilted angle score higher
  // than it should, because every sampled pixel lands on the same few scan lines.
  const step = Math.max(1, Math.round(W / 420));
  const pts = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x += step) if (ink[y * W + x]) pts.push(x, y);
  }
  if (pts.length < 200) return 0;
  const cx = W / 2, cy = H / 2;
  // the accumulator spans the rotated diagonal, otherwise large angles lose points
  // off the ends and every image looks "already straight"
  const span = Math.ceil(W + H), half = span >> 1;
  const rows = new Float32Array(span + 2);
  let best = 0, bestScore = -Infinity;
  for (let deg = -14; deg <= 14; deg += 0.5) {
    const a = deg * Math.PI / 180, s = Math.sin(a), c = Math.cos(a);
    rows.fill(0);
    for (let i = 0; i < pts.length; i += 2) {
      const dx = pts[i] - cx, dy = pts[i + 1] - cy;
      const fy = dx * s + dy * c + half;
      const i0 = fy | 0, frac = fy - i0;         // spread across two bins: no lattice bias
      rows[i0] += 1 - frac;
      rows[i0 + 1] += frac;
    }
    let score = 0;
    for (let y = 0; y < span; y++) score += rows[y] * rows[y];
    if (score > bestScore) { bestScore = score; best = deg; }
  }
  return Math.abs(best) < 0.6 ? 0 : best;
}

function rotateCanvas(canvas, deg) {
  // `deg` is the tilt found in the picture; rotating by the same amount cancels it,
  // because estimateSkew reports the correction, not the error.
  const a = deg * Math.PI / 180;
  const w = canvas.width, h = canvas.height;
  const cos = Math.abs(Math.cos(a)), sin = Math.abs(Math.sin(a));
  const W = Math.round(w * cos + h * sin), H = Math.round(w * sin + h * cos);
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = cornerColour(canvas);   // match the paper, or the rotation adds a false edge
  ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2, H / 2);
  ctx.rotate(a);
  ctx.drawImage(canvas, -w / 2, -h / 2);
  return out;
}

/** Average of the four corner pixels — a decent guess at the paper or desk colour. */
function cornerColour(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const w = canvas.width, h = canvas.height;
  let r = 0, g = 0, b = 0;
  for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) {
    const d = ctx.getImageData(x, y, 1, 1).data;
    r += d[0]; g += d[1]; b += d[2];
  }
  return `rgb(${Math.round(r / 4)},${Math.round(g / 4)},${Math.round(b / 4)})`;
}

/* ------------------------------------------------- connected components */

/**
 * 8-connected labelling of a binary mask.
 * @returns components with bbox, area, pixel indices and whether they touch the border.
 */
function labelMask(mask, W, H, minArea = 1) {
  const labels = new Int32Array(W * H);
  const parent = [0];
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };
  let next = 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!mask[i]) continue;
      const w = x > 0 ? labels[i - 1] : 0;
      const n = y > 0 ? labels[i - W] : 0;
      const nw = x > 0 && y > 0 ? labels[i - W - 1] : 0;
      const ne = x < W - 1 && y > 0 ? labels[i - W + 1] : 0;
      let L = 0;
      for (const c of [w, n, nw, ne]) if (c && (!L || c < L)) L = c;
      if (!L) { L = next; parent[next] = next; next++; }
      labels[i] = L;
      for (const c of [w, n, nw, ne]) if (c && c !== L) union(L, c);
    }
  }
  let count = 0;
  const remap = new Int32Array(next);
  for (let l = 1; l < next; l++) if (find(l) === l) remap[l] = ++count;
  for (let l = 1; l < next; l++) remap[l] = remap[find(l)];

  const area = new Int32Array(count + 1);
  const minX = new Int32Array(count + 1).fill(W), minY = new Int32Array(count + 1).fill(H);
  const maxX = new Int32Array(count + 1).fill(-1), maxY = new Int32Array(count + 1).fill(-1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const l = labels[y * W + x];
      if (!l) continue;
      const c = remap[l];
      labels[y * W + x] = c;
      area[c]++;
      if (x < minX[c]) minX[c] = x;
      if (x > maxX[c]) maxX[c] = x;
      if (y < minY[c]) minY[c] = y;
      if (y > maxY[c]) maxY[c] = y;
    }
  }
  const keep = [], index = new Map();
  for (let c = 1; c <= count; c++) {
    if (area[c] < minArea) continue;
    index.set(c, keep.length);
    keep.push({
      label: c, x: minX[c], y: minY[c], w: maxX[c] - minX[c] + 1, h: maxY[c] - minY[c] + 1,
      area: area[c], px: new Int32Array(area[c]), n: 0,
      border: minX[c] === 0 || minY[c] === 0 || maxX[c] === W - 1 || maxY[c] === H - 1,
    });
  }
  for (let i = 0; i < labels.length; i++) {
    const c = labels[i];
    if (!c) continue;
    const k = index.get(c);
    if (k === undefined) { labels[i] = 0; continue; }
    const comp = keep[k];
    comp.px[comp.n++] = i;
  }
  return { comps: keep, labels };
}

/** Median horizontal run of ink — a good proxy for pen thickness. */
function strokeWidth(ink, W, H) {
  const runs = [];
  for (let y = 0; y < H; y += 2) {
    let run = 0;
    for (let x = 0; x < W; x++) {
      if (ink[y * W + x]) run++;
      else { if (run > 0 && run < 60) runs.push(run); run = 0; }
    }
  }
  if (!runs.length) return 2;
  runs.sort((a, b) => a - b);
  return Math.max(1.5, runs[Math.floor(runs.length * 0.5)]);
}

/* --------------------------------------------------- geometry helpers */

function hull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}
const polyArea = (poly) => {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return Math.abs(a) / 2;
};
function pointLineDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
}
/** Drop vertices until every remaining one bends the outline by more than `eps`. */
function simplify(poly, eps) {
  let pts = poly.slice();
  while (pts.length > 3) {
    let worst = -1, worstErr = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      const err = pointLineDist(b, a, c);
      if (err < worstErr) { worstErr = err; worst = i; }
    }
    if (worstErr > eps) break;
    pts.splice(worst, 1);
  }
  return pts;
}

const boxOf = (c) => ({ x: c.x, y: c.y, w: c.w, h: c.h });
const centre = (b) => [b.x + b.w / 2, b.y + b.h / 2];
const inflate = (b, d) => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });
const contains = (b, p) => p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h;
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
function distToBox(b, p) {
  const dx = Math.max(b.x - p[0], 0, p[0] - (b.x + b.w));
  const dy = Math.max(b.y - p[1], 0, p[1] - (b.y + b.h));
  return Math.hypot(dx, dy);
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mid2 = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
function median(arr) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * The two ends of a stroke, measured *along* it rather than across the picture.
 * Two breadth-first sweeps give the longest path through the blob, so an elbow
 * connector reports its real ends instead of the outside of its bend.
 */
function endpointsOf(comp, W) {
  const w = comp.w + 2, h = comp.h + 2, x0 = comp.x - 1, y0 = comp.y - 1;
  const grid = new Int32Array(w * h).fill(-1);
  for (let i = 0; i < comp.n; i++) {
    const p = comp.px[i];
    grid[(Math.floor(p / W) - y0) * w + (p % W - x0)] = 0;
  }
  const queue = new Int32Array(comp.n);
  const prev = new Int32Array(w * h).fill(-1);
  const sweep = (start) => {
    for (let i = 0; i < grid.length; i++) if (grid[i] >= 0) grid[i] = 0;
    prev.fill(-1);
    let head = 0, tail = 0;
    queue[tail++] = start;
    grid[start] = 1;
    let last = start;
    while (head < tail) {
      const i = queue[head++];
      last = i;
      const cx = i % w, cy = (i - cx) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (grid[j] !== 0) continue;
          grid[j] = grid[i] + 1;
          prev[j] = i;
          queue[tail++] = j;
        }
      }
    }
    return last;
  };
  const toPt = (i) => [(i % w) + x0, Math.floor(i / w) + y0];
  const first = (comp.px[0] !== undefined) ? (Math.floor(comp.px[0] / W) - y0) * w + (comp.px[0] % W - x0) : 0;
  const aI = sweep(first);
  const bI = sweep(aI);
  // walk back along the longest path so bends can be measured
  const path = [];
  for (let i = bI, guard = 0; i >= 0 && guard < 20000; i = prev[i], guard++) path.push(toPt(i));
  path.reverse();
  return { a: toPt(aI), b: toPt(bI), path };
}
/** Ink mass within `r` of a point — an arrowhead is heavier than a bare line end. */
function massNear(comp, W, pt, r) {
  const r2 = r * r;
  let n = 0;
  for (let i = 0; i < comp.n; i++) {
    const p = comp.px[i], x = p % W, y = Math.floor(p / W);
    if ((x - pt[0]) ** 2 + (y - pt[1]) ** 2 <= r2) n++;
  }
  return n;
}
/** Biggest deviation of the traced stroke from the straight line between its ends. */
function pathBend(path, a, b) {
  if (!path || path.length < 5) return null;
  let best = null, bd = -1;
  const stride = Math.max(1, Math.floor(path.length / 400));
  for (let i = stride; i < path.length - stride; i += stride) {
    const d = pointLineDist(path[i], a, b);
    if (d > bd) { bd = d; best = path[i]; }
  }
  return best ? { point: best, dist: bd } : null;
}
function farthestFromLine(comp, W, a, b) {
  let best = null, bd = -1;
  const stride = Math.max(1, Math.floor(comp.n / 1200));
  for (let i = 0; i < comp.n; i += stride) {
    const p = comp.px[i], x = p % W, y = Math.floor(p / W);
    const d = pointLineDist([x, y], a, b);
    if (d > bd) { bd = d; best = [x, y]; }
  }
  return { point: best || mid2(a, b), dist: bd };
}

/* ------------------------------------------------------ shape classifier */

/**
 * Classify a shape from the outline of its *interior*.
 * Interiors are far more reliable than strokes: a hand-drawn box has a wobbly
 * outline but the white space it encloses is still rectangular.
 */
function classifyInterior(points, box, solid, pen = 4) {
  const hl = hull(points);
  const bboxArea = box.w * box.h;
  const ratio = bboxArea ? polyArea(hl) / bboxArea : 0;
  const poly = simplify(hl, Math.max(2.5, Math.min(box.w, box.h) * 0.075));
  const aspect = box.w / box.h;
  const reasons = [];

  let midHits = 0;
  for (const v of poly) {
    const fx = (v[0] - box.x) / box.w, fy = (v[1] - box.y) / box.h;
    if ((Math.abs(fx - 0.5) < 0.2 && (fy < 0.16 || fy > 0.84)) || (Math.abs(fy - 0.5) < 0.2 && (fx < 0.16 || fx > 0.84))) midHits++;
  }
  // Does the interior actually reach into the corners of its box? A rectangle does,
  // a rounded box or a diamond does not. This separates them far more reliably
  // than counting vertices on a wobbly outline.
  const inX = Math.min(box.w * 0.2, Math.max(3, pen * 1.6));
  const inY = Math.min(box.h * 0.2, Math.max(3, pen * 1.6));
  const probe = (px, py) => {
    if (!solid) return null;
    const gx = Math.round(px) - solid.x0, gy = Math.round(py) - solid.y0;
    if (gx < 0 || gy < 0 || gx >= solid.w || gy >= solid.h) return false;
    return !!solid.grid[gy * solid.w + gx];
  };
  const tl = probe(box.x + inX, box.y + inY), tr = probe(box.x + box.w - inX, box.y + inY);
  const bl = probe(box.x + inX, box.y + box.h - inY), br = probe(box.x + box.w - inX, box.y + box.h - inY);
  const occ = solid ? [tl, tr, bl, br].filter(Boolean).length : null;
  const polyCorners = poly.filter((v) => {
    const fx = (v[0] - box.x) / box.w, fy = (v[1] - box.y) / box.h;
    return (fx < 0.17 || fx > 0.83) && (fy < 0.17 || fy > 0.83);
  }).length;
  const cornerHits = occ === null ? polyCorners : occ;
  const lean = leaning(poly, box);

  let kind, score;
  if (ratio < 0.68 && cornerHits <= 1 && midHits >= 2) {
    kind = 'decision';
    score = 0.92 - Math.abs(ratio - 0.5);
    reasons.push('points at the edge midpoints and empty corners — a diamond');
  } else if (occ === 2 && ((tl && br) || (tr && bl)) && ratio > 0.68) {
    kind = 'io';
    score = 0.74;
    reasons.push('two opposite corners are cut away — sloping sides');
  } else if (cornerHits >= 3 && ratio > 0.84) {
    kind = lean ? 'io' : 'process';
    score = 0.72 + Math.min(0.24, (ratio - 0.84) * 2);
    reasons.push(lean ? 'four corners with sloping sides' : 'square corners filling its box');
  } else if (ratio >= 0.6 && cornerHits <= 1) {
    kind = 'terminal';
    score = 0.7 + Math.min(0.2, (ratio - 0.6) * 0.5);
    reasons.push('rounded or oval outline with empty corners');
  } else if (ratio < 0.68) {
    kind = 'decision';
    score = 0.4;
    reasons.push(`a narrow outline (it fills ${Math.round(ratio * 100)}% of its box)`);
  } else {
    kind = 'process';
    score = 0.35;
    reasons.push(`the outline is hard to read (it fills ${Math.round(ratio * 100)}% of its box)`);
  }
  if (kind === 'terminal' && Math.abs(aspect - 1) < 0.25 && Math.min(box.w, box.h) < 90) {
    reasons.push('small and round — this may be an on-page connector');
  }
  return { kind, confidence: Math.max(0.15, Math.min(0.96, score)), ratio, aspect, reasons };
}
function leaning(poly, box) {
  let slanted = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (Math.abs(dy) > box.h * 0.45 && Math.abs(dx) > box.w * 0.1) slanted++;
  }
  return slanted >= 2;
}

/* ---------------------------------------------- interior -> outline ring */

/** Fill islands inside a hole so glyphs drawn in a box count as part of its interior. */
function solidify(comp, W, pad = 1) {
  const x0 = comp.x - pad, y0 = comp.y - pad, w = comp.w + pad * 2, h = comp.h + pad * 2;
  const grid = new Uint8Array(w * h);
  for (let i = 0; i < comp.n; i++) {
    const p = comp.px[i];
    grid[(Math.floor(p / W) - y0) * w + (p % W - x0)] = 1;
  }
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let i = 0; i < w; i++) { stack.push(i, (h - 1) * w + i); }
  for (let j = 0; j < h; j++) { stack.push(j * w, j * w + w - 1); }
  while (stack.length) {
    const i = stack.pop();
    if (seen[i] || grid[i]) continue;
    seen[i] = 1;
    const cx = i % w, cy = (i - cx) / w;
    if (cx > 0) stack.push(i - 1);
    if (cx < w - 1) stack.push(i + 1);
    if (cy > 0) stack.push(i - w);
    if (cy < h - 1) stack.push(i + w);
  }
  for (let i = 0; i < grid.length; i++) if (!grid[i] && !seen[i]) grid[i] = 1;
  return { grid, x0, y0, w, h };
}

/**
 * Mark the pen stroke that draws a shape, starting from the edge of its interior and
 * growing a few stroke-widths through the ink. Arrows that touch the box lose only
 * their last few pixels, so they survive as separate components.
 */
function markRing(solid, ink, ringMask, W, H, reach) {
  const { grid, x0, y0, w, h } = solid;
  const queue = [];
  const depth = new Map();
  const push = (x, y, d) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x;
    if (!ink[i] || ringMask[i]) return;
    ringMask[i] = 1;
    depth.set(i, d);
    queue.push(i);
  };
  for (let gy = 0; gy < h; gy++) {
    for (let gx = 0; gx < w; gx++) {
      if (!grid[gy * w + gx]) continue;
      const edge = gx === 0 || gy === 0 || gx === w - 1 || gy === h - 1
        || !grid[gy * w + gx - 1] || !grid[gy * w + gx + 1] || !grid[(gy - 1) * w + gx] || !grid[(gy + 1) * w + gx];
      if (!edge) continue;
      const X = gx + x0, Y = gy + y0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) push(X + dx, Y + dy, 1);
    }
  }
  let qi = 0;
  while (qi < queue.length) {
    const i = queue[qi++];
    const d = depth.get(i);
    if (d >= reach) continue;
    const x = i % W, y = (i - x) / W;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        push(x + dx, y + dy, d + 1);
      }
    }
  }
}

/* ------------------------------------------------------------- main entry */

export async function scanImage(src, options = {}) {
  const opts = { ...SCAN_DEFAULTS, ...options };
  const t0 = performance.now();
  const img = await decode(src);
  let canvas = toCanvas(img, opts.maxDim, opts.rotate || 0);

  let bin = binarize(canvas, opts.sensitivity);
  let angle = 0;
  if (opts.deskew) {
    angle = estimateSkew(bin.ink, bin.W, bin.H);
    if (angle) {
      canvas = rotateCanvas(canvas, angle);
      bin = binarize(canvas, opts.sensitivity);
    }
  }
  const { ink, W, H } = bin;
  const warnings = [];
  if (bin.inverted) warnings.push('The picture looked light-on-dark, so the colours were flipped before tracing.');
  if (bin.inkCount < W * H * 0.0012) warnings.push('Very little ink was found. Raise the ink sensitivity, or use a sharper, better-lit photo.');

  const minDim = Math.min(W, H), maxSide = Math.max(W, H);
  const pen = strokeWidth(ink, W, H);
  const t1 = performance.now();

  /* ---- 1. shapes are the white regions their outlines enclose ---- */
  const bg = new Uint8Array(W * H);
  for (let i = 0; i < ink.length; i++) bg[i] = ink[i] ? 0 : 1;
  const minHole = Math.max(140, (minDim * 0.05) ** 2 * 0.35, (pen * 6) ** 2);
  const { comps: bgComps } = labelMask(bg, W, H, minHole);
  const holes = bgComps.filter((c) => !c.border && Math.min(c.w, c.h) > Math.max(10, minDim * 0.035));

  const ringMask = new Uint8Array(W * H);
  const shapes = [];

  // Measure every enclosed region first. Gaps between an arrow and a box also come out
  // as enclosed regions, so only convex, non-nesting ones are treated as shapes.
  const candidates = [];
  for (const hole of holes) {
    const solid = solidify(hole, W, 1);
    const pts = [];
    let solidArea = 0;
    const stride = Math.max(1, Math.floor((solid.w * solid.h) / 6000));
    let k = 0;
    for (let gy = 0; gy < solid.h; gy++) {
      for (let gx = 0; gx < solid.w; gx++) {
        if (!solid.grid[gy * solid.w + gx]) continue;
        solidArea++;
        if (k++ % stride === 0) pts.push([gx + solid.x0, gy + solid.y0]);
      }
    }
    if (pts.length < 8) continue;
    const hullA = polyArea(hull(pts)) || 1;
    candidates.push({
      hole, solid, pts,
      solidity: Math.min(1, solidArea / hullA),
      box: { x: hole.x, y: hole.y, w: hole.w, h: hole.h },
      centre: [hole.x + hole.w / 2, hole.y + hole.h / 2],
    });
  }
  const convex = candidates.filter((c) => c.solidity >= 0.84);
  // a region that swallows another one is the space *between* strokes, not a shape
  const keepers = convex.filter((c) => !convex.some((o) =>
    o !== c && c.box.w * c.box.h > o.box.w * o.box.h * 1.5 && contains(inflate(c.box, -2), o.centre)));

  keepers.forEach((c, i) => {
    const hole = c.hole;
    const cl = classifyInterior(c.pts, c.box, c.solid, pen);
    markRing(c.solid, ink, ringMask, W, H, Math.max(4, Math.round(pen * 1.7)));
    shapes.push({
      id: 's' + i, kind: cl.kind,
      x: Math.round(hole.x - pen), y: Math.round(hole.y - pen),
      w: Math.round(hole.w + pen * 2), h: Math.round(hole.h + pen * 2),
      confidence: cl.confidence * (c.solidity > 0.93 ? 1 : 0.9),
      reasons: [...cl.reasons], ratio: cl.ratio, aspect: cl.aspect,
      textIds: [], interior: c.box,
    });
  });

  /* ---- 2. what is left over is arrows, arrowheads and text ---- */
  const rest = new Uint8Array(W * H);
  for (let i = 0; i < ink.length; i++) rest[i] = ink[i] && !ringMask[i] ? 1 : 0;
  const noiseArea = Math.max(5, Math.round(W * H * 0.000010));
  const { comps } = labelMask(rest, W, H, noiseArea);

  const measured = comps.map((c) => {
    const ends = endpointsOf(c, W);
    const diameter = Math.max(2, dist(ends.a, ends.b));
    const thickness = Math.max(1, c.area / diameter);
    return { comp: c, ends, diameter, thickness, fill: c.area / (c.w * c.h) };
  });
  const glyphHeights = measured.filter((m) => m.comp.h < minDim * 0.1).map((m) => m.comp.h);
  const medianGlyphH = median(glyphHeights) || Math.max(10, minDim * 0.025);

  const snapR = Math.max(20, minDim * 0.05, pen * 6);
  const lineParts = [], glyphs = [], leftovers = [];
  for (const m of measured) {
    const c = m.comp;
    const elong = m.diameter / m.thickness;
    if (m.diameter > Math.max(22, maxSide * 0.025) && elong > 3.4) { lineParts.push(m); continue; }
    // a short stroke still counts as an arrow when it bridges two different shapes —
    // trimming the outlines away can leave very little of a tight connector
    if (elong > 2.8 && m.thickness < pen * 3 && m.diameter > Math.max(14, maxSide * 0.012)) {
      const nearA = nearestShape(shapes, m.ends.a, snapR), nearB = nearestShape(shapes, m.ends.b, snapR);
      if (nearA && nearB && nearA !== nearB) { m.bridges = true; lineParts.push(m); continue; }
    }
    if (Math.min(c.w, c.h) > minDim * 0.09 && elong < 3 && m.fill < 0.55) { leftovers.push(m); continue; }
    glyphs.push(m);
  }

  /* ---- 3. shapes drawn with a gap never enclosed anything: rescue them ---- */
  leftovers.forEach((m, i) => {
    const pts = [];
    const stride = Math.max(1, Math.floor(m.comp.n / 2500));
    for (let j = 0; j < m.comp.n; j += stride) {
      const p = m.comp.px[j];
      pts.push([p % W, Math.floor(p / W)]);
    }
    const cl = classifyInterior(pts, boxOf(m.comp));
    shapes.push({
      id: 'so' + i, kind: cl.kind, ...boxOf(m.comp),
      confidence: cl.confidence * 0.62,
      reasons: [...cl.reasons, 'the outline is not closed, so this may not be a shape at all'],
      ratio: cl.ratio, aspect: cl.aspect, textIds: [], interior: boxOf(m.comp),
    });
  });

  /* ---- 4. arrowheads ---- */
  // Barbs are often drawn as their own short strokes. Fold any short stroke that ends
  // near a longer one into that line, and remember which end it marks.
  lineParts.sort((a, b) => b.diameter - a.diameter);
  const barbs = new Set();
  for (let i = 1; i < lineParts.length; i++) {
    const small = lineParts[i];
    for (let j = 0; j < i; j++) {
      const big = lineParts[j];
      if (barbs.has(big) || small.diameter > big.diameter * 0.5) continue;
      const c = centre(boxOf(small.comp));
      const da = dist(c, big.ends.a), db = dist(c, big.ends.b);
      if (Math.min(da, db) > Math.max(16, pen * 5)) continue;
      barbs.add(small);
      big.headHint = da < db ? 'a' : 'b';
      big.headMass = (big.headMass || 0) + small.comp.area;
      break;
    }
  }
  const lines = lineParts.filter((m) => !barbs.has(m));

  const usedAsHead = new Set();
  for (const lm of lines) {
    for (const g of glyphs) {
      if (usedAsHead.has(g) || g.comp.area > lm.comp.area * 0.7) continue;
      const gc = centre(boxOf(g.comp));
      const da = dist(gc, lm.ends.a), db = dist(gc, lm.ends.b);
      if (Math.min(da, db) < Math.max(12, pen * 5)) {
        usedAsHead.add(g);
        lm.headHint = da < db ? 'a' : 'b';
        lm.headMass = (lm.headMass || 0) + g.comp.area;
      }
    }
  }
  const textGlyphs = glyphs.filter((g) => !usedAsHead.has(g));

  /* ---- 5. text blocks ---- */
  const blocks = groupGlyphs(textGlyphs.map((g) => boxOf(g.comp)), medianGlyphH);
  // the height of a whole word is the useful scale here; the median *component*
  // height is dragged down by dots, specks and broken letter parts
  const blockH = median(blocks.map((b) => b.h)) || medianGlyphH;
  const texts = blocks.map((b, i) => ({
    id: 't' + i, x: b.x, y: b.y, w: b.w, h: b.h,
    value: '', confidence: 0, ownerId: null, role: 'floating', parts: b.parts,
  }));
  for (const t of texts) {
    const c = centre(t);
    let best = null;
    for (const s of shapes) {
      if (!contains(inflate(s, Math.max(3, blockH * 0.25)), c)) continue;
      if (!best || s.w * s.h < best.w * best.h) best = s;
    }
    if (best) { t.ownerId = best.id; t.role = 'label'; best.textIds.push(t.id); }
  }

  /* ---- 6. arrows ---- */
  const arrows = [];
  lines.forEach((m, i) => {
    const { a, b } = m.ends;
    const rHead = Math.max(8, m.thickness * 3.2);
    const massA = massNear(m.comp, W, a, rHead) + (m.headHint === 'a' ? m.headMass : 0);
    const massB = massNear(m.comp, W, b, rHead) + (m.headHint === 'b' ? m.headMass : 0);
    const reasons = [];
    const ratio = Math.max(massA, massB) / Math.max(1, Math.min(massA, massB));
    let headIsB = massB >= massA, headConf;
    if (m.headHint) { headConf = 0.86; headIsB = m.headHint === 'b'; reasons.push('an arrowhead sits at one end'); }
    else if (ratio > 1.35) { headConf = Math.min(0.88, 0.42 + ratio * 0.16); reasons.push('one end carries more ink, so it is read as the head'); }
    else { headConf = 0.3; reasons.push('no arrowhead was visible — the direction follows the layout'); }

    let tail = headIsB ? a : b, head = headIsB ? b : a;
    if (headConf < 0.4) {
      if (Math.abs(a[1] - b[1]) >= Math.abs(a[0] - b[0])) { tail = a[1] < b[1] ? a : b; head = a[1] < b[1] ? b : a; }
      else { tail = a[0] < b[0] ? a : b; head = a[0] < b[0] ? b : a; }
    }
    const from = nearestShape(shapes, tail, snapR);
    const to = nearestShape(shapes, head, snapR);
    if (!from) reasons.push('the tail does not reach a shape');
    if (!to) reasons.push('the head does not reach a shape');
    let confidence = headConf;
    if (!from || !to) confidence = Math.min(confidence, 0.28);
    if (from && to && from.id === to.id) { confidence = 0.2; reasons.push('both ends land on the same shape'); }
    const bend = pathBend(m.ends.path, tail, head) || farthestFromLine(m.comp, W, tail, head);
    const trace = (m.ends.path || []).filter((_, k) => k % Math.max(1, Math.floor((m.ends.path.length) / 24)) === 0);
    arrows.push({
      id: 'a' + i, from: from?.id || null, to: to?.id || null,
      fromSide: from ? sideOf(from, tail) : null,
      toSide: to ? sideOf(to, head) : null,
      trace: trace.length > 2 ? trace : null,
      tail, head, mid: bend.dist > Math.max(10, pen * 3) ? bend.point : null,
      confidence, reasons, label: null,
      x: Math.min(tail[0], head[0]), y: Math.min(tail[1], head[1]),
      w: Math.abs(head[0] - tail[0]), h: Math.abs(head[1] - tail[1]),
    });
  });

  /* ---- 7. loose text near an arrow becomes its label ---- */
  const labelReach = Math.max(50, blockH * 3);
  for (const t of texts) {
    if (t.ownerId) continue;
    const c = centre(t);
    let best = null, bd = Infinity;
    for (const ar of arrows) {
      // measure against the stroke itself: the midpoint of a long elbow sits
      // nowhere near the line the writing was put beside
      const pts = ar.trace && ar.trace.length > 2
        ? ar.trace
        : (ar.mid ? [ar.mid, mid2(ar.tail, ar.head)] : [mid2(ar.tail, ar.head)]);
      for (const mp of pts) {
        const d = dist(c, mp);
        if (d < bd) { bd = d; best = ar; }
      }
    }
    if (best && bd < labelReach) {
      t.role = 'edge';
      t.ownerId = best.id;
      best.label = t.id;
    }
  }

  const stray = arrows.filter((a) => !a.from && !a.to).length;
  if (stray) {
    warnings.push(`${stray} line${stray > 1 ? 's were' : ' was'} ignored because neither end reached a shape — stray marks, a page edge or an arrow drawn too far from its box. Draw those connections on the canvas afterwards.`);
  }
  if (!shapes.length) warnings.push('No closed shapes were found. If the boxes are faint or broken, raise the ink sensitivity.');
  else if (!arrows.length) warnings.push('Shapes were found but no arrows between them — you can draw the connections once they are on the canvas.');

  return {
    canvas, width: W, height: H, angle,
    shapes, arrows, texts, warnings, droppedShapes: 0,
    stats: {
      components: comps.length + holes.length, glyphs: textGlyphs.length, pen: +pen.toFixed(1),
      ms: Math.round(performance.now() - t0), prep: Math.round(t1 - t0),
      inkPercent: +(bin.inkCount / (W * H) * 100).toFixed(2),
    },
    options: opts,
  };
}

/* ------------------------------------------------------------- utilities */

/** Merge glyph boxes that sit close enough to be one word or line of writing. */
function groupGlyphs(boxes, glyphH) {
  if (!boxes.length) return [];
  const gapX = Math.max(6, glyphH * 0.85), gapY = Math.max(3, glyphH * 0.4);
  const parent = boxes.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const grown = { x: boxes[j].x - gapX, y: boxes[j].y - gapY, w: boxes[j].w + gapX * 2, h: boxes[j].h + gapY * 2 };
      if (overlaps(boxes[i], grown)) {
        const a = find(i), b = find(j);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
  }
  const groups = new Map();
  boxes.forEach((b, i) => {
    const r = find(i), g = groups.get(r);
    if (!g) groups.set(r, { x: b.x, y: b.y, w: b.w, h: b.h, parts: 1 });
    else {
      const x1 = Math.max(g.x + g.w, b.x + b.w), y1 = Math.max(g.y + g.h, b.y + b.h);
      g.x = Math.min(g.x, b.x); g.y = Math.min(g.y, b.y);
      g.w = x1 - g.x; g.h = y1 - g.y; g.parts++;
    }
  });
  return [...groups.values()];
}

/** Which side of a box an endpoint arrived on — keeps the sketch's own routing. */
function sideOf(box, p) {
  const d = [
    [p[1] - box.y, 'n'], [box.x + box.w - p[0], 'e'],
    [box.y + box.h - p[1], 's'], [p[0] - box.x, 'w'],
  ];
  d.sort((a, b) => a[0] - b[0]);
  return d[0][1];
}

function nearestShape(shapes, pt, radius) {
  let best = null, bd = radius;
  for (const s of shapes) {
    const d = distToBox(s, pt);
    if (d <= bd) { bd = d; best = s; }
  }
  return best;
}

/** Crop a detected box out of the working canvas (thumbnails and recognition). */
export function cropOf(canvas, box, pad = 3, scale = 1) {
  const x = Math.max(0, Math.floor(box.x - pad)), y = Math.max(0, Math.floor(box.y - pad));
  const w = Math.max(1, Math.min(canvas.width - x, Math.ceil(box.w + pad * 2)));
  const h = Math.max(1, Math.min(canvas.height - y, Math.ceil(box.h + pad * 2)));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(canvas, x, y, w, h, 0, 0, c.width, c.height);
  return c;
}
