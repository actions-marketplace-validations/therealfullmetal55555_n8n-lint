import fs from 'node:fs';
import path from 'node:path';
import { lintDocument, unwrapWorkflows, VERSION, RULES } from './core.js';
import { SEVERITY_RANK } from './score.js';
import { formatPretty } from './report/pretty.js';
import { formatJson } from './report/json.js';
import { formatSarif } from './report/sarif.js';
import { formatMarkdown } from './report/markdown.js';
import { formatBadge } from './report/badge.js';

const HELP = `n8n-lint v${VERSION} — static security linter for n8n workflows

Usage:
  n8n-lint <file|dir|-> [...] [options]

Options:
  -f, --format <fmt>     pretty (default) | json | sarif | markdown | badge
  -o, --output <file>    write the report to a file instead of stdout
      --fail-on <sev>    exit 1 at or above: critical | high (default) | medium | low | none
      --min-score <n>    exit 1 if any workflow scores below n (0-100, default 0)
  -c, --config <file>    config file (default: ./.n8nlintrc.json if present)
      --show-info        show info-level notes in pretty/markdown output
      --no-color         disable colors
      --list-rules       list all rules
      --explain <ID>     explain a rule, with a bad and a good example
  -v, --version
  -h, --help

Exit codes: 0 ok · 1 findings at/above --fail-on (or score < --min-score) · 2 usage or input error
Suppress one finding: put "n8n-lint-disable N8N005" in the node's Notes.
Suppress a whole workflow: a sticky note containing "n8n-lint-disable-workflow".
`;

const FORMATS = ['pretty', 'json', 'sarif', 'markdown', 'badge'];
const FAIL_ON = ['critical', 'high', 'medium', 'low', 'none'];

export class UsageError extends Error {}

export function parseArgs(argv) {
  const o = { paths: [], format: 'pretty', failOn: null, minScore: null, config: null, output: null, color: undefined, showInfo: false };
  const need = (i, flag) => { if (i + 1 >= argv.length) throw new UsageError(`${flag} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.startsWith('--') && a.includes('=') ? a.indexOf('=') : -1;
    const flag = eq > 0 ? a.slice(0, eq) : a;
    const inline = eq > 0 ? a.slice(eq + 1) : null;
    const val = () => { if (inline !== null) return inline; const v = need(i, flag); i++; return v; };
    switch (flag) {
      case '-h': case '--help': o.help = true; break;
      case '-v': case '--version': o.version = true; break;
      case '-f': case '--format': o.format = val(); break;
      case '-o': case '--output': o.output = val(); break;
      case '--fail-on': o.failOn = val(); break;
      case '--min-score': o.minScore = Number(val()); break;
      case '-c': case '--config': o.config = val(); break;
      case '--show-info': o.showInfo = true; break;
      case '--no-color': o.color = false; break;
      case '--color': o.color = true; break;
      case '--list-rules': o.listRules = true; break;
      case '--explain': o.explain = val(); break;
      default:
        if (a.startsWith('-') && a !== '-') throw new UsageError(`Unknown option: ${a}`);
        o.paths.push(a);
    }
  }
  if (!FORMATS.includes(o.format)) throw new UsageError(`Unknown format "${o.format}" (use ${FORMATS.join(', ')})`);
  if (o.failOn !== null && !FAIL_ON.includes(o.failOn)) throw new UsageError(`Invalid --fail-on "${o.failOn}" (use ${FAIL_ON.join(', ')})`);
  if (o.minScore !== null && !(o.minScore >= 0 && o.minScore <= 100)) throw new UsageError('--min-score must be a number from 0 to 100');
  return o;
}

/** Tiny glob: `*` = within a segment, `**` = across segments, `dir` also matches everything below it. */
function globToRegex(g) {
  const re = g.replace(/^\.\//, '').replace(/\/+$/, '')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '(?:.*/)?').replace(/\u0001/g, '.*');
  return new RegExp(`(^|/)${re}(/.*)?$`);
}

function loadConfig(file, explicit) {
  const p = file || (fs.existsSync('.n8nlintrc.json') ? '.n8nlintrc.json' : null);
  if (!p) return {};
  if (!fs.existsSync(p)) { if (explicit) throw new UsageError(`Config file not found: ${p}`); return {}; }
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { throw new UsageError(`Cannot parse ${p}: ${e.message}`); }
  if (cfg.rules && typeof cfg.rules !== 'object') throw new UsageError(`${p}: "rules" must be an object`);
  for (const [k, v] of Object.entries(cfg.rules || {})) {
    if (v !== 'off' && !(v in SEVERITY_RANK)) throw new UsageError(`${p}: rules.${k} must be "off" or a severity, got ${JSON.stringify(v)}`);
  }
  return cfg;
}

function collect(paths, ignore) {
  const files = [];
  const skipDir = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);
  const ignored = (f) => ignore.some((re) => re.test(f.split(path.sep).join('/')));
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.') && e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!skipDir.has(e.name)) walk(full); }
      else if (e.isFile() && e.name.toLowerCase().endsWith('.json') && !ignored(full)) files.push({ file: full, explicit: false });
    }
  };
  for (const p of paths) {
    if (p === '-') { files.push({ file: '-', explicit: true }); continue; }
    if (!fs.existsSync(p)) throw new UsageError(`Path not found: ${p}`);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (!ignored(p)) files.push({ file: p, explicit: true });
  }
  return files;
}

function explain(id) {
  const r = RULES.find((x) => x.id.toLowerCase() === id.toLowerCase() || x.name === id);
  if (!r) throw new UsageError(`Unknown rule "${id}". Try --list-rules`);
  return `${r.id} ${r.name}  [${r.severity}]\n${r.title}\n\n${r.summary}\n\nWhy it matters\n  ${r.why}\n\nHow to fix\n  ${r.fix}\n\nBad\n${indent(r.bad)}\n\nGood\n${indent(r.good)}\n`;
}
const indent = (s) => String(s).split('\n').map((l) => '  ' + l).join('\n');

/**
 * Runs the CLI. Returns { code, stdout, stderr } so it is testable without spawning.
 */
export function run(argv, { stdin = () => fs.readFileSync(0, 'utf8'), isTTY = false } = {}) {
  let stdout = '', stderr = '';
  try {
    const o = parseArgs(argv);
    if (o.help) return { code: 0, stdout: HELP, stderr };
    if (o.version) return { code: 0, stdout: VERSION + '\n', stderr };
    if (o.listRules) {
      return { code: 0, stderr, stdout: RULES.map((r) => `${r.id}  ${r.severity.padEnd(8)} ${r.name.padEnd(28)} ${r.title}`).join('\n') + '\n' };
    }
    if (o.explain) return { code: 0, stdout: explain(o.explain), stderr };
    if (!o.paths.length) { return { code: 2, stdout, stderr: 'No input. Pass a workflow file, a directory, or - for stdin.\n\n' + HELP }; }

    const cfg = loadConfig(o.config, !!o.config);
    const failOn = o.failOn ?? cfg.failOn ?? 'high';
    const minScore = o.minScore ?? cfg.minScore ?? 0;
    if (!FAIL_ON.includes(failOn)) throw new UsageError(`Invalid failOn "${failOn}" in config`);
    const ignore = (cfg.ignore || []).map(globToRegex);
    const inputs = collect(o.paths, ignore);

    const files = [];
    let explicitBad = 0;
    for (const inp of inputs) {
      let text;
      try { text = inp.file === '-' ? stdin() : fs.readFileSync(inp.file, 'utf8'); }
      catch (e) { files.push({ file: inp.file, error: `Cannot read file: ${e.message}` }); explicitBad++; continue; }
      let data;
      try { data = JSON.parse(text.replace(/^\uFEFF/, '')); }
      catch (e) {
        if (inp.explicit) { files.push({ file: inp.file === '-' ? '<stdin>' : inp.file, error: `Invalid JSON: ${e.message}` }); explicitBad++; }
        continue;
      }
      if (!unwrapWorkflows(data).length) {
        if (inp.explicit) { stderr += `warning: ${inp.file} does not look like an n8n workflow (no "nodes" array), skipped\n`; explicitBad++; }
        continue;
      }
      files.push({ file: inp.file === '-' ? '<stdin>' : inp.file, text, results: lintDocument(data, cfg) });
    }

    const scanned = files.filter((f) => f.results);
    if (!scanned.length && !files.length) {
      stderr += 'No n8n workflows found.\n';
      return { code: o.paths.some((p) => p === '-' || (fs.existsSync(p) && fs.statSync(p).isFile())) ? 2 : 0, stdout, stderr };
    }

    const useColor = o.color ?? (isTTY && !process.env.NO_COLOR);
    const fmt = {
      pretty: () => formatPretty(files, { color: useColor && !o.output, showInfo: o.showInfo }),
      json: () => formatJson(files),
      sarif: () => formatSarif(files),
      markdown: () => formatMarkdown(files, { showInfo: o.showInfo }),
      badge: () => formatBadge(files),
    }[o.format]();
    if (o.output) { fs.mkdirSync(path.dirname(path.resolve(o.output)), { recursive: true }); fs.writeFileSync(o.output, fmt); }
    else stdout = fmt;

    const threshold = failOn === 'none' ? Infinity : SEVERITY_RANK[failOn];
    let fail = false;
    for (const f of scanned) for (const r of f.results) {
      if (r.findings.some((x) => SEVERITY_RANK[x.severity] >= threshold)) fail = true;
      if (r.score < minScore) fail = true;
    }
    const hadError = files.some((f) => f.error);
    return { code: hadError ? 2 : fail ? 1 : 0, stdout, stderr };
  } catch (e) {
    if (e instanceof UsageError) return { code: 2, stdout, stderr: `error: ${e.message}\n` };
    throw e;
  }
}
