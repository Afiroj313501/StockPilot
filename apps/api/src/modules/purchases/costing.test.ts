import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { nextAverageCost } from './costing';

const D = (v: string) => new Prisma.Decimal(v);

describe('nextAverageCost (moving weighted average)', () => {
  it('weights existing stock and the receipt by quantity', () => {
    // (10 x 1.00 + 10 x 3.00) / 20
    expect(nextAverageCost(10, D('1'), 10, D('3.00')).toFixed(4)).toBe('2.0000');
  });

  it('keeps the average when the receipt costs the same', () => {
    expect(nextAverageCost(7, D('2.5000'), 3, D('2.50')).toFixed(4)).toBe('2.5000');
  });

  it('uses the receipt cost when there is no positive stock on hand', () => {
    expect(nextAverageCost(0, D('5'), 4, D('2.50')).toFixed(4)).toBe('2.5000');
    expect(nextAverageCost(-3, D('5'), 4, D('2.50')).toFixed(4)).toBe('2.5000');
  });

  it('rounds half up to 4 decimal places', () => {
    // (3 x 1.0000 + 4 x 1.33) / 7 = 1.188571...
    expect(nextAverageCost(3, D('1.0000'), 4, D('1.33')).toFixed(4)).toBe('1.1886');
    // (1 x 0.0001 + 1 x 0.00) / 2 = 0.00005 exactly
    expect(nextAverageCost(1, D('0.0001'), 1, D('0.00')).toFixed(4)).toBe('0.0001');
  });
});