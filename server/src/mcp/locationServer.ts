import type { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { inspect } from 'util';
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
  async (args) => {
    const rawQuery = (() => {
      if (typeof args === 'string') {
        return args;
      }

      if (Array.isArray(args) && args.length > 0) {
        return args[0];
      }

      if (args && typeof args === 'object') {
        const argObject = args as { query?: unknown; arguments?: { query?: unknown } };
        if (typeof argObject.query !== 'undefined') {
          return argObject.query;
        }
        if (argObject.arguments && typeof argObject.arguments.query !== 'undefined') {
          return argObject.arguments.query;
        }
      }

      return undefined;
    })();

    const query = typeof rawQuery === 'string' ? rawQuery : rawQuery != null ? String(rawQuery) : '';

    const matches = buildLocationMatches(query);
    const payload = {
      query,
      matches,
      matchCount: matches.length,
    };

    // eslint-disable-next-line no-console
    console.debug('[MCP] resolve_location', {
      rawArgs: inspect(args, { depth: null, breakLength: Infinity }),
      rawQuery,
      query,
      matchCount: matches.length,
    });

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
    // eslint-disable-next-line no-console
    console.debug('[MCP] incoming request', {
      method: req.method,
      query: req.query,
      headers: {
        'mcp-session-id': req.headers['mcp-session-id'],
        'content-type': req.headers['content-type'],
      },
      body:
        typeof req.body === 'object'
          ? inspect(req.body, { depth: null, breakLength: Infinity })
          : req.body,
    });
    await transport.handleRequest(req, res, req.body);
  };
};
