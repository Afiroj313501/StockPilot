import { describe, expect, it } from 'vitest';
import { cumulativeShare, refundForReturn } from './refunds';

describe('refund proration', () => {
  it('computes cumulative shares with half-up rounding', () => {
    expect(cumulativeShare(1099n, 1, 3)).toBe(366n); // 366.33
    expect(cumulativeShare(1099n, 2, 3)).toBe(733n); // 732.67
    expect(cumulativeShare(1099n, 3, 3)).toBe(1099n);
    expect(cumulativeShare(1n, 1, 2)).toBe(1n); // 0.5 rounds up
    expect(cumulativeShare(990n, 0, 2)).toBe(0n);
    expect(cumulativeShare(0n, 1, 3)).toBe(0n);
  });

  it('refunds the difference to what was already refunded', () => {
    expect(refundForReturn(1099n, 0, 1, 3)).toBe(366n);
    expect(refundForReturn(1099n, 1, 1, 3)).toBe(367n);
    expect(refundForReturn(1099n, 2, 1, 3)).toBe(366n);
  });

  it('adds up to the line total however the returns are split', () => {
    for (const amount of [1n, 7n, 100n, 1099n, 99_999n]) {
      for (let quantity = 1; quantity <= 9; quantity++) {
        // one unit at a time
        let sum = 0n;
        for (let done = 0; done < quantity; done++)
          sum += refundForReturn(amount, done, 1, quantity);
        expect(sum).toBe(amount);

        // every two-step split
        for (let first = 1; first < quantity; first++) {
          const total =
            refundForReturn(amount, 0, first, quantity) +
            refundForReturn(amount, first, quantity - first, quantity);
          expect(total).toBe(amount);
        }
      }
    }
  });
});
