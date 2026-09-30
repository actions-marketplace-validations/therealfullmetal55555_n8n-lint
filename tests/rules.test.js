import test from 'node:test';
import assert from 'node:assert/strict';
import { N, wf, lint, ids, has, find, fake, webhook, agent, llm, gmailSend, wait, AGENT } from './helpers.js';

// ---------- N8N001 hardcoded-secret ----------
test('N8N001 flags vendor-format keys (critical)', () => {
  const r = lint(wf([N('Call', 'n8n-nodes-base.httpRequest', { url: 'https://api.openai.com/v1/x', jsonBody: `{"k":"${fake.openai()}"}` })]));
  const f = find(r, 'N8N001');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'critical');
  assert.ok(!f[0].message.includes(fake.openai()), 'message must not echo the full secret');
});
test('N8N001 flags AWS and GitHub shaped tokens', () => {
  const r = lint(wf([N('A', 'n8n-nodes-base.set', { values: { string: [{ name: 'x', value: fake.aws() }] } }), N('B', 'n8n-nodes-base.set', { v: fake.github() })]));
  assert.equal(find(r, 'N8N001').length, 2);
});
test('N8N001 flags literal Authorization header values', () => {
  const r = lint(wf([N('Call', 'n8n-nodes-base.httpRequest', { url: 'https://x.example/api', headerParameters: { parameters: [{ name: 'Authorization', value: 'Bearer q9Zx81LmPa7Rt2Vb' }] } })]));
  assert.ok(has(r, 'N8N001'));
});
test('N8N001 ignores expressions, $env and placeholders', () => {
  const r = lint(wf([
    N('A', 'n8n-nodes-base.httpRequest', { url: 'https://x.example', headerParameters: { parameters: [{ name: 'Authorization', value: '={{ "Bearer " + $env.API_TOKEN }}' }] } }),
    N('B', 'n8n-nodes-base.httpRequest', { url: 'https://x.example', headerParameters: { parameters: [{ name: 'Authorization', value: 'Bearer YOUR_TOKEN_HERE' }] } }),
    N('C', 'n8n-nodes-base.set', { apiKey: '={{ $credentials.foo.key }}' }),
  ]));
  assert.ok(!has(r, 'N8N001'));
});
test('N8N001 ignores disabled nodes', () => {
  assert.ok(!has(lint(wf([N('Off', 'n8n-nodes-base.set', { v: fake.openai() }, { disabled: true })])), 'N8N001'));
});

// ---------- N8N002 missing-error-handling ----------
test('N8N002 reports a missing error workflow', () => {
  const r = lint(wf([webhook(), agent()], [['Hook', 'Agent']], [], { executionOrder: 'v1' }));
  const f = find(r, 'N8N002').find((x) => x.path === 'settings.errorWorkflow');
  assert.ok(f);
  assert.equal(f.severity, 'medium');
});
test('N8N002 is only low for an inert workflow without error workflow', () => {
  const r = lint(wf([N('Cron', 'n8n-nodes-base.scheduleTrigger'), N('Set', 'n8n-nodes-base.set')], [['Cron', 'Set']], [], { executionOrder: 'v1' }));
  assert.equal(find(r, 'N8N002').find((x) => x.path === 'settings.errorWorkflow').severity, 'low');
});
test('N8N002 is satisfied by retries on external calls', () => {
  const call = N('Call', 'n8n-nodes-base.httpRequest', { url: 'https://api.example.com', method: 'GET' }, { retryOnFail: true });
  const r = lint(wf([N('Cron', 'n8n-nodes-base.scheduleTrigger'), call], [['Cron', 'Call']]));
  assert.ok(!find(r, 'N8N002').some((x) => x.nodes.includes('Call')));
});
test('N8N002 flags external calls without retry/error branch', () => {
  const r = lint(wf([N('Cron', 'n8n-nodes-base.scheduleTrigger'), N('Call', 'n8n-nodes-base.httpRequest', { url: 'https://api.example.com' })], [['Cron', 'Call']]));
  assert.ok(find(r, 'N8N002').some((x) => x.nodes.includes('Call')));
});

// ---------- N8N003 unauthenticated-webhook ----------
test('N8N003: open webhook feeding an LLM is high', () => {
  const r = lint(wf([webhook(), agent()], [['Hook', 'Agent']]));
  assert.equal(find(r, 'N8N003')[0].severity, 'high');
});
test('N8N003: open webhook that only posts a chat message is medium', () => {
  const r = lint(wf([webhook(), N('Tg', 'n8n-nodes-base.telegram', {})], [['Hook', 'Tg']]));
  assert.equal(find(r, 'N8N003')[0].severity, 'medium');
});
test('N8N003: header auth silences it', () => {
  const r = lint(wf([webhook('Hook', { authentication: 'headerAuth' }), agent()], [['Hook', 'Agent']]));
  assert.ok(!has(r, 'N8N003'));
});
test('N8N003: IP allow-list downgrades to low', () => {
  const r = lint(wf([webhook('Hook', { options: { ipWhitelist: '10.0.0.0/8' } }), agent()], [['Hook', 'Agent']]));
  const f = find(r, 'N8N003');
  assert.ok(!f.length || f[0].severity === 'low');
});

// ---------- N8N004 unbounded-loop ----------
test('N8N004 flags a cycle containing an LLM', () => {
  const r = lint(wf([N('Cron', 'n8n-nodes-base.scheduleTrigger'), agent('A'), N('IF', 'n8n-nodes-base.if')], [['Cron', 'A'], ['A', 'IF'], ['IF', 'A']]));
  const f = find(r, 'N8N004');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'high');
});
test('N8N004 treats splitInBatches loops as bounded', () => {
  const r = lint(wf([N('Cron', 'n8n-nodes-base.scheduleTrigger'), N('Split', 'n8n-nodes-base.splitInBatches'), N('Work', 'n8n-nodes-base.set')], [['Cron', 'Split'], ['Split', 'Work'], ['Work', 'Split']]));
  assert.ok(!has(r, 'N8N004'));
});
test('N8N004 flags agents with a huge maxIterations only above 25', () => {
  const big = lint(wf([N('A', AGENT, { options: { maxIterations: 100 } })]));
  const ok = lint(wf([N('A', AGENT, { options: { maxIterations: 10 } })]));
  assert.ok(has(big, 'N8N004'));
  assert.ok(!has(ok, 'N8N004'));
});

// ---------- N8N005 ungated-write-after-llm ----------
test('N8N005: LLM → email send is reported; untrusted trigger makes it critical', () => {
  const r = lint(wf([webhook(), agent(), gmailSend()], [['Hook', 'Agent'], ['Agent', 'Send Email']]));
  assert.equal(find(r, 'N8N005')[0].severity, 'critical');
});
test('N8N005: without untrusted input it is high', () => {
  const r = lint(wf([N('Cron', 'n8n-nodes-base.scheduleTrigger'), agent(), gmailSend()], [['Cron', 'Agent'], ['Agent', 'Send Email']]));
  assert.equal(find(r, 'N8N005')[0].severity, 'high');
});
test('N8N005: a Wait node is an approval gate', () => {
  const r = lint(wf([webhook(), agent(), wait(), gmailSend()], [['Hook', 'Agent'], ['Agent', 'Approve'], ['Approve', 'Send Email']]));
  assert.ok(!has(r, 'N8N005'));
});
test('N8N005: send-and-wait is an approval gate', () => {
  const sw = N('Ask Slack', 'n8n-nodes-base.slack', { operation: 'sendAndWait' });
  const r = lint(wf([webhook(), agent(), sw, gmailSend()], [['Hook', 'Agent'], ['Agent', 'Ask Slack'], ['Ask Slack', 'Send Email']]));
  assert.ok(!has(r, 'N8N005'));
});
test('N8N005: a gate on only one of two paths still reports the other', () => {
  const r = lint(wf([webhook(), agent(), wait(), gmailSend('Mail A'), gmailSend('Mail B')], [['Hook', 'Agent'], ['Agent', 'Approve'], ['Approve', 'Mail A'], ['Agent', 'Mail B']]));
  const f = find(r, 'N8N005');
  assert.equal(f.length, 1);
  assert.equal(f[0].nodes[0], 'Mail B');
});
test('N8N005: Gmail draft is low impact, not critical', () => {
  const draft = N('Draft', 'n8n-nodes-base.gmail', { operation: 'create', options: { isDraft: true } });
  const r = lint(wf([webhook(), agent(), draft], [['Hook', 'Agent'], ['Agent', 'Draft']]));
  assert.equal(find(r, 'N8N005')[0].severity, 'low');
});
test('N8N005: replying to the telegram sender is not a finding', () => {
  const tg = N('Reply', 'n8n-nodes-base.telegram', { chatId: '={{ $("Trigger").item.json.message.chat.id }}', text: '={{ $json.output }}' });
  const r = lint(wf([N('Trigger', 'n8n-nodes-base.telegramTrigger'), agent(), tg], [['Trigger', 'Agent'], ['Agent', 'Reply']]));
  assert.ok(!has(r, 'N8N005'));
});
test('N8N005: embedding endpoints are not LLM sources', () => {
  const emb = N('Embed', 'n8n-nodes-base.httpRequest', { method: 'POST', url: 'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent' });
  const r = lint(wf([N('Cron', 'n8n-nodes-base.scheduleTrigger'), emb, gmailSend()], [['Cron', 'Embed'], ['Embed', 'Send Email']]));
  assert.ok(!has(r, 'N8N005'));
});
test('N8N005: a read-looking HTTP POST is not a write', () => {
  const q = N('Vector Search', 'n8n-nodes-base.httpRequest', { method: 'POST', url: 'https://qdrant.example.com/collections/x/points/search' });
  const r = lint(wf([N('Cron', 'n8n-nodes-base.scheduleTrigger'), agent(), q], [['Cron', 'Agent'], ['Agent', 'Vector Search']]));
  assert.ok(!has(r, 'N8N005'));
});

// ---------- N8N006 agent-write-tool ----------
const toolWf = (tool, trigger = webhook()) => wf([trigger, agent(), llm(), tool], [[trigger.name, 'Agent']], [['LLM', 'Agent', 'ai_languageModel'], [tool.name, 'Agent', 'ai_tool']]);
test('N8N006: gmail send tool on an agent fed by untrusted input is critical', () => {
  const r = lint(toolWf(N('Mail Tool', 'n8n-nodes-base.gmailTool', { operation: 'send', sendTo: "={{ $fromAI('to') }}" })));
  assert.equal(find(r, 'N8N006')[0].severity, 'critical');
});
test('N8N006: read tools (getAll / search / fetch-page description) are not flagged', () => {
  const tools = [
    N('Get many', 'n8n-nodes-base.gmailTool', { operation: 'getAll' }),
    N('Fetch Page', '@n8n/n8n-nodes-langchain.toolWorkflow', { name: 'fetch_page', description: 'Fetches a web page and can remove navigation and ads from the text.' }),
    N('Orders', '@n8n/n8n-nodes-langchain.toolWorkflow', { name: 'get_order_status', description: 'Look up an order.' }),
  ];
  for (const t of tools) assert.ok(!has(lint(toolWf(t)), 'N8N006'), t.name);
});
test('N8N006: custom tool named like a write verb is flagged', () => {
  const t = N('Create Calendar Event', '@n8n/n8n-nodes-langchain.toolCustom', { name: 'create_calendar_event', description: 'Creates an event' });
  assert.ok(has(lint(toolWf(t)), 'N8N006'));
});
test('N8N006: SQL delete tool', () => {
  const t = N('Del', 'n8n-nodes-base.postgresTool', { operation: 'executeQuery', query: "=DELETE FROM t WHERE id = {{ $fromAI('id') }}" });
  const r = lint(toolWf(t));
  assert.ok(has(r, 'N8N006'));
  assert.ok(has(r, 'N8N007'));
});

// ---------- N8N007 sql-interpolation ----------
test('N8N007 flags {{ }} in executeQuery', () => {
  const r = lint(wf([webhook(), N('DB', 'n8n-nodes-base.postgres', { operation: 'executeQuery', query: "=SELECT * FROM u WHERE e = '{{ $json.body.email }}'" })], [['Hook', 'DB']]));
  assert.equal(find(r, 'N8N007')[0].severity, 'critical');
});
test('N8N007 accepts query replacement parameters', () => {
  const r = lint(wf([N('DB', 'n8n-nodes-base.postgres', { operation: 'executeQuery', query: 'SELECT * FROM u WHERE e = $1', options: { queryReplacement: '={{ $json.email }}' } })]));
  assert.ok(!has(r, 'N8N007'));
});
test('N8N007 ignores a static query', () => {
  assert.ok(!has(lint(wf([N('DB', 'n8n-nodes-base.mySql', { operation: 'executeQuery', query: 'SELECT 1' })])), 'N8N007'));
});

// ---------- N8N008 insecure-transport ----------
test('N8N008 flags http:// to a remote host and ignored TLS errors', () => {
  const r = lint(wf([N('A', 'n8n-nodes-base.httpRequest', { url: 'http://api.example.com/x' }), N('B', 'n8n-nodes-base.httpRequest', { url: 'https://x.example', options: { allowUnauthorizedCerts: true } })]));
  assert.equal(find(r, 'N8N008').length, 2);
});
test('N8N008 allows http:// to localhost / internal names', () => {
  const r = lint(wf([N('A', 'n8n-nodes-base.httpRequest', { url: 'http://localhost:6333/x' }), N('B', 'n8n-nodes-base.httpRequest', { url: 'http://qdrant:6333/x' })]));
  assert.ok(!has(r, 'N8N008'));
});

// ---------- N8N009 pindata-pii ----------
test('N8N009 flags real-looking emails and phones in pinData, not example.com', () => {
  const bad = lint(wf([N('A', 'n8n-nodes-base.set')], [], [], undefined, { pinData: { A: [{ json: { email: 'jane.doe@gmail.com', phone: '+1 415 555 0134' } }] } }));
  const ok = lint(wf([N('A', 'n8n-nodes-base.set')], [], [], undefined, { pinData: { A: [{ json: { email: 'jane@example.com' } }] } }));
  assert.ok(has(bad, 'N8N009'));
  assert.ok(!has(ok, 'N8N009'));
});

// ---------- N8N010 dead-nodes ----------
test('N8N010 flags disabled and unreachable nodes', () => {
  const r = lint(wf([N('Cron', 'n8n-nodes-base.scheduleTrigger'), N('A', 'n8n-nodes-base.set'), N('Off', 'n8n-nodes-base.set', {}, { disabled: true }), N('Orphan', 'n8n-nodes-base.set')], [['Cron', 'A']]));
  assert.equal(find(r, 'N8N010').length, 2);
});
test('N8N010 does not report orphans in trigger-less fragments', () => {
  const r = lint(wf([N('A', 'n8n-nodes-base.set'), N('B', 'n8n-nodes-base.set')], [['A', 'B']]));
  assert.ok(!has(r, 'N8N010'));
});
test('N8N010 ignores sticky notes', () => {
  const r = lint(wf([N('Cron', 'n8n-nodes-base.scheduleTrigger'), N('Note', 'n8n-nodes-base.stickyNote', { content: 'hi' })]));
  assert.ok(!has(r, 'N8N010'));
});

// ---------- N8N011 shell-execution ----------
test('N8N011 shell: critical when dynamic and reachable from untrusted input', () => {
  const r = lint(wf([webhook(), N('Sh', 'n8n-nodes-base.executeCommand', { command: 'echo {{ $json.body.x }}' })], [['Hook', 'Sh']]));
  assert.equal(find(r, 'N8N011')[0].severity, 'critical');
});
test('N8N011 shell: static command on a schedule is high', () => {
  const r = lint(wf([N('Cron', 'n8n-nodes-base.scheduleTrigger'), N('Sh', 'n8n-nodes-base.executeCommand', { command: 'ls' })], [['Cron', 'Sh']]));
  assert.equal(find(r, 'N8N011')[0].severity, 'high');
});

// ---------- N8N012 code-injection-risk ----------
test('N8N012 flags eval / child_process in Code nodes', () => {
  const r = lint(wf([N('Cron', 'n8n-nodes-base.scheduleTrigger'), N('Code', 'n8n-nodes-base.code', { jsCode: 'return eval(items[0].json.expr)' })], [['Cron', 'Code']]));
  assert.ok(has(r, 'N8N012'));
  assert.ok(!has(lint(wf([N('Code', 'n8n-nodes-base.code', { jsCode: 'return items.map(i => i.json)' })])), 'N8N012'));
});

// ---------- suppression & config ----------
test('suppression: n8n-lint-disable in node notes', () => {
  const mail = { ...gmailSend(), notes: 'reviewed by security. n8n-lint-disable N8N005' };
  const r = lint(wf([webhook(), agent(), mail], [['Hook', 'Agent'], ['Agent', 'Send Email']]));
  assert.ok(!has(r, 'N8N005'));
  assert.equal(r.suppressed.filter((x) => x.ruleId === 'N8N005').length, 1);
});
test('suppression: a workflow-level sticky note', () => {
  const r = lint(wf([webhook(), agent(), N('Note', 'n8n-nodes-base.stickyNote', { content: 'n8n-lint-disable-workflow' })], [['Hook', 'Agent']]));
  assert.equal(r.findings.length, 0);
});
test('config: rule off and severity override', () => {
  const w = wf([webhook(), agent()], [['Hook', 'Agent']]);
  assert.ok(!has(lint(w, { rules: { N8N003: 'off' } }), 'N8N003'));
  assert.equal(find(lint(w, { rules: { N8N003: 'low' } }), 'N8N003')[0].severity, 'low');
  assert.ok(!has(lint(w, { rules: { 'unauthenticated-webhook': 'off' } }), 'N8N003'));
});

// ---------- scoring ----------
test('score: clean is 100/A, a critical caps at 59', () => {
  const clean = lint(wf([N('Cron', 'n8n-nodes-base.scheduleTrigger'), N('Set', 'n8n-nodes-base.set')], [['Cron', 'Set']]));
  assert.equal(clean.score, 100);
  assert.equal(clean.grade, 'A');
  const crit = lint(wf([N('Cron', 'n8n-nodes-base.scheduleTrigger'), N('Code', 'n8n-nodes-base.code', { jsCode: 'eval(x)' }), N('Sh', 'n8n-nodes-base.executeCommand', { command: 'a {{ 1 }}' })], [['Cron', 'Code'], ['Code', 'Sh']]));
  assert.ok(crit.score <= 89);
  const c2 = lint(wf([webhook(), N('Sh', 'n8n-nodes-base.executeCommand', { command: 'a {{ $json.x }}' })], [['Hook', 'Sh']]));
  assert.ok(c2.score <= 59);
});
