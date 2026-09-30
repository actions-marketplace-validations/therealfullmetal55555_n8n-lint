import { isAgent, writeInfo, fromAi, severityFor } from '../classify.js';
import { isFedByUntrusted, untrustedSourcesOf } from '../graph.js';

const PROMPT_ONLY = /(only|after|before|unless|once|must|always).{0,60}(confirm|approv|permission|explicit|consent|verify|ask the user)/i;

export const ruleAgentWriteTool = {
  id: 'N8N006',
  name: 'agent-write-tool',
  severity: 'high',
  title: 'AI Agent can call a tool that changes the outside world',
  summary: 'A tool connected to an AI Agent sends, creates, updates or deletes data, so the model decides when and with which arguments it runs.',
  why: 'Tool calls are made by the model, not by your flow. "Ask for confirmation first" written in a prompt is a request, not a control: a prompt-injected or confused model can simply skip it. $fromAI() parameters hand the model the arguments too.',
  fix: 'Give the agent read-only tools and let it *propose* actions as structured output, then execute them after an approval gate in the main flow. If a write tool must stay, use an n8n human-review / Send-and-Wait step for it, scope its credentials narrowly and log every call.',
  bad: '{ "name": "Send Email Tool", "type": "n8n-nodes-base.gmailTool", "parameters": { "operation": "send", "sendTo": "={{ $fromAI(\'to\') }}" } }',
  good: '{ "note": "Agent returns { action, args } → Validate → Wait for Approval → Gmail: send" }',
  check({ model, report }) {
    for (const agent of model.nodes.filter((n) => !n.disabled && isAgent(n))) {
      const tools = (model.aiIn.get(agent.name) || []).filter((e) => e.type === 'ai_tool').map((e) => model.byName.get(e.from)).filter(Boolean);
      const sys = String(agent.parameters?.options?.systemMessage || '');
      const fed = isFedByUntrusted(model, agent.name);
      const via = untrustedSourcesOf(model, agent.name);
      for (const tool of tools) {
        if (tool.disabled) continue;
        const w = writeInfo(tool);
        if (!w) continue;
        const desc = `${tool.parameters?.description || ''} ${tool.parameters?.toolDescription || ''} ${sys}`;
        const promptOnly = PROMPT_ONLY.test(desc);
        const ai = fromAi(tool);
        const bits = [];
        if (promptOnly) bits.push('confirmation is only requested in the prompt, not enforced');
        if (ai) bits.push('arguments are filled by the model ($fromAI)');
        if (fed) bits.push(`the agent is fed by untrusted input (${via.slice(0, 2).map((v) => `"${v}"`).join(', ')})`);
        report({
          nodes: [tool.name, agent.name], severity: severityFor(w.impact + (promptOnly || ai ? 0 : 0), fed),
          message: `Agent "${agent.name}" can call "${tool.name}" (${w.reason}) on its own${bits.length ? `: ${bits.join('; ')}` : ''}.`,
        });
      }
    }
  },
};
