import { VERSION } from '../core.js';

const EMOJI = { critical: '🟥', high: '🟧', medium: '🟨', low: '🟦', info: '⬜' };
const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function formatMarkdown(files, { showInfo = false } = {}) {
  const out = ['## n8n-lint report', ''];
  let any = false;
  for (const f of files) {
    if (f.error) { out.push(`**${f.file}**: ❌ ${esc(f.error)}`, ''); continue; }
    for (const r of f.results) {
      any = true;
      const shown = r.findings.filter((x) => showInfo || x.severity !== 'info');
      const icon = r.score >= 90 ? '✅' : r.score >= 60 ? '⚠️' : '❌';
      out.push(`### ${icon} \`${f.file}\` — ${esc(r.name)}`, '', `**Score ${r.score}/100 (${r.grade})** · ${r.nodeCount} nodes · ${shown.length} finding${shown.length === 1 ? '' : 's'}`, '');
      if (shown.length) {
        out.push('| Severity | Rule | Finding | Nodes |', '|---|---|---|---|');
        for (const x of shown) out.push(`| ${EMOJI[x.severity]} ${x.severity} | \`${x.ruleId}\` ${x.rule} | ${esc(x.message)} | ${esc(x.nodes.slice(0, 3).map((n) => `\`${n}\``).join(', '))} |`);
        out.push('', '<details><summary>How to fix</summary>', '');
        const seen = new Set();
        for (const x of shown) { if (seen.has(x.ruleId)) continue; seen.add(x.ruleId); out.push(`- **${x.ruleId} ${x.rule}**: ${x.fix}`); }
        out.push('', '</details>', '');
      } else out.push('No findings. 🎉', '');
    }
  }
  if (!any) out.push('No n8n workflows found.', '');
  out.push(`<sub>n8n-lint v${VERSION} · suppress a finding with \`n8n-lint-disable N8N0xx\` in the node's Notes</sub>`, '');
  return out.join('\n');
}
