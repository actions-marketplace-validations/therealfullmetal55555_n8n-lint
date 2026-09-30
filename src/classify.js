// Node classification helpers. Pure functions, no I/O: they run in Node and in the browser.
// Everything here is a documented HEURISTIC over n8n node types / parameters.

export const shortType = (type) => String(type || '').split('.').pop();
export const isBaseNode = (node) => String(node?.type || '').startsWith('n8n-nodes-base.');
export const isLangchainNode = (node) => String(node?.type || '').startsWith('@n8n/n8n-nodes-langchain.');

export function walkStrings(value, visit, path = '', depth = 0) {
  if (depth > 40) return;
  if (typeof value === 'string') return visit(value, path);
  if (Array.isArray(value)) {
    value.forEach((v, i) => walkStrings(v, visit, `${path}[${i}]`, depth + 1));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walkStrings(v, visit, path ? `${path}.${k}` : k, depth + 1);
  }
}

export function walkEntries(value, visit, path = '', parentKey = '', depth = 0) {
  if (depth > 40) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => walkEntries(v, visit, `${path}[${i}]`, parentKey, depth + 1));
  } else if (value && typeof value === 'object') {
    visit(value, path, parentKey);
    for (const [k, v] of Object.entries(value)) walkEntries(v, visit, path ? `${path}.${k}` : k, k, depth + 1);
  }
}

// ---- triggers -------------------------------------------------------------------------------

const UNTRUSTED_TRIGGERS = new Set([
  'webhook', 'formTrigger', 'chatTrigger', 'telegramTrigger', 'gmailTrigger', 'emailReadImap',
  'slackTrigger', 'whatsAppTrigger', 'discordTrigger', 'microsoftOutlookTrigger', 'twilioTrigger',
  'facebookTrigger', 'githubTrigger', 'gitlabTrigger', 'jiraTrigger', 'zendeskTrigger',
  'hubspotTrigger', 'typeformTrigger', 'shopifyTrigger', 'wooCommerceTrigger', 'mcpTrigger',
  'emailTrigger', 'intercomTrigger', 'freshdeskTrigger', 'calendlyTrigger',
]);

export function isTrigger(node) {
  const st = shortType(node.type);
  return st.endsWith('Trigger') || ['webhook', 'cron', 'interval', 'start', 'emailReadImap'].includes(st);
}
/**
 * Is this trigger fed by people/systems we do not control?
 * - chatTrigger only when it is made public
 * - telegramTrigger is trusted when restricted to specific chat / user ids
 */
export function isUntrustedTrigger(node) {
  const st = shortType(node.type);
  const p = node.parameters || {};
  if (!UNTRUSTED_TRIGGERS.has(st)) return false;
  if (st === 'chatTrigger') return p.public === true;
  if (st === 'telegramTrigger') return !(p.additionalFields?.chatIds || p.additionalFields?.userIds);
  return true;
}
export const isErrorTrigger = (node) => shortType(node.type) === 'errorTrigger';
export const isSticky = (node) => shortType(node.type) === 'stickyNote';

// ---- LLM nodes ------------------------------------------------------------------------------

const LC_DECISION = new Set([
  'agent', 'toolsAgent', 'chainLlm', 'chainRetrievalQa', 'chainSummarization',
  'informationExtractor', 'textClassifier', 'sentimentAnalysis', 'openAi',
]);
const BASE_LLM = new Set(['openAi', 'anthropic', 'googleGemini', 'groq', 'mistralAi', 'ollama', 'perplexity', 'openRouter']);
const LLM_HOSTS = /(api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.groq\.com|openrouter\.ai|api\.mistral\.ai|api\.perplexity\.ai|api\.cohere\.(?:ai|com)|api\.together\.xyz|api\.deepseek\.com)/i;

export const isLlmHttp = (node) => {
  if (shortType(node.type) !== 'httpRequest') return false;
  const url = String(node.parameters?.url || '');
  return LLM_HOSTS.test(url) && !/embed/i.test(url); // embeddings return vectors, not decisions
};

/** A node whose *output* is model-generated text/decisions that downstream nodes may act on. */
export function isLlmNode(node) {
  const st = shortType(node.type);
  if (isLangchainNode(node)) return LC_DECISION.has(st);
  if (isBaseNode(node)) return BASE_LLM.has(st) || isLlmHttp(node);
  return false;
}
export const isAgent = (node) => isLangchainNode(node) && ['agent', 'toolsAgent'].includes(shortType(node.type));

// ---- approval gates -------------------------------------------------------------------------

/** A step that blocks until a human acts: Wait(resume=webhook|form), *Send and Wait*, Form node. */
export function isApprovalGate(node) {
  const st = shortType(node.type);
  const p = node.parameters || {};
  if (node.disabled) return false;
  if (st === 'wait' && ['webhook', 'form'].includes(p.resume)) return true;
  if (String(p.operation || '').toLowerCase() === 'sendandwait') return true;
  if (st === 'form' && isBaseNode(node)) return true;
  return false;
}

// ---- side effects ---------------------------------------------------------------------------

const WRITE_OP = /^(send|sendmessage|sendemail|create|createorupdate|update|upsert|insert|delete|remove|append|appendorupdate|post|reply|add|clear|upload|move|archive|cancel|refund|charge|book|publish|execute|edit|write|transfer|invite|assign|close|merge|forward|label|call|trigger)/i;
const SQL_WRITE = /\b(insert|update|delete|drop|alter|truncate|create|grant|merge|replace)\b/i;
const SQL_DESTRUCTIVE = /\b(delete|drop|truncate|alter|grant)\b/i;
const STRONG_VERB = /\b(send|email|delete|remove|pay|refund|charge|transfer|cancel|publish|deploy|execute)\b/i;
const STRONG_DESC_VERB = /\b(send|email|delete|pay|refund|charge|transfer|cancel|publish)\b/i;
const WEAK_VERB = /\b(create|update|write|book|schedule|post|insert|add|submit|reply|notify|run)\b/i;
const READ_HINT = /(search|query|embed|retriev|lookup|fetch|parse|extract|classif|transcri|completion|chat\/|ocr|scrape|analy[sz]|vector|points|graphql|rerank|tokeniz|predict|infer|generate|detect)/i;
const REPLY_TO_SENDER = /(message|callback_query|edited_message|channel_post)\.(chat|from)\.id|\bchat\.id\b|\bfrom\.id\b/;

const APPS = new Set([
  'gmail', 'telegram', 'slack', 'discord', 'whatsApp', 'twilio', 'emailSend', 'microsoftOutlook',
  'mattermost', 'matrix', 'hubspot', 'salesforce', 'pipedrive', 'zohoCrm', 'airtable', 'notion',
  'googleSheets', 'googleCalendar', 'googleDrive', 'googleDocs', 'googleContacts', 'postgres', 'mySql',
  'microsoftSql', 'mongoDb', 'redis', 'supabase', 'baserow', 'nocoDb', 'stripe', 'payPal', 'shopify',
  'wooCommerce', 'zendesk', 'freshdesk', 'intercom', 'jira', 'github', 'gitlab', 'trello', 'asana',
  'clickUp', 'linear', 'mailchimp', 'sendGrid', 'brevo', 'dropbox', 'awsS3', 'awsSes', 'awsSns',
  'awsLambda', 'odoo', 'quickbooks', 'xero', 'wordpress', 'ghost', 'twitter', 'linkedIn',
  'facebookGraphApi', 'youTube', 'mailgun', 'postmark', 'microsoftExcel', 'microsoftTeams',
  'microsoftOneDrive', 'googleBigQuery', 'snowflake', 'elasticsearch',
]);
const MESSAGING = new Set(['telegram', 'slack', 'discord', 'whatsApp', 'matrix', 'mattermost', 'microsoftTeams']);
const EMAIL = new Set(['gmail', 'emailSend', 'microsoftOutlook', 'sendGrid', 'mailgun', 'postmark', 'brevo', 'awsSes', 'mailchimp']);
const PAYMENT = new Set(['stripe', 'payPal', 'quickbooks', 'xero']);
/** Apps whose default operation (when `operation` is omitted) sends/writes. */
const DEFAULT_WRITE = new Set(['telegram', 'slack', 'gmail', 'emailSend', 'twilio', 'whatsApp', 'discord', 'microsoftOutlook', 'awsSes', 'awsSns', 'sendGrid', 'mailgun', 'postmark']);
const SQL_APPS = new Set(['postgres', 'mySql', 'microsoftSql', 'snowflake', 'googleBigQuery']);

export const isSqlNode = (node) => isBaseNode(node) && SQL_APPS.has(shortType(node.type).replace(/Tool$/, ''));

const splitWords = (s) => String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ');

/** impact: 3 = irreversible / outbound / money / code, 2 = changes business data, 1 = chat message, log row, draft */
function appImpact(base, op, p) {
  if (/^(delete|remove|clear|archive|cancel|refund|charge|transfer)/i.test(op)) return 3;
  if (PAYMENT.has(base)) return 3;
  if (EMAIL.has(base)) return p.options?.isDraft === true || /draft|label/i.test(op) || /draft|label/i.test(String(p.resource || '')) ? 1 : 3;
  if (MESSAGING.has(base)) return 1;
  if (base === 'twilio' || base === 'awsSns') return 2;
  if (/^append/i.test(op)) return 1;
  return 2;
}

/**
 * Does this node change the outside world when executed?
 * Returns null, or { kind, reason, impact (1-3), weak? }. `weak` = might actually be a read (e.g. HTTP POST).
 */
export function writeInfo(node) {
  if (node.disabled || isSticky(node)) return null;
  if (isApprovalGate(node)) return null;
  const p = node.parameters || {};
  const st = shortType(node.type);

  if (st === 'executeCommand' || st === 'ssh') return { kind: 'shell', reason: 'runs a shell command', impact: 3 };

  if (['httpRequest', 'httpRequestTool', 'toolHttpRequest'].includes(st)) {
    const method = String(p.method || 'GET').toUpperCase();
    if (isLlmHttp(node)) return null;
    if (method === 'DELETE') return { kind: 'http', reason: 'HTTP DELETE request', impact: 3 };
    if (method === 'PUT' || method === 'PATCH') return { kind: 'http', reason: `HTTP ${method} request`, impact: 2 };
    if (method === 'POST') {
      if (READ_HINT.test(`${p.url || ''} ${node.name || ''} ${p.toolDescription || ''}`)) return null;
      return { kind: 'http', reason: 'HTTP POST request (may be a read)', impact: 1, weak: true };
    }
    return null;
  }

  if (isBaseNode(node)) {
    const base = st.replace(/Tool$/, '');
    if (!APPS.has(base)) return null;
    if (base === 'telegram' && REPLY_TO_SENDER.test(String(p.chatId || ''))) return null; // replying to whoever wrote to the bot
    const op = String(p.operation ?? '');
    if (op) {
      if (/^executequery$/i.test(op) && isSqlNode(node)) {
        const q = String(p.query ?? '');
        if (/^\s*=?\s*(select|with|show|explain)\b/i.test(q) && !SQL_WRITE.test(q)) return null;
        return { kind: 'app', reason: `${base} SQL query`, impact: SQL_DESTRUCTIVE.test(q) ? 3 : 2 };
      }
      return WRITE_OP.test(op) ? { kind: 'app', reason: `${base} ${op}`, impact: appImpact(base, op, p) } : null;
    }
    if (DEFAULT_WRITE.has(base)) return { kind: 'app', reason: `${base} send (default operation)`, impact: appImpact(base, 'send', p) };
    return null;
  }

  if (isLangchainNode(node) && /^(tool|mcpClient)/.test(st)) {
    const name = splitWords(p.name || node.name);
    const desc = `${p.description || ''} ${p.toolDescription || ''}`;
    let m = name.match(STRONG_VERB) || desc.match(STRONG_DESC_VERB);
    if (m) return { kind: 'tool', reason: `tool "${p.name || node.name}" (${m[1].toLowerCase()})`, impact: 3 };
    m = name.match(WEAK_VERB);
    if (m) return { kind: 'tool', reason: `tool "${p.name || node.name}" (${m[1].toLowerCase()})`, impact: 2 };
  }
  return null;
}

/** Severity for "untrusted/LLM-driven action" findings, from the action's impact and whether untrusted input feeds it. */
export function severityFor(impact, fed) {
  if (fed) return { 3: 'critical', 2: 'high', 1: 'low' }[impact] || 'low';
  return { 3: 'high', 2: 'medium', 1: 'low' }[impact] || 'low';
}

export const fromAi = (node) => {
  let hit = false;
  walkStrings(node.parameters || {}, (s) => { if (s.includes('$fromAI(') || s.includes('fromAI(')) hit = true; });
  return hit;
};
