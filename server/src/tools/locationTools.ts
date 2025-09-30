// eslint-disable-next-line @typescript-eslint/no-var-requires
const cityTimezones = require('city-timezones') as {
  findFromCityStateProvince: (query: string) => CityTimezoneRecord[];
  lookupViaCity: (query: string) => CityTimezoneRecord[];
};

interface CityTimezoneRecord {
  city: string;
  city_ascii?: string;
  province?: string;
  country: string;
  iso2?: string;
  iso3?: string;
  timezone: string;
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

  const direct = cityTimezones.findFromCityStateProvince(normalized) ?? [];
  const cityLookup = cityTimezones.lookupViaCity(normalized) ?? [];

  const seen = new Map<string, LocationMatch>();

  for (const match of [...direct, ...cityLookup]) {
    const key = `${match.city}|${match.province}|${match.country}|${match.timezone}`;
    if (seen.has(key)) {
      continue;
    }

    const cityAscii = match.city_ascii ?? match.city;

    const entry: LocationMatch = {
      city: match.city,
      country: match.country,
      timezone: match.timezone,
      confidence:
        cityAscii.toLowerCase() === normalized.toLowerCase() ? 0.9 : 0.6,
    };

    if (match.province) {
      entry.province = match.province;
    }

    if (match.iso2) {
      entry.iso2 = match.iso2;
    }

    if (match.iso3) {
      entry.iso3 = match.iso3;
    }

    seen.set(key, entry);
  }

  return Array.from(seen.values()).sort((a, b) => b.confidence - a.confidence);
};

interface ResolveLocationArgs {
  query: string;
}

const resolve_location_definition = {
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

const resolve_location = async ({ query }: ResolveLocationArgs): Promise<string> => {
  const matches = buildMatches(query);

  return JSON.stringify({
    query,
    matches,
    matchCount: matches.length,
  });
};

module.exports = {
  resolve_location_definition,
  resolve_location,
};
