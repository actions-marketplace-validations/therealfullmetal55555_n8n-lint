#!/usr/bin/env node
// Bundles src/ (classify, graph, score, rules, core) + examples into ONE self-contained web/index.html.
// No network, no dependencies: the page lints workflows entirely in the browser.
// `--check` fails if the committed web/index.html is stale.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const OUT = path.join(root, 'web', 'index.html');

/** Module order = dependency order. */
function listModules() {
  const mods = ['classify.js', 'graph.js', 'score.js'];
  const rulesDir = fs.readdirSync(path.join(src, 'rules')).filter((f) => /^n8n\d+.*\.js$/.test(f)).sort();
  for (const f of rulesDir) mods.push('rules/' + f);
  mods.push('rules/index.js', 'core.js');
  return mods;
}
const key = (p) => p.replace(/\.js$/, '');
const resolveKey = (from, spec) => key(path.posix.normalize(path.posix.join(path.posix.dirname(from), spec)));

function transform(file, code) {
  const exported = [];
  const cur = file;
  if (/\bfrom\s+['"]node:/.test(code) || /import\s+.*\s+from\s+['"](?!\.)/.test(code)) throw new Error(`${file}: non-relative import cannot be bundled`);
  code = code.replace(/^import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?\s*$/gm, (_, names, spec) => {
    const mapped = names.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/\s+as\s+/, ': ')).join(', ');
    return `const { ${mapped} } = __req(${JSON.stringify(resolveKey(cur, spec))});`;
  });
  code = code.replace(/^import\s+\*\s+as\s+(\w+)\s+from\s*['"]([^'"]+)['"];?\s*$/gm, (_, id, spec) => `const ${id} = __req(${JSON.stringify(resolveKey(cur, spec))});`);
  code = code.replace(/^export\s+(const|let|function|class)\s+(\w+)/gm, (_, kw, name) => { exported.push(name); return `${kw} ${name}`; });
  code = code.replace(/^export\s*\{([^}]*)\}\s*(?:from\s*['"]([^'"]+)['"])?;?\s*$/gm, (_, names, spec) => {
    const list = names.split(',').map((s) => s.trim()).filter(Boolean);
    if (spec) return list.map((n) => { exported.push(n); return `const ${n} = __req(${JSON.stringify(resolveKey(cur, spec))}).${n};`; }).join('\n');
    list.forEach((n) => exported.push(n));
    return '';
  });
  if (/^\s*(import|export)\s/m.test(code)) throw new Error(`${file}: unsupported import/export syntax left after transform`);
  const uniq = [...new Set(exported)];
  return `__defs[${JSON.stringify(key(file))}] = function (__req) {\n${code}\nreturn { ${uniq.join(', ')} };\n};\n`;
}

function bundle() {
  const parts = ['const __defs = {}; const __cache = {};\nfunction __req(k) { if (!(k in __cache)) { if (!__defs[k]) throw new Error("missing module " + k); __cache[k] = __defs[k](__req); } return __cache[k]; }\n'];
  for (const m of listModules()) parts.push(transform(m, fs.readFileSync(path.join(src, m), 'utf8')));
  parts.push('const N8NLINT = __req("core");\n');
  return parts.join('\n');
}

function examples() {
  const dir = path.join(root, 'examples');
  const o = {};
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) o[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  return o;
}

export function build() {
  const tpl = fs.readFileSync(path.join(root, 'web', 'index.template.html'), 'utf8');
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const safe = (s) => s.replace(/<\/(script)/gi, '<\\/$1');
  return tpl
    .replace('/*__BUNDLE__*/', () => safe(bundle()))
    .replace('/*__EXAMPLES__*/', () => safe(`const EXAMPLES = ${JSON.stringify(examples())};`))
    .replace(/__VERSION__/g, version);
}

const html = build();
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (cur !== html) { console.error('web/index.html is out of date. Run: npm run build:web'); process.exit(1); }
  console.log('web/index.html is up to date');
} else {
  fs.writeFileSync(OUT, html);
  console.log(`wrote web/index.html (${(html.length / 1024).toFixed(0)} KB)`);
}
