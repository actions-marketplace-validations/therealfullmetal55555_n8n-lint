import { shortType, isLlmNode, writeInfo } from '../classify.js';
import { findCycles } from '../graph.js';

export const ruleUnboundedLoop = {
  id: 'N8N004',
  name: 'unbounded-loop',
  severity: 'medium',
  title: 'Cycle in the flow without a bound (or an agent with a huge iteration cap)',
  summary: 'Nodes are wired in a loop that does not go through Loop Over Items, or an AI Agent has a very high maxIterations.',
  why: 'A cycle that calls an LLM, an HTTP API or a write node will keep spending money / sending messages until something external stops it. Loop Over Items (SplitInBatches) is bounded by its input; a hand-wired back-edge is bounded by nothing.',
  fix: 'Use Loop Over Items for iteration. If you need a retry loop, carry an attempt counter and add an IF that exits after N tries. Keep Agent maxIterations small (default 10).',
  bad: '{ "connections": { "Ask LLM": { "main": [[{ "node": "Check", "type": "main", "index": 0 }]] }, "Check": { "main": [[{ "node": "Ask LLM", "type": "main", "index": 0 }]] } } }',
  good: '{ "note": "Check → IF (attempt < 3) → Ask LLM, else → Give up" }',
  check({ model, report }) {
    for (const comp of findCycles(model)) {
      const nodes = comp.map((n) => model.byName.get(n));
      if (nodes.some((n) => shortType(n.type) === 'splitInBatches')) continue; // standard bounded loop
      if (nodes.every((n) => n.disabled)) continue;
      const costly = nodes.filter((n) => !n.disabled && (isLlmNode(n) || writeInfo(n) || shortType(n.type) === 'httpRequest'));
      const severity = costly.length ? 'high' : 'medium';
      const names = comp;
      report({
        nodes: names, severity,
        message: `Cycle: ${names.map((n) => `"${n}"`).join(' → ')} → "${names[0]}"${costly.length ? `, and it includes ${costly.map((n) => `"${n.name}"`).slice(0, 3).join(', ')} (costs money or has side effects on every pass)` : ''}. Nothing bounds the number of iterations.`,
      });
    }
    for (const node of model.nodes) {
      if (node.disabled || !/agent/i.test(shortType(node.type))) continue;
      const max = Number(node.parameters?.options?.maxIterations);
      if (Number.isFinite(max) && max > 25) {
        report({ nodes: [node.name], path: 'parameters.options.maxIterations', message: `Agent "${node.name}" allows up to ${max} tool-calling iterations per run. Each one is a paid LLM call.` });
      }
    }
  },
};
