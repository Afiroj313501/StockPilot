import type { Prisma } from '@prisma/client';

const ROUND_HALF_UP = 4; // decimal.js rounding mode "round half up"

// Moving weighted-average cost.
//   onHand        units in stock before the receipt
//   currentAverage the average cost before the receipt (use the product's costPrice if none yet)
//   received      units received now
//   unitCost      cost per unit on this receipt
// With no positive stock on hand, there is nothing to weight, so the receipt cost becomes the average.
export function nextAverageCost(
  onHand: number,
  currentAverage: Prisma.Decimal,
  received: number,
  unitCost: Prisma.Decimal,
): Prisma.Decimal {
  if (onHand <= 0) return unitCost.toDecimalPlaces(4, ROUND_HALF_UP);
  const total = currentAverage.times(onHand).plus(unitCost.times(received));
  return total.dividedBy(onHand + received).toDecimalPlaces(4, ROUND_HALF_UP);
}
