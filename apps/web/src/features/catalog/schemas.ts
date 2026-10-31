import { z } from 'zod';
import type { Product, ProductPayload } from '../../types/api';
const amount = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,2})?$/, 'Enter an amount like 12.50');
export const productFormSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(200),
  sku: z
    .string()
    .trim()
    .min(1, 'Enter a SKU')
    .max(64)
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._/-]*$/,
      'Use letters, numbers, dots, dashes, underscores or slashes',
    ),
  barcode: z
    .string()
    .trim()
    .max(64)
    .refine((value) => value === '' || /^[A-Za-z0-9._-]+$/.test(value), 'Invalid barcode'),
  description: z.string().trim().max(1000),
  unit: z.string().trim().max(20),
  categoryId: z.string(),
  costPrice: amount,
  sellingPrice: amount,
  reorderThreshold: z
    .string()
    .trim()
    .refine(
      (value) => value === '' || (/^\d{1,7}$/.test(value) && Number(value) <= 1_000_000),
      'Use a whole number or leave blank',
    ),
});
export type ProductFormValues = z.infer<typeof productFormSchema>;
export const emptyProductForm: ProductFormValues = {
  name: '',
  sku: '',
  barcode: '',
  description: '',
  unit: '',
  categoryId: '',
  costPrice: '',
  sellingPrice: '',
  reorderThreshold: '',
};
export function toProductForm(product: Product): ProductFormValues {
  return {
    name: product.name,
    sku: product.sku,
    barcode: product.barcode ?? '',
    description: product.description ?? '',
    unit: product.unit ?? '',
    categoryId: product.categoryId ?? '',
    costPrice: product.costPrice ?? '',
    sellingPrice: product.sellingPrice,
    reorderThreshold: product.reorderThreshold === null ? '' : String(product.reorderThreshold),
  };
}
export function toProductPayload(value: ProductFormValues): ProductPayload {
  return {
    name: value.name,
    sku: value.sku,
    barcode: value.barcode || null,
    description: value.description || null,
    unit: value.unit || null,
    categoryId: value.categoryId || null,
    costPrice: Number(value.costPrice),
    sellingPrice: Number(value.sellingPrice),
    reorderThreshold: value.reorderThreshold === '' ? null : Number(value.reorderThreshold),
  };
}
