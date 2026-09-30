import { shortType, isLlmNode } from '../classify.js';
import { isFedByUntrusted, bfs } from '../graph.js';

export const ruleShellExecution = {
  id: 'N8N011',
  name: 'shell-execution',
  severity: 'high',
  title: 'Shell command execution node',
  summary: 'An Execute Command or SSH node runs commands on a host.',
  why: 'Shell access is the highest-impact node in n8n. If any part of the command is built from input or model output, it is remote code execution on your host.',
  fix: 'Avoid it: use a dedicated node or an HTTP call to a service with a narrow API. If you must keep it, hard-code the command, pass data via files/env, and never put it downstream of an LLM or a public trigger.',
  bad: '{ "type": "n8n-nodes-base.executeCommand", "parameters": { "command": "=convert {{ $json.file }} out.png" } }',
  good: '{ "note": "replace with an HTTP Request to an internal conversion service" }',
  check({ model, report }) {
    const llms = model.nodes.filter((n) => !n.disabled && isLlmNode(n));
    const afterLlm = new Set();
    for (const l of llms) for (const n of bfs(model, [l.name])) if (n !== l.name) afterLlm.add(n);
    for (const node of model.nodes) {
      if (node.disabled) continue;
      const st = shortType(node.type);
      if (st !== 'executeCommand' && st !== 'ssh') continue;
      const cmd = String(node.parameters?.command ?? '');
      const dynamic = /\{\{/.test(cmd);
      const fed = isFedByUntrusted(model, node.name);
      const llm = afterLlm.has(node.name);
      const severity = (fed || llm) && dynamic ? 'critical' : 'high';
      const ctx = [dynamic && 'the command is built from expressions', fed && 'it is reachable from untrusted input', llm && 'it runs after an LLM'].filter(Boolean);
      report({ nodes: [node.name], path: 'parameters.command', severity, message: `"${node.name}" executes shell commands${ctx.length ? ` (${ctx.join('; ')})` : ''}.` });
    }
  },
};
