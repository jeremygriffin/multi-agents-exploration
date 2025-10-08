import { OpenAIAgent } from 'openai-agents';

import type { Agent, AgentContext, AgentResult } from './baseAgent';
import { toTokenUsage } from '../utils/usageUtils';
import { buildOpenAIClientOptions } from '../config/openaiConfig';

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

  private readonly modelName: string;

  constructor(options: OpenAiTextAgentOptions) {
    this.id = options.id;
    this.name = options.name;
    this.modelName = options.defaultModel ?? 'gpt-4o-mini';
    this.agent = new OpenAIAgent(
      {
        model: this.modelName,
        temperature: options.temperature ?? 0.5,
        system_instruction: `${options.systemInstruction}\n\nAlways respond in English unless the user explicitly requests another language. Do not switch languages based on location or inference.`,
      },
      buildOpenAIClientOptions()
    );
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
    const usage = toTokenUsage(result.total_usage, this.modelName);

    return {
      content: choice ?? '',
      debug: {
        prompt,
      },
      ...(usage ? { usage } : {}),
    };
  }
}
