import { z } from 'zod';

const money = z
  .number()
  .min(0, 'Cannot be negative')
  .max(1_000_000_000, 'Too large')
  .refine((v) => Math.round(v * 100) / 100 === v, 'Use at most 2 decimal places');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable();

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Enter a real date')
  .nullable();

const itemSchema = z
  .object({
    productId: z.string().uuid(),
    quantityOrdered: z.number().int('Use a whole number').min(1, 'At least 1').max(1_000_000),
    unitCost: money,
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

export const createPurchaseSchema = z
  .object({
    supplierId: z.string().uuid(),
    notes: optionalText(1000).optional(),
    expectedDate: dateOnly.optional(),
    items: itemsSchema,
  })
  .strict();

export const updatePurchaseSchema = z
  .object({
    supplierId: z.string().uuid(),
    notes: optionalText(1000),
    expectedDate: dateOnly,
    items: itemsSchema,
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');

export const cancelPurchaseSchema = z.object({ reason: optionalText(300).optional() }).strict();

export const listPurchasesQuery = z.object({
  status: z
    .enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'])
    .optional(),
  supplierId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;
export type UpdatePurchaseInput = z.infer<typeof updatePurchaseSchema>;
export type CancelPurchaseInput = z.infer<typeof cancelPurchaseSchema>;
export type ListPurchasesQuery = z.infer<typeof listPurchasesQuery>;
