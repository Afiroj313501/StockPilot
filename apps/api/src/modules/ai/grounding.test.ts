import { describe, expect, it } from 'vitest';
import { numbersIn, ungroundedNumbers } from './grounding';

describe('grounding', () => {
  it('reads numbers with thousands separators and decimals', () => {
    expect(numbersIn('Sales were 1,234.50 in 12 days, up 3.5%.')).toEqual([1234.5, 12, 3.5]);
  });

  it('accepts numbers from the data in any formatting', () => {
    const sources = ['{"netSales":"1234.50","salesCount":12}'];
    expect(ungroundedNumbers('Net sales were 1,234.5 across 12 sales.', sources, 'sales?')).toEqual([]);
  });

  it('rejects numbers the data does not contain', () => {
    const sources = ['{"netSales":"35.00","salesCount":2}'];
    expect(ungroundedNumbers('Net sales were 99.99.', sources, 'sales?')).toEqual([99.99]);
    expect(ungroundedNumbers('Net sales were 35.00, up 12%.', sources, 'sales?')).toEqual([12]);
  });

  it('allows small counts and numbers from the question, but ignores digits inside identifiers', () => {
    expect(ungroundedNumbers('Top 3 products in the last 30 days', ['{}'], 'best sellers in the last 30 days')).toEqual([]);

    const sources = ['{"id":"00000000-0000-4000-8000-000000000000","period":{"from":"2026-11-01"}}'];
    expect(ungroundedNumbers('Since 2026-11-01 there were 4000 units', sources, 'units?')).toEqual([4000]);
  });
});