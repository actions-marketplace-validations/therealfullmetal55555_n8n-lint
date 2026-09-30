import { shortType, isLlmNode, writeInfo } from '../classify.js';
import { bfs } from '../graph.js';

export const ruleUnauthenticatedWebhook = {
  id: 'N8N003',
  name: 'unauthenticated-webhook',
  severity: 'high',
  title: 'Public webhook without authentication',
  summary: 'A Webhook trigger (or public chat trigger) accepts requests from anyone who finds the URL.',
  why: 'Production webhook URLs are guessable, leak through logs and referrers, and are scanned for. An open webhook that feeds an LLM or writes to a CRM is a free remote-control channel.',
  fix: 'Set Authentication to Header Auth / Basic Auth / JWT on the Webhook node, or verify a signature (e.g. HMAC) in the first node. For chat triggers, turn off "Make Chat Publicly Available" or add authentication.',
  bad: '{ "name": "Webhook", "type": "n8n-nodes-base.webhook", "parameters": { "path": "lead", "httpMethod": "POST" } }',
  good: '{ "name": "Webhook", "type": "n8n-nodes-base.webhook", "parameters": { "path": "lead", "httpMethod": "POST", "authentication": "headerAuth" }, "credentials": { "httpHeaderAuth": { "id": "7", "name": "Webhook secret" } } }',
  check({ model, report }) {
    for (const node of model.nodes) {
      if (node.disabled) continue;
      const st = shortType(node.type);
      const p = node.parameters || {};
      const auth = p.authentication ?? 'none';
      let open = false;
      if (st === 'webhook' && auth === 'none') open = true;
      if (st === 'chatTrigger' && p.public === true && auth === 'none') open = true;
      if (!open) continue;

      const downstream = bfs(model, [node.name]);
      const reaches = [...downstream].map((n) => model.byName.get(n)).filter((n) => n && n !== node && (isLlmNode(n) || (writeInfo(n)?.impact ?? 0) >= 2));
      const hasWhitelist = Boolean(p.options?.ipWhitelist);
      const severity = hasWhitelist ? 'low' : reaches.length ? 'high' : 'medium';
      const what = reaches.length ? ` It feeds ${reaches.slice(0, 3).map((n) => `"${n.name}"`).join(', ')}${reaches.length > 3 ? ', …' : ''}.` : '';
      report({ nodes: [node.name], path: 'parameters.authentication', severity, message: `"${node.name}" is reachable without authentication${hasWhitelist ? ' (IP allow-list set)' : ''}.${what}` });
    }
  },
};
