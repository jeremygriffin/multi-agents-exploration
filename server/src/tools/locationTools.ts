const { buildLocationMatches } = require('../location/locationMatcher') as {
  buildLocationMatches: (query: string) => {
    city: string;
    province?: string;
    country: string;
    iso2?: string;
    iso3?: string;
    timezone: string;
    confidence: number;
  }[];
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
  const matches = buildLocationMatches(query);

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
