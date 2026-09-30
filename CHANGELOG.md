# Changelog

## 0.1.0

First release.

- 12 rules (N8N001–N8N012): hard-coded secrets, missing error handling, unauthenticated webhooks, unbounded loops, ungated writes after an LLM, agent tools that write, SQL interpolation, insecure transport, PII in pinned data, dead nodes, shell execution, dynamic code execution.
- Graph analysis: approval gates (Wait / send-and-wait) block the "LLM output reaches a write" path; untrusted triggers raise severity.
- Output formats: pretty, JSON, SARIF 2.1.0, Markdown (for PR comments), SVG badge.
- Composite GitHub Action (step summary, optional SARIF upload, optional PR comment).
- Single-file web UI (`web/index.html`) with a workflow graph; runs offline in the browser.
- Suppression with `n8n-lint-disable N8N0xx` in node Notes; `.n8nlintrc.json` for severities, ignore globs, thresholds.
