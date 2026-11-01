import { z } from 'zod';

const lineSchema = z
  .object({
    productId: z.string().uuid(),
    quantity: z.number().int('Use a whole number').min(1, 'At least 1').max(1_000_000),
  })
  .strict();

// Strict: storeId, status, unitCost, quantityReceived... are rejected.
export const receivePurchaseSchema = z
  .object({
    idempotencyKey: z
      .string()
      .trim()
      .min(8, 'Use at least 8 characters')
      .max(100)
      .regex(/^[A-Za-z0-9._:-]+$/, 'Use letters, numbers, dots, dashes, underscores or colons'),
    note: z
      .string()
      .trim()
      .max(300)
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
    items: z
      .array(lineSchema)
      .min(1, 'Enter a quantity for at least one product')
      .max(200)
      .refine(
        (items) => new Set(items.map((i) => i.productId)).size === items.length,
        'Each product can appear only once',
      ),
  })
  .strict();

export type ReceivePurchaseInput = z.infer<typeof receivePurchaseSchema>;