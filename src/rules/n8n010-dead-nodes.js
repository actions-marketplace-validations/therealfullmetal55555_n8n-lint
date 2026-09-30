import { isSticky } from '../classify.js';
import { executableSet } from '../graph.js';

export const ruleDeadNodes = {
  id: 'N8N010',
  name: 'dead-nodes',
  severity: 'low',
  title: 'Disabled or unreachable nodes',
  summary: 'Nodes are disabled, or cannot be reached from any trigger, so they never run.',
  why: 'Dead nodes hide what the workflow really does, keep stale credentials and logic around, and are often half-finished experiments with side effects that someone later re-enables.',
  fix: 'Delete nodes you do not need. Keep experiments in a separate workflow.',
  bad: '{ "name": "Old Slack alert", "type": "n8n-nodes-base.slack", "disabled": true }',
  good: '(delete the node)',
  check({ model, report }) {
    const real = model.nodes.filter((n) => !isSticky(n));
    const disabled = real.filter((n) => n.disabled);
    if (disabled.length) {
      report({ nodes: disabled.map((n) => n.name), message: `${disabled.length} disabled node${disabled.length > 1 ? 's' : ''}: ${disabled.slice(0, 4).map((n) => `"${n.name}"`).join(', ')}${disabled.length > 4 ? ', …' : ''}.` });
    }
    if (!model.triggers.length) return; // fragments / sub-workflows without a trigger: nothing to compare against
    const live = executableSet(model);
    const orphans = real.filter((n) => !n.disabled && !live.has(n.name));
    if (orphans.length) {
      report({ nodes: orphans.map((n) => n.name), message: `${orphans.length} node${orphans.length > 1 ? 's are' : ' is'} not connected to any trigger and never run: ${orphans.slice(0, 4).map((n) => `"${n.name}"`).join(', ')}${orphans.length > 4 ? ', …' : ''}.` });
    }
  },
};
