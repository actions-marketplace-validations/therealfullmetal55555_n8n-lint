import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { run } from '../src/cli.js';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ex = (n) => path.join(root, 'examples', n);
const BAD = ex('bad-lead-agent.json');
const GOOD = ex('good-approval-flow.json');
const TOOLS = ex('agent-with-write-tools.json');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'n8nlint-'));

test('examples: good passes, bad and tools fail with exit 1', () => {
  assert.equal(run([GOOD, '--no-color']).code, 0);
  assert.equal(run([BAD, '--no-color']).code, 1);
  assert.equal(run([TOOLS, '--no-color']).code, 1);
});

test('examples: expected rules fire on the bad example', () => {
  const out = JSON.parse(run([BAD, '-f', 'json']).stdout);
  const ids = new Set(out.files[0].workflows[0].findings.map((f) => f.ruleId));
  for (const id of ['N8N001', 'N8N003', 'N8N005', 'N8N007', 'N8N008']) assert.ok(ids.has(id), id);
  assert.equal(out.files[0].workflows[0].grade, 'F');
});

test('examples: the good example has zero findings and score 100', () => {
  const out = JSON.parse(run([GOOD, '-f', 'json']).stdout);
  assert.equal(out.files[0].workflows[0].findings.length, 0);
  assert.equal(out.files[0].workflows[0].score, 100);
});

test('examples: no provider-format secret is committed in examples/', () => {
  const vendor = /\bsk-[A-Za-z0-9_-]{32,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|\b\d{8,10}:[A-Za-z0-9_-]{35}\b/;
  for (const f of fs.readdirSync(path.join(root, 'examples'))) assert.ok(!vendor.test(fs.readFileSync(ex(f), 'utf8')), f);
});

test('--fail-on and --min-score change the exit code', () => {
  assert.equal(run([BAD, '--fail-on', 'none']).code, 0);
  assert.equal(run([GOOD, '--min-score', '100']).code, 0);
  assert.equal(run([BAD, '--fail-on', 'none', '--min-score', '50']).code, 1);
  const medOnly = tmp();
  fs.writeFileSync(path.join(medOnly, 'w.json'), JSON.stringify({ nodes: [{ name: 'Cron', type: 'n8n-nodes-base.scheduleTrigger', parameters: {} }, { name: 'C', type: 'n8n-nodes-base.httpRequest', parameters: { url: 'http://api.example.com' } }], connections: { Cron: { main: [[{ node: 'C', type: 'main', index: 0 }]] } }, settings: { errorWorkflow: 'x', executionTimeout: 10 } }));
  assert.equal(run([medOnly]).code, 0, 'medium does not fail at default high');
  assert.equal(run([medOnly, '--fail-on', 'medium']).code, 1);
});

test('usage errors exit 2', () => {
  assert.equal(run([]).code, 2);
  assert.equal(run(['--bogus']).code, 2);
  assert.equal(run([BAD, '-f', 'xml']).code, 2);
  assert.equal(run([BAD, '--fail-on', 'nope']).code, 2);
  assert.equal(run([BAD, '--min-score', '500']).code, 2);
  assert.equal(run(['/does/not/exist.json']).code, 2);
  assert.equal(run([BAD, '--config', '/does/not/exist.json']).code, 2);
});

test('invalid JSON and non-workflow files exit 2 when given explicitly', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'broken.json'), '{ nope');
  fs.writeFileSync(path.join(d, 'pkg.json'), '{"name":"x"}');
  assert.equal(run([path.join(d, 'broken.json')]).code, 2);
  assert.equal(run([path.join(d, 'pkg.json')]).code, 2);
});

test('directory scan skips non-workflow json silently and recurses', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'sub'));
  fs.mkdirSync(path.join(d, 'node_modules'));
  fs.writeFileSync(path.join(d, 'package.json'), '{"name":"x"}');
  fs.writeFileSync(path.join(d, 'broken.json'), 'xx');
  fs.copyFileSync(GOOD, path.join(d, 'sub', 'a.json'));
  fs.copyFileSync(BAD, path.join(d, 'node_modules', 'ignored.json'));
  const r = run([d, '-f', 'json']);
  const out = JSON.parse(r.stdout);
  assert.equal(out.files.length, 1);
  assert.equal(r.code, 0);
});

test('empty directory: exit 0 with a notice', () => {
  const r = run([tmp()]);
  assert.equal(r.code, 0);
  assert.match(r.stderr, /No n8n workflows/);
});

test('stdin input with -', () => {
  const r = run(['-', '-f', 'json'], { stdin: () => fs.readFileSync(BAD, 'utf8') });
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).files[0].file, '<stdin>');
});

test('accepts n8n UI clipboard export, templates-API wrapper and arrays', () => {
  const wf = JSON.parse(fs.readFileSync(BAD, 'utf8'));
  for (const doc of [{ workflow: { workflow: wf } }, [wf, wf], { workflow: wf }]) {
    const r = run(['-', '-f', 'json'], { stdin: () => JSON.stringify(doc) });
    assert.ok([0, 1].includes(r.code));
    assert.ok(JSON.parse(r.stdout).files[0].workflows.length >= 1);
  }
});

test('config file: ignore globs, rule off, failOn', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'legacy'));
  fs.copyFileSync(BAD, path.join(d, 'legacy', 'old.json'));
  fs.copyFileSync(BAD, path.join(d, 'new.json'));
  const cfg = path.join(d, 'rc.json');
  fs.writeFileSync(cfg, JSON.stringify({ ignore: ['legacy/**'], rules: { N8N001: 'off', N8N005: 'off', N8N003: 'low', N8N007: 'off', N8N008: 'off', N8N002: 'off' }, failOn: 'high' }));
  const r = run([d, '-c', cfg, '-f', 'json']);
  const out = JSON.parse(r.stdout);
  assert.equal(out.files.length, 1);
  assert.equal(r.code, 0);
});

test('config file with an invalid severity exits 2', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'rc.json'), JSON.stringify({ rules: { N8N001: 'sometimes' } }));
  assert.equal(run([GOOD, '-c', path.join(d, 'rc.json')]).code, 2);
});

test('formats: json / sarif / markdown / badge / pretty are well-formed', () => {
  const json = JSON.parse(run([BAD, '-f', 'json']).stdout);
  assert.equal(json.tool, 'n8n-lint');

  const sarif = JSON.parse(run([BAD, '-f', 'sarif']).stdout);
  assert.equal(sarif.version, '2.1.0');
  const res = sarif.runs[0].results;
  assert.ok(res.length >= 5);
  assert.ok(sarif.runs[0].tool.driver.rules.length === 12);
  for (const x of res) {
    assert.ok(['error', 'warning', 'note'].includes(x.level));
    assert.ok(x.locations[0].physicalLocation.region.startLine >= 1);
    assert.ok(sarif.runs[0].tool.driver.rules.some((r) => r.id === x.ruleId));
  }
  const wh = res.find((x) => x.ruleId === 'N8N003');
  const line = fs.readFileSync(BAD, 'utf8').split('\n')[wh.locations[0].physicalLocation.region.startLine - 1];
  assert.match(line, /Lead Webhook/, 'SARIF line must point at the node');

  const md = run([BAD, '-f', 'markdown']).stdout;
  assert.match(md, /^## n8n-lint report/);
  assert.match(md, /\| Severity \| Rule/);

  const svg = run([BAD, '-f', 'badge']).stdout;
  assert.match(svg, /^<svg[\s\S]*<\/svg>\s*$/);
  assert.match(svg, /0\/100/);

  const pretty = run([BAD, '--no-color']).stdout;
  assert.doesNotMatch(pretty, /\x1b\[/);
  assert.match(pretty, /score 0\/100/);
});

test('pretty: color only when requested; info hidden unless --show-info', () => {
  assert.match(run([BAD, '--color']).stdout, /\x1b\[/);
  const hidden = run([BAD, '--no-color']).stdout;
  const shown = run([BAD, '--no-color', '--show-info']).stdout;
  assert.match(hidden, /info-level note.* hidden/);
  assert.match(shown, /INFO/);
});

test('--output writes a file and keeps stdout empty', () => {
  const f = path.join(tmp(), 'out', 'r.sarif');
  const r = run([BAD, '-f', 'sarif', '-o', f]);
  assert.equal(r.stdout, '');
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).version, '2.1.0');
});

test('--list-rules, --explain, --help, --version', () => {
  assert.equal(run(['--list-rules']).stdout.trim().split('\n').length, 12);
  assert.match(run(['--explain', 'N8N005']).stdout, /human approval/i);
  assert.match(run(['--explain', 'sql-interpolation']).stdout, /N8N007/);
  assert.equal(run(['--explain', 'N8N999']).code, 2);
  assert.match(run(['--help']).stdout, /Usage:/);
  assert.match(run(['--version']).stdout, /^\d+\.\d+\.\d+/);
});

test('the real binary: exit codes and stdout through a child process', () => {
  const bin = path.join(root, 'bin', 'n8n-lint.js');
  const good = spawnSync(process.execPath, [bin, GOOD], { encoding: 'utf8' });
  assert.equal(good.status, 0);
  const bad = spawnSync(process.execPath, [bin, BAD, '-f', 'json'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stdout).tool, 'n8n-lint');
  const piped = spawnSync(process.execPath, [bin, '-', '-f', 'json'], { input: fs.readFileSync(BAD), encoding: 'utf8' });
  assert.equal(piped.status, 1);
  const usage = spawnSync(process.execPath, [bin], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
});
