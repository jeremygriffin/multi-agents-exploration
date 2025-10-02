import { DateTime } from 'luxon';

export const toIsoInZone = (date: Date | undefined | null, zone: string): string | null => {
  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }

  return DateTime.fromJSDate(date).setZone(zone, { keepLocalTime: false }).toISO();
};

export const resolveTargetDate = (input: unknown, zone: string): DateTime => {
  if (typeof input === 'string' && input.trim().length > 0) {
    const parsed = DateTime.fromISO(input.trim(), { zone });
    if (parsed.isValid) {
      return parsed.startOf('day');
    }
  }

  return DateTime.now().setZone(zone).startOf('day');
};
