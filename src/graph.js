// Turns an n8n workflow JSON into a small graph model the rules can query.
import { isTrigger, isUntrustedTrigger, isSticky } from './classify.js';

/**
 * n8n connection format:
 *   connections[fromName][type] = [ [ {node, type, index}, ... ], ... ]
 * type === 'main'            -> data flow
 * type === 'ai_tool' (etc.)  -> `from` is a sub-node (tool, model, memory...) feeding `node` (the parent)
 */
export function buildModel(wf) {
  const nodes = (Array.isArray(wf?.nodes) ? wf.nodes : []).filter((n) => n && typeof n === 'object' && typeof n.name === 'string');
  const byName = new Map();
  for (const n of nodes) if (!byName.has(n.name)) byName.set(n.name, n);

  const succ = new Map();      // main edges: name -> Set(name)
  const pred = new Map();
  const aiIn = new Map();      // parent -> [{ from, type }]
  const aiParents = new Map(); // sub-node -> Set(parent)
  const edges = [];

  const addTo = (m, k, v) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(v); };

  const conns = wf && typeof wf.connections === 'object' && wf.connections ? wf.connections : {};
  for (const [from, byType] of Object.entries(conns)) {
    if (!byName.has(from) || !byType || typeof byType !== 'object') continue;
    for (const [type, branches] of Object.entries(byType)) {
      if (!Array.isArray(branches)) continue;
      branches.forEach((branch, output) => {
        if (!Array.isArray(branch)) return;
        for (const c of branch) {
          if (!c || !byName.has(c.node)) continue;
          edges.push({ from, to: c.node, type, output });
          if (type === 'main') {
            addTo(succ, from, c.node);
            addTo(pred, c.node, from);
          } else {
            if (!aiIn.has(c.node)) aiIn.set(c.node, []);
            aiIn.get(c.node).push({ from, type });
            addTo(aiParents, from, c.node);
          }
        }
      });
    }
  }

  const model = { nodes, byName, succ, pred, aiIn, aiParents, edges };
  model.triggers = nodes.filter((n) => !n.disabled && isTrigger(n));
  model.untrustedSeeds = nodes.filter((n) => !n.disabled && isUntrustedTrigger(n));
  model.untrusted = bfs(model, model.untrustedSeeds.map((n) => n.name));
  return model;
}

/** Nodes reachable from `starts` over main edges (starts included). `blocked(node)` stops expansion *through* a node. */
export function bfs(model, starts, blocked = () => false) {
  const seen = new Set();
  const queue = [...starts];
  while (queue.length) {
    const cur = queue.shift();
    if (seen.has(cur)) continue;
    seen.add(cur);
    if (blocked(model.byName.get(cur)) && !starts.includes(cur)) continue;
    for (const nx of model.succ.get(cur) || []) if (!seen.has(nx)) queue.push(nx);
  }
  return seen;
}

/** Is this node fed by untrusted external input (directly, or as a sub-node of a fed parent)? */
export function isFedByUntrusted(model, name, seen = new Set()) {
  if (seen.has(name)) return false;
  seen.add(name);
  if (model.untrusted.has(name)) return true;
  for (const parent of model.aiParents.get(name) || []) if (isFedByUntrusted(model, parent, seen)) return true;
  return false;
}

/** Which untrusted trigger(s) feed this node? (names, for messages) */
export function untrustedSourcesOf(model, name) {
  const out = [];
  for (const seed of model.untrustedSeeds) {
    if (bfs(model, [seed.name]).has(name)) out.push(seed.name);
  }
  if (out.length) return out;
  for (const parent of model.aiParents.get(name) || []) out.push(...untrustedSourcesOf(model, parent));
  return [...new Set(out)];
}

/** Strongly connected components of size > 1 (or self-loops) over main edges: i.e. cycles. Tarjan, iterative-safe for normal sizes. */
export function findCycles(model) {
  let index = 0;
  const stack = [];
  const onStack = new Set();
  const idx = new Map();
  const low = new Map();
  const result = [];

  const strong = (v) => {
    idx.set(v, index); low.set(v, index); index++;
    stack.push(v); onStack.add(v);
    for (const w of model.succ.get(v) || []) {
      if (!idx.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      const comp = [];
      let w;
      do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
      if (comp.length > 1 || (model.succ.get(v) || new Set()).has(v)) result.push(comp.reverse());
    }
  };
  for (const n of model.nodes) if (!idx.has(n.name)) strong(n.name);
  return result;
}

/** Everything that can execute: triggers + main-flow descendants + sub-nodes attached to executed parents. */
export function executableSet(model) {
  const reach = bfs(model, model.triggers.map((n) => n.name));
  let changed = true;
  while (changed) {
    changed = false;
    for (const [sub, parents] of model.aiParents) {
      if (reach.has(sub)) continue;
      for (const p of parents) if (reach.has(p)) { reach.add(sub); changed = true; break; }
    }
  }
  return reach;
}

export { isSticky };
