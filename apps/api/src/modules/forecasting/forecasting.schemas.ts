import { z } from 'zod';

const days = (min: number, max: number, def: number) =>
  z.coerce.number().int().min(min).max(max).default(def);

export const paramsQuery = z.object({
  windowDays: days(7, 180, 30),
  safetyDays: days(0, 60, 3),
  coverageDays: days(0, 180, 14),
});

export const listQuery = paramsQuery.extend({
  includeHandled: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

const paramsBody = z
  .object({
    windowDays: z.number().int().min(7).max(180),
    safetyDays: z.number().int().min(0).max(60),
    coverageDays: z.number().int().min(0).max(180),
  })
  .strict();

const note = z
  .string()
  .trim()
  .max(300)
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

// Strict: storeId, status, recommendedQuantity... are rejected. The server recomputes the
// recommendation itself and never trusts one sent by the browser.
export const approveSchema = z
  .object({
    idempotencyKey: z
      .string()
      .trim()
      .min(8, 'Use at least 8 characters')
      .max(100)
      .regex(/^[A-Za-z0-9._:-]+$/, 'Use letters, numbers, dots, dashes, underscores or colons'),
    quantity: z.number().int('Use a whole number').min(1, 'At least 1').max(1_000_000).optional(),
    supplierId: z.string().uuid().optional(),
    note,
    params: paramsBody.optional(),
  })
  .strict();

export const decisionSchema = z.object({ note, params: paramsBody.optional() }).strict();

export type PlannerParams = z.infer<typeof paramsQuery>;
export type ApproveInput = z.infer<typeof approveSchema>;
export type DecisionInput = z.infer<typeof decisionSchema>;

export const DEFAULT_PARAMS: PlannerParams = { windowDays: 30, safetyDays: 3, coverageDays: 14 };
