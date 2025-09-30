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
  }>;
  matchCount: number;
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

  async resolveLocation(query: string): Promise<LocationMcpPayload | null> {
    const client = await this.getClient();

    const result = await client.callTool({
      name: 'resolve_location',
      arguments: {
        query,
      },
    });

    // eslint-disable-next-line no-console
    console.debug('[MCP] callTool result', {
      query,
      isError: result.isError,
      hasStructured: Boolean((result as { structuredContent?: unknown }).structuredContent),
      rawResult: inspect(result, { depth: null, breakLength: Infinity }),
    });

    if (result.isError) {
      return null;
    }

    const structured = (result as { structuredContent?: unknown }).structuredContent;
    if (structured && typeof structured === 'object') {
      return structured as LocationMcpPayload;
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
      return JSON.parse(rawText) as LocationMcpPayload;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Failed to parse MCP payload', error);
      return null;
    }
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
