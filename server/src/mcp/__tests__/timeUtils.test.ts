import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';

import { resolveTargetDate, toIsoInZone } from '../timeUtils';

describe('timeUtils', () => {
  const zone = 'America/New_York';

  it('keeps provided ISO dates anchored to the requested zone', () => {
    const target = resolveTargetDate('2025-10-01', zone);
    expect(target.toISODate()).toBe('2025-10-01');
    expect(target.zoneName).toBe(zone);
  });

  it('falls back to the current day when no date is provided', () => {
    vi.useFakeTimers();
    const now = DateTime.fromISO('2025-10-01T15:00:00', { zone });
    vi.setSystemTime(now.toJSDate());

    const target = resolveTargetDate(undefined, zone);
    expect(target.toISODate()).toBe('2025-10-01');
    expect(target.hour).toBe(0);

    vi.useRealTimers();
  });

  it('converts Date objects to ISO strings in the provided zone', () => {
    const date = new Date('2025-10-01T12:00:00Z');
    const iso = toIsoInZone(date, zone);
    expect(iso).toBe('2025-10-01T08:00:00.000-04:00');
  });

  it('returns null for invalid dates', () => {
    const invalid = new Date('invalid');
    expect(toIsoInZone(invalid, zone)).toBeNull();
  });
});
