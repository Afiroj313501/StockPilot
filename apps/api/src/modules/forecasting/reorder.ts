export type Confidence = 'INSUFFICIENT' | 'LOW' | 'MEDIUM' | 'HIGH';
export type Urgency = 'CRITICAL' | 'HIGH' | 'NONE';
export type PlanStatus = 'REORDER' | 'OK' | 'INSUFFICIENT_DATA';

export const MIN_DAYS = 7;
export const MIN_TRANSACTIONS = 3;

export interface PlanInputs {
  currentStock: number; // sellable units on hand (may be negative if the store allows it)
  incomingStock: number; // remaining units on approved or partly received orders
  eligibleUnits: number; // units sold in the window minus units returned, never below 0
  transactions: number; // number of sales in the window that contained the product
  observedDays: number; // days of history actually available (at least 1)
  leadTimeDays: number;
  safetyDays: number;
  coverageDays: number;
  lowStockThreshold: number;
}

export interface Plan {
  status: PlanStatus;
  confidence: Confidence;
  urgency: Urgency;
  lowStock: boolean;
  averageDailyDemand: string;
  leadTimeDemand: number;
  safetyStock: number;
  coverageStock: number;
  reorderPoint: number;
  orderUpToLevel: number;
  position: number;
  daysOfCover: string | null;
  recommendedQuantity: number | null; // null when there is too little history to forecast
  steps: string[]; // the calculation in words, with the real numbers
}

export function confidenceOf(observedDays: number, transactions: number): Confidence {
  if (observedDays < MIN_DAYS || transactions < MIN_TRANSACTIONS) return 'INSUFFICIENT';
  if (observedDays < 14 || transactions < 10) return 'LOW';
  if (observedDays < 28) return 'MEDIUM';
  return 'HIGH';
}

// All inputs are whole numbers, so every quotient below is either exact or at least 1/180 away
// from a whole number: rounding up is safe and the result is identical on every run.
const ceilDiv = (a: number, b: number) => Math.ceil(a / b);
const fixed = (n: number, d: number, dp = 2) =>
  (Math.round((n / d) * 10 ** dp) / 10 ** dp).toFixed(dp);

export function buildPlan(i: PlanInputs): Plan {
  const stock = i.currentStock;
  const u = i.eligibleUnits;
  const d = i.observedDays;
  const position = stock + i.incomingStock;
  const lowStock = stock <= i.lowStockThreshold;
  const confidence = confidenceOf(d, i.transactions);

  const leadTimeDemand = ceilDiv(u * i.leadTimeDays, d);
  const safetyStock = ceilDiv(u * i.safetyDays, d);
  const coverageStock = ceilDiv(u * i.coverageDays, d);
  const reorderPoint = leadTimeDemand + safetyStock;
  const orderUpToLevel = reorderPoint + coverageStock;
  const averageDailyDemand = fixed(u, d);
  const daysOfCover = u > 0 ? (stock <= 0 ? '0.0' : fixed(stock * d, u, 1)) : null;

  const steps: string[] = [
    `Observed ${d} day(s): ${u} eligible unit(s) sold (sales minus returns) across ${i.transactions} sale(s).`,
  ];

  if (confidence === 'INSUFFICIENT') {
    steps.push(
      `There is not enough history to forecast (at least ${MIN_DAYS} days and ${MIN_TRANSACTIONS} sales are needed), so no quantity is recommended.`,
    );
    if (lowStock) {
      steps.push(
        `Stock (${stock}) is at or below the low-stock threshold (${i.lowStockThreshold}): review this product by hand.`,
      );
    }
    return {
      status: 'INSUFFICIENT_DATA',
      confidence,
      urgency: 'NONE',
      lowStock,
      averageDailyDemand,
      leadTimeDemand,
      safetyStock,
      coverageStock,
      reorderPoint,
      orderUpToLevel,
      position,
      daysOfCover,
      recommendedQuantity: null,
      steps,
    };
  }

  const needsReorder = u > 0 && position <= reorderPoint;
  const quantity = needsReorder ? Math.max(0, orderUpToLevel - position) : 0;
  const critical = quantity > 0 && (stock <= 0 || stock * d < u * i.leadTimeDays);

  steps.push(
    `Average daily demand = ${u} / ${d} = ${averageDailyDemand} unit(s) per day.`,
    `Lead-time demand = ${averageDailyDemand} x ${i.leadTimeDays} day(s) = ${fixed(u * i.leadTimeDays, d)} -> ${leadTimeDemand} (rounded up).`,
    `Safety stock = ${averageDailyDemand} x ${i.safetyDays} day(s) = ${fixed(u * i.safetyDays, d)} -> ${safetyStock} (rounded up).`,
    `Reorder point = ${leadTimeDemand} + ${safetyStock} = ${reorderPoint}.`,
    `Coverage after delivery = ${averageDailyDemand} x ${i.coverageDays} day(s) = ${fixed(u * i.coverageDays, d)} -> ${coverageStock} (rounded up). Order-up-to level = ${reorderPoint} + ${coverageStock} = ${orderUpToLevel}.`,
    `Stock position = ${stock} in stock + ${i.incomingStock} incoming = ${position}.`,
  );
  if (u === 0) {
    steps.push('Nothing was sold in this window, so no reorder is suggested.');
  } else if (position > reorderPoint) {
    steps.push(
      `${position} is above the reorder point (${reorderPoint}), so no order is needed yet.`,
    );
  } else if (quantity === 0) {
    steps.push(
      `${position} is at the reorder point, but the order-up-to level equals it, so no units are needed.`,
    );
  } else {
    steps.push(
      `${position} is at or below the reorder point (${reorderPoint}), so order ${orderUpToLevel} - ${position} = ${quantity} unit(s).`,
    );
  }

  return {
    status: quantity > 0 ? 'REORDER' : 'OK',
    confidence,
    urgency: quantity > 0 ? (critical ? 'CRITICAL' : 'HIGH') : 'NONE',
    lowStock,
    averageDailyDemand,
    leadTimeDemand,
    safetyStock,
    coverageStock,
    reorderPoint,
    orderUpToLevel,
    position,
    daysOfCover,
    recommendedQuantity: quantity,
    steps,
  };
}
