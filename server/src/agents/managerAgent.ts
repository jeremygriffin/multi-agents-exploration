import { OpenAIAgent } from 'openai-agents';

import type { Conversation, ManagerPlan } from '../types';

export class ManagerAgent {
  private readonly agent: OpenAIAgent;

  constructor() {
    this.agent = new OpenAIAgent({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      system_instruction: `You coordinate a team of specialist agents: greeting, summarizer, time_helper, input_coach, document_store.
Decide which agents should respond to the latest user message.
Return JSON matching this schema: {
  "actions": [
    { "agent": "greeting" | "summarizer" | "time_helper" | "input_coach" | "document_store", "instructions"?: string }
  ],
  "notes"?: string
}
Only include agents that materially advance the conversation. Prefer greeting agent for new sessions or topic changes, otherwise continue delegating to the agent that most recently requested follow-up until their task is resolved. When the user asks for time conversions include time_helper. Use summarizer for recap requests. Use input_coach to improve phrasing. If attachments are supplied or the user asks to store a document, include document_store. If no agent is needed return an empty actions array.`,
    });
  }

  async plan(conversation: Conversation, userMessage: string): Promise<ManagerPlan> {
    const history = conversation.messages
      .slice(-8)
      .map((msg) => `${msg.role === 'user' ? 'User' : `Agent(${msg.agent ?? 'assistant'})`}: ${msg.content}`)
      .join('\n');

    const prompt = [
      history ? `Recent conversation:\n${history}` : 'No previous conversation.',
      `User message: ${userMessage}`,
      'Respond with JSON only. If unsure, prefer a greeting followed by asking clarifying questions.',
    ].join('\n\n');

    const result = await this.agent.createChatCompletion(prompt, {
      custom_params: {
        temperature: 0,
        response_format: { type: 'json_object' },
      },
    });

    const [choice] = result.choices;

    try {
      const parsed = JSON.parse(choice ?? '{}') as Partial<ManagerPlan>;
      const plan: ManagerPlan = {
        actions: Array.isArray(parsed.actions) ? (parsed.actions as ManagerPlan['actions']) : [],
      };

      if (typeof parsed.notes === 'string' && parsed.notes.trim().length > 0) {
        plan.notes = parsed.notes.trim();
      }

      return plan;
    } catch (error) {
      return { actions: [] };
    }
  }
}
