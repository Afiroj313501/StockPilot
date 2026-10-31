import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable();
const money = z
  .number()
  .min(0, 'Cannot be negative')
  .max(1_000_000_000, 'Too large')
  .refine((v) => Math.round(v * 100) / 100 === v, 'Use at most 2 decimal places');
const shape = {
  name: z.string().trim().min(1, 'Enter a name').max(200),
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, 'Enter a SKU')
    .max(64)
    .regex(/^[A-Z0-9][A-Z0-9._/-]*$/, 'Use letters, numbers, dots, dashes, underscores or slashes'),
  barcode: optionalText(64).refine(
    (v) => v === null || /^[A-Za-z0-9._-]+$/.test(v),
    'Use letters, numbers, dots, dashes or underscores',
  ),
  description: optionalText(1000),
  unit: optionalText(20),
  categoryId: z.string().uuid().nullable(),
  costPrice: money,
  sellingPrice: money,
  reorderThreshold: z.number().int().min(0).max(1_000_000).nullable(),
};

export const createProductSchema = z
  .object({
    name: shape.name,
    sku: shape.sku,
    costPrice: shape.costPrice,
    sellingPrice: shape.sellingPrice,
    barcode: shape.barcode.optional(),
    description: shape.description.optional(),
    unit: shape.unit.optional(),
    categoryId: shape.categoryId.optional(),
    reorderThreshold: shape.reorderThreshold.optional(),
  })
  .strict();
export const updateProductSchema = z
  .object({ ...shape, isActive: z.boolean() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');
export const listProductsQuery = z.object({
  search: z.string().trim().max(100).optional(),
  categoryId: z.string().uuid().optional(),
  status: z.enum(['active', 'archived', 'all']).default('active'),
  sort: z.enum(['name', 'sku', 'sellingPrice', 'stockQuantity', 'createdAt']).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuery>;
