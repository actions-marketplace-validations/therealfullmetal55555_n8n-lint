import { VERSION } from '../core.js';
import { SEVERITY_RANK } from '../score.js';

const SEV_STYLE = {
  critical: { color: '1;97;41', dot: '●', label: 'CRITICAL' },
  high: { color: '1;31', dot: '●', label: 'HIGH' },
  medium: { color: '33', dot: '●', label: 'MEDIUM' },
  low: { color: '36', dot: '○', label: 'LOW' },
  info: { color: '90', dot: '·', label: 'INFO' },
};

// first sentence, without cutting at abbreviations like "e.g."
const firstSentence = (s) => { const m = /(?<!\be\.g|\bi\.e)[.!?](?=\s+[A-Z])/.exec(s); return (m ? s.slice(0, m.index + 1) : s).trim(); };

export function formatPretty(files, { color = true, showInfo = false } = {}) {
  const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const out = [];
  out.push(c('1', `n8n-lint v${VERSION}`), '');
  let wfCount = 0, total = 0, hiddenInfo = 0, suppressed = 0, worst = 100;
  const sevTotals = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

  for (const f of files) {
    out.push(c('1;4', f.file));
    if (f.error) { out.push(`  ${c('31', '✖')} ${f.error}`, ''); continue; }
    for (const r of f.results) {
      wfCount++;
      worst = Math.min(worst, r.score);
      suppressed += r.suppressed.length;
      const bar = '█'.repeat(Math.round(r.score / 10)) + '░'.repeat(10 - Math.round(r.score / 10));
      const scoreColor = r.score >= 90 ? '32' : r.score >= 60 ? '33' : '31';
      out.push(`  ${c('1', r.name)}  ${c('90', `${r.nodeCount} nodes`)}`);
      out.push(`  ${c(scoreColor, `score ${r.score}/100  ${r.grade}  ${bar}`)}`);
      const shown = r.findings.filter((x) => showInfo || x.severity !== 'info');
      hiddenInfo += r.findings.length - shown.length;
      if (!shown.length) out.push(`  ${c('32', '✔ no findings')}`);
      for (const x of shown) {
        total++; sevTotals[x.severity]++;
        const st = SEV_STYLE[x.severity];
        out.push('', `  ${c(st.color, ` ${st.dot} ${st.label} `)} ${c('1', x.ruleId)} ${c('90', x.rule)}`);
        out.push(`    ${x.message}`);
        out.push(`    ${c('90', '→ ' + firstSentence(x.fix))}`);
      }
      out.push('');
    }
  }

  const parts = Object.entries(sevTotals).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`);
  out.push(c('1', `${files.length} file${files.length === 1 ? '' : 's'} · ${wfCount} workflow${wfCount === 1 ? '' : 's'} · ${total} finding${total === 1 ? '' : 's'}${parts.length ? ` (${parts.join(', ')})` : ''}${wfCount ? ` · lowest score ${worst}` : ''}`));
  if (hiddenInfo) out.push(c('90', `${hiddenInfo} info-level note${hiddenInfo === 1 ? '' : 's'} hidden (use --show-info)`));
  if (suppressed) out.push(c('90', `${suppressed} finding${suppressed === 1 ? '' : 's'} suppressed by n8n-lint-disable comments`));
  return out.join('\n') + '\n';
}
