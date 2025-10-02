import { DateTime } from 'luxon';
import path from 'path';

import type { Agent, AgentContext, AgentResult } from './baseAgent';
import { OpenAIAgent } from 'openai-agents';
import {
  LocationMcpClient,
  type LocationMcpPayload,
  type SunTimesPayload,
  type MoonTimesPayload,
  type CalendarEventsPayload,
} from '../mcp/locationClient';
import type { InteractionLogger } from '../services/interactionLogger';

type TimeIntent = 'current_time' | 'sun_times' | 'moon_times' | 'calendar';

interface ToolResultMatch {
  city: string;
  province?: string;
  country: string;
  iso2?: string;
  iso3?: string;
  timezone: string;
  confidence: number;
  latitude?: number;
  longitude?: number;
}

interface ToolResultPayload {
  query: string;
  matches: ToolResultMatch[];
  matchCount: number;
}

interface ClassifiedRequest {
  intent: TimeIntent;
  location?: string | null;
  date?: string | null;
}

export class TimeHelperAgent implements Agent {
  readonly id = 'time_helper';

  readonly name = 'Time Helper Agent';

  private readonly agent: OpenAIAgent;

  private readonly locationExtractor: OpenAIAgent;

  private readonly intentClassifier: OpenAIAgent;

  private readonly toolsLoaded: Promise<boolean>;

  private readonly locationProvider: 'agents_sdk' | 'mcp';

  private readonly mcpClient?: LocationMcpClient;

  private readonly logger: InteractionLogger | undefined;

  constructor(logger?: InteractionLogger) {
    const provider = (process.env.TIME_HELPER_LOCATION_PROVIDER ?? 'agents_sdk').toLowerCase();
    this.locationProvider = provider === 'mcp' ? 'mcp' : 'agents_sdk';

    this.logger = logger;

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

    this.intentClassifier = new OpenAIAgent({
      model: 'gpt-4o-mini',
      temperature: 0,
      system_instruction: `You classify user questions about time-related information.
Return ONLY compact JSON with keys intent, location, date (example: {"intent":"current_time","location":"Seattle, Washington, United States","date":null}).
Valid intents: current_time (current local time / time zones), sun_times (sunrise/sunset), moon_times (moonrise/moonset), calendar (public holidays or notable calendar events).
Set location to null if unclear. Set date to an ISO string (YYYY-MM-DD) when the user specifies a day, otherwise null.
Do not include extra text or commentary.`,
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

  private buildLocationLabel(match: ToolResultMatch): string {
    return `${match.city}${match.province ? `, ${match.province}` : ''} (${match.country})`;
  }

  private formatIsoLocal(iso: string | null, zone: string): string {
    if (!iso) {
      return 'unavailable';
    }

    const dt = DateTime.fromISO(iso, { zone }).setZone(zone);
    if (!dt.isValid) {
      return 'unavailable';
    }

    return `${dt.toFormat('HH:mm')} (${dt.toFormat('ZZZZ')})`;
  }

  private formatDuration(minutes: number | null): string | null {
    if (minutes == null || Number.isNaN(minutes) || minutes <= 0) {
      return null;
    }

    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0 && mins > 0) {
      return `${hours}h ${mins}m`;
    }
    if (hours > 0) {
      return `${hours}h`;
    }
    return `${mins}m`;
  }

  private formatNoMatchResponse(intent: TimeIntent, attemptedQuery?: string | null): string {
    const suffix =
      attemptedQuery && attemptedQuery.trim().length > 0
        ? ` I couldn't find a match for "${attemptedQuery.trim()}". Could you share a nearby larger city, alternate spelling, or additional details?`
        : '';

    switch (intent) {
      case 'sun_times':
        return `I could not determine the location to calculate sunrise and sunset. Could you share the city and country?${suffix}`.trim();
      case 'moon_times':
        return `I could not determine the location to check moonrise or moonset. Could you share the city and country?${suffix}`.trim();
      case 'calendar':
        return `I could not determine the location to look up calendar events. Could you share the city and country?${suffix}`.trim();
      default:
        return `I could not determine the location. Could you share the city, state/province, and country?${suffix}`.trim();
    }
  }

  private formatMultipleMatchResponse(matches: ToolResultMatch[], intent: TimeIntent): string {
    if (matches.length === 0) {
      return this.formatNoMatchResponse(intent);
    }

    const topMatches = matches.slice(0, 5);
    const options = topMatches
      .map((match) => `${this.buildLocationLabel(match)} → ${match.timezone}`)
      .join('\n');

    const taskExplanation = (() => {
      switch (intent) {
        case 'sun_times':
          return 'sunrise and sunset times';
        case 'moon_times':
          return 'moonrise or moonset information';
        case 'calendar':
          return 'local holidays';
        default:
          return 'the current time';
      }
    })();

    return `I found multiple possible matches for that location. Could you clarify which one you mean so I can provide ${taskExplanation}?\n${options}`;
  }

  private formatCurrentTimeMatch(match: ToolResultMatch): string {
    const zoneTime = this.formatTime(match.timezone);
    if (!zoneTime.isValid) {
      return `I found ${this.buildLocationLabel(match)}, but the timezone looked invalid. Could you double-check the location?`;
    }

    return `Here is the current local time for ${this.buildLocationLabel(match)} in ${match.timezone}: ${zoneTime.time} (${zoneTime.offset}).`;
  }

  private formatSunTimesSummary(match: ToolResultMatch, payload: SunTimesPayload): string {
    const zone = match.timezone;
    const dateLabel = payload.date
      ? DateTime.fromISO(payload.date, { zone }).setZone(zone).toFormat('cccc, dd LLL yyyy')
      : 'the selected date';
    const sunrise = this.formatIsoLocal(payload.sunrise, zone);
    const sunset = this.formatIsoLocal(payload.sunset, zone);
    const daylight = this.formatDuration(payload.daylightDurationMinutes);

    const daylightLine = daylight ? ` Daylight lasts roughly ${daylight}.` : '';

    return `For ${this.buildLocationLabel(match)} on ${dateLabel}, sunrise is at ${sunrise} and sunset is at ${sunset}.${daylightLine}`;
  }

  private formatMoonTimesSummary(match: ToolResultMatch, payload: MoonTimesPayload): string {
    const zone = match.timezone;
    const dateLabel = payload.date
      ? DateTime.fromISO(payload.date, { zone }).setZone(zone).toFormat('cccc, dd LLL yyyy')
      : 'the selected date';

    if (payload.alwaysUp) {
      return `On ${dateLabel}, the moon stays above the horizon all day in ${this.buildLocationLabel(match)}.`;
    }

    if (payload.alwaysDown) {
      return `On ${dateLabel}, the moon does not rise above the horizon in ${this.buildLocationLabel(match)}.`;
    }

    const rise = this.formatIsoLocal(payload.rise, zone);
    const set = this.formatIsoLocal(payload.set, zone);

    if (rise === 'unavailable' && set === 'unavailable') {
      return `I could not determine reliable moonrise or moonset times for ${this.buildLocationLabel(match)} on ${dateLabel}.`;
    }

    return `For ${this.buildLocationLabel(match)} on ${dateLabel}, moonrise is at ${rise} and moonset is at ${set}.`;
  }

  private formatCalendarSummary(match: ToolResultMatch, payload: CalendarEventsPayload): string {
    const zone = match.timezone;
    const dateLabel = payload.date
      ? DateTime.fromISO(payload.date, { zone }).setZone(zone).toFormat('cccc, dd LLL yyyy')
      : 'the selected date';

    if (!payload.events || payload.events.length === 0) {
      return `I did not find major public holidays for ${dateLabel} in ${this.buildLocationLabel(match)}.`;
    }

    const entries = payload.events
      .map((event) => {
        const type = event.type ? ` (${event.type})` : '';
        return `• ${event.name}${type}`;
      })
      .join('\n');

    return `Here are the notable events for ${dateLabel} in ${this.buildLocationLabel(match)}:\n${entries}`;
  }

  private async classifyRequest(context: AgentContext, userInput: string): Promise<ClassifiedRequest> {
    const transcript = context.conversation.messages
      .slice(-4)
      .map((msg) => `${msg.role === 'user' ? 'User' : `Agent(${msg.agent ?? 'assistant'})`}: ${msg.content}`)
      .join('\n');

    const prompt = [
      'Analyse the user request and decide whether they want the current time, sunrise/sunset, moonrise/moonset, or calendar events.',
      'Return ONLY minified JSON with keys intent, location, date.',
      'Valid intents: current_time, sun_times, moon_times, calendar.',
      'If the location is unclear, set location to null. If the date is unspecified, set date to null. Interpret phrases like "today" or "tomorrow" as ISO dates when obvious.',
      transcript ? `Recent conversation:\n${transcript}` : null,
      `User input: ${userInput}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const completion = await this.intentClassifier.createChatCompletion(prompt, {
      custom_params: {
        temperature: 0,
        max_tokens: 120,
      },
    });

    const raw = completion.choices[0] ?? '';
    const parsed = this.parseJsonRecursive(raw);

    const validIntent = (value: unknown): TimeIntent => {
      switch (value) {
        case 'sun_times':
        case 'moon_times':
        case 'calendar':
          return value;
        default:
          return 'current_time';
      }
    };

    if (parsed && typeof parsed === 'object') {
      const intent = validIntent((parsed as { intent?: unknown }).intent);
      const locationValue = (parsed as { location?: unknown }).location;
      const location = typeof locationValue === 'string' && locationValue.trim().length > 0
        ? locationValue.trim()
        : null;
      const dateValue = (parsed as { date?: unknown }).date;
      const date = typeof dateValue === 'string' && dateValue.trim().length > 0
        ? dateValue.trim()
        : null;

      return {
        intent,
        location,
        date,
      };
    }

    return {
      intent: 'current_time',
      location: null,
      date: null,
    };
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
      return this.formatNoMatchResponse('current_time');
    }

    if (matches.length === 1) {
      return this.formatCurrentTimeMatch(matches[0]!);
    }

    return this.formatMultipleMatchResponse(matches, 'current_time');
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
        content: this.formatNoMatchResponse('current_time'),
        debug: {
          provider: 'mcp',
          reason: 'missing_query_or_client',
        },
      };
    }

    const classified = await this.classifyRequest(context, rawUserInput);

    const extractedQuery = classified.location
      ?? (await this.deriveLocationQuery(context, rawUserInput));

    if (!extractedQuery) {
      this.logMcpEvent(context, 'error', {
        rawUserInput,
        intent: classified.intent,
        reason: 'unable_to_extract_location',
      });
      return {
        content: this.formatNoMatchResponse(classified.intent),
        debug: {
          provider: 'mcp',
          rawUserInput,
          reason: 'unable_to_extract_location',
          classified,
        },
      };
    }

    this.logMcpEvent(context, 'request', {
      tool: 'resolve_location',
      rawUserInput,
      intent: classified.intent,
      date: classified.date,
      extractedQuery,
    });

    let payload: LocationMcpPayload | null = null;
    let errorMessage: string | undefined;

    try {
      payload = await this.mcpClient.resolveLocation(extractedQuery);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    if (!payload && errorMessage) {
      this.logMcpEvent(context, 'error', {
        tool: 'resolve_location',
        rawUserInput,
        extractedQuery,
        error: errorMessage,
      });
    } else {
      this.logMcpEvent(context, 'response', {
        tool: 'resolve_location',
        rawUserInput,
        extractedQuery,
        matchCount: payload?.matchCount ?? 0,
        matches: payload?.matches ?? [],
      });
    }

    if (!payload || payload.matchCount === 0) {
      return {
        content: this.formatNoMatchResponse(classified.intent, extractedQuery),
        debug: {
          provider: 'mcp',
          rawUserInput,
          extractedQuery,
          classified,
          payload,
          errorMessage,
        },
      };
    }

    if (payload.matchCount > 1) {
      return {
        content: this.formatMultipleMatchResponse(payload.matches, classified.intent),
        debug: {
          provider: 'mcp',
          rawUserInput,
          extractedQuery,
          classified,
          payload,
        },
      };
    }

    const match = payload.matches[0]!;

    const baseDebug = {
      provider: 'mcp' as const,
      rawUserInput,
      extractedQuery,
      classified,
      payload,
    };

    if (classified.intent === 'sun_times') {
      if (typeof match.latitude !== 'number' || typeof match.longitude !== 'number') {
        return {
          content: 'I found the location, but I do not have precise coordinates to calculate sunrise and sunset.',
          debug: {
            ...baseDebug,
            reason: 'missing_coordinates',
          },
        };
      }

      const args = {
        latitude: match.latitude,
        longitude: match.longitude,
        timezone: match.timezone,
        ...(classified.date ? { date: classified.date } : {}),
      };

      this.logMcpEvent(context, 'request', {
        tool: 'get_sun_times',
        args,
      });

      let sunPayload: SunTimesPayload | null = null;
      let sunError: string | undefined;
      try {
        sunPayload = await this.mcpClient.getSunTimes(args);
      } catch (error) {
        sunError = error instanceof Error ? error.message : String(error);
      }

      if (!sunPayload) {
        this.logMcpEvent(context, 'error', {
          tool: 'get_sun_times',
          args,
          error: sunError ?? 'unknown_sun_times_error',
        });

        return {
          content: 'I ran into an issue retrieving sunrise and sunset details. Please try again in a moment.',
          debug: {
            ...baseDebug,
            sunError,
          },
        };
      }

      this.logMcpEvent(context, 'response', {
        tool: 'get_sun_times',
        args,
        payload: sunPayload,
      });

      const content = this.formatSunTimesSummary(match, sunPayload);
      return {
        content,
        debug: {
          ...baseDebug,
          sunPayload,
        },
      };
    }

    if (classified.intent === 'moon_times') {
      if (typeof match.latitude !== 'number' || typeof match.longitude !== 'number') {
        return {
          content: 'I found the location, but I do not have precise coordinates to calculate moonrise or moonset.',
          debug: {
            ...baseDebug,
            reason: 'missing_coordinates',
          },
        };
      }

      const args = {
        latitude: match.latitude,
        longitude: match.longitude,
        timezone: match.timezone,
        ...(classified.date ? { date: classified.date } : {}),
      };

      this.logMcpEvent(context, 'request', {
        tool: 'get_moon_times',
        args,
      });

      let moonPayload: MoonTimesPayload | null = null;
      let moonError: string | undefined;
      try {
        moonPayload = await this.mcpClient.getMoonTimes(args);
      } catch (error) {
        moonError = error instanceof Error ? error.message : String(error);
      }

      if (!moonPayload) {
        this.logMcpEvent(context, 'error', {
          tool: 'get_moon_times',
          args,
          error: moonError ?? 'unknown_moon_times_error',
        });

        return {
          content: 'I could not retrieve moonrise or moonset information right now. Please try again shortly.',
          debug: {
            ...baseDebug,
            moonError,
          },
        };
      }

      this.logMcpEvent(context, 'response', {
        tool: 'get_moon_times',
        args,
        payload: moonPayload,
      });

      const content = this.formatMoonTimesSummary(match, moonPayload);
      return {
        content,
        debug: {
          ...baseDebug,
          moonPayload,
        },
      };
    }

    if (classified.intent === 'calendar') {
      if (!match.iso2) {
        return {
          content: 'I need the country information (ISO2 code) to look up local holidays. Could you specify the country?',
          debug: {
            ...baseDebug,
            reason: 'missing_iso2',
          },
        };
      }

      const args = {
        iso2: match.iso2,
        timezone: match.timezone,
        ...(classified.date ? { date: classified.date } : {}),
      };

      this.logMcpEvent(context, 'request', {
        tool: 'get_calendar_events',
        args,
      });

      let calendarPayload: CalendarEventsPayload | null = null;
      let calendarError: string | undefined;
      try {
        calendarPayload = await this.mcpClient.getCalendarEvents(args);
      } catch (error) {
        calendarError = error instanceof Error ? error.message : String(error);
      }

      if (!calendarPayload) {
        this.logMcpEvent(context, 'error', {
          tool: 'get_calendar_events',
          args,
          error: calendarError ?? 'unknown_calendar_error',
        });

        return {
          content: 'I could not fetch the local calendar events right now. Please try again later.',
          debug: {
            ...baseDebug,
            calendarError,
          },
        };
      }

      this.logMcpEvent(context, 'response', {
        tool: 'get_calendar_events',
        args,
        payload: calendarPayload,
      });

      const content = this.formatCalendarSummary(match, calendarPayload);
      return {
        content,
        debug: {
          ...baseDebug,
          calendarPayload,
        },
      };
    }

    const content = this.formatCurrentTimeMatch(match);
    return {
      content,
      debug: {
        ...baseDebug,
      },
    };
  }

  private logMcpEvent(
    context: AgentContext,
    stage: 'request' | 'response' | 'error',
    details: Record<string, unknown>
  ): void {
    if (!this.logger) {
      return;
    }

    void this.logger.append({
      timestamp: new Date().toISOString(),
      event: 'mcp_tool',
      conversationId: context.conversation.id,
      agent: this.id,
      payload: {
        stage,
        ...details,
      },
    });
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
