import { VERSION } from '../core.js';
export function formatJson(files) {
  return JSON.stringify({
    tool: 'n8n-lint', version: VERSION,
    files: files.map((f) => f.error ? { file: f.file, error: f.error } : { file: f.file, workflows: f.results }),
  }, null, 2) + '\n';
}
