import { ruleHardcodedSecret } from './n8n001-hardcoded-secret.js';
import { ruleMissingErrorHandling } from './n8n002-missing-error-handling.js';
import { ruleUnauthenticatedWebhook } from './n8n003-unauthenticated-webhook.js';
import { ruleUnboundedLoop } from './n8n004-unbounded-loop.js';
import { ruleUngatedWrite } from './n8n005-ungated-write-after-llm.js';
import { ruleAgentWriteTool } from './n8n006-agent-write-tool.js';
import { ruleSqlInterpolation } from './n8n007-sql-interpolation.js';
import { ruleInsecureTransport } from './n8n008-insecure-transport.js';
import { rulePinDataPii } from './n8n009-pindata-pii.js';
import { ruleDeadNodes } from './n8n010-dead-nodes.js';
import { ruleShellExecution } from './n8n011-shell-execution.js';
import { ruleCodeInjectionRisk } from './n8n012-code-injection-risk.js';

export const RULES = [
  ruleHardcodedSecret, ruleMissingErrorHandling, ruleUnauthenticatedWebhook, ruleUnboundedLoop,
  ruleUngatedWrite, ruleAgentWriteTool, ruleSqlInterpolation, ruleInsecureTransport,
  rulePinDataPii, ruleDeadNodes, ruleShellExecution, ruleCodeInjectionRisk,
];
