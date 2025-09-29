import { OpenAIAgent } from 'openai-agents';

import type { Agent, AgentContext, AgentResult } from './baseAgent';

interface OpenAiTextAgentOptions {
  id: string;
  name: string;
  systemInstruction: string;
  defaultModel?: string;
  temperature?: number;
}

export class OpenAiTextAgent implements Agent {
  public readonly id: string;

  public readonly name: string;

  protected readonly agent: OpenAIAgent;

  constructor(options: OpenAiTextAgentOptions) {
    this.id = options.id;
    this.name = options.name;
    this.agent = new OpenAIAgent({
      model: options.defaultModel ?? 'gpt-4o-mini',
      temperature: options.temperature ?? 0.5,
      system_instruction: options.systemInstruction,
    });
  }

  protected buildPrompt(context: AgentContext): string {
    const historySnippet = context.conversation.messages
      .map((msg) => `${msg.role === 'user' ? 'User' : `Agent(${msg.agent ?? 'assistant'})`}: ${msg.content}`)
      .slice(-8)
      .join('\n');

    return `Conversation so far:\n${historySnippet}\n\nUser message to address:\n${context.userMessage}`;
  }

  async handle(context: AgentContext): Promise<AgentResult> {
    const prompt = this.buildPrompt(context);
    const result = await this.agent.createChatCompletion(prompt);
    const [choice] = result.choices;

    return {
      content: choice ?? '',
      debug: {
        prompt,
      },
    };
  }
}
