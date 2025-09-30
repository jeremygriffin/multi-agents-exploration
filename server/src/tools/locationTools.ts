import cityTimezones from 'city-timezones';

interface ResolveLocationArgs {
  query: string;
}

interface LocationMatch {
  city: string;
  province?: string;
  country: string;
  iso2?: string;
  iso3?: string;
  timezone: string;
  confidence: number;
}

const normalizeQuery = (query: string): string => query.trim();

const buildMatches = (query: string): LocationMatch[] => {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return [];
  }

  const direct = cityTimezones.findFromCityStateProvince(normalized);
  const cityLookup = cityTimezones.lookupViaCity(normalized);

  const seen = new Map<string, LocationMatch>();

  for (const match of [...(direct ?? []), ...(cityLookup ?? [])]) {
    const key = `${match.city}|${match.province}|${match.country}|${match.timezone}`;
    if (seen.has(key)) {
      continue;
    }

    seen.set(key, {
      city: match.city,
      province: match.province,
      country: match.country,
      iso2: match.iso2,
      iso3: match.iso3,
      timezone: match.timezone,
      confidence: match.city_ascii?.toLowerCase() === normalized.toLowerCase() ? 0.9 : 0.6,
    });
  }

  return [...seen.values()].sort((a, b) => b.confidence - a.confidence);
};

export const resolve_location_definition = {
  type: 'function',
  function: {
    name: 'resolve_location',
    description: 'Resolve a user provided location string (city, state, country) to potential IANA time zones.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Raw user text describing the location whose current time is requested.',
        },
      },
      required: ['query'],
    },
  },
};

export const resolve_location = async ({ query }: ResolveLocationArgs): Promise<string> => {
  const matches = buildMatches(query);

  return JSON.stringify({
    query,
    matches,
    matchCount: matches.length,
  });
};
