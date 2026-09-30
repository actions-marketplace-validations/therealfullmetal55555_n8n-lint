import { isSqlNode, shortType, fromAi } from '../classify.js';
import { isFedByUntrusted } from '../graph.js';

export const ruleSqlInterpolation = {
  id: 'N8N007',
  name: 'sql-interpolation',
  severity: 'high',
  title: 'SQL built with {{ expressions }} instead of parameters',
  summary: 'A database node runs a query that interpolates values with {{ }} and has no query parameters configured.',
  why: 'Interpolated values become part of the SQL text. If any of them comes from a webhook, a message or an LLM, that is SQL injection.',
  fix: 'Use positional parameters ($1, $2, …) and fill them via the node option "Query Parameters" (queryReplacement), or use the node\'s built-in Insert / Update operations.',
  bad: '{ "type": "n8n-nodes-base.postgres", "parameters": { "operation": "executeQuery", "query": "=SELECT * FROM users WHERE email = \'{{ $json.email }}\'" } }',
  good: '{ "type": "n8n-nodes-base.postgres", "parameters": { "operation": "executeQuery", "query": "SELECT * FROM users WHERE email = $1", "options": { "queryReplacement": "={{ $json.email }}" } } }',
  check({ model, report }) {
    for (const node of model.nodes) {
      if (node.disabled || !isSqlNode(node)) continue;
      const p = node.parameters || {};
      const op = String(p.operation ?? (shortType(node.type) === 'postgres' ? 'executeQuery' : ''));
      if (!/^executequery$/i.test(op)) continue;
      const q = String(p.query ?? '');
      if (!/\{\{/.test(q)) continue;
      if (p.options?.queryReplacement || p.options?.queryParameters) continue;
      const fed = isFedByUntrusted(model, node.name) || fromAi(node);
      report({
        nodes: [node.name], path: 'parameters.query', severity: fed ? 'critical' : 'high',
        message: `"${node.name}" interpolates {{ }} expressions into a SQL query${fed ? ' and the value can come from untrusted input or the model' : ''}. Use query parameters.`,
      });
    }
  },
};
