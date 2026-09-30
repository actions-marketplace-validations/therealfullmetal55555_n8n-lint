import { VERSION, RULES } from '../core.js';

const LEVEL = { critical: 'error', high: 'error', medium: 'warning', low: 'note', info: 'note' };
const SECURITY_SEVERITY = { critical: '9.5', high: '8.0', medium: '5.5', low: '3.0', info: '1.0' };

/** 1-based line of the node with this name in the source text (best effort). */
export function locateNode(text, nodeName) {
  if (!text || !nodeName) return 1;
  const esc = JSON.stringify(nodeName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`"name"\\s*:\\s*${esc}`).exec(text);
  if (!m) return 1;
  return text.slice(0, m.index).split('\n').length;
}

export function formatSarif(files) {
  const results = [];
  for (const f of files) {
    if (f.error) continue;
    for (const r of f.results) {
      for (const x of r.findings) {
        results.push({
          ruleId: x.ruleId,
          level: LEVEL[x.severity],
          message: { text: x.message },
          properties: { 'security-severity': SECURITY_SEVERITY[x.severity], severity: x.severity, workflow: r.name },
          locations: [{
            physicalLocation: { artifactLocation: { uri: f.file.replace(/\\/g, '/') }, region: { startLine: locateNode(f.text, x.nodes[0]) } },
            logicalLocations: x.nodes.slice(0, 1).map((n) => ({ name: n, kind: 'member' })),
          }],
        });
      }
    }
  }
  return JSON.stringify({
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: { driver: {
        name: 'n8n-lint', version: VERSION, informationUri: 'https://github.com/therealfullmetal55555/n8n-lint',
        rules: RULES.map((r) => ({
          id: r.id, name: r.name, shortDescription: { text: r.title }, fullDescription: { text: r.summary },
          help: { text: `${r.why}\n\nFix: ${r.fix}`, markdown: `**Why:** ${r.why}\n\n**Fix:** ${r.fix}` },
          defaultConfiguration: { level: LEVEL[r.severity] }, properties: { tags: ['security', 'n8n'] },
        })),
      } },
      results,
    }],
  }, null, 2) + '\n';
}
