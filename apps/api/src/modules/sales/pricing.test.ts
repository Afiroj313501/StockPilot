import { describe, expect, it } from 'vitest';
import { allocate, computePricing, type DiscountInput } from './pricing';

const NO_TAX = { rateHundredths: 0n, inclusive: false };
const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

describe('computePricing', () => {
  it('sums lines with no discount or tax', () => {
    const r = computePricing(
      [
        { unitPriceCents: 150n, quantity: 2 },
        { unitPriceCents: 225n, quantity: 3 },
      ],
      null,
      NO_TAX,
    );
    expect(r.subtotal).toBe(975n);
    expect(r.total).toBe(975n);
    expect(r.lines.map((l) => l.lineTotal)).toEqual([300n, 675n]);
  });

  it('adds exclusive tax once on the whole sale, rounding half up', () => {
    // 7.50% of 9.75 = 0.73125 -> 0.73
    const r = computePricing([{ unitPriceCents: 975n, quantity: 1 }], null, {
      rateHundredths: 750n,
      inclusive: false,
    });
    expect(r.taxTotal).toBe(73n);
    expect(r.total).toBe(1048n);
  });

  it('treats inclusive tax as part of the price', () => {
    // 11.00 at 10% inclusive: tax = 11.00 x 10 / 110 = 1.00
    const r = computePricing([{ unitPriceCents: 1100n, quantity: 1 }], null, {
      rateHundredths: 1000n,
      inclusive: true,
    });
    expect(r.taxTotal).toBe(100n);
    expect(r.total).toBe(1100n);
  });

  it('applies percent and amount discounts before tax', () => {
    const line = [{ unitPriceCents: 1000n, quantity: 1 }];
    const tax = { rateHundredths: 1000n, inclusive: false };

    const percent = computePricing(line, { type: 'PERCENT', hundredths: 1500n }, tax);
    expect(percent.discountTotal).toBe(150n); // 15% of 10.00
    expect(percent.taxTotal).toBe(85n); // 10% of 8.50
    expect(percent.total).toBe(935n);

    const amount = computePricing(line, { type: 'AMOUNT', cents: 200n }, tax);
    expect(amount.discountTotal).toBe(200n);
    expect(amount.total).toBe(880n); // 8.00 + 0.80
  });

  it('rounds a percent discount half up', () => {
    // 10% of 10.05 = 1.005 -> 1.01
    const r = computePricing(
      [{ unitPriceCents: 1005n, quantity: 1 }],
      { type: 'PERCENT', hundredths: 1000n },
      NO_TAX,
    );
    expect(r.discountTotal).toBe(101n);
  });

  it('rejects a discount larger than the subtotal', () => {
    expect(() =>
      computePricing([{ unitPriceCents: 1000n, quantity: 1 }], { type: 'AMOUNT', cents: 1001n }, NO_TAX),
    ).toThrow();
  });

  it('allocates cents by largest remainder', () => {
    expect(allocate(100n, [333n, 333n, 334n])).toEqual([33n, 33n, 34n]);
    expect(allocate(1n, [1n, 1n, 1n])).toEqual([1n, 0n, 0n]);
    expect(allocate(0n, [5n, 5n])).toEqual([0n, 0n]);
  });

  it('keeps line shares equal to the sale totals', () => {
    const lines = [
      { unitPriceCents: 333n, quantity: 3 },
      { unitPriceCents: 199n, quantity: 1 },
      { unitPriceCents: 1n, quantity: 7 },
    ];
    const discounts: (DiscountInput | null)[] = [
      null,
      { type: 'PERCENT', hundredths: 1234n },
      { type: 'AMOUNT', cents: 150n },
    ];
    for (const inclusive of [false, true]) {
      for (const discount of discounts) {
        const r = computePricing(lines, discount, { rateHundredths: 825n, inclusive });
        expect(sum(r.lines.map((l) => l.lineSubtotal))).toBe(r.subtotal);
        expect(sum(r.lines.map((l) => l.discountShare))).toBe(r.discountTotal);
        expect(sum(r.lines.map((l) => l.taxShare))).toBe(r.taxTotal);
        expect(sum(r.lines.map((l) => l.lineTotal))).toBe(r.total);
        expect(r.lines.every((l) => l.lineTotal >= 0n)).toBe(true);
      }
    }
  });

  it('handles a zero-priced sale', () => {
    const r = computePricing([{ unitPriceCents: 0n, quantity: 3 }], null, {
      rateHundredths: 1000n,
      inclusive: false,
    });
    expect(r).toMatchObject({ subtotal: 0n, discountTotal: 0n, taxTotal: 0n, total: 0n });
    expect(r.lines[0]).toEqual({ lineSubtotal: 0n, discountShare: 0n, taxShare: 0n, lineTotal: 0n });
  });
});