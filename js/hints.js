// Optional "what next?" suggestions. Every hint explains itself and can be applied or dismissed.
import { newNode, newEdge, outgoing, incoming, nodeById } from './model.js';
import { SHAPES } from './shapes.js';

const GAP_Y = 110, GAP_X = 150;

export function freeSpot(doc, x, y, w, h, skip = new Set()) {
  const hits = (ax, ay) => doc.nodes.some((n) => !skip.has(n.id) && ax < n.x + n.w + 16 && ax + w + 16 > n.x && ay < n.y + n.h + 16 && ay + h + 16 > n.y);
  let px = x, py = y;
  for (let i = 0; i < 60 && hits(px, py); i++) {
    if (i % 2 === 0) py += 40; else px += 60;
  }
  return { x: Math.round(px), y: Math.round(py) };
}

function addAfter(doc, src, type, text, label = '', dir = 's') {
  const def = SHAPES[type];
  let x = src.x + (src.w - def.size[0]) / 2, y = src.y + src.h + GAP_Y;
  if (dir === 'e') { x = src.x + src.w + GAP_X; y = src.y + (src.h - def.size[1]) / 2; }
  if (dir === 'w') { x = src.x - GAP_X - def.size[0]; y = src.y + (src.h - def.size[1]) / 2; }
  const spot = freeSpot(doc, x, y, def.size[0], def.size[1]);
  const n = newNode(type, spot.x, spot.y, doc.settings, text);
  doc.nodes.push(n);
  const e = newEdge(src.id, n.id, doc.settings, label);
  if (dir === 'e') { e.fromPort = 'e'; e.toPort = 'w'; }
  if (dir === 'w') { e.fromPort = 'w'; e.toPort = 'e'; }
  doc.edges.push(e);
  return n;
}

/**
 * @param {object} doc
 * @param {Set<string>} sel selected node ids
 * @param {Set<string>} dismissed hint ids the user has waved away
 */
export function getHints(doc, sel, dismissed = new Set()) {
  const hints = [];
  const add = (hh) => { if (!dismissed.has(hh.id)) hints.push(hh); };
  const nodes = doc.nodes.filter((n) => n.type !== 'note');
  const selected = [...sel].map((id) => nodeById(doc, id)).filter(Boolean);
  const focus = selected.length === 1 ? selected[0] : null;

  if (!nodes.length) {
    add({
      id: 'seed', icon: '▶', title: 'Begin with a Start step',
      why: 'Every readable flowchart has one entry point. FlowState will also add the first action for you.',
      apply(d) {
        const s = newNode('start', 320, 120, d.settings, 'Start');
        d.nodes.push(s);
        const p = addAfter(d, s, 'process', 'First step');
        return [p.id];
      },
    });
    return hints;
  }

  if (!nodes.some((n) => n.type === 'start')) {
    add({
      id: 'need-start', icon: '▶', title: 'Add a Start step',
      why: 'Without a Start, the logic checks cannot work out which steps are reachable.',
      apply(d) {
        const top = d.nodes.reduce((a, n) => (n.y < a.y ? n : a), d.nodes[0]);
        const s = newNode('start', top.x + (top.w - 150) / 2, top.y - 130, d.settings, 'Start');
        d.nodes.push(s);
        d.edges.push(newEdge(s.id, top.id, d.settings));
        return [s.id];
      },
    });
  }

  // decisions missing branches — highest value hint
  for (const n of nodes.filter((x) => x.type === 'decision')) {
    const o = outgoing(doc, n.id);
    if (o.length >= 2) continue;
    const taken = o.map((e) => (e.label || '').toLowerCase());
    const needYes = !taken.some((t) => /^y/.test(t));
    add({
      id: 'dec-' + n.id, icon: '◆', nodes: [n.id],
      title: `Give "${short(n.text) || 'the decision'}" ${o.length ? 'its other branch' : 'two branches'}`,
      why: 'A diamond asks a question, so each possible answer needs its own labelled arrow. Unlabelled or missing branches are the most common flowchart error.',
      apply(d) {
        const src = nodeById(d, n.id);
        const made = [];
        if (!o.length) {
          const a = addAfter(d, src, 'process', 'If yes…', 'Yes', 's');
          const b = addAfter(d, src, 'process', 'If no…', 'No', 'e');
          made.push(a.id, b.id);
        } else {
          const lbl = needYes ? 'Yes' : 'No';
          const b = addAfter(d, src, 'process', `If ${lbl.toLowerCase()}…`, lbl, 'e');
          const first = d.edges.find((e) => e.from === n.id && e.id !== b.id && !(e.label || '').trim());
          if (first) first.label = lbl === 'Yes' ? 'No' : 'Yes';
          made.push(b.id);
        }
        return made;
      },
    });
  }

  // continue from the focused step
  if (focus && focus.type !== 'end' && !outgoing(doc, focus.id).length) {
    const kind = focus.type === 'decision' ? null : guessNext(doc, focus);
    if (kind) {
      add({
        id: 'next-' + focus.id + kind.type, icon: '→', nodes: [focus.id],
        title: (focus.text || '').trim()
          ? `Follow "${short(focus.text)}" with ${kind.article} ${SHAPES[kind.type].label.replace('\n', ' ')}`
          : `Add ${kind.article} ${SHAPES[kind.type].label.replace('\n', ' ')} after the selected step`,
        why: kind.why,
        apply(d) { const n = addAfter(d, nodeById(d, focus.id), kind.type, kind.text); return [n.id]; },
      });
    }
  }

  // dangling ends need an End step
  const dead = nodes.filter((n) => n.type !== 'end' && !outgoing(doc, n.id).length && incoming(doc, n.id).length);
  if (dead.length && nodes.length > 1) {
    const t = dead[0];
    add({
      id: 'close-' + t.id, icon: '■', nodes: dead.map((n) => n.id),
      title: dead.length > 1 ? `Close off ${dead.length} loose ends` : `Close off "${short(t.text)}"`,
      why: 'Readers need to see where the process stops. FlowState will point the loose ends at a single End step.',
      apply(d) {
        let end = d.nodes.find((n) => n.type === 'end');
        if (!end) {
          const low = d.nodes.reduce((a, n) => (n.y + n.h > a.y + a.h ? n : a), d.nodes[0]);
          const spot = freeSpot(d, low.x + (low.w - 150) / 2, low.y + low.h + GAP_Y, 150, 56);
          end = newNode('end', spot.x, spot.y, d.settings, 'End');
          d.nodes.push(end);
        }
        for (const n of dead) d.edges.push(newEdge(n.id, end.id, d.settings));
        return [end.id];
      },
    });
  }

  // connect two selected steps
  if (selected.length === 2) {
    const [a, b] = selected.sort((p, q) => p.y - q.y || p.x - q.x);
    const already = doc.edges.some((e) => (e.from === a.id && e.to === b.id) || (e.from === b.id && e.to === a.id));
    if (!already) {
      add({
        id: 'join-' + a.id + b.id, icon: '↘', nodes: [a.id, b.id],
        title: `Connect "${short(a.text)}" to "${short(b.text)}"`,
        why: 'Both steps are selected and nothing joins them yet.',
        apply(d) { const e = newEdge(a.id, b.id, d.settings); d.edges.push(e); return [b.id]; },
      });
    }
  }

  // long straight run — suggest a subprocess
  const run = longestRun(doc);
  if (run.length >= 6) {
    add({
      id: 'collapse-' + run[0], icon: '▭', nodes: run,
      title: `Group ${run.length} steps into a Subprocess`,
      why: 'Long unbroken chains are hard to read. A Subprocess box can stand in for the detail, which you then draw on its own chart.',
    });
  }

  // loop with no exit decision
  const loopNode = nodes.find((n) => outgoing(doc, n.id).some((e) => e.to === n.id));
  if (loopNode) {
    add({
      id: 'selfloop-' + loopNode.id, icon: '↻', nodes: [loopNode.id],
      title: `"${short(loopNode.text)}" loops straight back to itself`,
      why: 'A step that repeats forever needs a Decision to test when to stop.',
      apply(d) {
        const src = nodeById(d, loopNode.id);
        const dec = addAfter(d, src, 'decision', 'Done?', '', 'e');
        const back = d.edges.find((e) => e.from === loopNode.id && e.to === loopNode.id);
        if (back) { back.from = dec.id; back.label = 'No'; }
        return [dec.id];
      },
    });
  }

  return hints.slice(0, 5);
}

function guessNext(doc, n) {
  const ins = incoming(doc, n.id);
  const fromDecision = ins.some((e) => nodeById(doc, e.from)?.type === 'decision');
  if (n.type === 'start') return { type: 'process', article: 'a', text: 'First step', why: 'Start steps lead straight into the first action.' };
  if (n.type === 'io') return { type: 'process', article: 'a', text: 'Process the input', why: 'Input is usually validated or processed next.' };
  if (/\b(check|valid|verify|is |does |has |are |confirm|compare|test)\b/i.test(n.text || '')) {
    return { type: 'decision', article: 'a', text: (n.text || 'Condition').replace(/\.$/, '') + '?', why: 'The wording reads like a test, so a Decision with Yes/No branches usually comes next.' };
  }
  if (fromDecision) return { type: 'process', article: 'a', text: 'Next step', why: 'This step sits on a branch; continue it until the branch rejoins the flow or ends.' };
  const depth = chainDepth(doc, n.id);
  if (depth >= 3) return { type: 'decision', article: 'a', text: 'Everything OK?', why: `There have been ${depth} actions in a row — a checkpoint keeps the flow honest.` };
  return { type: 'process', article: 'a', text: 'Next step', why: 'Keep the sequence going, then finish with an End step.' };
}
function chainDepth(doc, id, seen = new Set()) {
  let d = 0, cur = id;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const ins = incoming(doc, cur);
    if (ins.length !== 1) break;
    const p = nodeById(doc, ins[0].from);
    if (!p || p.type === 'decision' || p.type === 'start') break;
    d++; cur = p.id;
  }
  return d;
}
function longestRun(doc) {
  let best = [];
  for (const start of doc.nodes) {
    if (start.type !== 'process') continue;
    if (incoming(doc, start.id).some((e) => nodeById(doc, e.from)?.type === 'process')) continue;
    const run = [];
    let cur = start;
    const guard = new Set();
    while (cur && cur.type === 'process' && !guard.has(cur.id)) {
      guard.add(cur.id);
      run.push(cur.id);
      const o = outgoing(doc, cur.id);
      if (o.length !== 1) break;
      cur = nodeById(doc, o[0].to);
    }
    if (run.length > best.length) best = run;
  }
  return best;
}
const short = (s) => (s || '').trim().replace(/\s+/g, ' ').slice(0, 22) || 'this step';

