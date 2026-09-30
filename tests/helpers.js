import { lintWorkflow } from '../src/index.js';

export const N = (name, type, parameters = {}, extra = {}) => ({ id: name, name, type, typeVersion: 1, position: [0, 0], parameters, ...extra });
export const LLM = '@n8n/n8n-nodes-langchain.lmChatOpenAi';
export const AGENT = '@n8n/n8n-nodes-langchain.agent';

/** wf(nodes, edges[[a,b]], ai[[sub,parent,type]], settings) */
export function wf(nodes, edges = [], ai = [], settings = { executionOrder: 'v1', errorWorkflow: 'eh', executionTimeout: 60 }, extra = {}) {
  const connections = {};
  for (const [a, b] of edges) (connections[a] ??= { main: [[]] }).main[0].push({ node: b, type: 'main', index: 0 });
  for (const [a, b, t = 'ai_tool'] of ai) ((connections[a] ??= {})[t] ??= [[]])[0].push({ node: b, type: t, index: 0 });
  return { name: 'test', nodes, connections, settings, ...extra };
}

export const lint = (w, config) => lintWorkflow(w, config);
export const ids = (r) => r.findings.map((f) => f.ruleId);
export const has = (r, id) => r.findings.some((f) => f.ruleId === id);
export const find = (r, id) => r.findings.filter((f) => f.ruleId === id);

// Secret-shaped fixtures are assembled at runtime so no provider-format secret is committed to the repo.
export const fake = {
  openai: () => 'sk-' + 'A1b2C3d4'.repeat(6),
  aws: () => 'AK' + 'IA' + 'ABCDEFGHIJKLMNOP',
  github: () => 'gh' + 'p_' + 'a1B2c3D4e5'.repeat(4),
};

export const webhook = (name = 'Hook', p = {}) => N(name, 'n8n-nodes-base.webhook', { path: 'x', ...p });
export const agent = (name = 'Agent') => N(name, AGENT, {});
export const llm = (name = 'LLM') => N(name, LLM, {});
export const gmailSend = (name = 'Send Email') => N(name, 'n8n-nodes-base.gmail', { operation: 'send', resource: 'message' });
export const wait = (name = 'Approve') => N(name, 'n8n-nodes-base.wait', { resume: 'webhook' });
