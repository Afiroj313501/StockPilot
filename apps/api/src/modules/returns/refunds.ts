import { divRound } from '../sales/pricing';

// Amounts are integer cents (bigint).
// Returning units of a sale line is counted cumulatively: after k of `quantity` units are
// back, the customer has been refunded round(amount x k / quantity) in total. Each return
// refunds the difference to what earlier returns already paid, so every way of splitting
// the returns adds up to exactly `amount` once all units are back.
export function cumulativeShare(amount: bigint, k: number, quantity: number): bigint {
  return divRound(amount * BigInt(k), BigInt(quantity));
}

export function refundForReturn(
  amount: bigint,
  alreadyReturned: number,
  returningNow: number,
  quantity: number,
): bigint {
  return (
    cumulativeShare(amount, alreadyReturned + returningNow, quantity) -
    cumulativeShare(amount, alreadyReturned, quantity)
  );
}