import { shortType } from '../classify.js';
import { isFedByUntrusted } from '../graph.js';

const DANGEROUS = /\beval\s*\(|new\s+Function\s*\(|child_process|\bexecSync\s*\(|\bspawnSync?\s*\(|\bos\.system\s*\(|\bsubprocess\.|__import__\s*\(|\bexec\s*\(\s*(?:f?["'`]|[a-zA-Z_])/;

export const ruleCodeInjectionRisk = {
  id: 'N8N012',
  name: 'code-injection-risk',
  severity: 'medium',
  title: 'Code node evaluates dynamic code or spawns processes',
  summary: 'A Code node uses eval(), new Function(), child_process, os.system or similar.',
  why: 'Evaluating strings as code turns any data that reaches it into code. Even where the n8n sandbox blocks some of it, it is a pattern that should not be in automation glue.',
  fix: 'Parse data (JSON.parse, regex, explicit field access) instead of evaluating it. Move process-spawning to a dedicated, locked-down service.',
  bad: '{ "type": "n8n-nodes-base.code", "parameters": { "jsCode": "return [{ json: { out: eval($input.first().json.expr) } }];" } }',
  good: '{ "type": "n8n-nodes-base.code", "parameters": { "jsCode": "const { a, b } = $input.first().json; return [{ json: { out: Number(a) + Number(b) } }];" } }',
  check({ model, report }) {
    for (const node of model.nodes) {
      if (node.disabled || !['code', 'function', 'functionItem'].includes(shortType(node.type))) continue;
      const p = node.parameters || {};
      const src = [p.jsCode, p.pythonCode, p.functionCode].filter((x) => typeof x === 'string').join('\n');
      const m = src.match(DANGEROUS);
      if (!m) continue;
      const fed = isFedByUntrusted(model, node.name);
      report({ nodes: [node.name], path: 'parameters.jsCode', severity: fed ? 'critical' : 'medium', message: `"${node.name}" contains \`${m[0].trim()}\`${fed ? ' and is reachable from untrusted input' : ''}. Dynamic code execution turns data into code.` });
    }
  },
};
