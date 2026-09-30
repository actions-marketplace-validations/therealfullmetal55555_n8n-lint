export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
export const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0, none: -1 };
const WEIGHT = { critical: 30, high: 15, medium: 7, low: 3, info: 0 };

/**
 * Score = 100 minus a weight per finding, floored at 0.
 * Any critical finding caps the score at 59, so a workflow with a critical issue can never look "fine".
 */
export function computeScore(findings) {
  let score = 100;
  for (const f of findings) score -= WEIGHT[f.severity] ?? 0;
  score = Math.max(0, score);
  if (findings.some((f) => f.severity === 'critical')) score = Math.min(score, 59);
  return score;
}

export function gradeOf(score) {
  return score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
}

export function countBySeverity(findings) {
  const c = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) c[f.severity] = (c[f.severity] || 0) + 1;
  return c;
}
