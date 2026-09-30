#!/usr/bin/env node
import { run } from '../src/cli.js';

try {
  const { code, stdout, stderr } = run(process.argv.slice(2), { isTTY: !!process.stdout.isTTY });
  if (stderr) process.stderr.write(stderr);
  if (stdout) process.stdout.write(stdout);
  process.exitCode = code;
} catch (e) {
  process.stderr.write(`n8n-lint crashed: ${e && e.stack || e}\nPlease report this with a redacted workflow.\n`);
  process.exitCode = 2;
}
