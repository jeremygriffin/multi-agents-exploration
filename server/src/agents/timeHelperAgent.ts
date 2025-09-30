import { DateTime } from 'luxon';
import path from 'path';

import type { Agent, AgentContext, AgentResult } from './baseAgent';
import { OpenAIAgent } from 'openai-agents';
import { LocationMcpClient } from '../mcp/locationClient';

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

  private readonly locationExtractor: OpenAIAgent;

  private readonly toolsLoaded: Promise<boolean>;

  private readonly locationProvider: 'agents_sdk' | 'mcp';

  private readonly mcpClient?: LocationMcpClient;

  constructor() {
    const provider = (process.env.TIME_HELPER_LOCATION_PROVIDER ?? 'agents_sdk').toLowerCase();
    this.locationProvider = provider === 'mcp' ? 'mcp' : 'agents_sdk';

    this.agent = new OpenAIAgent({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      system_instruction: `You help users figure out current times around the world.
Use the resolve_location tool to map user text to IANA time zones whenever the location is unclear or unfamiliar.
If multiple matches exist, ask the user to clarify before giving times. If none are found, explain what extra info you need.
Stay in the conversation until the user has an answer or declines to continue.`,
    });

    this.locationExtractor = new OpenAIAgent({
      model: 'gpt-4o-mini',
      temperature: 0,
      system_instruction:
        'Extract the location the user wants a time for. Respond with only the location string (e.g., "Seattle, Washington, United States"). If unsure, reply with UNKNOWN.',
    });

    if (this.locationProvider === 'agents_sdk') {
      const toolsDir = path.resolve(__dirname, '../tools');
      this.toolsLoaded = this.agent.loadToolFuctions(toolsDir).catch((error) => {
        // eslint-disable-next-line no-console
        console.error('Failed to load tools for TimeHelperAgent:', error);
        return false;
      });
    } else {
      this.toolsLoaded = Promise.resolve(true);
      const mcpUrl = process.env.TIME_HELPER_MCP_URL
        ?? `http://127.0.0.1:${process.env.PORT ?? 3001}/mcp/location`;
      this.mcpClient = new LocationMcpClient(mcpUrl);
    }
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

  private parseJsonRecursive(value: string): unknown {
    let current: unknown = value;

    let loopGuard = 0;
    while (loopGuard < 6) {
      if (typeof current !== 'string') {
        break;
      }

      const trimmed = current.trim();
      if (trimmed.length === 0) {
        return null;
      }

      const wrappedInQuotes = trimmed.startsWith('"') && trimmed.endsWith('"');
      const looksJson = trimmed.startsWith('{') || trimmed.startsWith('[');

      try {
        if (looksJson || wrappedInQuotes) {
          current = JSON.parse(trimmed);
          loopGuard += 1;
          continue;
        }
      } catch (error) {
        return null;
      }

      break;
    }

    return current;
  }

  private extractToolResult(message: Record<string, unknown>): ToolResultPayload | null {
    const rawResult = (() => {
      if ('result' in message && typeof message.result === 'string') {
        return message.result;
      }

      if ('content' in message) {
        const content = message.content;
        if (typeof content === 'string') {
          return content;
        }

        if (Array.isArray(content)) {
          const textPart = content.find((part) => typeof part?.text === 'string');
          if (textPart && typeof textPart.text === 'string') {
            return textPart.text;
          }
        }
      }

      return null;
    })();

    if (!rawResult) {
      return null;
    }

    const parsed = this.parseJsonRecursive(rawResult);
    if (parsed && typeof parsed === 'object' && 'matchCount' in parsed) {
      return parsed as ToolResultPayload;
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
    if (this.locationProvider === 'mcp') {
      return this.handleViaMcp(context);
    }

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

  private async handleViaMcp(context: AgentContext): Promise<AgentResult> {
    const rawUserInput = this.stripManagerInstructions(context.userMessage);
    if (!rawUserInput || !this.mcpClient) {
      return {
        content: 'I could not determine the time. Could you share more about the location (city and country)?',
        debug: {
          provider: 'mcp',
          reason: 'missing_query_or_client',
        },
      };
    }

    const extractedQuery = await this.deriveLocationQuery(context, rawUserInput);
    if (!extractedQuery) {
      return {
        content: 'I could not determine the time. Could you share more about the location (city and country)?',
        debug: {
          provider: 'mcp',
          rawUserInput,
          reason: 'unable_to_extract_location',
        },
      };
    }

    const payload = await this.mcpClient.resolveLocation(extractedQuery);

    if (!payload) {
      return {
        content: 'I was unable to resolve that location. Could you add more detail like the country or state?',
        debug: {
          provider: 'mcp',
          rawUserInput,
          extractedQuery,
          payload,
        },
      };
    }

    const content = this.formatFromMatches(payload.matches ?? []);

    return {
      content,
      debug: {
        provider: 'mcp',
        rawUserInput,
        extractedQuery,
        payload,
      },
    };
  }

  private stripManagerInstructions(message: string): string {
    if (!message) {
      return '';
    }

    const [userPortion] = message.split('Manager instructions:');
    return (userPortion ?? message).trim();
  }

  private async deriveLocationQuery(context: AgentContext, userInput: string): Promise<string | null> {
    const transcript = context.conversation.messages
      .slice(-4)
      .map((msg) => `${msg.role === 'user' ? 'User' : `Agent(${msg.agent ?? 'assistant'})`}: ${msg.content}`)
      .join('\n');

    const prompt = [
      'Identify the location the user wants the current time for and respond with only that location.',
      'Return a succinct string such as "Seattle, Washington" or "Tokyo, Japan". Use just the information provided; do not invent details.',
      'If you are unsure about the location, respond with UNKNOWN.',
      transcript ? `Recent conversation:\n${transcript}` : null,
      `User input: ${userInput}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const completion = await this.locationExtractor.createChatCompletion(prompt, {
      custom_params: {
        temperature: 0,
        max_tokens: 32,
      },
    });

    const answer = completion.choices[0]?.trim();
    if (!answer) {
      return null;
    }

    const firstLine = answer.split('\n')[0]?.trim();
    if (!firstLine || firstLine.toUpperCase() === 'UNKNOWN') {
      return null;
    }

    return firstLine.replace(/^Location:\s*/i, '').trim();
  }
}
