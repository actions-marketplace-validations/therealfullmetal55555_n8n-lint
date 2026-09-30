import { shortType } from '../classify.js';

const LOCAL = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal)(:\d+)?$/i;

export const ruleInsecureTransport = {
  id: 'N8N008',
  name: 'insecure-transport',
  severity: 'medium',
  title: 'Plain HTTP or disabled TLS verification',
  summary: 'An HTTP Request node calls http:// (not localhost) or turns on "Ignore SSL Issues".',
  why: 'Anything sent over plain HTTP (including API keys in headers) can be read and modified on the path. Ignoring certificate errors removes the protection HTTPS was supposed to give.',
  fix: 'Use https://. Remove "Ignore SSL Issues" and fix the certificate (or pin a CA) instead.',
  bad: '{ "type": "n8n-nodes-base.httpRequest", "parameters": { "url": "http://api.example.org/v1/items", "options": { "allowUnauthorizedCerts": true } } }',
  good: '{ "type": "n8n-nodes-base.httpRequest", "parameters": { "url": "https://api.example.org/v1/items" } }',
  check({ model, report }) {
    for (const node of model.nodes) {
      if (node.disabled || !['httpRequest', 'httpRequestTool', 'toolHttpRequest'].includes(shortType(node.type))) continue;
      const p = node.parameters || {};
      const url = String(p.url || '').replace(/^=/, '').trim();
      const m = url.match(/^http:\/\/([^/?#]+)/i);
      if (m && !LOCAL.test(m[1]) && m[1].includes('.')) {
        report({ nodes: [node.name], path: 'parameters.url', message: `"${node.name}" calls ${m[1]} over plain http://. Credentials and payloads travel unencrypted.` });
      }
      if (p.options?.allowUnauthorizedCerts === true) {
        report({ nodes: [node.name], path: 'parameters.options.allowUnauthorizedCerts', message: `"${node.name}" ignores TLS certificate errors ("Ignore SSL Issues").` });
      }
    }
  },
};
