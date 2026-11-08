// Inline stroke icons (24px grid unless noted). icon(name) returns an <svg> string that inherits currentColor.
const I = {
  undo: '<path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  theme: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 010 18z" fill="currentColor"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1-1.5 2M12 17h.01"/>',
  shapes: '<rect x="3" y="3" width="8" height="8" rx="2"/><circle cx="17" cy="7" r="4"/><path d="M12 14l5 7H7z"/>',
  templates: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 9v12"/>',
  create: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  design: '<path d="M4 6h8M18 6h2M4 12h2M12 12h8M4 18h10M20 18h0"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  check: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5L16 9.5"/>',
  code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
  graph: '<rect x="3" y="3" width="6" height="5" rx="1"/><rect x="15" y="3" width="6" height="5" rx="1"/><rect x="9" y="16" width="6" height="5" rx="1"/><path d="M6 8v3h12V8M12 11v5"/>',
  folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 16V5M7 9l5-5 5 5M5 20h14"/>',
  file: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
  cursor: '<path d="M5 3l14 7-6 2-2 6z"/>',
  move: '<path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
  connect: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6H14a2 2 0 012 2v7.5M13.5 13l2.5 2.5 2.5-2.5"/>',
  grid: '<path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18"/>',
  magnet: '<path d="M6 3v8a6 6 0 0012 0V3h-4v8a2 2 0 01-4 0V3zM6 7h4M14 7h4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>',
  layout: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="8.5" y="14" width="7" height="7" rx="1.5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/>',
  paste: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  pencil: '<path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3"/>',
  group: '<rect x="3" y="3" width="11" height="11" rx="2"/><rect x="10" y="10" width="11" height="11" rx="2"/>',
  ungroup: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>',
  bold: '<path d="M7 4h6a3.5 3.5 0 010 7H7zM7 11h7a3.5 3.5 0 010 7H7z"/>',
  italic: '<path d="M14 4h-4M14 20h-4M15 4L9 20"/>',
  flip: '<path d="M7 7h12l-3-3M17 17H5l3 3"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  elbow: '<path d="M4 18h6V6h10"/>',
  curve: '<path d="M4 18c8 0 4-12 16-12"/>',
  straight: '<path d="M4 19L20 5"/>',
  lane: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  checkmark: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
};

export function icon(name, size = 20) {
  return `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[name] || ''}</svg>`;
}

/* Illustrator-style align glyphs on a 16px grid. */
const A = (d, rects) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>${rects.map((r) => `<rect x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" rx="1" fill="currentColor"/>`).join('')}`;
const ALIGN = {
  left: A('M2 1.5v13', [[4, 3.5, 9, 3.5], [4, 9, 5.5, 3.5]]),
  cx: A('M8 1.5v13', [[3, 3.5, 10, 3.5], [4.5, 9, 7, 3.5]]),
  right: A('M14 1.5v13', [[3, 3.5, 9, 3.5], [6.5, 9, 5.5, 3.5]]),
  top: A('M1.5 2h13', [[3.5, 4, 3.5, 9], [9, 4, 3.5, 5.5]]),
  cy: A('M1.5 8h13', [[3.5, 3, 3.5, 10], [9, 4.5, 3.5, 7]]),
  bottom: A('M1.5 14h13', [[3.5, 3, 3.5, 9], [9, 6.5, 3.5, 5.5]]),
  dh: A('M2 1.5v13M14 1.5v13', [[5.5, 4, 5, 8]]),
  dv: A('M1.5 2h13M1.5 14h13', [[4, 5.5, 8, 5]]),
};
export const ALIGN_LABELS = {
  left: 'Align left', cx: 'Align centres', right: 'Align right', top: 'Align top',
  cy: 'Align middles', bottom: 'Align bottom', dh: 'Distribute across', dv: 'Distribute down',
};
export function alignIcon(kind, size = 18) {
  return `<svg class="ic" viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true">${ALIGN[kind] || ''}</svg>`;
}
