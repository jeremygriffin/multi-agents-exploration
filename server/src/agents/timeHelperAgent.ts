import { DateTime } from 'luxon';
import path from 'path';

import type { Agent, AgentContext, AgentResult } from './baseAgent';
import { OpenAIAgent } from 'openai-agents';

interface ToolResultMatch {
  city: string;
  province?: string;
  country: string;
  iso2?: string;
  iso3?: string;
  timezone: string;
  confidence: number;
}

interface ToolResultPayload {
  query: string;
  matches: ToolResultMatch[];
  matchCount: number;
}

export class TimeHelperAgent implements Agent {
  readonly id = 'time_helper';

  readonly name = 'Time Helper Agent';

  private readonly agent: OpenAIAgent;

  private readonly toolsLoaded: Promise<boolean>;

  constructor() {
    this.agent = new OpenAIAgent({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      system_instruction: `You help users figure out current times around the world.
Use the resolve_location tool to map user text to IANA time zones whenever the location is unclear or unfamiliar.
If multiple matches exist, ask the user to clarify before giving times. If none are found, explain what extra info you need.
Stay in the conversation until the user has an answer or declines to continue.`,
    });

    const toolsDir = path.resolve(__dirname, '../tools');
    this.toolsLoaded = this.agent.loadToolFuctions(toolsDir).catch((error) => {
      // eslint-disable-next-line no-console
      console.error('Failed to load tools for TimeHelperAgent:', error);
      return false;
    });
  }

  private async ensureToolsLoaded(): Promise<void> {
    await this.toolsLoaded;
  }

  private formatTime(zone: string): { time: string; offset: string; isValid: boolean } {
    const now = DateTime.now().setZone(zone);
    return {
      time: now.toFormat('cccc, dd LLL yyyy HH:mm'),
      offset: now.toFormat('ZZZZ'),
      isValid: now.isValid,
    };
  }

  private buildPrompt(context: AgentContext): string {
    const transcript = context.conversation.messages
      .slice(-4)
      .map((msg) => `${msg.role === 'user' ? 'User' : `Agent(${msg.agent ?? 'assistant'})`}: ${msg.content}`)
      .join('\n');

    return [
      'Resolve the user request by calling resolve_location if necessary, then report current local time for each confirmed match.',
      'If the tool returns no matches, ask the user for more context (country, nearby major city, etc.).',
      'If multiple matches look plausible, share the options and request clarification before giving the time.',
      transcript ? `Recent conversation:\n${transcript}` : null,
      `User message: ${context.userMessage}`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private extractToolResult(message: Record<string, unknown>): ToolResultPayload | null {
    try {
      if ('result' in message && typeof message.result === 'string') {
        return JSON.parse(message.result) as ToolResultPayload;
      }

      if ('content' in message) {
        const content = message.content;
        if (typeof content === 'string') {
          return JSON.parse(content) as ToolResultPayload;
        }

        if (Array.isArray(content)) {
          const textPart = content.find((part) => typeof part?.text === 'string');
          if (textPart && typeof textPart.text === 'string') {
            return JSON.parse(textPart.text) as ToolResultPayload;
          }
        }
      }
    } catch (error) {
      return null;
    }

    return null;
  }

  private formatFromMatches(matches: ToolResultMatch[]): string {
    if (matches.length === 0) {
      return 'I could not map that location to a timezone. Could you share a nearby major city or the country as well?';
    }

    if (matches.length === 1) {
      const match = matches[0]!;
      const zoneTime = this.formatTime(match.timezone);
      if (!zoneTime.isValid) {
        return `I found ${match.city}${match.province ? `, ${match.province}` : ''} in ${match.country}, but the timezone looked invalid. Could you double-check the location?`;
      }

      return `Here is the current local time for ${match.city}${match.province ? `, ${match.province}` : ''} (${match.country}) in ${match.timezone}: ${zoneTime.time} (${zoneTime.offset}).`;
    }

    const topMatches = matches.slice(0, 5);
    const options = topMatches
      .map((match) => `${match.city}${match.province ? `, ${match.province}` : ''} (${match.country}) → ${match.timezone}`)
      .join('\n');

    return `I found multiple matches for that location. Could you clarify which one you need?\n${options}`;
  }

  async handle(context: AgentContext): Promise<AgentResult> {
    await this.ensureToolsLoaded();

    const prompt = this.buildPrompt(context);

    const completion = await this.agent.createChatCompletion(prompt, {
      tool_choices: ['resolve_location'],
    });

    const choice = completion.choices[0] ?? '';
    const toolMessages = (completion.completion_messages ?? []).filter(
      (msg) => msg.role === 'tool'
    );

    const toolPayloads = toolMessages
      .map((msg) => this.extractToolResult(msg as unknown as Record<string, unknown>))
      .filter((payload): payload is ToolResultPayload => payload !== null);

    const latest = toolPayloads[toolPayloads.length - 1] ?? null;

    let content = choice;

    if (latest) {
      content = this.formatFromMatches(latest.matches ?? []);
    } else if (!choice) {
      content = 'I could not determine the time. Could you share more about the location (city and country)?';
    }

    return {
      content,
      debug: {
        prompt,
        toolPayloads,
        rawToolMessages: toolMessages,
      },
    };
  }
}
