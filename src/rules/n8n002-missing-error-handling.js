import { isLlmNode, isErrorTrigger, shortType, isSticky, writeInfo, isUntrustedTrigger } from '../classify.js';

const EXTERNAL_CALL = (n) => ['httpRequest'].includes(shortType(n.type)) || isLlmNode(n);

export const ruleMissingErrorHandling = {
  id: 'N8N002',
  name: 'missing-error-handling',
  severity: 'medium',
  title: 'Failures are silent or not retried',
  summary: 'No error workflow is configured, and external calls (HTTP / LLM) have no retry or error branch.',
  why: 'LLM and HTTP calls fail all the time (rate limits, timeouts, 5xx). Without an error workflow nobody is told when an automation stops; without retryOnFail a single blip drops the item.',
  fix: 'Set Workflow Settings → Error Workflow to a workflow that starts with an Error Trigger and alerts you. On HTTP / LLM nodes enable Retry On Fail, or set On Error → Continue (error output) and handle it.',
  bad: '{ "nodes": [ { "name": "Ask LLM", "type": "n8n-nodes-base.httpRequest", "parameters": { "url": "https://api.openai.com/v1/chat/completions", "method": "POST" } } ], "settings": {} }',
  good: '{ "nodes": [ { "name": "Ask LLM", "retryOnFail": true, "maxTries": 3, "type": "n8n-nodes-base.httpRequest", "parameters": { "url": "https://api.openai.com/v1/chat/completions", "method": "POST" } } ], "settings": { "errorWorkflow": "AbC123", "executionTimeout": 300 } }',
  check({ wf, model, report }) {
    const live = model.nodes.filter((n) => !n.disabled && !isSticky(n));
    if (!live.length) return;
    const isErrorWorkflow = live.some(isErrorTrigger);
    const settings = wf.settings || {};

    if (!isErrorWorkflow && !settings.errorWorkflow) {
      const consequential = live.some((n) => isLlmNode(n) || (writeInfo(n)?.impact ?? 0) >= 2 || isUntrustedTrigger(n));
      report({ nodes: [], path: 'settings.errorWorkflow', severity: consequential ? 'medium' : 'low', message: 'No error workflow is set (settings.errorWorkflow). If this workflow fails, nothing alerts you.' });
    }

    const unprotected = live.filter((n) => EXTERNAL_CALL(n) && !n.retryOnFail && !n.continueOnFail && !(n.onError && n.onError !== 'stopWorkflow'));
    if (unprotected.length) {
      const names = unprotected.map((n) => n.name);
      report({ nodes: names, severity: 'low', fix: 'On each node: Settings → Retry On Fail (with a wait between tries) and On Error → Continue (using error output), then handle the error branch explicitly.', message: `${names.length} external call${names.length > 1 ? 's have' : ' has'} no retry or error branch: ${names.slice(0, 4).map((x) => `"${x}"`).join(', ')}${names.length > 4 ? ', …' : ''}.` });
    }

    const usesLlm = live.some(isLlmNode);
    if (usesLlm && !isErrorWorkflow && !settings.executionTimeout) {
      report({ nodes: [], severity: 'info', path: 'settings.executionTimeout', fix: 'Set Workflow Settings → Timeout Workflow to a sane upper bound (e.g. 300 seconds).', message: 'No executionTimeout in workflow settings. A stuck agent run can occupy a worker until the instance-wide limit (if any) kills it.' });
    }
  },
};
