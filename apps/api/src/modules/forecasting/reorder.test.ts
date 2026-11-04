import { describe, expect, it } from 'vitest';
import { buildPlan, confidenceOf, type PlanInputs } from './reorder';

const base: PlanInputs = {
  currentStock: 14,
  incomingStock: 0,
  eligibleUnits: 42,
  transactions: 12,
  observedDays: 30,
  leadTimeDays: 7,
  safetyDays: 3,
  coverageDays: 14,
  lowStockThreshold: 5,
};

describe('buildPlan', () => {
  it('calculates every step with exact rounding up', () => {
    const p = buildPlan(base);
    expect(p).toMatchObject({
      status: 'REORDER',
      confidence: 'MEDIUM' === confidenceOf(30, 12) ? 'MEDIUM' : 'HIGH',
      averageDailyDemand: '1.40',
      leadTimeDemand: 10, // 9.8
      safetyStock: 5, // 4.2
      coverageStock: 20, // 19.6
      reorderPoint: 15,
      orderUpToLevel: 35,
      position: 14,
      daysOfCover: '10.0',
      recommendedQuantity: 21, // 35 - 14
      urgency: 'HIGH',
    });
    expect(p.steps.join(' ')).toContain('order 35 - 14 = 21');
  });

  it('marks it critical when stock runs out before a new order could arrive, and not above the reorder point', () => {
    const critical = buildPlan({ ...base, currentStock: 8 }); // 8 units last 5.7 days, lead time 7
    expect(critical).toMatchObject({ status: 'REORDER', urgency: 'CRITICAL', recommendedQuantity: 27 });

    const fine = buildPlan({ ...base, currentStock: 20 });
    expect(fine).toMatchObject({ status: 'OK', urgency: 'NONE', recommendedQuantity: 0 });

    // Approved incoming stock counts towards the position.
    const covered = buildPlan({ ...base, currentStock: 8, incomingStock: 10 });
    expect(covered).toMatchObject({ status: 'OK', position: 18, recommendedQuantity: 0 });
  });

  it('gives identical results for identical inputs', () => {
    expect(buildPlan(base)).toEqual(buildPlan({ ...base }));
    expect(buildPlan(base).steps).toEqual(buildPlan({ ...base }).steps);
  });

  it('refuses to forecast with too little history, but still flags low stock', () => {
    const young = buildPlan({ ...base, observedDays: 5, transactions: 10, currentStock: 2 });
    expect(young).toMatchObject({
      status: 'INSUFFICIENT_DATA',
      confidence: 'INSUFFICIENT',
      urgency: 'NONE',
      recommendedQuantity: null,
      lowStock: true,
    });
    expect(young.steps.join(' ')).toContain('not enough history');

    const quiet = buildPlan({ ...base, transactions: 2, currentStock: 50 });
    expect(quiet).toMatchObject({ status: 'INSUFFICIENT_DATA', recommendedQuantity: null, lowStock: false });
  });

  it('grades confidence by days observed and sales count', () => {
    expect(confidenceOf(6, 100)).toBe('INSUFFICIENT');
    expect(confidenceOf(30, 2)).toBe('INSUFFICIENT');
    expect(confidenceOf(7, 3)).toBe('LOW');
    expect(confidenceOf(13, 100)).toBe('LOW');
    expect(confidenceOf(30, 9)).toBe('LOW');
    expect(confidenceOf(14, 10)).toBe('MEDIUM');
    expect(confidenceOf(27, 50)).toBe('MEDIUM');
    expect(confidenceOf(28, 10)).toBe('HIGH');
  });

  it('handles zero demand and zero or negative stock', () => {
    const none = buildPlan({ ...base, eligibleUnits: 0, currentStock: 0 });
    expect(none).toMatchObject({ status: 'OK', averageDailyDemand: '0.00', reorderPoint: 0, daysOfCover: null, recommendedQuantity: 0 });

    const empty = buildPlan({ ...base, eligibleUnits: 30, currentStock: 0 });
    expect(empty).toMatchObject({ status: 'REORDER', urgency: 'CRITICAL', recommendedQuantity: 24, daysOfCover: '0.0' });

    const negative = buildPlan({ ...base, eligibleUnits: 30, currentStock: -3 });
    expect(negative).toMatchObject({ urgency: 'CRITICAL', position: -3, recommendedQuantity: 27 });
  });

  it('rounds each component up and handles zero coverage days', () => {
    const tiny = buildPlan({ ...base, eligibleUnits: 1 });
    expect(tiny).toMatchObject({ leadTimeDemand: 1, safetyStock: 1, coverageStock: 1, reorderPoint: 2, orderUpToLevel: 3 });

    const noCoverage = { ...base, eligibleUnits: 30, coverageDays: 0 }; // reorder point = order-up-to = 10
    expect(buildPlan({ ...noCoverage, currentStock: 10 })).toMatchObject({ status: 'OK', recommendedQuantity: 0 });
    expect(buildPlan({ ...noCoverage, currentStock: 9 })).toMatchObject({ status: 'REORDER', recommendedQuantity: 1 });
  });
});