import { z } from 'zod';

const amount = z
  .number()
  .min(0, 'Cannot be negative')
  .max(1_000_000_000, 'Too large')
  .refine((v) => Math.round(v * 100) / 100 === v, 'Use at most 2 decimal places');

const itemSchema = z
  .object({
    productId: z.string().uuid(),
    quantity: z.number().int('Use a whole number').min(1, 'At least 1').max(100_000),
  })
  .strict();

const itemsSchema = z
  .array(itemSchema)
  .min(1, 'Add at least one product')
  .max(200, 'Too many lines')
  .refine(
    (items) => new Set(items.map((i) => i.productId)).size === items.length,
    'Each product can appear only once',
  );

const discountSchema = z
  .object({ type: z.enum(['PERCENT', 'AMOUNT']), value: z.number() })
  .strict()
  .superRefine((d, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', path: ['value'], message });
    if (Math.round(d.value * 100) / 100 !== d.value) issue('Use at most 2 decimal places');
    if (d.value <= 0) issue('Must be more than 0');
    if (d.type === 'PERCENT' && d.value > 100) issue('Cannot exceed 100');
    if (d.type === 'AMOUNT' && d.value > 1_000_000_000) issue('Too large');
  });

// Strict: total, unitPrice, taxTotal, storeId, cashierId... are rejected, never trusted.
export const previewSaleSchema = z
  .object({
    items: itemsSchema,
    discount: discountSchema.nullable().optional(),
  })
  .strict();

export const checkoutSchema = z
  .object({
    idempotencyKey: z
      .string()
      .trim()
      .min(8, 'Use at least 8 characters')
      .max(100)
      .regex(/^[A-Za-z0-9._:-]+$/, 'Use letters, numbers, dots, dashes, underscores or colons'),
    items: itemsSchema,
    discount: discountSchema.nullable().optional(),
    customerName: z
      .string()
      .trim()
      .max(100)
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
    payment: z
      .object({
        method: z.enum(['CASH', 'CARD', 'MOBILE', 'OTHER']),
        amountTendered: amount,
      })
      .strict(),
    // The total the cashier saw. If the server total differs, nothing is saved (409).
    expectedTotal: amount.optional(),
  })
  .strict();

export const listSalesQuery = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PreviewInput = z.infer<typeof previewSaleSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type ListSalesQuery = z.infer<typeof listSalesQuery>;
