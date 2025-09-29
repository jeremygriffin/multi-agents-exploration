import { DateTime } from 'luxon';

import type { Agent, AgentContext, AgentResult } from './baseAgent';

interface CityTimeZone {
  keywords: string[];
  zone: string;
  label: string;
}

const CITY_TIMEZONES: CityTimeZone[] = [
  { keywords: ['new york', 'nyc', 'eastern'], zone: 'America/New_York', label: 'New York (ET)' },
  { keywords: ['los angeles', 'la', 'pacific', 'san francisco'], zone: 'America/Los_Angeles', label: 'Los Angeles (PT)' },
  { keywords: ['chicago', 'ct', 'central'], zone: 'America/Chicago', label: 'Chicago (CT)' },
  { keywords: ['denver', 'mt', 'mountain'], zone: 'America/Denver', label: 'Denver (MT)' },
  { keywords: ['london', 'uk', 'britain'], zone: 'Europe/London', label: 'London (UK)' },
  { keywords: ['berlin', 'germany'], zone: 'Europe/Berlin', label: 'Berlin (CET)' },
  { keywords: ['tokyo', 'japan'], zone: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { keywords: ['sydney', 'australia'], zone: 'Australia/Sydney', label: 'Sydney (AET)' },
  { keywords: ['singapore'], zone: 'Asia/Singapore', label: 'Singapore (SGT)' },
  { keywords: ['dubai', 'uae'], zone: 'Asia/Dubai', label: 'Dubai (GST)' },
];

const findCities = (message: string): CityTimeZone[] => {
  const lower = message.toLowerCase();
  const matches = CITY_TIMEZONES.filter((entry) =>
    entry.keywords.some((keyword) => lower.includes(keyword))
  );

  return matches;
};

const formatTime = (zone: string): { time: string; offset: string } => {
  const now = DateTime.now().setZone(zone);
  return {
    time: now.toFormat('cccc, dd LLL yyyy HH:mm'),
    offset: now.toFormat('ZZZZ'),
  };
};

export class TimeHelperAgent implements Agent {
  readonly id = 'time_helper';

  readonly name = 'Time Helper Agent';

  async handle(context: AgentContext): Promise<AgentResult> {
    const cities = findCities(context.userMessage);

    if (cities.length === 0) {
      return {
        content:
          'I could not spot a city or timezone in your request. Try asking "What time is it in Tokyo?" or "Compare London and New York."',
      };
    }

    const primary = cities[0]!;
    const rest = cities.slice(1);

    const lines = cities.map((city) => {
      const { time, offset } = formatTime(city.zone);
      return `• ${city.label}: ${time} (${offset})`;
    });

    const intro = rest.length > 0
      ? 'Here are the current local times for the locations you mentioned:'
      : `Current local time for ${primary.label}:`;

    return {
      content: `${intro}\n${lines.join('\n')}`,
      debug: {
        matchedCities: cities.map((city) => city.label),
        rawInput: context.userMessage,
      },
    };
  }
}
