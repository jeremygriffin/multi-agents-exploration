import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

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

    if (result.isError) {
      return null;
    }

    if (result.structuredContent && typeof result.structuredContent === 'object') {
      return result.structuredContent as LocationMcpPayload;
    }

    const contentItems = Array.isArray(result.content) ? result.content : [];
    const textPayload = contentItems.find(
      (item): item is { type: 'text'; text: string } =>
        Boolean(item && typeof item === 'object' && 'type' in item && item.type === 'text' && 'text' in item && typeof (item as { text: unknown }).text === 'string')
    );
    if (!textPayload) {
      return null;
    }

    try {
      return JSON.parse(textPayload.text) as LocationMcpPayload;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Failed to parse MCP payload', error);
      return null;
    }
  }
}
