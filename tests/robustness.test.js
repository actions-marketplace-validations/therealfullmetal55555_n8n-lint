import test from 'node:test';
import assert from 'node:assert/strict';
import { lintDocument, lintWorkflow, unwrapWorkflows } from '../src/index.js';
import { N, wf } from './helpers.js';

test('never throws on junk input', () => {
  const junk = [null, undefined, 0, 'x', [], {}, { nodes: null }, { nodes: 'x' }, { nodes: [null, 1, 'a', []] }, { nodes: [{}] }, { nodes: [{ name: 'a' }] },
    { nodes: [{ name: 'a', type: 5, parameters: 'str' }], connections: 'x' }, { nodes: [{ name: 'a', type: 'x', parameters: null }], connections: { a: null } },
    { nodes: [{ name: 'a', type: 'x' }], connections: { a: { main: 'bad' } } }, { nodes: [{ name: 'a', type: 'x' }], connections: { a: { main: [[null, { node: 'ghost' }, 5]] } } },
    { nodes: [{ name: 'a', type: 'n8n-nodes-base.webhook', parameters: { options: 7 } }], pinData: 'x' }, { nodes: [], pinData: { a: null } }];
  for (const j of junk) assert.doesNotThrow(() => lintDocument(j), JSON.stringify(j));
});

test('duplicate node names and self loops do not crash', () => {
  const w = wf([N('A', 'n8n-nodes-base.set'), N('A', 'n8n-nodes-base.set'), N('Hook', 'n8n-nodes-base.webhook')], [['A', 'A'], ['Hook', 'A']]);
  assert.doesNotThrow(() => lintWorkflow(w));
});

test('random mutations of real-shaped workflows never crash', () => {
  let seed = 42;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const base = JSON.stringify(wf([N('Hook', 'n8n-nodes-base.webhook', { path: 'x' }), N('Agent', '@n8n/n8n-nodes-langchain.agent', { options: { maxIterations: 5 } }), N('Mail', 'n8n-nodes-base.gmail', { operation: 'send' })], [['Hook', 'Agent'], ['Agent', 'Mail']]));
  for (let i = 0; i < 300; i++) {
    let s = base;
    const cuts = Math.floor(rnd() * 4);
    for (let c = 0; c < cuts; c++) {
      const at = Math.floor(rnd() * s.length);
      s = rnd() < 0.5 ? s.slice(0, at) + s.slice(at + 1 + Math.floor(rnd() * 5)) : s.slice(0, at) + ['null', '"x"', '[]', '{}', '1e999'][Math.floor(rnd() * 5)] + s.slice(at);
    }
    let doc;
    try { doc = JSON.parse(s); } catch { continue; }
    assert.doesNotThrow(() => lintDocument(doc), s);
  }
});

test('deep chain (5000 nodes) and big cycle do not overflow the stack and finish fast', () => {
  const n = 5000;
  const nodes = [N('Hook', 'n8n-nodes-base.webhook')];
  const edges = [];
  for (let i = 0; i < n; i++) { nodes.push(N('S' + i, 'n8n-nodes-base.set')); edges.push([i === 0 ? 'Hook' : 'S' + (i - 1), 'S' + i]); }
  edges.push(['S' + (n - 1), 'S0']); // close the loop
  const t0 = Date.now();
  const r = lintWorkflow(wf(nodes, edges));
  assert.ok(Date.now() - t0 < 5000, 'took too long');
  assert.ok(r.findings.some((f) => f.ruleId === 'N8N004'));
});

test('wide fan-out (2000 nodes) is fast', () => {
  const nodes = [N('Hook', 'n8n-nodes-base.webhook'), N('Agent', '@n8n/n8n-nodes-langchain.agent')];
  const edges = [['Hook', 'Agent']];
  for (let i = 0; i < 2000; i++) { nodes.push(N('M' + i, 'n8n-nodes-base.gmail', { operation: 'send' })); edges.push(['Agent', 'M' + i]); }
  const t0 = Date.now();
  lintWorkflow(wf(nodes, edges));
  assert.ok(Date.now() - t0 < 5000);
});

test('unwrapWorkflows understands the supported shapes', () => {
  const w = { nodes: [{ name: 'a', type: 'x' }], connections: {} };
  assert.equal(unwrapWorkflows(w).length, 1);
  assert.equal(unwrapWorkflows({ workflow: w }).length, 1);
  assert.equal(unwrapWorkflows({ workflow: { workflow: w } }).length, 1);
  assert.equal(unwrapWorkflows([w, w]).length, 2);
  assert.equal(unwrapWorkflows({ foo: 1 }).length, 0);
});

test('secret values never appear in any report', () => {
  const secret = 'sk-' + 'Zy9Xw8Vu'.repeat(6);
  const r = lintWorkflow(wf([N('C', 'n8n-nodes-base.httpRequest', { url: 'https://x.example', body: secret })]));
  assert.ok(!JSON.stringify(r).includes(secret));
});
