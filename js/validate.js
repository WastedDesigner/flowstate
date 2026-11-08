// Live flow-logic checks. Pure function: doc -> list of issues.
// Each issue: {id, sev:'error'|'warning'|'info', title, detail, nodes:[], edges:[], fix?:{label,apply(doc)}}
import { outgoing, incoming, newEdge, newNode } from './model.js';

const label = (n) => (n.text || '').trim().replace(/\s+/g, ' ').slice(0, 40) || '(no label)';
const YES = /^(y|yes|true|t|ok|valid|pass|1)\b/i;
const NO = /^(n|no|false|f|invalid|fail|0)\b/i;

export function runChecks(doc) {
  const issues = [];
  const nodes = doc.nodes.filter((n) => n.type !== 'note' && n.type !== 'lane');
  if (!nodes.length) return issues;

  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const out = new Map(), inc = new Map();
  for (const n of doc.nodes) { out.set(n.id, []); inc.set(n.id, []); }
  for (const e of doc.edges) {
    if (out.has(e.from)) out.get(e.from).push(e);
    if (inc.has(e.to)) inc.get(e.to).push(e);
  }
  const push = (o) => issues.push({ id: o.id, sev: o.sev, title: o.title, detail: o.detail, nodes: o.nodes || [], edges: o.edges || [], fix: o.fix });

  /* ---- terminals ---- */
  const starts = nodes.filter((n) => n.type === 'start');
  const ends = nodes.filter((n) => n.type === 'end');
  if (!starts.length) {
    push({
      id: 'no-start', sev: 'error', title: 'No Start step',
      detail: 'A flowchart needs exactly one Start so readers know where to begin.',
      fix: {
        label: 'Add a Start step',
        apply(d) {
          const top = d.nodes.reduce((a, n) => (n.y < a.y ? n : a), d.nodes[0]);
          const s = newNode('start', top.x, top.y - 120, d.settings, 'Start');
          d.nodes.push(s);
          d.edges.push(newEdge(s.id, top.id, d.settings));
        },
      },
    });
  } else if (starts.length > 1) {
    push({
      id: 'many-starts', sev: 'error', title: `${starts.length} Start steps`,
      detail: 'Only one entry point is allowed. Change the extras to Process or Connector steps.',
      nodes: starts.map((n) => n.id),
    });
  }
  if (!ends.length) {
    push({
      id: 'no-end', sev: 'warning', title: 'No End step',
      detail: 'Add an End so it is clear where the flow stops.',
      fix: {
        label: 'Add an End step',
        apply(d) {
          const bottom = d.nodes.reduce((a, n) => (n.y + n.h > a.y + a.h ? n : a), d.nodes[0]);
          const e = newNode('end', bottom.x, bottom.y + bottom.h + 90, d.settings, 'End');
          d.nodes.push(e);
          d.edges.push(newEdge(bottom.id, e.id, d.settings));
        },
      },
    });
  }
  for (const s of starts) {
    if (inc.get(s.id).length) {
      push({ id: 'start-in-' + s.id, sev: 'warning', title: 'Start has an incoming arrow', detail: `"${label(s)}" is the entry point, so nothing should flow into it.`, nodes: [s.id], edges: inc.get(s.id).map((e) => e.id) });
    }
    if (!out.get(s.id).length) {
      push({ id: 'start-out-' + s.id, sev: 'error', title: 'Start goes nowhere', detail: `Connect "${label(s)}" to the first step of the process.`, nodes: [s.id] });
    }
  }
  for (const e of ends) {
    if (out.get(e.id).length) {
      push({ id: 'end-out-' + e.id, sev: 'error', title: 'End continues onwards', detail: `"${label(e)}" is a stop point but has an outgoing arrow.`, nodes: [e.id], edges: out.get(e.id).map((x) => x.id) });
    }
    if (!inc.get(e.id).length) {
      push({ id: 'end-in-' + e.id, sev: 'warning', title: 'End is never reached', detail: `Nothing connects to "${label(e)}".`, nodes: [e.id] });
    }
  }

  /* ---- isolated / dangling ---- */
  const isolated = nodes.filter((n) => !out.get(n.id).length && !inc.get(n.id).length);
  if (isolated.length) {
    push({
      id: 'isolated', sev: nodes.length > 1 ? 'error' : 'info',
      title: isolated.length === 1 ? 'A step is not connected' : `${isolated.length} steps are not connected`,
      detail: isolated.map((n) => `"${label(n)}"`).join(', ') + ' — nothing flows in or out.',
      nodes: isolated.map((n) => n.id),
    });
  }
  const noOut = nodes.filter((n) => n.type !== 'end' && !out.get(n.id).length && inc.get(n.id).length);
  for (const n of noOut) {
    push({
      id: 'dead-' + n.id, sev: 'warning', title: 'Dead end',
      detail: `"${label(n)}" has no outgoing arrow, so the flow just stops here. Connect it onwards or change it to an End step.`,
      nodes: [n.id],
      fix: {
        label: 'Convert to End step',
        apply(d) {
          const t = d.nodes.find((x) => x.id === n.id);
          if (t) { t.type = 'end'; if (!t.text || /^process$/i.test(t.text)) t.text = 'End'; }
        },
      },
    });
  }

  /* ---- decisions ---- */
  for (const n of nodes.filter((x) => x.type === 'decision')) {
    const o = out.get(n.id);
    if (o.length < 2) {
      push({
        id: 'dec-branch-' + n.id, sev: 'error', title: 'Decision is missing a branch',
        detail: `"${label(n)}" has ${o.length} outgoing arrow${o.length === 1 ? '' : 's'}. A decision needs at least two so every answer is covered.`,
        nodes: [n.id],
        fix: o.length === 1 ? {
          label: 'Add the missing branch',
          apply(d) {
            const src = d.nodes.find((x) => x.id === n.id);
            const existing = d.edges.filter((e) => e.from === n.id);
            const taken = existing.map((e) => (e.label || '').toLowerCase());
            const lbl = taken.some((t) => YES.test(t)) ? 'No' : 'Yes';
            const target = newNode('process', src.x + src.w + 120, src.y, d.settings, 'Handle "' + lbl + '"');
            d.nodes.push(target);
            const ne = newEdge(n.id, target.id, d.settings, lbl);
            ne.fromPort = 'e';
            d.edges.push(ne);
            if (existing.length === 1 && !existing[0].label) existing[0].label = lbl === 'Yes' ? 'No' : 'Yes';
          },
        } : undefined,
      });
    } else {
      const unlabelled = o.filter((e) => !(e.label || '').trim());
      if (unlabelled.length) {
        push({
          id: 'dec-label-' + n.id, sev: 'warning', title: 'Decision branch has no label',
          detail: `${unlabelled.length} of ${o.length} arrows out of "${label(n)}" are unlabelled. Readers cannot tell which answer leads where.`,
          nodes: [n.id], edges: unlabelled.map((e) => e.id),
          fix: o.length === 2 ? {
            label: 'Label them Yes / No',
            apply(d) {
              const es = d.edges.filter((e) => e.from === n.id);
              const hasYes = es.some((e) => YES.test(e.label || ''));
              const hasNo = es.some((e) => NO.test(e.label || ''));
              let y = !hasYes, no = !hasNo;
              for (const e of es) {
                if ((e.label || '').trim()) continue;
                if (y) { e.label = 'Yes'; y = false; }
                else if (no) { e.label = 'No'; no = false; }
              }
            },
          } : undefined,
        });
      }
      const dupes = new Map();
      for (const e of o) {
        const key = (e.label || '').trim().toLowerCase();
        if (!key) continue;
        dupes.set(key, (dupes.get(key) || 0) + 1);
      }
      for (const [k, c] of dupes) if (c > 1) {
        push({ id: 'dec-dupe-' + n.id + k, sev: 'warning', title: 'Two branches share a label', detail: `"${label(n)}" has ${c} arrows labelled "${k}". Only one path can be taken for a given answer.`, nodes: [n.id] });
      }
      if (!(n.text || '').trim()) {
        push({ id: 'dec-q-' + n.id, sev: 'warning', title: 'Decision has no question', detail: 'Write the condition being tested inside the diamond.', nodes: [n.id] });
      }
    }
  }

  /* ---- plain steps with multiple exits ---- */
  for (const n of nodes) {
    if (['decision', 'end', 'note'].includes(n.type)) continue;
    const o = out.get(n.id);
    if (o.length > 1) {
      push({
        id: 'multi-out-' + n.id, sev: 'warning', title: 'Step has more than one exit',
        detail: `"${label(n)}" is a ${n.type} step with ${o.length} outgoing arrows, so the path is ambiguous. Use a Decision to branch.`,
        nodes: [n.id], edges: o.map((e) => e.id),
        fix: { label: 'Change to a Decision', apply(d) { const t = d.nodes.find((x) => x.id === n.id); if (t) { t.type = 'decision'; t.h = Math.max(t.h, 100); } } },
      });
    }
  }

  /* ---- empty labels ---- */
  const blank = nodes.filter((n) => !(n.text || '').trim() && n.type !== 'connector' && n.type !== 'decision');
  if (blank.length) {
    push({ id: 'blank', sev: 'info', title: blank.length === 1 ? 'A step has no text' : `${blank.length} steps have no text`, detail: 'Unlabelled boxes are hard to follow. Double-click a step to type in it.', nodes: blank.map((n) => n.id) });
  }

  /* ---- reachability ---- */
  const roots = starts.length ? starts.map((n) => n.id) : nodes.filter((n) => !inc.get(n.id).length).map((n) => n.id);
  if (roots.length) {
    const seen = new Set(roots);
    const stack = [...roots];
    while (stack.length) {
      const id = stack.pop();
      for (const e of out.get(id) || []) if (!seen.has(e.to)) { seen.add(e.to); stack.push(e.to); }
    }
    const unreachable = nodes.filter((n) => !seen.has(n.id) && (out.get(n.id).length || inc.get(n.id).length));
    if (unreachable.length) {
      push({
        id: 'unreachable', sev: 'error',
        title: unreachable.length === 1 ? 'A step can never run' : `${unreachable.length} steps can never run`,
        detail: 'Working forwards from Start never arrives at ' + unreachable.slice(0, 4).map((n) => `"${label(n)}"`).join(', ') + (unreachable.length > 4 ? ` and ${unreachable.length - 4} more` : '') + '.',
        nodes: unreachable.map((n) => n.id),
      });
    }
    // can every path terminate?
    if (ends.length) {
      const endSet = new Set(ends.map((n) => n.id));
      const canReachEnd = new Set(endSet);
      let grew = true;
      while (grew) {
        grew = false;
        for (const n of nodes) {
          if (canReachEnd.has(n.id)) continue;
          if (out.get(n.id).some((e) => canReachEnd.has(e.to))) { canReachEnd.add(n.id); grew = true; }
        }
      }
      const stuck = nodes.filter((n) => seen.has(n.id) && !canReachEnd.has(n.id) && out.get(n.id).length);
      if (stuck.length) {
        push({
          id: 'no-exit-path', sev: 'error', title: 'Some steps can never finish',
          detail: 'From ' + stuck.slice(0, 4).map((n) => `"${label(n)}"`).join(', ') + (stuck.length > 4 ? ' and others' : '') + ' there is no route to an End step — the flow is trapped.',
          nodes: stuck.map((n) => n.id),
        });
      }
    }
  }

  /* ---- loops without an exit ---- */
  for (const comp of stronglyConnected(nodes, out)) {
    if (comp.length === 1) {
      const only = comp[0];
      if (!out.get(only).some((e) => e.to === only)) continue;     // not a self loop
    }
    const set = new Set(comp);
    const escapes = [];
    for (const id of comp) for (const e of out.get(id)) if (!set.has(e.to)) escapes.push(e);
    const names = comp.map((id) => `"${label(byId.get(id))}"`).slice(0, 4).join(' → ');
    if (!escapes.length) {
      push({
        id: 'loop-' + comp.join('-'), sev: 'error', title: 'Loop with no way out',
        detail: `${names}${comp.length > 4 ? ' …' : ''} form a cycle, and no arrow leaves it. Add a Decision inside the loop with an exit branch.`,
        nodes: comp,
        fix: {
          label: 'Add an exit decision',
          apply(d) {
            const anchor = d.nodes.find((x) => x.id === comp[0]);
            const dec = newNode('decision', anchor.x + anchor.w + 150, anchor.y, d.settings, 'Done?');
            d.nodes.push(dec);
            const after = d.edges.find((e) => e.from === anchor.id && set.has(e.to));
            const nextId = after ? after.to : comp[1] || anchor.id;
            if (after) { after.from = dec.id; after.label = after.label || 'No'; }
            d.edges.push(newEdge(anchor.id, dec.id, d.settings));
            const endNode = d.nodes.find((x) => x.type === 'end');
            if (endNode) {
              const ex = newEdge(dec.id, endNode.id, d.settings, 'Yes');
              ex.fromPort = 'e';
              d.edges.push(ex);
            } else {
              const en = newNode('end', dec.x + dec.w + 140, dec.y, d.settings, 'End');
              d.nodes.push(en);
              const ex = newEdge(dec.id, en.id, d.settings, 'Yes');
              ex.fromPort = 'e';
              d.edges.push(ex);
            }
            void nextId;
          },
        },
      });
    } else if (!comp.some((id) => byId.get(id).type === 'decision')) {
      push({
        id: 'loop-nodec-' + comp.join('-'), sev: 'warning', title: 'Loop has no decision',
        detail: `${names} loop back on each other with no Decision to test when to stop. The exit arrow is unconditional, which is usually a mistake.`,
        nodes: comp,
      });
    }
  }

  /* ---- crossed / duplicated connections ---- */
  const pairs = new Map();
  for (const e of doc.edges) {
    const k = e.from + '>' + e.to;
    pairs.set(k, (pairs.get(k) || []).concat(e));
  }
  for (const [k, list] of pairs) {
    if (list.length > 1) {
      const [from] = k.split('>');
      push({ id: 'dupe-' + k, sev: 'warning', title: 'Duplicate connection', detail: `There are ${list.length} arrows between the same two steps (from "${label(byId.get(from))}").`, edges: list.map((e) => e.id) });
    }
  }
  const order = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => order[a.sev] - order[b.sev]);
  return issues;
}

/** Tarjan SCC over the flow graph. */
function stronglyConnected(nodes, out) {
  let idx = 0;
  const index = new Map(), low = new Map(), onStack = new Set(), stack = [], comps = [];
  const ids = nodes.map((n) => n.id);
  const idSet = new Set(ids);
  const visit = (v) => {
    index.set(v, idx); low.set(v, idx); idx++;
    stack.push(v); onStack.add(v);
    for (const e of out.get(v) || []) {
      const w = e.to;
      if (!idSet.has(w)) continue;
      if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) === index.get(v)) {
      const comp = [];
      let w;
      do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
      if (comp.length > 1 || (out.get(v) || []).some((e) => e.to === v)) comps.push(comp);
    }
  };
  for (const id of ids) if (!index.has(id)) visit(id);
  return comps;
}

export function issueMaps(issues) {
  const m = new Map();
  const rank = { error: 2, warning: 1, info: 0 };
  const put = (id, sev) => {
    if (sev === 'info') return;
    const cur = m.get(id);
    if (!cur || rank[sev] > rank[cur]) m.set(id, sev);
  };
  for (const i of issues) { for (const n of i.nodes) put(n, i.sev); for (const e of i.edges) put(e, i.sev); }
  return m;
}
export function summarize(issues) {
  const c = { error: 0, warning: 0, info: 0 };
  for (const i of issues) c[i.sev]++;
  return c;
}
void incoming; void outgoing;
