// Pure, environment-agnostic linting core (runs in Node and in the browser playground).
import { buildModel } from './graph.js';
import { RULES } from './rules/index.js';
import { SEVERITY_RANK, computeScore, gradeOf, countBySeverity } from './score.js';

export const VERSION = '0.1.0';

/** Accepts: a workflow, a UI clipboard export, a templates-API wrapper ({workflow:{workflow}}), or an array of workflows. */
export function unwrapWorkflows(data) {
  const out = [];
  const visit = (d) => {
    if (Array.isArray(d)) return d.forEach(visit);
    if (!d || typeof d !== 'object') return;
    if (Array.isArray(d.nodes)) return out.push(d);
    if (d.workflow && typeof d.workflow === 'object') return visit(d.workflow);
    if (d.data && typeof d.data === 'object' && !Array.isArray(d.data)) return visit(d.data);
  };
  visit(data);
  return out;
}

export const looksLikeWorkflow = (d) => unwrapWorkflows(d).length > 0;

const DISABLE_RE = /n8n-lint-disable(?!-workflow)((?:[\s,]+(?:N8N\d{3}|ALL)\b)*)/i;
const DISABLE_WF_RE = /n8n-lint-disable-workflow((?:[\s,]+(?:N8N\d{3}|ALL)\b)*)/i;
const parseIds = (s) => new Set(String(s).split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean));

function nodeDisables(node) {
  const m = String(node?.notes || '').match(DISABLE_RE);
  return m ? parseIds(m[1]) : new Set();
}
/** `n8n-lint-disable-workflow` in a sticky note: all rules; with ids (`... N8N003, N8N002`): only those. */
function workflowDisables(wf) {
  const ids = new Set();
  for (const n of wf.nodes || []) {
    const m = String(n?.parameters?.content || '').match(DISABLE_WF_RE);
    if (!m) continue;
    const list = parseIds(m[1]);
    if (!list.size) ids.add('ALL'); else list.forEach((x) => ids.add(x));
  }
  return ids;
}

/**
 * config = { rules: { N8N010: 'off' | 'critical'|'high'|'medium'|'low'|'info' } }
 * Returns { name, nodeCount, findings[], suppressed[], score, grade, counts }
 */
export function lintWorkflow(wf, config = {}) {
  const model = buildModel(wf);
  const findings = [];
  const suppressed = [];
  const wfOff = workflowDisables(wf);

  for (const rule of RULES) {
    const setting = config.rules?.[rule.id] ?? config.rules?.[rule.name];
    if (setting === 'off' || setting === false) continue;
    const override = SEVERITY_RANK[setting] !== undefined && setting !== 'off' ? setting : null;

    const report = ({ nodes = [], message, severity, path, fix }) => {
      const f = {
        ruleId: rule.id, rule: rule.name, title: rule.title,
        severity: override || severity || rule.severity,
        message, nodes, path: path || null, fix: fix || rule.fix,
      };
      const primary = nodes.length ? model.byName.get(nodes[0]) : null;
      const off = wfOff.has(rule.id) || wfOff.has('ALL') || (primary && (nodeDisables(primary).has(rule.id) || nodeDisables(primary).has('ALL')));
      (off ? suppressed : findings).push(f);
    };
    try {
      rule.check({ wf, model, report, config });
    } catch (err) {
      // A rule bug must never take down the whole run.
      findings.push({ ruleId: rule.id, rule: rule.name, title: rule.title, severity: 'info', message: `Rule crashed on this workflow: ${err.message}`, nodes: [], path: null, fix: 'Please report this at the project issue tracker with a redacted workflow.' });
    }
  }

  findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.ruleId.localeCompare(b.ruleId));
  const score = computeScore(findings);
  return {
    name: typeof wf.name === 'string' && wf.name ? wf.name : '(unnamed workflow)',
    nodeCount: model.nodes.length,
    findings, suppressed, score, grade: gradeOf(score), counts: countBySeverity(findings),
  };
}

/** Lint a parsed JSON document that may contain one or many workflows. */
export function lintDocument(data, config = {}) {
  return unwrapWorkflows(data).map((wf) => lintWorkflow(wf, config));
}

export { RULES };
