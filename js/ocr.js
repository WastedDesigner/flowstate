// Text recognition for sketch import.
//
// Three tiers, in order of what the browser can actually do:
//   1. "builtin"   — the browser's own TextDetector (Shape Detection API). Free, instant,
//                    but only shipped on some platforms and tuned for printed text.
//   2. "tesseract" — tesseract.js, fetched from a CDN the first time the user asks for it.
//                    Much better on printed text, fair on tidy handwriting. The worker,
//                    the WebAssembly core and the English model add up to several MB.
//   3. "manual"    — no recognition: FlowState shows the cropped snippet and you type it.
// Whatever happens, every label stays editable, so recognition is a convenience, never a
// dependency.

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js';

export const ENGINES = {
  manual: { id: 'manual', label: 'Type the labels myself', note: 'Nothing is downloaded. Each snippet is shown next to a text box.' },
  builtin: { id: 'builtin', label: 'Browser text detection', note: 'Uses the Shape Detection API built into this browser. Instant, best on printed text.' },
  tesseract: { id: 'tesseract', label: 'Downloadable engine (tesseract.js)', note: 'Downloads the engine and the English model from a CDN the first time (several megabytes). Good on print, fair on neat handwriting.' },
};

export function builtinAvailable() {
  return typeof window !== 'undefined' && typeof window.TextDetector === 'function';
}
export function engineList() {
  return [
    ENGINES.manual,
    { ...ENGINES.builtin, disabled: !builtinAvailable(), note: builtinAvailable() ? ENGINES.builtin.note : 'Not available in this browser.' },
    { ...ENGINES.tesseract, disabled: !navigator.onLine, note: navigator.onLine ? ENGINES.tesseract.note : 'Needs an internet connection the first time, to download the engine.' },
  ];
}
/** The best engine we can use without downloading anything. */
export const defaultEngine = () => (builtinAvailable() ? 'builtin' : 'manual');

let worker = null, workerLang = null, loading = null;

export async function prepare(mode, onProgress = () => {}) {
  if (mode === 'manual') return { ok: true, id: 'manual' };
  if (mode === 'builtin') {
    if (!builtinAvailable()) return { ok: false, id: 'manual', error: 'This browser has no built-in text detection.' };
    return { ok: true, id: 'builtin' };
  }
  if (mode !== 'tesseract') return { ok: false, id: 'manual', error: 'Unknown recognition engine.' };
  if (worker && workerLang === 'eng') return { ok: true, id: 'tesseract' };
  if (loading) return loading;
  loading = (async () => {
    try {
      onProgress({ phase: 'script', progress: 0, message: 'Fetching the recognition engine…' });
      const mod = await import(/* @vite-ignore */ TESSERACT_URL);
      const createWorker = mod.createWorker || mod.default?.createWorker;
      if (!createWorker) throw new Error('The engine loaded but did not expose createWorker().');
      onProgress({ phase: 'model', progress: 0.2, message: 'Downloading the English model…' });
      worker = await createWorker('eng', 1, {
        logger: (m) => onProgress({ phase: m.status, progress: 0.2 + (m.progress || 0) * 0.8, message: humanise(m.status) }),
      });
      workerLang = 'eng';
      onProgress({ phase: 'ready', progress: 1, message: 'Engine ready.' });
      return { ok: true, id: 'tesseract' };
    } catch (err) {
      worker = null;
      return { ok: false, id: 'manual', error: friendly(err) };
    } finally {
      loading = null;
    }
  })();
  return loading;
}
function humanise(status) {
  const map = {
    'loading tesseract core': 'Loading the engine core…',
    'initializing tesseract': 'Starting the engine…',
    'loading language traineddata': 'Downloading the English model…',
    'initializing api': 'Getting ready…',
    'recognizing text': 'Reading the handwriting…',
  };
  return map[status] || (status ? status[0].toUpperCase() + status.slice(1) + '…' : 'Working…');
}
function friendly(err) {
  const m = String(err?.message || err);
  if (/Failed to fetch|NetworkError|ERR_|dynamically imported/i.test(m)) {
    return 'The engine could not be downloaded. Check your connection, or type the labels yourself.';
  }
  return 'The recognition engine failed to start: ' + m;
}

export async function dispose() {
  try { await worker?.terminate(); } catch {}
  worker = null; workerLang = null;
}

/** Upscale small crops — both engines do far better with ~56px tall text. */
function prepCrop(canvas, targetH = 56) {
  const scale = Math.min(6, Math.max(1, targetH / Math.max(8, canvas.height)));
  if (scale <= 1.05) return canvas;
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * scale);
  c.height = Math.round(canvas.height * scale);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(canvas, 0, 0, c.width, c.height);
  return c;
}

const tidy = (s) => String(s || '')
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

/**
 * @returns {{text:string, confidence:number, engine:string}|null}
 */
export async function readText(canvas, mode) {
  if (!mode || mode === 'manual') return null;
  const img = prepCrop(canvas);
  try {
    if (mode === 'builtin') {
      const det = new window.TextDetector();
      const blocks = await det.detect(img);
      if (!blocks?.length) return null;
      const text = tidy(blocks.map((b) => b.rawValue || '').join('\n'));
      if (!text) return null;
      return { text, confidence: 0.6, engine: 'builtin' };
    }
    if (mode === 'tesseract') {
      if (!worker) return null;
      const { data } = await worker.recognize(img);
      const text = tidy(data?.text);
      if (!text) return null;
      return { text, confidence: Math.max(0, Math.min(1, (data.confidence ?? 50) / 100)), engine: 'tesseract' };
    }
  } catch {
    return null;
  }
  return null;
}

/** Read every text block, reporting progress. Returns the number recognised. */
export async function readAll(blocks, mode, onStep = () => {}) {
  let done = 0, hits = 0;
  for (const b of blocks) {
    const r = await readText(b.canvas, mode);
    if (r && b.apply(r) !== false) hits++;
    done++;
    onStep(done, blocks.length);
  }
  return hits;
}
