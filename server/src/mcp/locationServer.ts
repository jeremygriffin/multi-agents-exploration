import type { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

import { buildLocationMatches } from '../location/locationMatcher';

const locationServer = new McpServer({
  name: 'location-resolver',
  version: '0.1.0',
});

locationServer.tool(
  'resolve_location',
  {
    title: 'Resolve a location string to candidate time zones',
    description:
      'Accepts a city, state, province, or country name and returns possible matches paired with IANA timezones.',
    inputSchema: {
      query: z.string().min(1, 'A location query is required'),
    },
  },
  async ({ query }) => {
    const matches = buildLocationMatches(query);
    const payload = {
      query,
      matches,
      matchCount: matches.length,
    };

    // eslint-disable-next-line no-console
    console.debug('[MCP] resolve_location', { query, matchCount: matches.length });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(payload),
        },
      ],
      structuredContent: payload,
    };
  }
);

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
  enableJsonResponse: true,
});

const connectionReady = locationServer.connect(transport).catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start MCP location server', error);
  throw error;
});

export const createLocationMcpHandler = () => {
  return async (req: Request, res: Response): Promise<void> => {
    await connectionReady;
    await transport.handleRequest(req, res, req.body);
  };
};
