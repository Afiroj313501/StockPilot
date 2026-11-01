import { z } from 'zod';

const money = z
  .number()
  .min(0, 'Cannot be negative')
  .max(1_000_000_000, 'Too large')
  .refine((value) => Math.round(value * 100) / 100 === value, 'Use at most 2 decimal places');
const line = z
  .object({
    productId: z.string().uuid(),
    quantityOrdered: z.number().int().min(1).max(1_000_000),
    unitCost: money,
  })
  .strict();

export const purchaseOrderSchema = z
  .object({
    supplierId: z.string().uuid(),
    notes: z.string().trim().max(1000).nullable().optional(),
    lines: z.array(line).min(1).max(1000),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = value.lines.map((item) => item.productId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lines'],
        message: 'Each product may appear only once',
      });
    }
  });
export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;
