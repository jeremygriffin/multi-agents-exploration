import type { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { inspect } from 'util';
import { z } from 'zod';
import SunCalc from 'suncalc';
import Holidays from 'date-holidays';

import { buildLocationMatches } from '../location/locationMatcher';
import { toIsoInZone, resolveTargetDate } from './timeUtils';

const isDebugEnabled = () => process.env.DEBUG === 'true';

const locationServer = new McpServer({
  name: 'location-resolver',
  version: '0.1.0',
});

locationServer.registerTool(
  'resolve_location',
  {
    title: 'Resolve a location string to candidate time zones',
    description:
      'Accepts a city, state, province, or country name and returns possible matches paired with IANA timezones.',
    inputSchema: {
      query: z.string().min(1, 'A location query is required'),
    },
  },
  async (argsInput, extra) => {
    const argObject = (argsInput ?? {}) as { query?: unknown };
    const rawQuery = argObject.query;
    const query = typeof rawQuery === 'string' ? rawQuery : rawQuery != null ? String(rawQuery) : '';

    const matches = buildLocationMatches(query);
    const payload = {
      query,
      matches,
      matchCount: matches.length,
    };

    if (isDebugEnabled()) {
      // eslint-disable-next-line no-console
      console.debug('[MCP] resolve_location', {
        rawArgs: inspect(argsInput, { depth: null, breakLength: Infinity }),
        extra: inspect(extra, { depth: 1 }),
        rawQuery,
        query,
        matchCount: matches.length,
      });
    }

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

const sunTimesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timezone: z.string().min(1),
  date: z.string().optional(),
});

locationServer.registerTool(
  'get_sun_times',
  {
    title: 'Compute sunrise and sunset times',
    description: 'Returns sunrise and sunset for the specified coordinates and date.',
    inputSchema: {
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      timezone: z.string().min(1),
      date: z.string().optional(),
    },
  },
  async (argsInput) => {
    const parsed = sunTimesSchema.parse(argsInput ?? {});
    const targetDay = resolveTargetDate(parsed.date, parsed.timezone);

    const times = SunCalc.getTimes(targetDay.toJSDate(), parsed.latitude, parsed.longitude);

    const payload = {
      timezone: parsed.timezone,
      date: targetDay.toISODate(),
      sunrise: toIsoInZone(times.sunrise, parsed.timezone),
      sunset: toIsoInZone(times.sunset, parsed.timezone),
      solarNoon: toIsoInZone(times.solarNoon, parsed.timezone),
      daylightDurationMinutes:
        times.sunrise && times.sunset
          ? Math.max(0, Math.round((times.sunset.getTime() - times.sunrise.getTime()) / 60000))
          : null,
    };

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

const moonTimesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timezone: z.string().min(1),
  date: z.string().optional(),
});

locationServer.registerTool(
  'get_moon_times',
  {
    title: 'Compute moonrise and moonset times',
    description: 'Returns moonrise and moonset (when available) for the specified coordinates and date.',
    inputSchema: {
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      timezone: z.string().min(1),
      date: z.string().optional(),
    },
  },
  async (argsInput) => {
    const parsed = moonTimesSchema.parse(argsInput ?? {});
    const targetDay = resolveTargetDate(parsed.date, parsed.timezone);

    const times = SunCalc.getMoonTimes(targetDay.toJSDate(), parsed.latitude, parsed.longitude, true);

    const payload = {
      timezone: parsed.timezone,
      date: targetDay.toISODate(),
      rise: toIsoInZone(times.rise ?? null, parsed.timezone),
      set: toIsoInZone(times.set ?? null, parsed.timezone),
      alwaysUp: Boolean(times.alwaysUp),
      alwaysDown: Boolean(times.alwaysDown),
    };

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

const calendarSchema = z.object({
  iso2: z.string().length(2).optional(),
  timezone: z.string().min(1),
  date: z.string().optional(),
});

locationServer.registerTool(
  'get_calendar_events',
  {
    title: 'Look up notable calendar events',
    description: 'Returns public holidays or notable events for the specified date and country (iso2).',
    inputSchema: {
      iso2: z.string().length(2).optional(),
      timezone: z.string().min(1),
      date: z.string().optional(),
    },
  },
  async (argsInput) => {
    const parsed = calendarSchema.parse(argsInput ?? {});
    const targetDay = resolveTargetDate(parsed.date, parsed.timezone);

    let holidays: Holidays | null = null;
    if (parsed.iso2) {
      try {
        holidays = new Holidays(parsed.iso2.toUpperCase());
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('[MCP] get_calendar_events failed to initialize Holidays', {
          iso2: parsed.iso2,
          error,
        });
      }
    }

    const entries = holidays?.getHolidays(targetDay.toISODate() ?? '') ?? [];

    const payload = {
      timezone: parsed.timezone,
      date: targetDay.toISODate(),
      events: entries.map((entry) => ({
        name: entry.name,
        type: entry.type,
        note: 'note' in entry ? (entry as { note?: string }).note ?? null : null,
        date: entry.date ?? null,
      })),
    };

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
    if (isDebugEnabled()) {
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
    }
    await transport.handleRequest(req, res, req.body);
  };
};
