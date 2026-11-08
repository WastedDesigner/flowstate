// Shape geometry. All paths are in local coordinates (0,0) -> (w,h).
const rr = (x, y, w, h, r) => {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x + r}A${r},${r} 0 0 1 ${x},${y + h - r}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}Z`;
};

export const SHAPES = {
  start:    { label: 'Start',     role: 'terminal', size: [150, 56],  text: [.12, .1, .76, .8] },
  end:      { label: 'End',       role: 'terminal', size: [150, 56],  text: [.12, .1, .76, .8] },
  process:  { label: 'Process',   role: 'step',     size: [170, 70],  text: [.08, .1, .84, .8] },
  decision: { label: 'Decision',  role: 'branch',   size: [172, 104], text: [.2, .26, .6, .48] },
  io:       { label: 'Input /\nOutput', role: 'step', size: [176, 70], text: [.16, .1, .68, .8] },
  subroutine:{ label: 'Subprocess', role: 'step',   size: [180, 72],  text: [.12, .1, .76, .8] },
  data:     { label: 'Database',  role: 'step',     size: [150, 86],  text: [.08, .22, .84, .62] },
  document: { label: 'Document',  role: 'step',     size: [164, 80],  text: [.08, .08, .84, .72] },
  manual:   { label: 'Manual',    role: 'step',     size: [168, 70],  text: [.14, .12, .72, .76] },
  delay:    { label: 'Delay',     role: 'step',     size: [156, 66],  text: [.06, .12, .76, .76] },
  connector:{ label: 'Connector', role: 'connector',size: [60, 60],   text: [.1, .1, .8, .8] },
  note:     { label: 'Note',      role: 'note',     size: [170, 72],  text: [.1, .1, .82, .8] },
};
export const SHAPE_ORDER = ['start', 'process', 'decision', 'io', 'end', 'subroutine', 'data', 'document', 'manual', 'delay', 'connector', 'note'];
export const TERMINALS = new Set(['start', 'end']);

/** SVG path data for a shape. */
export function shapePath(type, w, h, radius = 10) {
  switch (type) {
    case 'start':
    case 'end':
      return rr(0, 0, w, h, h / 2);
    case 'decision':
      return `M${w / 2},0L${w},${h / 2}L${w / 2},${h}L0,${h / 2}Z`;
    case 'io': {
      const s = Math.min(w * .2, h * .55);
      return `M${s},0H${w}L${w - s},${h}H0Z`;
    }
    case 'manual': {
      const s = Math.min(w * .16, h * .5);
      return `M0,${s}L${w},0V${h}H0Z`;
    }
    case 'data': {
      const ry = Math.min(h * .18, 18);
      return `M0,${ry}A${w / 2},${ry} 0 0 1 ${w},${ry}V${h - ry}A${w / 2},${ry} 0 0 1 0,${h - ry}Z`;
    }
    case 'document': {
      const a = h * .16;
      return `M0,0H${w}V${h - a}C${w * .75},${h - a * 2.1} ${w * .6},${h + a * .5} ${w * .38},${h - a * .5}C${w * .24},${h - a * 1.2} ${w * .12},${h - a * .1} 0,${h - a}Z`;
    }
    case 'delay':
      return `M0,0H${w - h / 2}A${h / 2},${h / 2} 0 0 1 ${w - h / 2},${h}H0Z`;
    case 'connector': {
      const r = Math.min(w, h) / 2;
      return `M${w / 2 - r},${h / 2}a${r},${r} 0 1 0 ${r * 2},0a${r},${r} 0 1 0 ${-r * 2},0Z`;
    }
    case 'note':
      return rr(0, 0, w, h, Math.min(radius, 8));
    case 'subroutine':
    case 'process':
    default:
      return rr(0, 0, w, h, radius);
  }
}

/** Extra decoration paths drawn on top of the body (same stroke, no fill). */
export function shapeDecor(type, w, h) {
  if (type === 'subroutine') {
    const i = Math.min(14, w * .12);
    return [`M${i},0V${h}`, `M${w - i},0V${h}`];
  }
  if (type === 'data') {
    const ry = Math.min(h * .18, 18);
    return [`M0,${ry}A${w / 2},${ry} 0 0 0 ${w},${ry}`];
  }
  if (type === 'note') {
    return [`M0,0h${Math.min(10, w * .08)}`, `M0,${h}h${Math.min(10, w * .08)}`];
  }
  return [];
}

/** Inner rectangle available for the label. */
export function textBox(type, w, h) {
  const t = (SHAPES[type] || SHAPES.process).text;
  return { x: w * t[0], y: h * t[1], w: w * t[2], h: h * t[3] };
}

export const PORTS = ['n', 'e', 's', 'w'];
export const PORT_DIR = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };

/** Port position in local coordinates. */
export function portLocal(type, w, h, port) {
  switch (port) {
    case 'n': return { x: w / 2, y: 0 };
    case 's': return { x: w / 2, y: h };
    case 'w': return { x: 0, y: h / 2 };
    case 'e': return { x: w, y: h / 2 };
    default: return { x: w / 2, y: h / 2 };
  }
}
export function portPoint(node, port) {
  const p = portLocal(node.type, node.w, node.h, port);
  return { x: node.x + p.x, y: node.y + p.y };
}
export const centerOf = (n) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });

/** Tiny palette thumbnails (24x16 viewBox-ish, scaled by CSS). */
export function thumbSVG(type) {
  const w = 30, h = 20, pad = 1.2;
  const d = shapePath(type, w - pad * 2, h - pad * 2, 4);
  const decor = shapeDecor(type, w - pad * 2, h - pad * 2).map((p) => `<path d="${p}"/>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" aria-hidden="true"><g transform="translate(${pad},${pad})"><path d="${d}"/>${decor}</g></svg>`;
}
