import { describe, expect, it, beforeEach } from 'vitest';

import { TimeHelperAgent } from '../timeHelperAgent';

const buildMatch = () => ({
  city: 'Columbus',
  province: 'Ohio',
  country: 'United States of America',
  iso2: 'US',
  timezone: 'America/New_York',
  confidence: 0.9,
  latitude: 39.9612,
  longitude: -82.9988,
});

describe('TimeHelperAgent formatting helpers', () => {
  beforeEach(() => {
    process.env.TIME_HELPER_LOCATION_PROVIDER = 'mcp';
    process.env.OPENAI_API_KEY = 'test-key';
  });

  it('summarises sunrise and sunset times', () => {
    const agent = new TimeHelperAgent();
    const helper = agent as unknown as {
      formatSunTimesSummary: (match: ReturnType<typeof buildMatch>, payload: unknown) => string;
    };

    const summary = helper.formatSunTimesSummary(buildMatch(), {
      timezone: 'America/New_York',
      date: '2025-10-01',
      sunrise: '2025-10-01T11:23:00.000Z',
      sunset: '2025-10-01T23:45:00.000Z',
      solarNoon: '2025-10-01T17:34:00.000Z',
      daylightDurationMinutes: 742,
    });

    expect(summary).toContain('sunrise is at');
    expect(summary).toContain('sunset is at');
    expect(summary).toContain('Daylight lasts roughly');
  });

  it('handles polar day moon reports', () => {
    const agent = new TimeHelperAgent();
    const helper = agent as unknown as {
      formatMoonTimesSummary: (match: ReturnType<typeof buildMatch>, payload: unknown) => string;
    };

    const summary = helper.formatMoonTimesSummary(buildMatch(), {
      timezone: 'America/New_York',
      date: '2025-10-01',
      rise: null,
      set: null,
      alwaysUp: true,
      alwaysDown: false,
    });

    expect(summary).toContain('stays above the horizon');
  });

  it('requests clarification when multiple matches are found for sun times', () => {
    const agent = new TimeHelperAgent();
    const helper = agent as unknown as {
      formatMultipleMatchResponse: (matches: ReturnType<typeof buildMatch>[], intent: string) => string;
    };

    const message = helper.formatMultipleMatchResponse(
      [buildMatch(), { ...buildMatch(), city: 'Columbus', province: 'Georgia' }],
      'sun_times'
    );

    expect(message).toContain('Could you clarify');
    expect(message).toContain('sunrise and sunset');
  });

  it('explains when calendar location is missing', () => {
    const agent = new TimeHelperAgent();
    const helper = agent as unknown as {
      formatNoMatchResponse: (intent: string) => string;
    };

    const message = helper.formatNoMatchResponse('calendar');
    expect(message).toContain('calendar');
  });
});
