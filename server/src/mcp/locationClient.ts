import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { inspect } from 'util';

export interface LocationMcpPayload {
  query: string;
  matches: Array<{
    city: string;
    province?: string;
    country: string;
    iso2?: string;
    iso3?: string;
    timezone: string;
    confidence: number;
    latitude?: number;
    longitude?: number;
  }>;
  matchCount: number;
}

export interface SunTimesPayload {
  timezone: string;
  date: string | null;
  sunrise: string | null;
  sunset: string | null;
  solarNoon: string | null;
  daylightDurationMinutes: number | null;
}

export interface MoonTimesPayload {
  timezone: string;
  date: string | null;
  rise: string | null;
  set: string | null;
  alwaysUp: boolean;
  alwaysDown: boolean;
}

export interface CalendarEventsPayload {
  timezone: string;
  date: string | null;
  events: Array<{
    name: string;
    type?: string;
    note?: string | null;
    date?: string | null;
  }>;
}

export class LocationMcpClient {
  private clientPromise: Promise<Client> | null = null;

  constructor(private readonly url: string) {}

  private async getClient(): Promise<Client> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const transport = new StreamableHTTPClientTransport(new URL(this.url), {
          requestInit: {
            headers: {
              'content-type': 'application/json',
              accept: 'application/json',
            },
          },
        });
        const client = new Client({
          name: 'time-helper-backend',
          version: '0.1.0',
        });
        await client.connect(transport as unknown as Transport);
        return client;
      })().catch((error) => {
        this.clientPromise = null;
        throw error;
      });
    }

    const clientPromise = this.clientPromise;
    if (!clientPromise) {
      throw new Error('MCP client failed to initialize');
    }

    return clientPromise;
  }

  private async callTool<T>(name: string, args: Record<string, unknown>): Promise<T | null> {
    const client = await this.getClient();

    const result = await client.callTool({
      name,
      arguments: args,
    });

    // eslint-disable-next-line no-console
    console.debug('[MCP] callTool result', {
      name,
      args,
      isError: result.isError,
      hasStructured: Boolean((result as { structuredContent?: unknown }).structuredContent),
      rawResult: inspect(result, { depth: null, breakLength: Infinity }),
    });

    if (result.isError) {
      return null;
    }

    const structured = (result as { structuredContent?: unknown }).structuredContent;
    if (structured && typeof structured === 'object') {
      return structured as T;
    }

    const contentItems = Array.isArray((result as { content?: unknown }).content)
      ? ((result as { content?: unknown[] }).content ?? [])
      : [];
    const textPayload = contentItems.find((item) => item && typeof item === 'object' && 'type' in item && item.type === 'text');
    if (!textPayload) {
      return null;
    }

    try {
      const rawText = extractTextContent(textPayload);
      if (!rawText) {
        return null;
      }
      return JSON.parse(rawText) as T;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Failed to parse MCP payload', error);
      return null;
    }
  }

  async resolveLocation(query: string): Promise<LocationMcpPayload | null> {
    return this.callTool<LocationMcpPayload>('resolve_location', { query });
  }

  async getSunTimes(args: {
    latitude: number;
    longitude: number;
    timezone: string;
    date?: string;
  }): Promise<SunTimesPayload | null> {
    return this.callTool<SunTimesPayload>('get_sun_times', args);
  }

  async getMoonTimes(args: {
    latitude: number;
    longitude: number;
    timezone: string;
    date?: string;
  }): Promise<MoonTimesPayload | null> {
    return this.callTool<MoonTimesPayload>('get_moon_times', args);
  }

  async getCalendarEvents(args: {
    iso2?: string;
    timezone: string;
    date?: string;
  }): Promise<CalendarEventsPayload | null> {
    return this.callTool<CalendarEventsPayload>('get_calendar_events', args);
  }
}

const extractTextContent = (item: unknown): string | null => {
  if (!item || typeof item !== 'object' || !('type' in item) || (item as { type: unknown }).type !== 'text') {
    return null;
  }

  const textCandidate = (item as { text?: unknown }).text;
  if (typeof textCandidate === 'string') {
    return textCandidate;
  }

  if (Array.isArray(textCandidate)) {
    return textCandidate
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        if (part && typeof part === 'object' && 'text' in part && typeof (part as { text?: unknown }).text === 'string') {
          return (part as { text: string }).text;
        }
        return '';
      })
      .join('')
      .trim();
  }

  return null;
};
