import { describe, expect, it } from 'vitest';
import { resolvePeriod } from './Period';

const today = '2026-11-05';

describe('resolvePeriod', () => {
  it('defaults to the last 30 days through today', () => {
    expect(resolvePeriod('How are sales doing?', today)).toEqual({
      from: '2026-10-07',
      to: today,
      label: 'the last 30 days',
      explicit: false,
    });
  });

  it('resolves explicit day ranges and clamps their size', () => {
    expect(resolvePeriod('sales in the past 7 days', today)).toEqual({
      from: '2026-10-30',
      to: today,
      label: 'the last 7 day(s)',
      explicit: true,
    });
    expect(resolvePeriod('last 0 days', today).from).toBe(today);
    expect(resolvePeriod('last 999 days', today).from).toBe('2025-11-06');
  });

  it('resolves relative calendar periods', () => {
    expect(resolvePeriod('sales yesterday', today)).toEqual({
      from: '2026-11-04',
      to: '2026-11-04',
      label: 'yesterday',
      explicit: true,
    });
    expect(resolvePeriod('sales this week', today)).toEqual({
      from: '2026-11-02',
      to: today,
      label: 'this week',
      explicit: true,
    });
    expect(resolvePeriod('sales last week', today)).toEqual({
      from: '2026-10-26',
      to: '2026-11-01',
      label: 'last week',
      explicit: true,
    });
  });

  it('resolves month and today phrases', () => {
    expect(resolvePeriod('sales last month', today)).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      label: 'last month',
      explicit: true,
    });
    expect(resolvePeriod('sales this month', today)).toEqual({
      from: '2026-11-01',
      to: today,
      label: 'this month',
      explicit: true,
    });
    expect(resolvePeriod('sales today', today)).toEqual({
      from: today,
      to: today,
      label: 'today',
      explicit: true,
    });
  });
});
