import { walkEntries, walkStrings } from '../classify.js';

const VENDOR = [
  ['OpenAI API key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/],
  ['Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ['Telegram bot token', /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/],
  ['AWS access key id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['Stripe secret key', /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/],
  ['SendGrid API key', /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/],
  ['Private key', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
];
const SECRET_KEY = /(api[_-]?key|apikey|secret|token|passw(?:or)?d|authorization|auth[_-]?token|client[_-]?secret|bearer|x-api-key)/i;
const SECRET_HEADER = /^(authorization|x-api-key|api-key|x-auth-token|apikey|x-token|proxy-authorization)$/i;
const PLACEHOLDER = /^(your|xxx|<|\[|\{|changeme|change_me|example|test|dummy|placeholder|todo|\*+$|\.\.\.|none$|null$|undefined$)/i;
const CODE_ASSIGN = /(?:api[_-]?key|token|secret|passw(?:or)?d|authorization)\s*[:=]\s*['"`]([A-Za-z0-9_\-./+=]{16,})['"`]/i;
const URL_SECRET = /[?&](?:api[_-]?key|apikey|key|token|access_token|secret)=([A-Za-z0-9_\-]{16,})/i;

const isExpressionOnly = (s) => s.startsWith('=') && /\{\{|\$env|\$credentials|\$vars|\$secrets/.test(s);
const looksLikeSecretValue = (v) => {
  if (typeof v !== 'string') return false;
  const s = v.replace(/^=/, '').replace(/^(Bearer|Basic|Token)\s+/i, '').trim();
  if (s.length < 12 || PLACEHOLDER.test(s) || /\{\{|\$env|\$credentials|\$vars|\$secrets|\$json|\$node/.test(s)) return false;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[_\-./+=]/].filter((r) => r.test(s)).length;
  return classes >= 2 && !/\s/.test(s);
};
export const redact = (s) => `${String(s).replace(/^=/, '').slice(0, 4)}…(${String(s).length} chars)`;

export const ruleHardcodedSecret = {
  id: 'N8N001',
  name: 'hardcoded-secret',
  severity: 'high',
  title: 'Hard-coded secret in workflow JSON',
  summary: 'API keys, tokens, passwords or private keys are stored as literal values in node parameters or code.',
  why: 'Workflow JSON gets exported, committed, pasted into forum posts and shared as templates. Anything literal in it is leaked the moment the file leaves your instance. n8n has a credential store and $env / $vars for exactly this.',
  fix: 'Move the value into an n8n credential (or an environment variable) and reference it with {{ $env.NAME }} / the credential selector. Then rotate the leaked value.',
  bad: '{ "name": "Call API", "type": "n8n-nodes-base.httpRequest", "parameters": { "headerParameters": { "parameters": [ { "name": "Authorization", "value": "Bearer 9f8a7b6c5d4e3f2a1b0c" } ] } } }',
  good: '{ "name": "Call API", "type": "n8n-nodes-base.httpRequest", "parameters": { "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth" }, "credentials": { "httpHeaderAuth": { "id": "12", "name": "My API" } } }',
  check({ model, report }) {
    for (const node of model.nodes) {
      if (node.disabled) continue;
      const seen = new Set();
      const hit = (label, value, path, severity) => {
        const key = `${path}|${label}`;
        if (seen.has(key)) return;
        seen.add(key);
        report({ nodes: [node.name], path: `parameters.${path}`, severity, message: `${label} found in "${node.name}" (${redact(value)}). Literal secrets end up in exports and git history.` });
      };
      const params = node.parameters || {};

      walkStrings(params, (s, path) => {
        for (const [label, re] of VENDOR) { const m = s.match(re); if (m) hit(label, m[0], path, 'critical'); }
        if (/^https?:|^=https?:/.test(s)) {
          const m = s.match(URL_SECRET);
          if (m) hit('API key in URL query string', m[1], path, 'high');
        }
        const isCode = /(^|\.)(jsCode|pythonCode|functionCode|code|query)$/.test(path);
        if (isCode) {
          const m = s.match(CODE_ASSIGN);
          if (m && looksLikeSecretValue(m[1])) hit('Secret assigned in code', m[1], path, 'high');
        }
      });

      walkEntries(params, (obj, path, parentKey) => {
        // { name: 'Authorization', value: '...' } pairs (headers, query params, body fields)
        if (typeof obj.name === 'string' && typeof obj.value === 'string' && SECRET_HEADER.test(obj.name) && looksLikeSecretValue(obj.value)) {
          hit(`Literal "${obj.name}" value`, obj.value, `${path}.value`, 'high');
        }
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === 'string' && SECRET_KEY.test(k) && !/^(authentication|genericAuthType|nodeCredentialType|tokenType|passwordType)$/i.test(k) && looksLikeSecretValue(v) && !isExpressionOnly(v)) {
            hit(`Literal value for "${k}"`, v, path ? `${path}.${k}` : k, 'high');
          }
        }
      });
    }
  },
};
