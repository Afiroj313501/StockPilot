import { AppError } from '../../utils/httpError';

// All amounts are integer cents (bigint). Percentages are in hundredths of a percent
// (7.50% = 750). Rounding is always half up.

export type DiscountInput =
  { type: 'PERCENT'; hundredths: bigint } | { type: 'AMOUNT'; cents: bigint };

export interface PricingLine {
  unitPriceCents: bigint;
  quantity: number;
}

export interface TaxInput {
  rateHundredths: bigint;
  inclusive: boolean;
}

export interface PricedLine {
  lineSubtotal: bigint;
  discountShare: bigint;
  taxShare: bigint;
  lineTotal: bigint;
}

export interface PricingResult {
  lines: PricedLine[];
  subtotal: bigint;
  discountTotal: bigint;
  taxTotal: bigint;
  total: bigint;
}

// numerator / denominator, rounded half up. Both must be non-negative; denominator > 0.
export function divRound(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

// Splits `total` cents across `weights` so the parts add up exactly
// (largest remainder method; ties go to the earlier line).
export function allocate(total: bigint, weights: bigint[]): bigint[] {
  if (total === 0n) return weights.map(() => 0n);
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (sum === 0n) throw new Error('Cannot allocate an amount across zero weights');

  const parts = weights.map((w) => (total * w) / sum);
  const leftover = Number(total - parts.reduce((a, b) => a + b, 0n));
  const order = weights
    .map((w, index) => ({ index, remainder: (total * w) % sum }))
    .sort((a, b) =>
      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
    );
  for (let k = 0; k < leftover; k++) {
    const idx = order[k]!.index;
    parts[idx] = (parts[idx] ?? 0n) + 1n;
  }
  return parts;
}

export function computePricing(
  lines: PricingLine[],
  discount: DiscountInput | null,
  tax: TaxInput,
): PricingResult {
  const lineSubtotals = lines.map((l) => l.unitPriceCents * BigInt(l.quantity));
  const subtotal = lineSubtotals.reduce((a, b) => a + b, 0n);

  // 1. Discount comes off the subtotal, before tax.
  let discountTotal = 0n;
  if (discount?.type === 'PERCENT')
    discountTotal = divRound(subtotal * discount.hundredths, 10_000n);
  if (discount?.type === 'AMOUNT') discountTotal = discount.cents;
  if (discountTotal > subtotal) {
    throw new AppError(
      400,
      'DISCOUNT_TOO_LARGE',
      'The discount cannot be more than the sale subtotal',
    );
  }
  const netBase = subtotal - discountTotal;

  // 2. Tax is calculated once for the whole sale.
  //    Exclusive: added on top. Inclusive: already inside the prices.
  const taxTotal = tax.inclusive
    ? divRound(netBase * tax.rateHundredths, 10_000n + tax.rateHundredths)
    : divRound(netBase * tax.rateHundredths, 10_000n);
  const total = tax.inclusive ? netBase : netBase + taxTotal;

  // 3. Spread discount and tax over the lines so each line total is exact.
  const discountShares = allocate(discountTotal, lineSubtotals);
  const nets = lineSubtotals.map((s, i) => s - discountShares[i]!);
  const taxShares = allocate(taxTotal, nets);

  return {
    subtotal,
    discountTotal,
    taxTotal,
    total,
    lines: lineSubtotals.map((s, i) => ({
      lineSubtotal: s,
      discountShare: discountShares[i]!,
      taxShare: taxShares[i]!,
      lineTotal: nets[i]! + (tax.inclusive ? 0n : taxShares[i]!),
    })),
  };
}
