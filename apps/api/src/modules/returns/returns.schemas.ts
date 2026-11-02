import { z } from 'zod';

const REASONS = ['CHANGED_MIND', 'DAMAGED', 'WRONG_ITEM', 'OTHER'] as const;

const quantity = z.number().int('Use a whole number').min(1, 'At least 1').max(100_000);
const uniqueProducts = (items: { productId: string }[]) =>
  new Set(items.map((i) => i.productId)).size === items.length;

const previewLine = z.object({ productId: z.string().uuid(), quantity }).strict();

// `restock` is required on purpose: the restocking decision is always explicit.
const returnLine = z
  .object({
    productId: z.string().uuid(),
    quantity,
    restock: z.boolean(),
    reason: z.enum(REASONS),
  })
  .strict();

// Strict: refundTotal, storeId, status, refundAmount... are rejected. Refunds are
// always calculated by the server from the sale's saved figures.
export const previewReturnSchema = z
  .object({
    saleId: z.string().uuid(),
    items: z
      .array(previewLine)
      .min(1, 'Choose at least one product')
      .max(200)
      .refine(uniqueProducts, 'Each product can appear only once'),
  })
  .strict();

export const createReturnSchema = z
  .object({
    saleId: z.string().uuid(),
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
      .array(returnLine)
      .min(1, 'Choose at least one product')
      .max(200)
      .refine(uniqueProducts, 'Each product can appear only once'),
  })
  .strict();

export const listReturnsQuery = z.object({
  saleId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PreviewReturnInput = z.infer<typeof previewReturnSchema>;
export type CreateReturnInput = z.infer<typeof createReturnSchema>;
export type ListReturnsQuery = z.infer<typeof listReturnsQuery>;
