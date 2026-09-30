import { isLlmNode, writeInfo, isApprovalGate, isSticky, severityFor } from '../classify.js';
import { bfs, isFedByUntrusted, untrustedSourcesOf } from '../graph.js';

export const ruleUngatedWrite = {
  id: 'N8N005',
  name: 'ungated-write-after-llm',
  severity: 'high',
  title: 'Model output can trigger a write with no human approval',
  summary: 'A node that sends, creates, updates or deletes something is reachable from an LLM / agent node without passing a human-approval step.',
  why: 'LLM output is untrusted text. Anything the model can be talked into (or hallucinates) becomes an email, a CRM record, a payment or a DB write. If the workflow is also triggered by external input, this is a prompt-injection-to-action path.',
  fix: 'Put an approval gate between the model and the write: a Wait node (Resume: On Webhook Call / On Form Submitted), or a "Send and Wait for Response" action on Slack / Telegram / Gmail. Validate the model output (Code / IF / structured output parser) before it.',
  bad: '{ "connections": { "Triage Agent": { "main": [[{ "node": "Send Email", "type": "main", "index": 0 }]] } } }',
  good: '{ "connections": { "Triage Agent": { "main": [[{ "node": "Validate", "type": "main", "index": 0 }]] }, "Validate": { "main": [[{ "node": "Wait for Approval", "type": "main", "index": 0 }]] }, "Wait for Approval": { "main": [[{ "node": "Send Email", "type": "main", "index": 0 }]] } } }',
  check({ model, report }) {
    const llms = model.nodes.filter((n) => !n.disabled && isLlmNode(n));
    if (!llms.length) return;
    const reachFrom = new Map(llms.map((l) => [l.name, bfs(model, [l.name], (n) => n && isApprovalGate(n))]));
    for (const node of model.nodes) {
      if (node.disabled || isSticky(node)) continue;
      const w = writeInfo(node);
      if (!w) continue;
      const sources = llms.filter((l) => l.name !== node.name && reachFrom.get(l.name).has(node.name));
      if (!sources.length) continue;
      const fed = isFedByUntrusted(model, node.name);
      const via = untrustedSourcesOf(model, node.name);
      const severity = severityFor(w.impact, fed);
      report({
        nodes: [node.name, ...sources.map((s) => s.name)], severity,
        message: `"${node.name}" (${w.reason}) can run on the output of ${sources.slice(0, 2).map((s) => `"${s.name}"`).join(' / ')} with no human approval in between.${fed ? ` The flow starts at untrusted input (${via.slice(0, 2).map((v) => `"${v}"`).join(', ')}): prompt injection can reach this action.` : ''}`,
      });
    }
  },
};
