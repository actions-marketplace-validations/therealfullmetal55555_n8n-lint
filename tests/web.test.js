import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { lintWorkflow } from '../src/index.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8');

test('web bundle: loads in a bare VM and gives identical results to the Node build', () => {
  const start = html.indexOf('const __defs = {}');
  const end = html.indexOf('const N8NLINT = __req("core");') + 'const N8NLINT = __req("core");'.length;
  assert.ok(start > 0 && end > start);
  const ctx = vm.createContext({});
  vm.runInContext(html.slice(start, end) + '\nthis.N8NLINT = N8NLINT;', ctx);
  for (const f of fs.readdirSync(path.join(root, 'examples'))) {
    const wf = JSON.parse(fs.readFileSync(path.join(root, 'examples', f), 'utf8'));
    const a = ctx.N8NLINT.lintWorkflow(wf, {});
    const b = lintWorkflow(wf, {});
    assert.equal(a.score, b.score, f);
    assert.equal(JSON.stringify(a.findings), JSON.stringify(b.findings), f);
  }
});

test('web page: no external resources are loaded', () => {
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.doesNotMatch(html, /<link[^>]+href=["']https?:/i);
  assert.doesNotMatch(html, /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket)\s*\(/);
});
