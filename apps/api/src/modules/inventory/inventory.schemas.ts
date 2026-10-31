import { z } from 'zod';

const MOVEMENT_TYPES = ['OPENING', 'ADJUSTMENT', 'DAMAGED', 'LOST', 'RECONCILIATION'] as const;

export const createMovementSchema = z
  .object({
    productId: z.string().uuid(),
    type: z.enum(MOVEMENT_TYPES),
    quantity: z.number().int('Use a whole number').min(-1_000_000).max(1_000_000),
    reason: z
      .string()
      .trim()
      .max(300)
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
    idempotencyKey: z
      .string()
      .trim()
      .min(8, 'Use at least 8 characters')
      .max(100)
      .regex(/^[A-Za-z0-9._:-]+$/, 'Use letters, numbers, dots, dashes, underscores or colons'),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (['OPENING', 'DAMAGED', 'LOST'].includes(value.type) && value.quantity < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['quantity'],
        message: 'Enter a quantity of at least 1',
      });
    }
    if (value.type === 'ADJUSTMENT') {
      if (value.quantity === 0)
        ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Adjustment cannot be zero' });
      if (!value.reason)
        ctx.addIssue({
          code: 'custom',
          path: ['reason'],
          message: 'Give a reason for the adjustment',
        });
    }
    if (value.type === 'RECONCILIATION' && value.quantity < 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['quantity'],
        message: 'Counted quantity cannot be negative',
      });
    }
  });

export const listMovementsQuery = z.object({
  productId: z.string().uuid().optional(),
  type: z
    .enum([
      'OPENING',
      'RECEIPT',
      'SALE',
      'RETURN',
      'ADJUSTMENT',
      'DAMAGED',
      'LOST',
      'RECONCILIATION',
    ])
    .optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const lowStockQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type CreateMovementInput = z.infer<typeof createMovementSchema>;
export type ListMovementsQuery = z.infer<typeof listMovementsQuery>;
export type LowStockQuery = z.infer<typeof lowStockQuery>;
