import { describe, expect, it } from 'vitest';
import {
  addDays,
  bucketKeys,
  bucketStart,
  daysBetween,
  isValidDate,
  localToday,
  rangeToUtc,
  startOfLocalDay,
} from './dateRange';

describe('startOfLocalDay', () => {
  it('converts a local midnight to UTC', () => {
    expect(startOfLocalDay('2026-11-01', 'Asia/Dhaka').toISOString()).toBe('2026-10-31T18:00:00.000Z');
    expect(startOfLocalDay('2026-11-01', 'UTC').toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('follows daylight saving changes', () => {
    // US clocks go forward on 2026-03-08 and back on 2026-11-01.
    expect(startOfLocalDay('2026-03-08', 'America/New_York').toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(startOfLocalDay('2026-03-09', 'America/New_York').toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect(startOfLocalDay('2026-11-01', 'America/New_York').toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(startOfLocalDay('2026-11-02', 'America/New_York').toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });
});

describe('rangeToUtc', () => {
  it('covers whole local days, end exclusive', () => {
    const { start, end } = rangeToUtc('2026-11-01', '2026-11-03', 'Asia/Dhaka');
    expect(start.toISOString()).toBe('2026-10-31T18:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-03T18:00:00.000Z');
  });

  it('makes the daylight-saving day 23 hours long', () => {
    const { start, end } = rangeToUtc('2026-03-08', '2026-03-08', 'America/New_York');
    expect(end.getTime() - start.getTime()).toBe(23 * 3_600_000);
  });
});

describe('buckets', () => {
  it('starts weeks on Monday and months on the 1st', () => {
    expect(bucketStart('2026-11-01', 'week')).toBe('2026-10-26'); // a Sunday
    expect(bucketStart('2026-11-02', 'week')).toBe('2026-11-02'); // a Monday
    expect(bucketStart('2026-11-04', 'week')).toBe('2026-11-02');
    expect(bucketStart('2026-11-17', 'month')).toBe('2026-11-01');
    expect(bucketStart('2026-11-17', 'day')).toBe('2026-11-17');
  });

  it('lists every bucket in a range once', () => {
    expect(bucketKeys('2026-10-30', '2026-11-02', 'day')).toHaveLength(4);
    expect(bucketKeys('2026-10-30', '2026-11-02', 'month')).toEqual(['2026-10-01', '2026-11-01']);
    expect(bucketKeys('2026-11-01', '2026-11-03', 'week')).toEqual(['2026-10-26', '2026-11-02']);
  });
});

describe('date helpers', () => {
  it('validates real calendar dates only', () => {
    expect(isValidDate('2026-11-01')).toBe(true);
    expect(isValidDate('2026-02-31')).toBe(false);
    expect(isValidDate('2026-2-1')).toBe(false);
    expect(isValidDate('nope')).toBe(false);
  });

  it('does calendar arithmetic and tells the local date per time zone', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-01', '2026-11-01')).toBe(31);

    const instant = new Date('2026-11-01T12:00:00Z');
    expect(localToday('Pacific/Kiritimati', instant)).toBe('2026-11-02'); // UTC+14
    expect(localToday('Etc/GMT+12', instant)).toBe('2026-11-01'); // UTC-12
  });
});